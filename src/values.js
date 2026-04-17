// values.js — selectable piece-value systems + openness-aware bishop-pair
// bonus + classical imbalance calculations (Kaufman, Berliner, AlphaZero,
// Stockfish-modern, Classical). Pure functions, no DOM.
//
// All values in centipawns (pawn = 100).

// ──────────────────────────────────────────────────────────────────
//  Value systems — each a table of base piece values, MG/EG, plus
//  bishop-pair bonus rules.
// ──────────────────────────────────────────────────────────────────

export const VALUE_SYSTEMS = {
  classical: {
    name: 'Classical (1/3/3/5/9)',
    note: 'Teaching default from Staunton/Capablanca tradition.',
    mg: { p:100, n:300, b:300, r:500, q:900 },
    eg: { p:100, n:300, b:300, r:500, q:900 },
    pair:   { open: 50, semi: 50, closed: 50 },
    pawnAdjustN: 0,   // no Kaufman adjustment
    pawnAdjustR: 0,
    secondRookPenalty: { mg: 0, eg: 0 },
  },

  kaufman1999: {
    name: 'Kaufman 1999',
    note: 'Kaufman\'s original imbalance paper (300k games, 2300+ FIDE).',
    mg: { p:100, n:325, b:325, r:500, q:975 },
    eg: { p:100, n:325, b:325, r:500, q:975 },
    pair:   { open: 50, semi: 50, closed: 50 },
    pawnAdjustN:  6.25,   // +6.25 cp per pawn above 5
    pawnAdjustR: -12.5,   // −12.5 cp per pawn above 5
    secondRookPenalty: { mg: 0, eg: 0 },
  },

  kaufman2021: {
    name: 'Kaufman 2021 (phase-aware)',
    note: 'Kaufman\'s most recent — values shift with whose queen(s) are on.',
    mg: { p:80,  n:320, b:330, r:470, q:1000 },
    eg: { p:100, n:320, b:330, r:530, q:1000 },
    pair:   { open: 30, semi: 40, closed: 50 },
    pawnAdjustN:  6.25,
    pawnAdjustR: -12.5,
    secondRookPenalty: { mg: 20, eg: 30 },
  },

  berliner: {
    name: 'Berliner ("The System")',
    note: 'Hans Berliner, 1999. Openness multiplies piece values.',
    mg: { p:100, n:320, b:333, r:510, q:880 },
    eg: { p:100, n:320, b:333, r:510, q:880 },
    pair:   { open: 50, semi: 40, closed: 30 },
    pawnAdjustN: 0,   // Berliner uses multipliers instead (applied below)
    pawnAdjustR: 0,
    secondRookPenalty: { mg: 0, eg: 0 },
    openClosedMult: true,   // special flag — apply Berliner multipliers
  },

  alphazero: {
    name: 'AlphaZero-derived',
    note: 'Inferred from DeepMind\'s 2017 self-play net.',
    mg: { p:100, n:305, b:333, r:563, q:950 },
    eg: { p:100, n:305, b:333, r:563, q:950 },
    pair:   { open: 40, semi: 40, closed: 40 },
    pawnAdjustN: 0,
    pawnAdjustR: 0,
    secondRookPenalty: { mg: 0, eg: 0 },
  },

  stockfishClassical: {
    name: 'Stockfish (classical, pre-NNUE)',
    note: 'What SF 11 used in its hand-crafted eval.',
    mg: { p:128, n:781, b:825, r:1276, q:2538 },
    eg: { p:213, n:854, b:915, r:1380, q:2682 },
    pair:   { open: 50, semi: 40, closed: 30 },
    pawnAdjustN: 0,
    pawnAdjustR: 0,
    secondRookPenalty: { mg: 0, eg: 0 },
  },

  avrukh: {
    name: 'Avrukh (GM practical)',
    note: 'Boris Avrukh\'s framework: pair = 7 total, vanishes in closed positions. Activity > static count.',
    mg: { p:100, n:325, b:325, r:500, q:975 },
    eg: { p:100, n:325, b:325, r:500, q:975 },
    // Steeper openness curve: pair matters MUCH more open, nearly gone closed
    pair:   { open: 50, semi: 25, closed: 10 },
    pawnAdjustN: 0,
    pawnAdjustR: 0,
    secondRookPenalty: { mg: 0, eg: 0 },
  },

  default2026: {
    name: 'Modern default (2026)',
    note: 'Converged values from Kaufman-2021, ubdip regression, AlphaZero. Recommended.',
    mg: { p:100, n:320, b:330, r:500, q:950 },
    eg: { p:100, n:320, b:330, r:530, q:950 },
    pair:   { open: 40, semi: 40, closed: 55 },
    pawnAdjustN:  6.25,
    pawnAdjustR: -12.5,
    secondRookPenalty: { mg: 20, eg: 0 },
  },
};

