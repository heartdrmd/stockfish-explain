// archetype.js — pawn-structure archetype detection + plan generation.
//
// Detects the four major middlegame pawn-structure types and returns a
// label, a health scorecard, and side-specific plans. Used by the
// positional Coach to turn generic advice into archetype-specific
// advice ("You have an IQP, so attack on the kingside via Bd3/Qd3"
// instead of just "you have an isolated pawn — find compensation").
//
// Structures covered:
//   • IQP           (isolated queen pawn on d-file)
//   • Carlsbad      (QGD Exchange skeleton: Black c6+d5+e6 vs White d4+c3+e3)
//   • Hanging       (adjacent pawns on 4th rank with flanking half-open files)
//   • Maroczy       (White c4+e4 vs Black lacking d-pawn)
//
// Methodology is a paraphrased synthesis of publicly-documented
// positional theory. No copyrighted text reproduced.

import { Chess } from '../vendor/chess.js/chess.js';

// ─── public API ─────────────────────────────────────────────────────

/**
 * Run detection over every known archetype. Returns null if no
 * structure matches; otherwise the HIGHEST-priority one with its
 * health scorecard and plans.
 */
export function detectArchetype(fen) {
  const chess = new Chess(fen);
  const board = chess.board();
  // Ordered most-specific → least-specific; first match wins
  const detectors = [
    detectIQP,
    detectCarlsbad,
    detectHangingPawns,
    detectMaroczy,
  ];
  for (const fn of detectors) {
    const result = fn(board, fen);
    if (result) return result;
  }
  return null;
}

// ─── helpers ────────────────────────────────────────────────────────

const FILE_IDX = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 };
const FILES = 'abcdefgh';

function at(board, file, rank) {
  // rank 1-8 (1 = board[7])
  const r = 8 - rank;
  const c = FILE_IDX[file];
  return board[r]?.[c] || null;
}
function pawnAt(board, file, rank, color) {
  const p = at(board, file, rank);
  return p && p.type === 'p' && p.color === color;
}
function anyPawnOnFile(board, file, color) {
  const c = FILE_IDX[file];
  for (let r = 0; r < 8; r++) {
    const p = board[r][c];
    if (p && p.type === 'p' && p.color === color) return true;
  }
  return false;
}
function piecesOf(board, color, type) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (p && p.color === color && p.type === type) {
      out.push({ file: FILES[c], rank: 8 - r, r, c });
    }
  }
  return out;
}
function controllers(chess, square, color) {
  // Count how many moves `color` has that land on `square`.
  const fp = chess.fen().split(' ');
  fp[1] = color; fp[3] = '-';
  try {
    const t = new Chess(fp.join(' '));
    return t.moves({ verbose: true }).filter(m => m.to === square).length;
  } catch { return 0; }
}

// ─── IQP (isolated d-pawn, classic) ─────────────────────────────────

function detectIQP(board, fen) {
  // Classic IQP: exactly one pawn on d-file, no friendly pawns on c or e,
  // and that pawn sits past its home rank (ranks 4-5 for White, 4-5 for Black).
  for (const side of ['w', 'b']) {
    const dpawns = [];
    for (let r = 0; r < 8; r++) {
      const p = board[r][FILE_IDX.d];
      if (p && p.type === 'p' && p.color === side) dpawns.push(8 - r);
    }
    if (dpawns.length !== 1) continue;
    if (anyPawnOnFile(board, 'c', side)) continue;
    if (anyPawnOnFile(board, 'e', side)) continue;
    const rank = dpawns[0];
    if (side === 'w' && rank < 4) continue;
    if (side === 'b' && rank > 5) continue;

    // Score health (8 features, ±2 each)
    const chess = new Chess(fen);
    const score = scoreIQP(chess, board, side, rank);
    const health = {
      ...score,
      band: classifyBand(score.total),
    };
    return {
      archetype: 'iqp',
      label: side === 'w' ? 'Isolated Queen Pawn (White\'s d-pawn)' : 'Isolated Queen Pawn (Black\'s d-pawn)',
      ownerSide: side,
      blockaderSide: side === 'w' ? 'b' : 'w',
      health,
      plans: iqpPlans(side),
      signals: iqpSignals(chess, board, side, health),
    };
  }
  return null;
}

