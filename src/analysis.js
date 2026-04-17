// analysis.js — static position dissector. Studies any FEN and reports
// the tactical motifs available (for either side) and the strategic
// features of the position (pawn structure, king safety, piece activity,
// material imbalance, open files, outposts, etc.).
//
// Everything here is pure: FEN in, structured report out.

import { Chess } from '../vendor/chess.js/chess.js';

// ──────────────── constants ────────────────
const PIECE_NAME  = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FILES = ['a','b','c','d','e','f','g','h'];
const FILE_IDX = (sq) => sq.charCodeAt(0) - 97;
const RANK_IDX = (sq) => +sq[1] - 1;
const SQ = (f, r) => `${String.fromCharCode(97 + f)}${r + 1}`;

function allSquares() {
  const out = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) out.push(SQ(f, r));
  return out;
}

// Flip side-to-move in a FEN (so we can ask "what does OUR piece attack?"
// using chess.js's move generator even when it's not our turn).
function flipSideFen(fen, forceSide /* 'w'|'b' */) {
  const parts = fen.split(' ');
  parts[1] = forceSide;
  parts[3] = '-';                  // clear en-passant to avoid crash
  return parts.join(' ');
}

// Every square our piece at `from` attacks (including empty squares it could
// capture if an enemy stood there). We use legal-moves with side-to-move
// forced to our color; then include moves whose `to` is a capture.
function attacksFromSquare(fen, from, ourColor) {
  const ghostFen = flipSideFen(fen, ourColor);
  let ghost;
  try { ghost = new Chess(ghostFen); } catch { return []; }
  try {
    return ghost.moves({ square: from, verbose: true })
                .filter(m => m.flags.includes('c') || m.flags.includes('e') || m.flags === 'n');
  } catch { return []; }
}

// All squares `color` pieces attack (union). For defender/attacker counts.
function allAttackSquares(fen, color) {
  const ghostFen = flipSideFen(fen, color);
  let ghost;
  try { ghost = new Chess(ghostFen); } catch { return new Set(); }
  const attacked = new Set();
  try {
    for (const m of ghost.moves({ verbose: true })) {
      if (m.flags.includes('c') || m.flags.includes('e')) attacked.add(m.to);
      // Also treat quiet moves to empty squares as attacks-if-occupied
      attacked.add(m.to);
    }
  } catch {}
  return attacked;
}

// Count how many of `color`'s pieces defend a square (via legal captures
// or quiet reaches — same heuristic as attacker count).
function attackerCount(fen, square, color) {
  const ghostFen = flipSideFen(fen, color);
  let ghost;
  try { ghost = new Chess(ghostFen); } catch { return 0; }
  let count = 0;
  try {
    for (const m of ghost.moves({ verbose: true })) {
      if (m.to === square) count++;
    }
  } catch {}
  return count;
}

// ══════════════════════════════════════════════════════════════════
//  STRATEGIC ANALYSIS
// ══════════════════════════════════════════════════════════════════

export function analyzeStrategy(fen) {
  const chess = new Chess(fen);
  const board = chess.board(); // 8×8 array of {type,color} or null
  const report = {
    material:     analyzeMaterial(board),
    pawns:        analyzePawns(board),
    king:         { w: analyzeKingSafety(chess, board, 'w'), b: analyzeKingSafety(chess, board, 'b') },
    files:        analyzeFiles(board),
    outposts:     analyzeOutposts(board),
    mobility:     analyzeMobility(fen),
    bishopPair:   { w: hasBishopPair(board, 'w'), b: hasBishopPair(board, 'b') },
    development:  analyzeDevelopment(board, chess),
    // ── deep additions ──
    colorComplex: analyzeColorComplex(board),
    bishopQuality:analyzeBishopQuality(board),
    pawnChains:   analyzePawnChains(board),
    space:        analyzeSpace(fen),
    structure:    classifyStructure(board),
    plans:        null, // filled below after structure is known
  };
  report.plans = suggestPlans(report);
  return report;
}

// ── material & imbalance ──
function analyzeMaterial(board) {
  const count = { w: {}, b: {} };
  for (const p of 'pnbrqk') { count.w[p] = 0; count.b[p] = 0; }
  for (const row of board) for (const sq of row) {
    if (!sq) continue;
    count[sq.color][sq.type]++;
  }
  const materialVal = (c) =>
    count[c].p*1 + count[c].n*3 + count[c].b*3 + count[c].r*5 + count[c].q*9;
  const w = materialVal('w'), b = materialVal('b');
  const diff = w - b;  // positive = white ahead, in pawn units

  // Minor imbalance
  const minorW = count.w.n + count.w.b;
  const minorB = count.b.n + count.b.b;
  const pawnsW = count.w.p, pawnsB = count.b.p;

  // Detect exchange (one side has rook vs minor piece)
  let exchange = null;
  if ((count.w.r - count.b.r) === 1 && (minorW - minorB) === -1) exchange = 'white';
  if ((count.w.r - count.b.r) === -1 && (minorW - minorB) === 1) exchange = 'black';

  return { count, diff, w, b, pawns: { w: pawnsW, b: pawnsB }, exchange };
}

// ── pawn structure ──
function analyzePawns(board) {
  // Collect pawn squares per file per color
  const byFile = { w: Array(8).fill(0).map(() => []), b: Array(8).fill(0).map(() => []) };
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (s && s.type === 'p') byFile[s.color][f].push(7 - r + 1);  // rank 1..8
  }

  const features = { w: pawnFeatures(byFile, 'w'), b: pawnFeatures(byFile, 'b') };
  return features;
}
function pawnFeatures(byFile, color) {
  const ours = byFile[color], theirs = byFile[color === 'w' ? 'b' : 'w'];
  const fwd = color === 'w' ? 1 : -1;

  const isolated = [];
  const doubled  = [];
  const backward = [];
  const passed   = [];
  const islands  = [];

  for (let f = 0; f < 8; f++) {
    if (!ours[f].length) continue;
    if (ours[f].length >= 2) ours[f].forEach(r => doubled.push(SQ(f, r - 1)));

    // Isolated: no friendly pawns on adjacent files
    const hasNeighbor = (f > 0 && ours[f-1].length) || (f < 7 && ours[f+1].length);
    if (!hasNeighbor) ours[f].forEach(r => isolated.push(SQ(f, r - 1)));

    // Passed: no enemy pawn on same or adjacent file in front
    for (const r of ours[f]) {
      let pass = true;
      for (let df = -1; df <= 1; df++) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        for (const er of theirs[nf]) {
          if ((color === 'w' && er > r) || (color === 'b' && er < r)) { pass = false; break; }
        }
        if (!pass) break;
      }
      if (pass) passed.push(SQ(f, r - 1));
    }

    // Backward: can't be defended by a friendly pawn on an adjacent file,
    // and enemy controls the square in front.
    for (const r of ours[f]) {
      const behindOk =
        ((f > 0) && ours[f-1].some(rr => (color === 'w' ? rr <= r : rr >= r))) ||
        ((f < 7) && ours[f+1].some(rr => (color === 'w' ? rr <= r : rr >= r)));
      if (behindOk) continue;
      // Front-square controlled by enemy pawn?
      const frontRank = r + fwd;
      if (frontRank < 1 || frontRank > 8) continue;
      const frontBlocked =
        ((f > 0) && theirs[f-1].some(rr => (color === 'w' ? rr === frontRank + 1 : rr === frontRank - 1))) ||
        ((f < 7) && theirs[f+1].some(rr => (color === 'w' ? rr === frontRank + 1 : rr === frontRank - 1)));
      if (frontBlocked) backward.push(SQ(f, r - 1));
    }
  }

  // Islands: groups of consecutive files containing pawns
  let inIsland = false, currStart = 0;
  for (let f = 0; f <= 8; f++) {
    const has = f < 8 && ours[f].length;
    if (has && !inIsland) { inIsland = true; currStart = f; }
    else if (!has && inIsland) { islands.push([currStart, f - 1]); inIsland = false; }
  }

  return { isolated, doubled, backward, passed, islands: islands.length, islandRanges: islands };
}