// ──────────────────────────────────────────────────────────────────
//  Openness + phase detection
// ──────────────────────────────────────────────────────────────────

export function countPawns(board) {
  let c = 0;
  for (const row of board) for (const s of row)
    if (s && s.type === 'p') c++;
  return c;
}

export function countAllPieces(board) {
  let c = 0;
  for (const row of board) for (const s of row) if (s) c++;
  return c;
}

/**
 * Openness classification based on total pawn count (both sides).
 * 14-16 pawns = closed, 10-13 = semi-open, ≤ 9 = open.
 */
export function classifyOpenness(board) {
  const p = countPawns(board);
  if (p >= 14) return { label: 'closed', pawns: p };
  if (p >= 10) return { label: 'semi',   pawns: p };
  return              { label: 'open',   pawns: p };
}

/**
 * Game-phase heuristic: middlegame vs endgame based on major pieces.
 * Queen present on either side → MG; else EG. Approximate.
 */
export function classifyPhase(board) {
  let qW = 0, qB = 0;
  for (const row of board) for (const s of row) {
    if (!s) continue;
    if (s.type === 'q' && s.color === 'w') qW++;
    if (s.type === 'q' && s.color === 'b') qB++;
  }
  if (qW && qB)     return 'mg';
  if (qW || qB)     return 'threshold';
  return 'eg';
}

// ──────────────────────────────────────────────────────────────────
//  Material / imbalance calculation
// ──────────────────────────────────────────────────────────────────

/**
 * Compute material balance from White's POV (positive = White ahead).
 * Returns a structured breakdown:
 *   { diff, breakdown: { component: cp }, hasPair: {w,b}, openness, phase }
 */