function scoreIQP(chess, board, side, rank) {
  const enemy = side === 'w' ? 'b' : 'w';
  // Blockade square
  const blockRank = side === 'w' ? rank + 1 : rank - 1;
  const blockSq = 'd' + blockRank;
  const blocker = at(board, 'd', blockRank);
  let f1 = 0;
  if (blocker && blocker.color === enemy) {
    f1 = blocker.type === 'n' ? -2 : blocker.type === 'b' ? -1 : 0;
  }
  // Outposts on c5/e5 (Black IQP) or c4/e4 (White IQP)
  const outRank = side === 'w' ? 5 : 4;
  let f2 = 0;
  for (const f of ['c', 'e']) {
    const p = at(board, f, outRank);
    if (p && p.color === side && p.type === 'n') f2 = Math.max(f2, 2);
    else if (isHoleForSide(board, f, outRank, side)) f2 = Math.max(f2, 1);
  }
  // Open e-file for owner
  const eOpen = !anyPawnOnFile(board, 'e', side) && !anyPawnOnFile(board, 'e', enemy);
  const eSemiOpen = !anyPawnOnFile(board, 'e', side);
  const f3 = eOpen ? 2 : eSemiOpen ? 1 : 0;
  // Attacking bishop on b1-h7/h8-b1 diagonal
  let f4 = 0;
  const attackDiagFile = side === 'w' ? 'd' : 'd';   // Bd3 / Bd6 aim at enemy king
  const attackDiagRank = side === 'w' ? 3 : 6;
  const b = at(board, attackDiagFile, attackDiagRank);
  if (b && b.color === side && b.type === 'b') f4 = 1;
  // Queens on?
  const qW = piecesOf(board, 'w', 'q').length > 0;
  const qB = piecesOf(board, 'b', 'q').length > 0;
  const f5 = (qW && qB) ? 1 : -1;   // queen trade bad for IQP owner
  // Minor count
  const minors = (piecesOf(board, side, 'n').length + piecesOf(board, side, 'b').length);
  const f6 = minors >= 3 ? 1 : 0;
  // Enemy king castled short?
  const ek = piecesOf(board, enemy, 'k')[0];
  const castled = ek && ((enemy === 'w' && ek.rank === 1 && ek.c >= 6) ||
                         (enemy === 'b' && ek.rank === 8 && ek.c >= 6));
  const f7 = castled ? 1 : 0;
  // Endgame signal (queens off + minors ≤ 1)
  const f8 = (!qW && !qB && minors <= 1) ? -2 : 0;

  const total = f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  return { f1, f2, f3, f4, f5, f6, f7, f8, total };
}

function iqpPlans(side) {
  return {
    [side]: [
      { pri: 1, text: `Keep minor pieces on — you need attackers for a kingside assault.` },
      { pri: 1, text: `Aim for Ne5 / ...Ne4 outpost; control the key central square.` },
      { pri: 2, text: `Open the position via e4-e5 (or ...e5-e4) lever when pieces are ready.` },
      { pri: 2, text: `Battery your light-squared bishop + queen on the b1-h7 diagonal toward h7 (or h2).` },
      { pri: 3, text: `Refuse queen trades — the endgame is your enemy.` },
    ],
    [side === 'w' ? 'b' : 'w']: [
      { pri: 1, text: `Plant a knight on the blockade square (d5 or d4) defended by a pawn.` },
      { pri: 1, text: `Trade queens — the IQP is a long-term weakness in the endgame.` },
      { pri: 2, text: `Trade the attacker's light-squared bishop to neutralize the kingside threat.` },
      { pri: 2, text: `Double on the c- or d-file to pressure the isolani directly.` },
      { pri: 3, text: `Keep your own dark-squared bishop to defend the blockade.` },
    ],
  };
}

function iqpSignals(chess, board, side, health) {
  const signals = [];
  if (health.f8 < 0) signals.push('Endgame with IQP still on board — losing trajectory.');
  if (health.f1 === -2) signals.push('Knight blockader on d5/d4 — severe restriction.');
  if (health.f5 < 0) signals.push('Queens off — IQP side\'s main attacking resource gone.');
  if (health.total <= -4) signals.push('Time pressure — attack or concede structural play.');
  return signals;
}

// ─── Carlsbad ───────────────────────────────────────────────────────