// ── king safety ──
function analyzeKingSafety(chess, board, color) {
  // Find king
  let kf = -1, kr = -1;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (s && s.type === 'k' && s.color === color) { kf = f; kr = 7 - r; }
  }
  if (kf < 0) return null;
  const kingSquare = SQ(kf, kr);

  // Castled?
  const homeRank = color === 'w' ? 0 : 7;
  const castled = (kr === homeRank) && (kf === 2 || kf === 6);   // c1/c8 or g1/g8
  const onHome  = (kr === homeRank) && kf === 4;                 // e1/e8

  // Pawn shield — pawns on the three files ahead of the king, one or two ranks up
  const shield = [];
  const shieldMissing = [];
  const dir = color === 'w' ? 1 : -1;
  for (let df = -1; df <= 1; df++) {
    const f = kf + df;
    if (f < 0 || f > 7) continue;
    // Ideal: pawn on king's rank + 1 (or + 2 as backup)
    const has1 = board[7 - (kr + dir)]?.[f]?.type === 'p' && board[7 - (kr + dir)]?.[f]?.color === color;
    const has2 = board[7 - (kr + 2*dir)]?.[f]?.type === 'p' && board[7 - (kr + 2*dir)]?.[f]?.color === color;
    if (has1 || has2) shield.push(SQ(f, has1 ? kr + dir : kr + 2*dir));
    else shieldMissing.push(FILES[f]);
  }

  // Any enemy attacker near the king?
  const enemy = color === 'w' ? 'b' : 'w';
  const enemyAttacks = allAttackSquares(chess.fen(), enemy);
  const nearbyAttacked = [];
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    const f = kf + df, r = kr + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    if (df === 0 && dr === 0) continue;
    const sq = SQ(f, r);
    if (enemyAttacks.has(sq)) nearbyAttacked.push(sq);
  }

  return {
    square: kingSquare,
    castled,
    onHome,
    shield,
    shieldMissing,
    nearbyAttacked,
    inCheck: chess.inCheck() && chess.turn() === color,
  };
}

// ── files (open / half-open) ──
function analyzeFiles(board) {
  const open = [];
  const halfOpenW = [], halfOpenB = [];
  const rooksOnFile = { w: [], b: [] };

  for (let f = 0; f < 8; f++) {
    let wPawns = 0, bPawns = 0;
    const rooksHere = { w: [], b: [] };
    for (let r = 0; r < 8; r++) {
      const s = board[7 - r]?.[f];
      if (!s) continue;
      if (s.type === 'p') { if (s.color === 'w') wPawns++; else bPawns++; }
      if (s.type === 'r' || s.type === 'q') rooksHere[s.color].push(SQ(f, r));
    }
    if (wPawns === 0 && bPawns === 0) open.push(FILES[f]);
    else if (wPawns === 0) halfOpenW.push(FILES[f]);
    else if (bPawns === 0) halfOpenB.push(FILES[f]);

    for (const r of rooksHere.w) rooksOnFile.w.push({ sq: r, file: FILES[f], open: !wPawns && !bPawns, halfOpen: !wPawns && bPawns });
    for (const r of rooksHere.b) rooksOnFile.b.push({ sq: r, file: FILES[f], open: !wPawns && !bPawns, halfOpen: !bPawns && wPawns });
  }

  return { open, halfOpenW, halfOpenB, rooks: rooksOnFile };
}

// ── outposts (knight on a hole, supported by a pawn) ──
function analyzeOutposts(board) {
  const outposts = { w: [], b: [] };
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.type !== 'n') continue;
    const color = s.color;
    const enemy = color === 'w' ? 'b' : 'w';
    const rank = 7 - r;
    // For white: only ranks 4-6 count as outposts; black: ranks 1-3
    if (color === 'w' && (rank < 3 || rank > 5)) continue;
    if (color === 'b' && (rank < 2 || rank > 4)) continue;
    // Can the enemy defend this square with a pawn? (Pawns that could later land adjacent & in front)
    const aheadDir = color === 'w' ? 1 : -1;
    let canBeKicked = false;
    for (let df = -1; df <= 1; df += 2) {
      const nf = f + df;
      if (nf < 0 || nf > 7) continue;
      // Is there ANY enemy pawn on file nf at a rank such that advancing it lands adjacent to our knight?
      for (let rr = 0; rr < 8; rr++) {
        const sq = board[rr]?.[nf];
        if (sq && sq.type === 'p' && sq.color === enemy) {
          const pawnRank = 7 - rr;
          // Pawn can advance to rank of (knight) + 1 in our direction
          // For our knight on rank `rank`, the attacking square would be `rank + aheadDir` on nf
          const attackRank = rank + aheadDir;
          // enemy pawn at (nf, pawnRank) can reach attackRank if pawnRank ≥ attackRank (for black) or ≤ (for white)
          if (color === 'w' && pawnRank > rank) canBeKicked = true;
          if (color === 'b' && pawnRank < rank) canBeKicked = true;
          if (canBeKicked) break;
        }
      }
      if (canBeKicked) break;
    }
    if (canBeKicked) continue;
    // Supported by a friendly pawn?
    const behindDir = -aheadDir;
    let supported = false;
    for (let df = -1; df <= 1; df += 2) {
      const nf = f + df;
      if (nf < 0 || nf > 7) continue;
      const sqBehind = board[r - behindDir]?.[nf]; // wait: board is r=0 top
      // board[r][f] — r=0 is rank 8, r=7 is rank 1
      // knight at board[r][f], its defender pawn is diagonally "behind" in board-row terms
      const pawnRowIdx = color === 'w' ? r + 1 : r - 1;
      const p = board[pawnRowIdx]?.[nf];
      if (p && p.type === 'p' && p.color === color) { supported = true; break; }
    }
    outposts[color].push({ square: SQ(f, rank), supported });
  }
  return outposts;
}

// ── mobility (total legal moves per side at this position) ──
function analyzeMobility(fen) {
  const out = {};
  for (const c of ['w','b']) {
    try {
      const g = new Chess(flipSideFen(fen, c));
      out[c] = g.moves().length;
    } catch { out[c] = 0; }
  }
  return out;
}

// ── bishop pair ──
function hasBishopPair(board, color) {
  let c = 0;
  for (const row of board) for (const s of row)
    if (s && s.type === 'b' && s.color === color) c++;
  return c >= 2;
}

// ══════════════════════════════════════════════════════════════════
//  DEEP STRATEGIC CONCEPTS
// ══════════════════════════════════════════════════════════════════

// Square color: a1 is dark, h1 is light; (file + rank) even → dark, odd → light
const squareColor = (f, r) => ((f + r) % 2 === 0 ? 'dark' : 'light');