export function computeImbalance(board, systemKey = 'default2026') {
  const sys = VALUE_SYSTEMS[systemKey] || VALUE_SYSTEMS.default2026;
  const openness = classifyOpenness(board);
  const phase    = classifyPhase(board);
  const pawnCount = openness.pawns;

  // Count pieces per side
  const count = {
    w: { p:0, n:0, b:0, r:0, q:0 },
    b: { p:0, n:0, b:0, r:0, q:0 },
  };
  for (const row of board) for (const s of row) {
    if (!s || s.type === 'k') continue;
    count[s.color][s.type]++;
  }

  // Pick MG or EG value table
  const table = (phase === 'eg') ? sys.eg : sys.mg;

  // Per-piece values with Kaufman pawn-count corrections
  const vP = table.p;
  const vN = table.n + sys.pawnAdjustN * (pawnCount - 5);
  const vB = table.b;
  const vR = table.r + sys.pawnAdjustR * (pawnCount - 5);
  const vQ = table.q;

  // Berliner multipliers (if enabled)
  const berlMult = sys.openClosedMult
    ? berlinerMultipliers(pawnCount)
    : { n: 1, b: 1, r: 1, q: 1 };

  const forSide = (c) =>
    count[c].p * vP +
    count[c].n * vN * berlMult.n +
    count[c].b * vB * berlMult.b +
    count[c].r * vR * berlMult.r +
    count[c].q * vQ * berlMult.q;

  const wBase = forSide('w');
  const bBase = forSide('b');

  // Bishop-pair bonus (phase-aware, openness-aware)
  const bonusForPair =
    openness.label === 'open'   ? sys.pair.open   :
    openness.label === 'semi'   ? sys.pair.semi   :
                                  sys.pair.closed;
  const hasPair = { w: count.w.b >= 2, b: count.b.b >= 2 };
  const wPair = hasPair.w ? bonusForPair : 0;
  const bPair = hasPair.b ? bonusForPair : 0;

  // Second-rook redundancy penalty (Kaufman)
  const secondRookPen = phase === 'eg' ? sys.secondRookPenalty.eg : sys.secondRookPenalty.mg;
  const wRookPen = (count.w.r >= 2) ? secondRookPen : 0;
  const bRookPen = (count.b.r >= 2) ? secondRookPen : 0;

  const wTotal = wBase + wPair - wRookPen;
  const bTotal = bBase + bPair - bRookPen;
  const diff = Math.round(wTotal - bTotal);

  // Breakdown of the diff — exposes each component for display
  const breakdown = [];
  // Material balance piece-by-piece
  for (const t of ['p','n','b','r','q']) {
    const d = count.w[t] - count.b[t];
    if (d === 0) continue;
    const pieceVal = (t === 'p' ? vP : t === 'n' ? vN * berlMult.n :
                      t === 'b' ? vB * berlMult.b : t === 'r' ? vR * berlMult.r :
                      vQ * berlMult.q);
    breakdown.push({
      label: d > 0 ? `+${d} ${pieceName(t)}${Math.abs(d)>1?'s':''}` : `+${-d} ${pieceName(t)}${Math.abs(d)>1?'s':''} for Black`,
      cp: Math.round(d * pieceVal),
    });
  }
  if (wPair - bPair !== 0) {
    const side = wPair > bPair ? 'White' : 'Black';
    breakdown.push({
      label: `${side} bishop pair (${openness.label} position)`,
      cp: Math.round(wPair - bPair),
    });
  }
  if (wRookPen !== bRookPen) {
    const side = wRookPen > bRookPen ? 'White (−)' : 'Black (−)';
    breakdown.push({
      label: `${side} second-rook redundancy`,
      cp: Math.round(bRookPen - wRookPen),
    });
  }

  // Detect classic Kaufman imbalances
  const imbalances = detectImbalances(count, hasPair, phase);

  // Per-side explicit arithmetic — for the transparent calc view
  const arith = {};
  for (const c of ['w', 'b']) {
    const rows = [];
    if (count[c].p) rows.push({ piece: 'P', count: count[c].p, value: Math.round(vP),          sub: count[c].p * vP });
    if (count[c].n) rows.push({ piece: 'N', count: count[c].n, value: Math.round(vN*berlMult.n), sub: count[c].n * vN*berlMult.n });
    if (count[c].b) rows.push({ piece: 'B', count: count[c].b, value: Math.round(vB*berlMult.b), sub: count[c].b * vB*berlMult.b });
    if (count[c].r) rows.push({ piece: 'R', count: count[c].r, value: Math.round(vR*berlMult.r), sub: count[c].r * vR*berlMult.r });
    if (count[c].q) rows.push({ piece: 'Q', count: count[c].q, value: Math.round(vQ*berlMult.q), sub: count[c].q * vQ*berlMult.q });
    const pairBonus = (c === 'w' ? wPair : bPair);
    if (pairBonus) rows.push({ piece: 'pair', count: 1, value: Math.round(pairBonus), sub: pairBonus, note: `(${openness.label})` });
    const secondR = (c === 'w' ? wRookPen : bRookPen);
    if (secondR) rows.push({ piece: '−2nd R', count: 1, value: -Math.round(secondR), sub: -secondR });
    const total = rows.reduce((acc, r) => acc + r.sub, 0);
    arith[c] = { rows, total: Math.round(total) };
  }

  return {
    system:     sys.name,
    systemKey,
    note:       sys.note,
    phase,
    openness:   openness.label,
    pawnCount,
    whiteTotal: Math.round(wTotal),
    blackTotal: Math.round(bTotal),
    diff,
    breakdown,
    hasPair,
    imbalances,
    values: {
      p: Math.round(vP),
      n: Math.round(vN * berlMult.n),
      b: Math.round(vB * berlMult.b),
      r: Math.round(vR * berlMult.r),
      q: Math.round(vQ * berlMult.q),
      pair: bonusForPair,
    },
    arith,
  };
}