function detectCarlsbad(board, fen) {
  // Black pawns on c6 + d5 + e6 (REQUIRED), a7 b7 (intact with ±1 drift),
  // White pawns a2 b2 c3 d4 e3 (loose tolerance).
  // Mirror case: White carries the structure if a reversed opening arose.
  for (const side of ['b', 'w']) {
    const carlsbad = (side === 'b')
      ? pawnAt(board, 'c', 6, 'b') && pawnAt(board, 'd', 5, 'b') && pawnAt(board, 'e', 6, 'b')
          && pawnAt(board, 'd', 4, 'w') && pawnAt(board, 'c', 3, 'w') && pawnAt(board, 'e', 3, 'w')
      : pawnAt(board, 'c', 3, 'w') && pawnAt(board, 'd', 4, 'w') && pawnAt(board, 'e', 3, 'w')
          && pawnAt(board, 'd', 5, 'b') && pawnAt(board, 'c', 6, 'b') && pawnAt(board, 'e', 6, 'b');
    if (!carlsbad) continue;
    // Exclude Stonewall (pawn on f4)
    if (pawnAt(board, 'f', 4, 'w') || pawnAt(board, 'f', 5, 'b')) continue;

    const attackerSide = side === 'b' ? 'w' : 'b';   // minority-attacker
    const chess = new Chess(fen);
    return {
      archetype: 'carlsbad',
      label: 'Carlsbad structure (QGD Exchange skeleton)',
      ownerSide: side,           // side with the c6/c3 pawn and heavier queenside
      attackerSide,              // side with queenside pawn majority
      minorityViability: scoreMinorityAttack(chess, board, attackerSide),
      plans: carlsbadPlans(attackerSide),
      signals: [],
    };
  }
  return null;
}

function scoreMinorityAttack(chess, board, attacker) {
  // Score viability of the minority attack plan from attacker's POV
  const defender = attacker === 'w' ? 'b' : 'w';
  let s = 0;
  const notes = [];
  // Rook on b-file or b-file clear?
  const rooksAtt = piecesOf(board, attacker, 'r');
  if (rooksAtt.some(r => r.file === 'b')) { s += 1; notes.push('Rook already on b-file'); }
  // Defender's a-pawn on a5/a4? Freezes the attack
  const aFreezeRank = defender === 'b' ? 5 : 4;
  if (pawnAt(board, 'a', aFreezeRank, defender)) { s -= 2; notes.push(`Defender's a-pawn on a${aFreezeRank} brakes the plan`); }
  // Can defender break with ...c5 easily? (check square c5/c4 controllers)
  const breakRank = defender === 'b' ? 5 : 4;
  const breakSq = 'c' + breakRank;
  const cDefenders = controllers(chess, breakSq, defender);
  const cAttackers = controllers(chess, breakSq, attacker);
  if (cDefenders > cAttackers) { s -= 2; notes.push(`Defender controls ${breakSq} — ...c5 break threatens`); }
  // Queen well placed?
  const qs = piecesOf(board, attacker, 'q');
  if (qs.some(q => (q.file === 'c' && q.rank === (attacker === 'w' ? 2 : 7))
               || (q.file === 'b' && q.rank === (attacker === 'w' ? 3 : 6)))) {
    s += 1; notes.push('Queen on c2/c7 or b3/b6 — good support');
  }
  // Attacker's king castled?
  const k = piecesOf(board, attacker, 'k')[0];
  const kCastled = k && k.c >= 6 && k.rank === (attacker === 'w' ? 1 : 8);
  if (!kCastled) { s -= 1; notes.push('King not yet castled'); }

  const verdict = s >= 2 ? 'execute' : s >= 0 ? 'prepare' : 'abandon';
  return { score: s, verdict, notes };
}

function carlsbadPlans(attackerSide) {
  const a = attackerSide, d = attackerSide === 'w' ? 'b' : 'w';
  return {
    [a]: [
      { pri: 1, text: `MINORITY ATTACK: Rb1, b2-b4, a2-a4, b4-b5 — create a weak c-pawn to target.` },
      { pri: 2, text: `If Black plays ...a5, abandon minority attack — switch to kingside pawn storm (f3, e4).` },
      { pri: 2, text: `Control b5 square — knight support (Nd2-f1-g3 path) before pushing.` },
      { pri: 3, text: `Queen on c2 or b3, keep c3 pawn defended.` },
    ],
    [d]: [
      { pri: 1, text: `Prepare ...e6-e5 break: ...Re8, ...Nd7, ...Bf8/...Bd6 setup.` },
      { pri: 1, text: `If White's minority attack is coming, play ...a5 to freeze b4, or counter with ...b5.` },
      { pri: 2, text: `Knight to e4 (via Nf6-e4 or Nd7-f6-e4) to stabilize the center.` },
      { pri: 3, text: `Trade light-squared bishops via ...Bg4 if it simplifies Black's main piece problem.` },
    ],
  };
}

// ─── Hanging pawns ──────────────────────────────────────────────────