// ── Color-complex analysis ──
// If one side's pawns are mostly on one color, the squares of the OTHER
// color are "weak" for that side. A bishop on the weak color is "good"
// (not blocked by own pawns). Same-colored bishop is "bad".
function analyzeColorComplex(board) {
  const out = { w: zeroComplex(), b: zeroComplex() };
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.type !== 'p') continue;
    const c = squareColor(f, 7 - r);
    out[s.color][c]++;
    out[s.color].total++;
  }
  for (const color of ['w','b']) {
    const o = out[color];
    o.lightPct = o.total ? Math.round(100 * o.light / o.total) : 0;
    o.darkPct  = o.total ? Math.round(100 * o.dark  / o.total) : 0;
    // "Weak" complex = the minority color (bishop of that color is bad)
    if (o.total >= 4) {
      if (o.lightPct >= 65)      o.weakSquares = 'dark';  // too many pawns on light → dark are weak
      else if (o.darkPct >= 65)  o.weakSquares = 'light';
      else o.weakSquares = null;
    } else o.weakSquares = null;
  }
  return out;
}
function zeroComplex() { return { light: 0, dark: 0, total: 0 }; }

// ── Good vs bad bishop ──
// A bishop is "bad" if its own pawns block it (many friendly pawns on its
// color). Good if its pawns leave its diagonals open.
function analyzeBishopQuality(board) {
  const bishops = { w: [], b: [] };
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.type !== 'b') continue;
    const sq = SQ(f, 7 - r);
    const sqCol = squareColor(f, 7 - r);
    // Count friendly pawns on the same color as this bishop
    let sameColor = 0, total = 0;
    for (let rr = 0; rr < 8; rr++) for (let ff = 0; ff < 8; ff++) {
      const p = board[rr][ff];
      if (!p || p.type !== 'p' || p.color !== s.color) continue;
      total++;
      if (squareColor(ff, 7 - rr) === sqCol) sameColor++;
    }
    const pct = total ? sameColor / total : 0;
    let verdict;
    if (total < 3)         verdict = 'normal';
    else if (pct >= 0.67)  verdict = 'bad';
    else if (pct <= 0.33)  verdict = 'good';
    else                   verdict = 'normal';
    bishops[s.color].push({ square: sq, on: sqCol, pawnsOnSameColor: sameColor, totalPawns: total, verdict });
  }
  return bishops;
}

// ── Pawn chains ──
// A diagonal chain of at least 3 same-color pawns, each defending the next.
function analyzePawnChains(board) {
  const out = { w: [], b: [] };
  for (const color of ['w','b']) {
    const dir = color === 'w' ? 1 : -1;  // chain defender is one rank back
    const pawnGrid = {};
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const s = board[r][f];
      if (s && s.type === 'p' && s.color === color) pawnGrid[`${f},${7 - r}`] = true;
    }
    const seen = new Set();
    for (const key of Object.keys(pawnGrid)) {
      if (seen.has(key)) continue;
      const [f0, r0] = key.split(',').map(Number);
      // Follow the chain upward (each pawn defended by one diagonally behind)
      const chain = [SQ(f0, r0)];
      let f = f0, r = r0;
      // Tip direction: look at squares +1 forward, ±1 file
      while (true) {
        const candidates = [ [f-1, r+dir], [f+1, r+dir] ]
          .filter(([ff, rr]) => ff >= 0 && ff <= 7 && rr >= 0 && rr <= 7)
          .filter(([ff, rr]) => pawnGrid[`${ff},${rr}`] && !seen.has(`${ff},${rr}`));
        if (!candidates.length) break;
        const [nf, nr] = candidates[0];
        chain.push(SQ(nf, nr));
        f = nf; r = nr;
      }
      // Follow backward
      let bf = f0, br = r0;
      while (true) {
        const candidates = [ [bf-1, br-dir], [bf+1, br-dir] ]
          .filter(([ff, rr]) => ff >= 0 && ff <= 7 && rr >= 0 && rr <= 7)
          .filter(([ff, rr]) => pawnGrid[`${ff},${rr}`] && !seen.has(`${ff},${rr}`));
        if (!candidates.length) break;
        const [nf, nr] = candidates[0];
        chain.unshift(SQ(nf, nr));
        bf = nf; br = nr;
      }
      if (chain.length >= 3) {
        chain.forEach(sq => seen.add(`${FILE_IDX(sq)},${+sq[1]-1}`));
        out[color].push({
          squares: chain,
          base: chain[0],       // the back of the chain (target for attack)
          head: chain[chain.length - 1],
        });
      }
    }
  }
  return out;
}

// ── Space advantage ──
// Count squares in the enemy half controlled by each side (via attacks).
function analyzeSpace(fen) {
  const out = { w: 0, b: 0 };
  for (const color of ['w', 'b']) {
    const attacks = allAttackSquares(fen, color);
    for (const sq of attacks) {
      const r = +sq[1];
      // White's "enemy half" = ranks 5-8; Black's = ranks 1-4
      if (color === 'w' && r >= 5) out.w++;
      if (color === 'b' && r <= 4) out.b++;
    }
  }
  out.diff = out.w - out.b;
  out.leader = out.diff > 4 ? 'White' : out.diff < -4 ? 'Black' : null;
  return out;
}

// ── Pawn-structure classification ──
// Detect a handful of iconic structures and return a name + description.
function classifyStructure(board) {
  // Gather pawn positions per side
  const wp = {}, bp = {};
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.type !== 'p') continue;
    const sq = SQ(f, 7 - r);
    if (s.color === 'w') wp[sq] = true; else bp[sq] = true;
  }
  const wpHas = (s) => wp[s], bpHas = (s) => bp[s];

  const hits = [];

  // IQP — isolated queen pawn. White d4 with no c or e pawn, or Black d5 same.
  if (wpHas('d4') && !wpHas('c3') && !wpHas('c4') && !wpHas('c2') &&
                     !wpHas('e3') && !wpHas('e4') && !wpHas('e2')) {
    hits.push({ name: 'IQP (White isolated d-pawn)',
      desc: 'White has an isolated pawn on d4 — dynamic piece play with typical plans d4-d5 push or kingside attack; Black aims to blockade d5 and trade minor pieces toward an endgame where the d-pawn is weak.',
      side: 'white' });
  }
  if (bpHas('d5') && !bpHas('c6') && !bpHas('c5') && !bpHas('c7') &&
                     !bpHas('e6') && !bpHas('e5') && !bpHas('e7')) {
    hits.push({ name: 'IQP (Black isolated d-pawn)',
      desc: 'Black has an isolated pawn on d5 — dynamic piece play, plans include …d5-d4 or kingside pressure; White wants to blockade d4 and simplify.',
      side: 'black' });
  }

  // Hanging pawns — two adjacent central pawns (typically c- and d-) with no friendly neighbors
  if (wpHas('c4') && wpHas('d4') && !wpHas('b3') && !wpHas('b2') && !wpHas('e3') && !wpHas('e4')) {
    hits.push({ name: 'Hanging pawns (White c4+d4)',
      desc: 'White has hanging pawns c4+d4. They control the center but have no neighbouring defenders. Plan for White: advance c4-c5 or d4-d5 at the right moment; for Black: pressure c4 and d4 with rooks on the c- and d-files, trade active pieces.' });
  }
  if (bpHas('c5') && bpHas('d5') && !bpHas('b6') && !bpHas('b7') && !bpHas('e6') && !bpHas('e5')) {
    hits.push({ name: 'Hanging pawns (Black c5+d5)',
      desc: 'Black has hanging pawns c5+d5. Same dynamics mirrored.' });
  }

  // Stonewall — pawns on c3/d4/e3/f4 (White) or c6/d5/e6/f5 (Black)
  if (wpHas('c3') && wpHas('d4') && wpHas('e3') && wpHas('f4')) {
    hits.push({ name: 'Stonewall (White)',
      desc: 'White has a Stonewall. The e5 square is a strong outpost for a White knight; the light-squared bishop is typically bad (blocked by the pawn chain). Plan: install a knight on e5, pressure kingside with Qh5, f4-f5 lever.' });
  }
  if (bpHas('c6') && bpHas('d5') && bpHas('e6') && bpHas('f5')) {
    hits.push({ name: 'Stonewall (Black)',
      desc: 'Black has a Stonewall. Symmetric: e4 is a strong outpost; light-squared bishop bad.' });
  }

  // King's Indian / Benoni-ish chain: White d5 with pawns on c4/e4, Black e5/d6
  if (wpHas('d5') && wpHas('c4') && wpHas('e4') && bpHas('d6') && bpHas('e5')) {
    hits.push({ name: "King's Indian / Benoni chain",
      desc: 'Closed center with interlocking pawn chains. White attacks on the queenside (c4-c5 lever); Black attacks on the kingside (f5-f4 lever, piece sacrifices on g- and h-files). Wrong-side rook and bishop moves are strategic mistakes.' });
  }

  // Carlsbad — White d4/e3, Black d5/e6, c-file semi-open for White
  if (wpHas('d4') && wpHas('e3') && bpHas('d5') && bpHas('e6') && !wpHas('c2') && !wpHas('c3') && !wpHas('c4')) {
    hits.push({ name: 'Carlsbad structure',
      desc: 'Classic Carlsbad. Plan for White: minority attack b2-b4-b5 to create a weak c6 pawn. Plan for Black: central break with ...c6-c5 or kingside attack with ...Ne4/…f5.' });
  }

  // French-ish: closed d4/e5 vs d5/e6
  if (wpHas('d4') && wpHas('e5') && bpHas('d5') && bpHas('e6')) {
    hits.push({ name: 'French Advance chain',
      desc: 'White fixes the centre with d4/e5 against Black d5/e6. White has kingside space; Black pressures d4 with ...c5 lever. Black\'s light-squared bishop is traditionally bad (stuck behind e6).' });
  }

  return hits;
}