function pieceName(t) {
  return { p:'pawn', n:'knight', b:'bishop', r:'rook', q:'queen' }[t];
}

function berlinerMultipliers(pawnCount) {
  // Berliner: knight +50% when closed, bishop/rook/queen +10% open to −20% closed
  const closedness = Math.max(0, Math.min(1, (pawnCount - 8) / 8));
  return {
    n: 1 + 0.4 * closedness - 0.1,    // up to +50% closed, down to −10% open (adjusted to be symmetric-ish)
    b: 1 + 0.1 * (1 - closedness) - 0.2 * closedness,
    r: 1 + 0.1 * (1 - closedness) - 0.2 * closedness,
    q: 1 + 0.1 * (1 - closedness) - 0.2 * closedness,
  };
}

// Avrukh's seven rules + minor-piece hierarchy, surfaced contextually.
// Returns an array of {title, text} — rules that apply to the CURRENT
// imbalance on the board.
export function avrukhRules(board) {
  const rules = [];

  // Count pieces per side
  const count = { w:{p:0,n:0,b:0,r:0,q:0}, b:{p:0,n:0,b:0,r:0,q:0} };
  for (const row of board) for (const s of row) {
    if (!s || s.type === 'k') continue;
    count[s.color][s.type]++;
  }

  const minors = (c) => count[c].n + count[c].b;
  const hasPair = (c) => count[c].b >= 2;

  // ─── R + pawn vs 2 minors imbalance ───
  for (const [side, other] of [['w','b'], ['b','w']]) {
    const sideName  = side  === 'w' ? 'White' : 'Black';
    const otherName = other === 'w' ? 'White' : 'Black';
    // side has 2 minors; other has rook (and typically a pawn)
    if (minors(side) - minors(other) === 2 && count[other].r - count[side].r === 1) {
      // Avrukh's hierarchy of difficulty for the rook side
      const nMinorSide = count[side].n, bMinorSide = count[side].b;
      let hierarchy;
      if (bMinorSide === 2)                    hierarchy = `2 bishops (the hardest combination for the rook side — pair dominates open play)`;
      else if (nMinorSide === 1 && bMinorSide === 1) hierarchy = `bishop + knight (a fighting imbalance — both sides have trumps)`;
      else if (nMinorSide === 2)              hierarchy = `2 knights (easiest for the rook side — knights struggle to coordinate)`;
      else                                    hierarchy = `two minor pieces`;

      rules.push({
        title: `Avrukh — R vs 2 minors detected (${sideName} has ${hierarchy})`,
        text: `Boris Avrukh's seven rules apply here:
          <ol class="avrukh-rules">
            <li><strong>For ${sideName} (minors):</strong> keep as many pieces as possible — trade pawns, not pieces.</li>
            <li><strong>For ${sideName}:</strong> prefer queens on — minors are better with queens.</li>
            <li><strong>For ${sideName}:</strong> build outposts — fixed squares for knights are the minor-piece side's bread and butter.</li>
            <li><strong>For ${otherName} (rook):</strong> trade the bishop pair if present — ${hasPair(side) ? '<em>applies here.</em>' : '<em>not applicable, no pair.</em>'}</li>
            <li><strong>For ${otherName}:</strong> trade the opponent's rook — breaks their coordination and lets yours invade.</li>
            <li><strong>For ${otherName}:</strong> create a passed pawn to tie down a minor piece.</li>
            <li><strong>Rule 7 (both sides):</strong> material count is misleading — activity and coordination come first. "A rook protects a weak spot once, minor pieces attack twice."</li>
          </ol>`,
      });
    }
  }

  // ─── Bishop pair context reminder ───
  if (hasPair('w') !== hasPair('b')) {
    const pairSide = hasPair('w') ? 'White' : 'Black';
    const pawnCount = (() => { let p=0; for (const r of board) for (const s of r) if (s?.type==='p') p++; return p; })();
    const openness = pawnCount >= 14 ? 'closed' : pawnCount >= 10 ? 'semi-open' : 'open';
    const advice = openness === 'closed'
      ? `closed position — pair premium vanishes ("White can hardly hope to benefit from his bishop pair" — Avrukh on a similar Queen's Indian)`
      : openness === 'semi-open'
        ? `semi-open position — pair worth moderate extra`
        : `open position — pair worth full +0.5 premium (Avrukh: "pair = 7 total, half-point above two individual bishops")`;
    rules.push({
      title: `Avrukh — ${pairSide} has the bishop pair (${openness})`,
      text: `${advice}. When in doubt about trades, <strong>keep the bishops.</strong>`,
    });
  }

  // ─── Exchange-sacrifice terrain ───
  // Avrukh: compensation = space advantage + bilateral play.
  // Heuristic: one side has both MORE space AND pieces on 5th+ rank.
  // We don't compute space in this pure function; skip for now.
  // (Could be added later.)

  // ─── Queenless position guidance ───
  if (count.w.q === 0 && count.b.q === 0) {
    rules.push({
      title: 'Avrukh — queens off',
      text: `With queens off, Avrukh emphasises endgame principles: entry squares for rooks, passed pawns, king activity. His Rule 2 ("keep queens on if you have the minors") now reverses — the rook side wants exactly this terrain.`,
    });
  }

  return rules;
}