function detectHangingPawns(board, fen) {
  // Adjacent friendly pawns on c+d or d+e on rank 4 (White) / 5 (Black),
  // no friendly pawns on the flanking files, both files half-open for enemy.
  for (const side of ['w', 'b']) {
    const rank = side === 'w' ? 4 : 5;
    const pairs = [['c', 'd'], ['d', 'e']];
    for (const [f1, f2] of pairs) {
      if (!pawnAt(board, f1, rank, side) || !pawnAt(board, f2, rank, side)) continue;
      // flanks must be clean of own pawns
      const flankL = f1 === 'a' ? null : FILES[FILE_IDX[f1] - 1];
      const flankR = f2 === 'h' ? null : FILES[FILE_IDX[f2] + 1];
      if (flankL && anyPawnOnFile(board, flankL, side)) continue;
      if (flankR && anyPawnOnFile(board, flankR, side)) continue;
      const chess = new Chess(fen);
      const health = scoreHangingPawns(chess, board, side, f1, f2);
      return {
        archetype: 'hanging',
        label: `Hanging pawns (${f1}${rank} + ${f2}${rank})`,
        ownerSide: side,
        blockaderSide: side === 'w' ? 'b' : 'w',
        pawnsOn: [f1 + rank, f2 + rank],
        health,
        plans: hangingPlans(side),
        signals: [],
      };
    }
  }
  return null;
}

function scoreHangingPawns(chess, board, side, f1, f2) {
  const enemy = side === 'w' ? 'b' : 'w';
  let s = 0;
  // Long-diagonal bishop support
  const lsbRank = side === 'w' ? 2 : 7;
  if (pieceOnSquare(board, side, 'b', 'b', lsbRank)) s += 0.4;
  if (pieceOnSquare(board, side, 'b', 'g', lsbRank)) s += 0.4;
  // Own rook on semi-open flanking file (b or e typically)
  for (const f of ['b', 'e']) {
    if (piecesOf(board, side, 'r').some(r => r.file === f)) s += 0.3;
  }
  // Enemy knight on blockade square (d5 for white hanging, d4 for black hanging)
  const blockRank = side === 'w' ? 5 : 4;
  const blocker = at(board, 'd', blockRank);
  if (blocker && blocker.color === enemy && blocker.type === 'n') s -= 0.5;
  // Enemy pawn defending blockader on e6/e3
  if (pawnAt(board, 'e', side === 'w' ? 6 : 3, enemy)) s -= 0.2;
  // Queens off → bad for hanging owner
  const qW = piecesOf(board, 'w', 'q').length > 0;
  const qB = piecesOf(board, 'b', 'q').length > 0;
  if (!qW && !qB) s -= 0.4;
  // Minor count ≥ 3
  const minors = piecesOf(board, side, 'n').length + piecesOf(board, side, 'b').length;
  if (minors >= 3) s += 0.4;
  return { score: +s.toFixed(2), owner: side };
}

function pieceOnSquare(board, color, type, file, rank) {
  const p = at(board, file, rank);
  return p && p.color === color && p.type === type;
}

function hangingPlans(side) {
  const s = side, o = side === 'w' ? 'b' : 'w';
  return {
    [s]: [
      { pri: 1, text: `Prepare d-pawn break (d5 or ...d5) — liquidation or space-gain at the right moment.` },
      { pri: 1, text: `Keep minor pieces on the board; trade heavy pieces to avoid blockade.` },
      { pri: 2, text: `Rook lift (Rd1-d3-h3) for a kingside attack leveraging the central mass.` },
      { pri: 3, text: `Trade the opponent's blockading knight even at the cost of a tempo.` },
    ],
    [o]: [
      { pri: 1, text: `Plant a knight on the blockade square (d5 / d4), protected by a pawn.` },
      { pri: 2, text: `Double rooks on the c- or d-file to pressure the pawns directly.` },
      { pri: 2, text: `Trade queens — endgame is strategically winning against static hanging pawns.` },
      { pri: 3, text: `Provoke a premature d-push, then attack the isolated c-pawn that remains.` },
    ],
  };
}

// ─── Maroczy bind ───────────────────────────────────────────────────