// ── Typical plans from structure + imbalances ──
function suggestPlans(report) {
  const plans = { w: [], b: [] };
  for (const s of report.structure) {
    if (s.side === 'white')      plans.w.push(s.desc);
    else if (s.side === 'black') plans.b.push(s.desc);
    else                         { plans.w.push(s.desc); plans.b.push(s.desc); }
  }
  // Minority attack: side with fewer pawns on a flank advances them
  // (we already note this in Carlsbad above)

  // Passed-pawn plan
  if (report.pawns.w.passed.length) {
    plans.w.push(`Push and escort White's passed pawn${report.pawns.w.passed.length>1?'s':''} (${report.pawns.w.passed.join(', ')}) — a passed pawn's lust to expand must be satisfied (Nimzowitsch).`);
  }
  if (report.pawns.b.passed.length) {
    plans.b.push(`Push and escort Black's passed pawn${report.pawns.b.passed.length>1?'s':''} (${report.pawns.b.passed.join(', ')}).`);
  }
  // Rook on open file
  if (report.files.open.length) {
    const rookW = report.files.rooks.w.find(r => r.open);
    const rookB = report.files.rooks.b.find(r => r.open);
    if (!rookW) plans.w.push(`Double rooks or seize the open ${report.files.open.join(', ')}-file.`);
    if (!rookB) plans.b.push(`Double rooks or seize the open ${report.files.open.join(', ')}-file.`);
  }
  // Good/bad bishop
  for (const color of ['w','b']) {
    const side = color === 'w' ? 'White' : 'Black';
    for (const b of report.bishopQuality[color]) {
      if (b.verdict === 'bad')
        plans[color].push(`${side}'s bishop on ${b.square} is bad (${b.pawnsOnSameColor}/${b.totalPawns} pawns on ${b.on} squares) — trade it if possible.`);
      else if (b.verdict === 'good')
        plans[color].push(`${side}'s bishop on ${b.square} is good (${b.pawnsOnSameColor}/${b.totalPawns} pawns on ${b.on} squares) — keep it, avoid trading.`);
    }
  }
  // Color-complex weaknesses
  for (const color of ['w','b']) {
    const side = color === 'w' ? 'White' : 'Black';
    const cc = report.colorComplex[color];
    if (cc.weakSquares) {
      const enemy = color === 'w' ? 'b' : 'w';
      const enemySide = enemy === 'w' ? 'White' : 'Black';
      plans[enemy].push(`${side}'s ${cc.weakSquares}-squared complex is weak — ${enemySide} should manoeuvre pieces there (especially the ${cc.weakSquares}-square bishop and knights onto holes).`);
    }
  }
  // Space
  if (report.space.leader) {
    const leader = report.space.leader.toLowerCase();
    const other  = leader === 'white' ? 'Black' : 'White';
    plans[leader === 'white' ? 'w' : 'b']
      .push(`${report.space.leader} has a space advantage (${report.space.diff > 0 ? '+' : ''}${report.space.diff} squares in the enemy half) — avoid trades, maintain cramping.`);
    plans[leader === 'white' ? 'b' : 'w']
      .push(`${other} is cramped — seek trades to ease the position.`);
  }
  return plans;
}

// ── development (opening heuristic) ──
function analyzeDevelopment(board, chess) {
  const undevelopedW = [], undevelopedB = [];
  // White knights/bishops still on home rank = undeveloped
  const homeW = { b1: 'n', c1: 'b', f1: 'b', g1: 'n' };
  const homeB = { b8: 'n', c8: 'b', f8: 'b', g8: 'n' };
  for (const [sq, t] of Object.entries(homeW)) {
    const p = chess.get(sq);
    if (p && p.type === t && p.color === 'w') undevelopedW.push(sq);
  }
  for (const [sq, t] of Object.entries(homeB)) {
    const p = chess.get(sq);
    if (p && p.type === t && p.color === 'b') undevelopedB.push(sq);
  }
  return { w: undevelopedW, b: undevelopedB };
}

// ══════════════════════════════════════════════════════════════════
//  IDEAS IN THE AIR — concrete moves tied to strategy concepts
// ══════════════════════════════════════════════════════════════════
//
// Returns, per side, a short list of SPECIFIC ideas that are actionable
// right now — pawn breaks that would open lines, knight jumps to outposts,
// piece trades suggested by color-complex or bad-bishop findings,
// sacrificial motifs on the king, plan-linked advances.

export function generateIdeas(fen, strategy) {
  const chess = new Chess(fen);
  const ideas = { w: [], b: [] };

  for (const color of ['w', 'b']) {
    // 1. Pawn breaks available RIGHT NOW
    ideas[color].push(...detectPawnBreaks(chess, color));
    // 2. Outpost jumps within 1-2 moves
    ideas[color].push(...detectOutpostJumps(chess, strategy, color));
    // 3. Trade the bad bishop
    ideas[color].push(...detectBishopTrades(chess, strategy, color));
    // 4. Classic sacrifices (Greek gift, Nxf7, etc.)
    ideas[color].push(...detectSacrificePatterns(chess, color));
    // 5. Plans from structure (Carlsbad minority attack, KI side attack, etc.)
    ideas[color].push(...detectStructuralPlans(chess, strategy, color));
    // 6. Exploit enemy weak color complex
    ideas[color].push(...detectColorComplexExploits(chess, strategy, color));
  }
  return ideas;
}