function detectImbalances(count, hasPair, phase) {
  const findings = [];
  // 2 minors vs R+P
  const wMinors = count.w.n + count.w.b;
  const bMinors = count.b.n + count.b.b;
  if (wMinors - bMinors === 2 && count.b.r - count.w.r === 1) {
    findings.push(`White has 2 minors vs Black's rook — minors slightly favored${hasPair.w ? ' (bishop pair boosts this)' : ''}.`);
  }
  if (bMinors - wMinors === 2 && count.w.r - count.b.r === 1) {
    findings.push(`Black has 2 minors vs White's rook — minors slightly favored${hasPair.b ? ' (bishop pair boosts this)' : ''}.`);
  }
  // Q vs 2R
  if (count.w.q && !count.b.q && count.b.r - count.w.r === 2) {
    findings.push(`White queen vs Black's two rooks — roughly equal; slim edge to rooks if pawns are balanced.`);
  }
  if (count.b.q && !count.w.q && count.w.r - count.b.r === 2) {
    findings.push(`Black queen vs White's two rooks — roughly equal; slim edge to rooks if pawns are balanced.`);
  }
  // Q vs 3 minors
  if (count.w.q && !count.b.q && bMinors - wMinors === 3) {
    findings.push(`White queen vs Black's three minors — three minors slightly favoured${hasPair.b ? ' (pair boosts further)' : ''}.`);
  }
  if (count.b.q && !count.w.q && wMinors - bMinors === 3) {
    findings.push(`Black queen vs White's three minors — three minors slightly favoured${hasPair.w ? ' (pair boosts further)' : ''}.`);
  }
  // The exchange (one side up the exchange)
  if (count.w.r - count.b.r === 1 && bMinors - wMinors === 1) {
    findings.push(`White is up the exchange (rook for minor).`);
  }
  if (count.b.r - count.w.r === 1 && wMinors - bMinors === 1) {
    findings.push(`Black is up the exchange (rook for minor).`);
  }
  return findings;
}

/** Short label for a system key, used in UI. */
export function systemOptions() {
  return Object.entries(VALUE_SYSTEMS).map(([k, v]) => ({ key: k, name: v.name }));
}