function detectMaroczy(board, fen) {
  // White pawns on c4 AND e4, no white pawn on d-file (or d3 only),
  // Black has no c7-pawn (typically already played ...c5 and traded).
  if (!pawnAt(board, 'c', 4, 'w') || !pawnAt(board, 'e', 4, 'w')) return null;
  if (anyPawnOnFile(board, 'd', 'w') && !pawnAt(board, 'd', 3, 'w')) return null;
  if (pawnAt(board, 'c', 7, 'b')) return null;
  // Black typically has d6 pawn (or has traded it)
  const blackDs = piecesOf(board, 'b', 'p').filter(p => p.file === 'd');
  if (blackDs.length > 1) return null;

  const chess = new Chess(fen);
  const health = scoreMaroczy(chess, board);
  return {
    archetype: 'maroczy',
    label: 'Maroczy Bind (c4 + e4 vs ...c5 complex)',
    ownerSide: 'w',         // White owns the bind by convention (reversed Maroczy is rare)
    blockaderSide: 'b',
    health,
    plans: maroczyPlans(),
    signals: maroczyRiskSignals(chess, board),
  };
}

function scoreMaroczy(chess, board) {
  let s = 0;
  // White knight on d5 supported?
  const d5 = at(board, 'd', 5);
  if (d5 && d5.color === 'w' && d5.type === 'n') s += 0.5;
  // White dark-squared bishop on board?
  const wbs = piecesOf(board, 'w', 'b');
  if (wbs.some(b => ((b.r + b.c) % 2 === 1))) s += 0.3;    // dark-sq bishop → light+dark convention: approximate
  // Black knight on c6?
  if (at(board, 'c', 6)?.type === 'n' && at(board, 'c', 6)?.color === 'b') s -= 0.4;
  // Black achieved ...b5?
  if (pawnAt(board, 'b', 5, 'b')) s -= 0.6;
  // White pawn on f3 (committed)?
  if (pawnAt(board, 'f', 3, 'w')) s -= 0.2;
  // Queens off → endgame favors White
  const qs = piecesOf(board, 'w', 'q').length + piecesOf(board, 'b', 'q').length;
  if (qs === 0) s += 0.4;
  return { score: +s.toFixed(2) };
}

function maroczyRiskSignals(chess, board) {
  const sig = [];
  if (pawnAt(board, 'b', 5, 'b')) sig.push('Black achieved ...b5 — bind is broken.');
  if (pawnAt(board, 'f', 3, 'w') && at(board, 'g', 7)?.type === 'b') sig.push('White played f3 with Bg7 still alive — e3 is chronically weak.');
  // Both white knights traded?
  if (piecesOf(board, 'w', 'n').length === 0) sig.push('Both white knights traded — d5 outpost is unreachable.');
  return sig;
}

function maroczyPlans() {
  return {
    w: [
      { pri: 1, text: `Maintain the bind: prevent ...b5 via Nc3 / a4 / Rb1; keep d5 defended.` },
      { pri: 2, text: `Slow maneuver: Be2, O-O, Rc1, Qd2, Rfd1 — compound piece quality.` },
      { pri: 2, text: `Trade Black's dark-squared bishop (Bh6) to expose the long diagonal.` },
      { pri: 3, text: `Steer to endgame — the bind converts extremely well with queens off.` },
    ],
    b: [
      { pri: 1, text: `Prepare ...a6 + ...b5 — the #1 liberating plan.` },
      { pri: 1, text: `...Nc6-d4 jump; if White trades, ...Nxd4 gives a protected outpost.` },
      { pri: 2, text: `If White plays f3, target e3 with ...Nc5 or ...Be6.` },
      { pri: 3, text: `Consider ...Rxc3 exchange sac if White's queenside is slow and d-pawn is mobile.` },
    ],
  };
}

// ─── shared helpers ─────────────────────────────────────────────────

function isHoleForSide(board, file, rank, side) {
  // A "hole" for `side` = a square on the enemy side where the enemy cannot
  // attack with a pawn (enemy pawns on adjacent files have all advanced past it).
  const enemy = side === 'w' ? 'b' : 'w';
  const c = FILE_IDX[file];
  for (const dc of [-1, 1]) {
    const nc = c + dc;
    if (nc < 0 || nc > 7) continue;
    for (let er = 0; er < 8; er++) {
      const enemyRank = 8 - er;
      const p = board[er][nc];
      if (p && p.type === 'p' && p.color === enemy) {
        // still behind the target square for enemy's attack range?
        if (enemy === 'w' ? enemyRank < rank : enemyRank > rank) return false;
      }
    }
  }
  return true;
}

function classifyBand(total) {
  if (total >= 6)  return 'owner-dominant';
  if (total >= 1)  return 'balanced';
  if (total >= -3) return 'blockader-edge';
  return 'strategic-loss';
}