// Pawn breaks: moves like c4-c5, d4-d5, f4-f5 (and mirrors) that would
// open lines or contest the centre. Report SAN + the "why".
function detectPawnBreaks(chess, color) {
  const out = [];
  let moves;
  try { moves = new Chess(flipSideFen(chess.fen(), color)).moves({ verbose: true }); }
  catch { return out; }
  const CENTER_BREAKS = { c: true, d: true, e: true, f: true };
  for (const m of moves) {
    if (m.piece !== 'p') continue;
    if (!CENTER_BREAKS[m.to[0]]) continue;
    // Only look at pawn advances that move TWO ranks or create a lever
    const fromRank = +m.from[1], toRank = +m.to[1];
    // A "break" is a pawn advance that challenges an enemy pawn on an
    // adjacent file OR a one-square advance onto a rank where it contacts
    // an enemy pawn diagonally.
    const isLever = Math.abs(fromRank - toRank) >= 1;
    if (!isLever) continue;
    // Does it contact an enemy pawn (same/adjacent file in front)?
    const f = FILE_IDX(m.to);
    const r = toRank - 1;
    const enemy = color === 'w' ? 'b' : 'w';
    let contacts = false;
    for (let df = -1; df <= 1; df++) {
      const nf = f + df;
      if (nf < 0 || nf > 7) continue;
      const nr = color === 'w' ? r + 1 : r - 1;
      if (nr < 0 || nr > 7) continue;
      const p = chess.get(SQ(nf, nr));
      if (p && p.type === 'p' && p.color === enemy) { contacts = true; break; }
    }
    if (!contacts) continue;
    out.push({
      kind: 'break',
      move: m.san,
      text: `<strong>${m.san}</strong> — pawn break, contests the centre and opens lines.`,
    });
    if (out.length >= 3) break;
  }
  return out;
}

// Outpost jumps: knights within 1-2 moves of a square that is a hole in
// the enemy structure (can't be kicked by a pawn).
function detectOutpostJumps(chess, strategy, color) {
  const out = [];
  const enemy = color === 'w' ? 'b' : 'w';
  const board = chess.board();
  // Find enemy "holes" — squares no enemy pawn can attack from
  const holes = findHoles(board, enemy);
  if (!holes.length) return out;
  // For each friendly knight, check reachable outposts
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.type !== 'n' || s.color !== color) continue;
    const knightSq = SQ(f, 7 - r);
    for (const holeSq of holes) {
      const dist = knightMoveDistance(knightSq, holeSq);
      if (dist === 1) {
        // Check legality now
        let ghost;
        try { ghost = new Chess(flipSideFen(chess.fen(), color)); } catch { continue; }
        const legal = ghost.moves({ square: knightSq, verbose: true }).find(m => m.to === holeSq);
        if (legal) {
          out.push({
            kind: 'outpost',
            move: legal.san,
            text: `<strong>${legal.san}</strong> — knight jumps to <strong>${holeSq}</strong>, an unkickable outpost.`,
          });
        }
      } else if (dist === 2 && dist !== Infinity) {
        out.push({
          kind: 'maneuver',
          text: `Knight manoeuvre <strong>${knightSq} → ${holeSq}</strong> (2 moves) — install a knight on the outpost.`,
        });
      }
      if (out.length >= 3) break;
    }
  }
  return dedupeBy(out, 'text').slice(0, 3);
}

function findHoles(board, color) {
  // A hole in `color`'s structure = a square on the `color`-side territory
  // that no pawn of color `color` can ever attack.
  // Territory = ranks 1-4 for black, ranks 4-7 for white (approximate).
  const holes = [];
  const pawns = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (s && s.type === 'p' && s.color === color) pawns.push({ f, r: 7 - r });
  }
  const dir = color === 'w' ? 1 : -1;  // pawns of `color` attack diagonally in this direction
  for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) {
    // Only consider squares on the enemy side
    if (color === 'w' && r < 3) continue;
    if (color === 'b' && r > 4) continue;
    // Can any pawn of `color` ever attack this square?
    let attackable = false;
    for (const p of pawns) {
      // Pawn at (pf, pr) attacks (pf±1, pr+dir). It can advance forward
      // to any (pf, any_rank_further). So the set of squares it can ever
      // attack is (pf-1, any rank in advancing direction from pr+dir) +
      // mirror +1.
      for (const df of [-1, 1]) {
        const tf = p.f + df;
        if (tf !== f) continue;
        // Rank must be reachable: in the direction of pawn's forward march
        // AND with a closer initial position
        if ((dir === 1 && r >= p.r + 1) || (dir === -1 && r <= p.r - 1)) {
          attackable = true; break;
        }
      }
      if (attackable) break;
    }
    if (!attackable) holes.push(SQ(f, r));
  }
  return holes;
}

function knightMoveDistance(a, b) {
  // Simple BFS on knight graph. Returns Infinity if > 3.
  if (a === b) return 0;
  const queue = [[a, 0]]; const seen = new Set([a]);
  const deltas = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
  while (queue.length) {
    const [sq, d] = queue.shift();
    if (d >= 3) continue;
    const f0 = FILE_IDX(sq), r0 = +sq[1] - 1;
    for (const [df, dr] of deltas) {
      const nf = f0 + df, nr = r0 + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      const n = SQ(nf, nr);
      if (n === b) return d + 1;
      if (!seen.has(n)) { seen.add(n); queue.push([n, d + 1]); }
    }
  }
  return Infinity;
}

// Bishop trade suggestions — if my bishop is bad and the enemy has a good
// bishop of the same color, suggest offering a trade.
function detectBishopTrades(chess, strategy, color) {
  const out = [];
  const mine = strategy.bishopQuality[color];
  const enemy = strategy.bishopQuality[color === 'w' ? 'b' : 'w'];
  for (const b of mine) {
    if (b.verdict !== 'bad') continue;
    const oppSame = enemy.find(eb => eb.on === b.on && (eb.verdict === 'good' || eb.verdict === 'normal'));
    if (oppSame) {
      out.push({
        kind: 'trade',
        text: `Look to trade your bad ${b.on}-squared bishop on <strong>${b.square}</strong> for the enemy bishop on <strong>${oppSame.square}</strong>.`,
      });
    }
  }
  return out;
}

// Classic sacrifice patterns. Cheap signal — the actual sacrifice needs
// deeper search to confirm; we just flag the setup.
function detectSacrificePatterns(chess, color) {
  const out = [];
  const enemy = color === 'w' ? 'b' : 'w';
  // Greek gift: light-squared bishop aims at h7/h2, knight on f3/f6, queen ready to come to h5/h4
  if (color === 'w') {
    const bishopAimingH7 = chess.get('d3') && chess.get('d3').type === 'b' && chess.get('d3').color === 'w'
                        || chess.get('c2') && chess.get('c2').type === 'b' && chess.get('c2').color === 'w'
                        || chess.get('b1') && chess.get('b1').type === 'b' && chess.get('b1').color === 'w';
    const h7Pawn = chess.get('h7');
    const bKing  = chess.get('g8');
    if (bishopAimingH7 && h7Pawn && h7Pawn.type === 'p' && bKing && bKing.type === 'k') {
      out.push({
        kind: 'sac',
        text: `<strong>Bxh7+ setup</strong> is in the air — Greek gift sacrifice pattern against Black's king.`,
      });
    }
  } else {
    const bishopAimingH2 = chess.get('d6') && chess.get('d6').type === 'b' && chess.get('d6').color === 'b'
                        || chess.get('c7') && chess.get('c7').type === 'b' && chess.get('c7').color === 'b';
    const h2Pawn = chess.get('h2');
    const wKing  = chess.get('g1');
    if (bishopAimingH2 && h2Pawn && h2Pawn.type === 'p' && wKing && wKing.type === 'k') {
      out.push({
        kind: 'sac',
        text: `<strong>…Bxh2+ setup</strong> is in the air — Greek gift against White's king.`,
      });
    }
  }
  return out;
}

// Structural plans tied to named structures.
function detectStructuralPlans(chess, strategy, color) {
  const out = [];
  const board = chess.board();
  for (const s of strategy.structure) {
    if (s.side && s.side !== (color === 'w' ? 'white' : 'black') && s.side !== undefined) continue;
    // Map structure name to concrete move hints
    if (s.name.startsWith('Carlsbad') && color === 'w') {
      out.push({ kind: 'plan', text: `Carlsbad minority attack — prepare <strong>a4, b4-b5</strong> to create a weak pawn on c6.` });
    }
    if (s.name.startsWith('Carlsbad') && color === 'b') {
      out.push({ kind: 'plan', text: `Against the minority attack, play for <strong>...c6-c5</strong> lever or a kingside knight manoeuvre Ne4/…f5.` });
    }
    if (s.name.startsWith("King's Indian") && color === 'b') {
      out.push({ kind: 'plan', text: `KI chain — attack with <strong>...f5-f4</strong>, then …g5, …g4, …h5, rook lifts via f6/h6.` });
    }
    if (s.name.startsWith("King's Indian") && color === 'w') {
      out.push({ kind: 'plan', text: `Queenside attack — push <strong>c4-c5</strong>, open the c-file, rook to c1, knight to b5/d5.` });
    }
    if (s.name.startsWith('IQP') && s.side && ((s.side === 'white' && color === 'w') || (s.side === 'black' && color === 'b'))) {
      const pawn = color === 'w' ? 'd4' : 'd5';
      const advance = color === 'w' ? 'd5' : 'd4';
      out.push({ kind: 'plan', text: `IQP side — seek the <strong>${pawn}-${advance} push</strong> or a kingside attack with pieces; avoid piece trades.` });
    }
    if (s.name.startsWith('IQP') && s.side && ((s.side === 'white' && color === 'b') || (s.side === 'black' && color === 'w'))) {
      const block = s.side === 'white' ? 'd5' : 'd4';
      out.push({ kind: 'plan', text: `Against the IQP — blockade on <strong>${block}</strong> with a knight, trade minor pieces toward an ending.` });
    }
    if (s.name.startsWith('Stonewall')) {
      const outpost = s.name.includes('White') ? 'e5' : 'e4';
      const target = s.name.includes('White') === (color === 'w');
      if (target) out.push({ kind: 'plan', text: `Install a knight on <strong>${outpost}</strong> (Stonewall outpost). Attack the kingside with Qh5 and f4-f5.` });
    }
  }
  return out;
}

// Exploit enemy weak color complex
function detectColorComplexExploits(chess, strategy, color) {
  const out = [];
  const enemy = color === 'w' ? 'b' : 'w';
  const weak = strategy.colorComplex[enemy].weakSquares;  // 'light' | 'dark' | null
  if (!weak) return out;
  // Do we have a bishop on that color?
  const myBishopOnWeak = strategy.bishopQuality[color].find(b => b.on === weak);
  if (myBishopOnWeak) {
    out.push({
      kind: 'exploit',
      text: `Your ${weak}-square bishop on <strong>${myBishopOnWeak.square}</strong> eyes the weak ${weak} squares in the enemy camp — manoeuvre it to the strongest diagonal.`,
    });
  } else {
    out.push({
      kind: 'exploit',
      text: `Enemy <strong>${weak} squares</strong> are weak — direct your pieces (especially a ${weak}-square bishop or knights on ${weak}-square holes) toward them.`,
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  TACTICAL MOTIFS
// ══════════════════════════════════════════════════════════════════

export function analyzeTactics(fen) {
  const chess = new Chess(fen);
  const findings = { w: [], b: [] };

  for (const color of ['w', 'b']) {
    findings[color].push(...detectHangingTargets(chess, fen, color));
    findings[color].push(...detectForks(chess, fen, color));
    findings[color].push(...detectPinsAndSkewers(chess, fen, color));
    findings[color].push(...detectBatteries(chess, fen, color));
    findings[color].push(...detectBackRankWeakness(chess, color));
    findings[color].push(...detectTrappedPieces(chess, fen, color));
    findings[color].push(...detectOverloadedDefenders(chess, fen, color));
    findings[color].push(...detectDiscoveredAttackOpportunity(chess, fen, color));
  }
  return findings;
}

// Hanging piece: enemy piece attacked by us with fewer defenders than attackers
function detectHangingTargets(chess, fen, color) {
  const enemy = color === 'w' ? 'b' : 'w';
  const board = chess.board();
  const out = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.color !== enemy) continue;
    const sq = SQ(f, 7 - r);
    const attackers = attackerCount(fen, sq, color);
    if (!attackers) continue;
    const defenders = attackerCount(fen, sq, enemy);
    // Accounting: if attackers > defenders, target is loose
    // Skip king (always defended by fleeing)
    if (s.type === 'k') continue;
    if (attackers > defenders) {
      out.push({
        motif: 'hanging',
        piece: s.type, square: sq,
        text: `${PIECE_NAME[s.type]} on ${sq} is under-defended (${attackers} attackers vs ${defenders} defenders)`,
      });
    }
  }
  return out;
}

// Fork: ANY of our pieces can move to a square attacking ≥2 valuable enemies
function detectForks(chess, fen, color) {
  const out = [];
  const ghostFen = flipSideFen(fen, color);
  let ghost;
  try { ghost = new Chess(ghostFen); } catch { return out; }
  let moves;
  try { moves = ghost.moves({ verbose: true }); } catch { return out; }
  for (const m of moves) {
    // Simulate
    let clone;
    try { clone = new Chess(ghostFen); clone.move({from:m.from,to:m.to,promotion:m.promotion}); } catch { continue; }
    // From perspective of us: at the destination, we're now there. Look at what
    // we attack on the NEW position with side set to us.
    const attacks = attacksFromSquare(clone.fen(), m.to, color)
                      .filter(a => a.flags.includes('c') || a.flags.includes('e'));
    if (attacks.length < 2) continue;
    const mover = chess.get(m.from);
    if (!mover) continue;
    const myVal = PIECE_VALUE[mover.type];
    const valuable = attacks.filter(a => PIECE_VALUE[a.captured] >= myVal);
    if (valuable.length >= 2) {
      const names = [...new Set(valuable.map(a => PIECE_NAME[a.captured]))];
      out.push({
        motif: 'fork-threat',
        move: `${m.from}${m.to}`, san: m.san,
        text: `${PIECE_NAME[mover.type]} can go to ${m.to}, forking ${names.join(' and ')}`,
      });
      if (out.length >= 3) break; // don't overwhelm
    }
  }
  return out;
}

// Pins and skewers currently present
function detectPinsAndSkewers(chess, fen, color) {
  const out = [];
  const board = chess.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.color !== color) continue;
    if (!'brq'.includes(s.type)) continue;
    const sq = SQ(f, 7 - r);
    const rays = s.type === 'b' ? [[1,1],[1,-1],[-1,1],[-1,-1]]
              : s.type === 'r' ? [[1,0],[-1,0],[0,1],[0,-1]]
              : [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    for (const [df, dr] of rays) {
      const hits = scanRay(board, f, 7 - r, df, dr, color);
      if (hits.length < 2) continue;
      const [h1, h2] = hits;
      const v1 = PIECE_VALUE[h1.piece.type], v2 = PIECE_VALUE[h2.piece.type];
      if (h2.piece.type === 'k' || v2 > v1) {
        out.push({
          motif: 'pin',
          text: h2.piece.type === 'k'
            ? `${PIECE_NAME[s.type]} on ${sq} pins the ${PIECE_NAME[h1.piece.type]} on ${h1.sq} to the king`
            : `${PIECE_NAME[s.type]} on ${sq} pins the ${PIECE_NAME[h1.piece.type]} to the ${PIECE_NAME[h2.piece.type]}`,
        });
      } else if (v1 > v2 && h1.piece.type !== 'k') {
        out.push({
          motif: 'skewer',
          text: `${PIECE_NAME[s.type]} on ${sq} skewers the ${PIECE_NAME[h1.piece.type]} with a ${PIECE_NAME[h2.piece.type]} behind`,
        });
      }
    }
  }
  return dedupeBy(out, 'text');
}
function scanRay(board, f, r, df, dr, ourColor) {
  const hits = [];
  for (let i = 1; i < 8; i++) {
    const nf = f + df * i, nr = r + dr * i;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) break;
    const piece = board[7 - nr]?.[nf];
    if (!piece) continue;
    if (piece.color === ourColor) break;
    hits.push({ sq: SQ(nf, nr), piece });
    if (hits.length >= 2) break;
  }
  return hits;
}

// Batteries: two of our pieces aligned on a line aiming at enemy
function detectBatteries(chess, fen, color) {
  const out = [];
  const board = chess.board();
  // For each pair of our (r,q) on rank/file; (b,q) on diag — simple detection
  const pieces = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (s && s.color === color && 'brq'.includes(s.type)) pieces.push({ sq: SQ(f, 7 - r), f, r: 7 - r, type: s.type });
  }
  const lines = [
    { name: 'file', match: (a, b) => a.f === b.f,
      between: (a, b, board) => rangeClear(board, a, b, 0, Math.sign(b.r - a.r)) },
    { name: 'rank', match: (a, b) => a.r === b.r,
      between: (a, b, board) => rangeClear(board, a, b, Math.sign(b.f - a.f), 0) },
    { name: 'diag', match: (a, b) => Math.abs(a.f - b.f) === Math.abs(a.r - b.r),
      between: (a, b, board) => rangeClear(board, a, b, Math.sign(b.f - a.f), Math.sign(b.r - a.r)) },
  ];
  for (let i = 0; i < pieces.length; i++) for (let j = i+1; j < pieces.length; j++) {
    const a = pieces[i], b = pieces[j];
    for (const ln of lines) {
      if (!ln.match(a, b)) continue;
      // Types must both slide on that line
      if (ln.name === 'diag' && !(['b','q'].includes(a.type) && ['b','q'].includes(b.type))) continue;
      if (['file','rank'].includes(ln.name) && !(['r','q'].includes(a.type) && ['r','q'].includes(b.type))) continue;
      if (!ln.between(a, b, board)) continue;
      out.push({
        motif: 'battery',
        text: `battery: ${PIECE_NAME[a.type]} on ${a.sq} and ${PIECE_NAME[b.type]} on ${b.sq} aligned on the ${ln.name}`,
      });
    }
  }
  return dedupeBy(out, 'text');
}
function rangeClear(board, a, b, df, dr) {
  let f = a.f + df, r = a.r + dr;
  while (f !== b.f || r !== b.r) {
    if (board[7 - r]?.[f]) return false;
    f += df; r += dr;
  }
  return true;
}

// Back-rank weakness: king on 1st/8th rank, trapped by own pawns, no rook defense
function detectBackRankWeakness(chess, color) {
  const out = [];
  const board = chess.board();
  const homeRank = color === 'w' ? 0 : 7;
  let kf = -1;
  for (let f = 0; f < 8; f++) {
    const s = board[7 - homeRank]?.[f];
    if (s && s.type === 'k' && s.color === color) { kf = f; break; }
  }
  if (kf < 0) return out;
  // Pawns blocking escape on 2nd/7th rank directly in front of king
  const pawnRank = color === 'w' ? 1 : 6;
  const escapes = [kf - 1, kf, kf + 1].filter(f => f >= 0 && f <= 7);
  let blocked = true;
  for (const f of escapes) {
    const s = board[7 - pawnRank]?.[f];
    if (!s || s.type !== 'p' || s.color !== color) { blocked = false; break; }
  }
  if (!blocked) return out;
  out.push({
    motif: 'back-rank',
    text: `king on back rank is locked in by its own pawns — watch for back-rank mate threats`,
  });
  return out;
}

// Trapped pieces: our piece has zero legal retreats that are safe
function detectTrappedPieces(chess, fen, color) {
  const out = [];
  const board = chess.board();
  const ghostFen = flipSideFen(fen, color);
  let ghost;
  try { ghost = new Chess(ghostFen); } catch { return out; }
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.color !== color) continue;
    if ('pk'.includes(s.type)) continue;
    const sq = SQ(f, 7 - r);
    let moves;
    try { moves = ghost.moves({ square: sq, verbose: true }); } catch { continue; }
    if (!moves.length) continue;
    // Any move that goes to a safer square (fewer attackers than defenders)?
    let hasSafeRetreat = false;
    for (const m of moves) {
      const atk = attackerCount(ghostFen, m.to, color === 'w' ? 'b' : 'w');
      const def = attackerCount(ghostFen, m.to, color);
      if (atk <= def) { hasSafeRetreat = true; break; }
    }
    // Additionally, is the piece actually being attacked right now?
    const underAttack = attackerCount(fen, sq, color === 'w' ? 'b' : 'w') > 0;
    if (!hasSafeRetreat && underAttack) {
      out.push({
        motif: 'trapped',
        text: `${PIECE_NAME[s.type]} on ${sq} is trapped — every square it can move to is still attacked`,
      });
    }
  }
  return out;
}

// Overloaded defender: one piece defends ≥2 things, capture one and the other hangs
function detectOverloadedDefenders(chess, fen, color) {
  const out = [];
  const enemy = color === 'w' ? 'b' : 'w';
  const board = chess.board();
  // For each enemy piece that is defending multiple of its own
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.color !== enemy) continue;
    if (s.type === 'k') continue;
    const sq = SQ(f, 7 - r);
    // Does it defend ≥2 other enemy pieces?
    const squaresItDefends = attacksFromSquare(fen, sq, enemy)
      .filter(a => a.flags.includes('c') || a.flags.includes('e'))
      .map(a => a.to);
    const defendedOwn = squaresItDefends.filter(t => {
      const p = chess.get(t);
      return p && p.color === enemy;
    });
    if (defendedOwn.length >= 2) {
      // And those defended pieces are currently attacked by us?
      const attackedByUs = defendedOwn.filter(t => attackerCount(fen, t, color) > 0);
      if (attackedByUs.length >= 2) {
        out.push({
          motif: 'overload',
          text: `${PIECE_NAME[s.type]} on ${sq} is overloaded — it defends multiple pieces we're attacking`,
        });
      }
    }
  }
  return out;
}

// Discovered attack opportunity: moving piece A unveils a ray from piece B
// aimed at a valuable target.
function detectDiscoveredAttackOpportunity(chess, fen, color) {
  const out = [];
  const ghostFen = flipSideFen(fen, color);
  let ghost;
  try { ghost = new Chess(ghostFen); } catch { return out; }
  let moves;
  try { moves = ghost.moves({ verbose: true }); } catch { return out; }
  for (const m of moves) {
    // Attackers on the FROM square (from opposite side's perspective)
    // — if anything was "blocked" by the mover, that's a reveal.
    const preAttackers = attackerCount(fen, m.from, color);  // attackers ON from (us defending ourselves via that square)
    // Simulate
    let clone;
    try { clone = new Chess(ghostFen); clone.move({from:m.from,to:m.to,promotion:m.promotion}); } catch { continue; }
    // A simple heuristic: compare how many enemy pieces we attack before vs after
    const beforeAttacks = allAttackSquares(fen, color);
    const afterAttacks  = allAttackSquares(clone.fen(), color);
    const newlyAttacked = [...afterAttacks].filter(sq => !beforeAttacks.has(sq));
    const newlyAttackedPieces = newlyAttacked
      .map(sq => ({ sq, piece: chess.get(sq) }))
      .filter(x => x.piece && x.piece.color !== color);
    if (newlyAttackedPieces.length) {
      const names = newlyAttackedPieces.map(x => `${PIECE_NAME[x.piece.type]} on ${x.sq}`);
      out.push({
        motif: 'discovery',
        text: `moving ${m.san} uncovers an attack on ${names.join(', ')}`,
      });
      if (out.length >= 2) break;
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  RENDERING — HTML strings from reports
// ══════════════════════════════════════════════════════════════════

export function renderStrategyReport(report) {
  const mat = report.material;
  const diff = mat.diff;
  const matLine = diff === 0
    ? 'Material is even.'
    : `Material: ${diff > 0 ? 'White' : 'Black'} is up ${Math.abs(diff)} pawn${Math.abs(diff)===1?'':'s'}.`;

  const bishopPair = [];
  if (mat.diff === 0 || mat.diff === 1 || mat.diff === -1) {
    if (report.bishopPair.w && !report.bishopPair.b) bishopPair.push('White has the bishop pair.');
    else if (report.bishopPair.b && !report.bishopPair.w) bishopPair.push('Black has the bishop pair.');
  }
  const exchange = mat.exchange ? `${cap(mat.exchange)} is up the exchange.` : null;

  const pw = report.pawns.w, pb = report.pawns.b;
  const pawnLines = [];
  if (pw.passed.length)   pawnLines.push(`White passed pawn${pw.passed.length>1?'s':''}: ${pw.passed.join(', ')}.`);
  if (pb.passed.length)   pawnLines.push(`Black passed pawn${pb.passed.length>1?'s':''}: ${pb.passed.join(', ')}.`);
  if (pw.isolated.length) pawnLines.push(`White isolated: ${uniq(pw.isolated).join(', ')}.`);
  if (pb.isolated.length) pawnLines.push(`Black isolated: ${uniq(pb.isolated).join(', ')}.`);
  if (pw.doubled.length > 1) pawnLines.push(`White doubled on ${FILES[FILE_IDX(pw.doubled[0])]}.`);
  if (pb.doubled.length > 1) pawnLines.push(`Black doubled on ${FILES[FILE_IDX(pb.doubled[0])]}.`);
  if (pw.backward.length) pawnLines.push(`White backward: ${uniq(pw.backward).join(', ')}.`);
  if (pb.backward.length) pawnLines.push(`Black backward: ${uniq(pb.backward).join(', ')}.`);
  pawnLines.push(`Pawn islands — White: ${pw.islands}, Black: ${pb.islands}.`);

  const kingLines = [];
  for (const c of ['w','b']) {
    const k = report.king[c];
    if (!k) continue;
    const name = c === 'w' ? 'White' : 'Black';
    const parts = [];
    parts.push(k.castled ? 'castled' : (k.onHome ? 'still on home square' : `king on ${k.square}`));
    if (k.shieldMissing.length) parts.push(`pawn shield gaps on ${k.shieldMissing.join(', ')}`);
    if (k.nearbyAttacked.length) parts.push(`enemy attacks squares around it (${k.nearbyAttacked.join(', ')})`);
    kingLines.push(`${name} king: ${parts.join('; ')}.`);
  }

  const files = report.files;
  const fileLines = [];
  if (files.open.length)      fileLines.push(`Open files: ${files.open.join(', ')}.`);
  if (files.halfOpenW.length) fileLines.push(`Half-open (White): ${files.halfOpenW.join(', ')}.`);
  if (files.halfOpenB.length) fileLines.push(`Half-open (Black): ${files.halfOpenB.join(', ')}.`);
  for (const c of ['w','b']) {
    for (const rk of files.rooks[c].filter(x => x.open || x.halfOpen)) {
      fileLines.push(`${c==='w'?'White':'Black'} rook on ${rk.sq} controls ${rk.open?'open':'half-open'} ${rk.file}-file.`);
    }
  }

  const outpostLines = [];
  for (const c of ['w','b']) {
    for (const op of report.outposts[c]) {
      outpostLines.push(`${c==='w'?'White':'Black'} knight outpost on ${op.square}${op.supported ? ' (pawn-supported)' : ''}.`);
    }
  }

  const mobLines = [];
  mobLines.push(`Mobility: White ${report.mobility.w} moves, Black ${report.mobility.b} moves.`);

  const devLines = [];
  if (report.development.w.length) devLines.push(`White undeveloped: ${report.development.w.join(', ')}.`);
  if (report.development.b.length) devLines.push(`Black undeveloped: ${report.development.b.join(', ')}.`);

  // ── deep additions ──
  const structureLines = report.structure.map(s => `<strong>${s.name}:</strong> ${s.desc}`);
  const complexLines = [];
  for (const c of ['w','b']) {
    const side = c === 'w' ? 'White' : 'Black';
    const cc = report.colorComplex[c];
    if (cc.weakSquares)
      complexLines.push(`${side} has weak <strong>${cc.weakSquares} squares</strong> (${cc.lightPct}% of pawns on light, ${cc.darkPct}% on dark).`);
  }
  const bishopLines = [];
  for (const c of ['w','b']) {
    const side = c === 'w' ? 'White' : 'Black';
    for (const b of report.bishopQuality[c]) {
      if (b.verdict === 'normal') continue;
      const label = b.verdict === 'good' ? '<span style="color:var(--c-brilliant)">good</span>' : '<span style="color:var(--c-bad)">bad</span>';
      bishopLines.push(`${side} bishop on ${b.square} (${b.on}-squares) is ${label} — ${b.pawnsOnSameColor}/${b.totalPawns} friendly pawns on its color.`);
    }
  }
  const chainLines = [];
  for (const c of ['w','b']) {
    const side = c === 'w' ? 'White' : 'Black';
    for (const ch of report.pawnChains[c]) {
      chainLines.push(`${side} pawn chain: ${ch.squares.join('–')} (base at <strong>${ch.base}</strong>).`);
    }
  }
  const spaceLines = report.space.leader
    ? [`${report.space.leader} leads in space (${report.space.w} vs ${report.space.b} squares controlled in enemy half, diff ${report.space.diff}).`]
    : [`Space is balanced (White ${report.space.w} vs Black ${report.space.b} squares in enemy half).`];

  const planLines = {
    w: report.plans.w,
    b: report.plans.b,
  };

  return {
    material:     [matLine, ...bishopPair, exchange].filter(Boolean).join(' '),
    pawns:        pawnLines,
    king:         kingLines,
    files:        fileLines,
    outposts:     outpostLines,
    mobility:     mobLines,
    development:  devLines,
    structure:    structureLines,
    colorComplex: complexLines,
    bishops:      bishopLines,
    chains:       chainLines,
    space:        spaceLines,
    plansWhite:   planLines.w,
    plansBlack:   planLines.b,
  };
}

export function renderTacticsReport(findings) {
  return {
    w: findings.w.map(f => f.text),
    b: findings.b.map(f => f.text),
  };
}

// ── utilities ──
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
function uniq(a) { return [...new Set(a)]; }
function dedupeBy(arr, key) {
  const seen = new Set(); const out = [];
  for (const x of arr) { if (!seen.has(x[key])) { seen.add(x[key]); out.push(x); } }
  return out;
}
