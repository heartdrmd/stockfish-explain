// dorfman.js — static / dynamic positional factors inspired by Iossif
// Dorfman's "The Method in Chess" and its successors.
//
// This is NOT a Stockfish replacement — it's a coaching-style report:
// for a given FEN we compute Dorfman's four static factors and some
// dynamic indicators, then print a plain-language summary of which
// side stands better and why, whether a critical-moment-detector
// triggered, and which side has the "easier plan" (independence-of-
// plan heuristic).
//
// Rules implemented (numbered to match the research report):
//   1. Lexicographic eval (K → Material → Queens-off → Pawn structure)
//   2. King-safety alarm (pawn-shield + attackers vs defenders near K)
//   3. Phantom-queens eval (evaluate with queens removed, sign flip)
//   4. Piece-combination bonus (2N+B on fixed pawn colour)
//   5. Critical-moment detector (captures chain / central push / forced)
//   6. Independence-of-plan score (# moves that don't need cooperation)
//   7. Opposite-side-castling storm (pawn-storm advancement)
//   8. Dynamic decay (not implemented inline — caller decays bonuses)
//   9. Static-vs-dynamic mode switch (returned as `recommendedMode`)
//
// All functions take the same FEN string and return small objects.
// The top-level `dorfmanReport(fen)` aggregates everything.

import { Chess } from '../vendor/chess.js/chess.js';

const PIECE_CP = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// ─── 1. Lexicographic factor aggregation ────────────────────────────

export function dorfmanReport(fen) {
  const chess = new Chess(fen);
  const board = chess.board();

  const kingSafety       = kingSafetyFactor(chess, board);
  const material         = materialFactor(board);
  const queensOff        = phantomQueensFactor(chess);
  const pawnStructure    = pawnStructureFactor(board);
  const pieceCombo       = pieceCombinationBonus(board);
  const criticalMoment   = detectCriticalMoment(chess, board);
  const independence     = independenceOfPlan(chess, board);
  const oppCastle        = oppositeCastleStorm(chess, board);

  // Lexicographic verdict: the most decisive factor wins. If K-safety
  // says "black in serious danger" that dominates a pawn deficit.
  // If K-safety is neutral, look at material; if material is equal,
  // look at queens-off eval; if that flips, look at structure.
  const verdict = lexicographicVerdict([
    kingSafety,
    material,
    queensOff,
    pawnStructure,
  ]);

  // Rule 9: mode switch — statically worse side should seek dynamics
  const recommendedMode =
    verdict.sign === 0   ? 'balanced'
    : verdict.sign > 0   ? 'white-consolidates'
    :                      'black-consolidates';
  // …and the opposite side should look for forcing counterplay
  const counterMode =
    verdict.sign === 0   ? null
    : verdict.sign > 0   ? 'black-seeks-dynamics'
    :                      'white-seeks-dynamics';

  return {
    sideToMove:        chess.turn() === 'w' ? 'White' : 'Black',
    factors: {
      kingSafety,
      material,
      queensOff,
      pawnStructure,
      pieceCombo,
    },
    criticalMoment,
    independence,
    oppCastle,
    verdict,
    recommendedMode,
    counterMode,
  };
}

// ─── 2. King safety ─────────────────────────────────────────────────

function kingSafetyFactor(chess, board) {
  const white = kingZoneStats(chess, board, 'w');
  const black = kingZoneStats(chess, board, 'b');

  // Alarm = shield missing AND attackers ≥ defenders
  const wAlarm = white.shieldHoles >= 2 && white.attackers >= white.defenders;
  const bAlarm = black.shieldHoles >= 2 && black.attackers >= black.defenders;

  let sign = 0, note = 'both kings adequately safe';
  if (wAlarm && !bAlarm) { sign = -1; note = 'White king exposed (shield holes + attackers ≥ defenders)'; }
  else if (bAlarm && !wAlarm) { sign = +1; note = 'Black king exposed (shield holes + attackers ≥ defenders)'; }
  else if (wAlarm && bAlarm)  { sign = 0;  note = 'both kings under fire — race'; }
  return { sign, note, white, black, wAlarm, bAlarm };
}

function kingZoneStats(chess, board, color) {
  // Find the king's square, look at pawn shield in front, count attackers
  // and defenders of 8 squares around the king.
  let kSquare = null;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (p && p.type === 'k' && p.color === color) kSquare = { r, f };
  }
  if (!kSquare) return { shieldHoles: 0, attackers: 0, defenders: 0 };

  // Pawn shield — 3 squares in front of king on own side
  const shieldDir = color === 'w' ? -1 : +1;   // toward own side is negative
  const shieldRank = kSquare.r + shieldDir;
  let shieldHoles = 0;
  for (const df of [-1, 0, 1]) {
    const f = kSquare.f + df;
    if (f < 0 || f > 7 || shieldRank < 0 || shieldRank > 7) continue;
    const p = board[shieldRank][f];
    if (!p || p.type !== 'p' || p.color !== color) shieldHoles++;
  }

  // Attackers / defenders in 3×3 zone around the king
  let attackers = 0, defenders = 0;
  for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++) {
    const r = kSquare.r + dr, f = kSquare.f + df;
    if (r < 0 || r > 7 || f < 0 || f > 7) continue;
    const sq = fileChar(f, chess) + rankChar(r, chess);
    // count enemy pieces that attack this square
    const atkCount = countAttackersOn(chess, sq, color === 'w' ? 'b' : 'w');
    const defCount = countAttackersOn(chess, sq, color);
    attackers += atkCount;
    defenders += defCount;
  }
  return { shieldHoles, attackers, defenders };
}

// chess.js uses 'a' file at board[r][0] when r is the 0-indexed rank
// counting from rank 8 down to rank 1. Helper converts board[r][f] → san.
function fileChar(f) { return 'abcdefgh'[f]; }
function rankChar(r) { return '87654321'[r]; }

function countAttackersOn(chess, square, byColor) {
  // chess.js has .isAttacked(square, color) — returns boolean. We want a count.
  // Approximate count by generating all moves for byColor and counting those
  // whose destination equals `square`.
  // Tried and true but expensive. For this advisor it's acceptable.
  const fen = chess.fen().split(' ');
  // temporarily flip side to move so chess.js generates `byColor` moves
  const flipped = fen.slice();
  flipped[1] = byColor;
  flipped[3] = '-';
  try {
    const tmp = new Chess(flipped.join(' '));
    const moves = tmp.moves({ verbose: true });
    return moves.filter(m => m.to === square).length;
  } catch { return 0; }
}

// ─── 3. Material ────────────────────────────────────────────────────

function materialFactor(board) {
  let w = 0, b = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f]; if (!p) continue;
    (p.color === 'w' ? (w += PIECE_CP[p.type]) : (b += PIECE_CP[p.type]));
  }
  const diff = w - b;
  let sign = 0, note = 'material balanced';
  if (diff >= 100) { sign = +1; note = `White ahead by ~${(diff/100).toFixed(2)} pawns`; }
  else if (diff <= -100) { sign = -1; note = `Black ahead by ~${(-diff/100).toFixed(2)} pawns`; }
  return { sign, note, diff };
}

// ─── 4. Phantom queens ──────────────────────────────────────────────

function phantomQueensFactor(chess) {
  const realMat = simpleMaterialEval(chess);
  // Remove both queens
  const board = chess.board();
  let stripped = chess.fen().split(' ');
  const rows = stripped[0].split('/').map(row =>
    row.replace(/[QqQq]/g, (c) => {
      // Counter-intuitive but simple: replace Q/q with 1 (empty square)
      return '1';
    })
  );
  // Collapse consecutive digits after the replacement
  stripped[0] = rows.map(row => row.replace(/(\d)(\d)+/g, (m, ...g) => {
    const total = m.split('').reduce((s, c) => s + Number(c), 0);
    return String(total);
  })).join('/');
  let phantomEval = 0;
  try { phantomEval = simpleMaterialEval(new Chess(stripped.join(' '))); }
  catch { phantomEval = realMat; }

  const signFlip = Math.sign(realMat) !== Math.sign(phantomEval) && Math.abs(realMat) > 50;
  let sign = 0, note;
  if (signFlip) {
    sign = Math.sign(phantomEval);
    note = 'queen trade flips the evaluation — trade-sensitive position';
  } else {
    note = 'queen trade preserves the balance';
  }
  return { sign, note, realEval: realMat, phantomEval, signFlip };
}

function simpleMaterialEval(chess) {
  const board = chess.board();
  let w = 0, b = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f]; if (!p) continue;
    (p.color === 'w' ? (w += PIECE_CP[p.type]) : (b += PIECE_CP[p.type]));
  }
  return w - b;
}

// ─── 5. Pawn structure ──────────────────────────────────────────────

function pawnStructureFactor(board) {
  const w = pawnStats(board, 'w');
  const b = pawnStats(board, 'b');
  // Rough score: penalize isolated / doubled / backward; reward passed pawns.
  const wScore = w.passed * 40 - w.isolated * 20 - w.doubled * 15 - w.islands * 8 - w.backward * 12;
  const bScore = b.passed * 40 - b.isolated * 20 - b.doubled * 15 - b.islands * 8 - b.backward * 12;
  const diff = wScore - bScore;
  let sign = 0, note;
  if (diff >= 25) { sign = +1; note = `White pawn structure is better (+${diff})`; }
  else if (diff <= -25) { sign = -1; note = `Black pawn structure is better (${diff})`; }
  else { note = 'pawn structures roughly balanced'; }
  return { sign, note, white: w, black: b, diff };
}

function pawnStats(board, color) {
  // Collect pawn files & ranks
  const files = [0, 0, 0, 0, 0, 0, 0, 0];
  const pawnsByFile = [[], [], [], [], [], [], [], []];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (p && p.type === 'p' && p.color === color) {
      files[f]++;
      pawnsByFile[f].push(r);
    }
  }
  const doubled = files.reduce((s, v) => s + Math.max(0, v - 1), 0);

  // Isolated: pawn on file F with no pawn on F-1 or F+1
  let isolated = 0;
  for (let f = 0; f < 8; f++) if (files[f] > 0) {
    const leftEmpty  = f === 0 || files[f-1] === 0;
    const rightEmpty = f === 7 || files[f+1] === 0;
    if (leftEmpty && rightEmpty) isolated += files[f];
  }

  // Islands: contiguous groups of occupied files
  let islands = 0, inside = false;
  for (let f = 0; f < 8; f++) {
    if (files[f] > 0 && !inside) { islands++; inside = true; }
    else if (files[f] === 0) inside = false;
  }

  // Passed: no enemy pawns on same or adjacent files ahead
  let passed = 0;
  for (let f = 0; f < 8; f++) for (const r of pawnsByFile[f]) {
    const ahead = color === 'w' ? (rr) => rr < r : (rr) => rr > r;
    const enemy = color === 'w' ? 'b' : 'w';
    let blocked = false;
    for (let df = -1; df <= 1; df++) {
      const ef = f + df;
      if (ef < 0 || ef > 7) continue;
      for (let rr = 0; rr < 8; rr++) {
        if (!ahead(rr)) continue;
        const p = board[rr][ef];
        if (p && p.type === 'p' && p.color === enemy) { blocked = true; break; }
      }
      if (blocked) break;
    }
    if (!blocked) passed++;
  }

  // Backward: pawn that can't advance safely because its neighbours are ahead.
  let backward = 0;
  for (let f = 0; f < 8; f++) for (const r of pawnsByFile[f]) {
    let supported = false;
    for (const df of [-1, 1]) {
      const ef = f + df; if (ef < 0 || ef > 7) continue;
      for (const rr of pawnsByFile[ef]) {
        if (color === 'w' ? rr > r : rr < r) { supported = true; break; }
      }
      if (supported) break;
    }
    if (!supported) backward++;
  }

  return { files, doubled, isolated, islands, passed, backward };
}

// ─── 6. Piece-combination bonus (2N+B on fixed pawn colour) ─────────

function pieceCombinationBonus(board) {
  const w = knightBishopMix(board, 'w');
  const b = knightBishopMix(board, 'b');
  const wFixed = pawnsOnColourFixed(board);
  // Award bonus if one side has 2N+B and pawns are fixed on the B's colour.
  let sign = 0, note = 'no side has a clear piece-combination advantage';
  if (w.N === 2 && w.B === 1 && b.N === 1 && b.B === 2) {
    // Check white's bishop colour; if enemy pawns fix on that colour, +
    const bishopColour = whiteBishopColour(board, 'w');
    if (bishopColour && wFixed[bishopColour] >= 4) {
      sign = +1;
      note = `White has 2N+B with enemy pawns fixed on the ${bishopColour} colour`;
    }
  } else if (b.N === 2 && b.B === 1 && w.N === 1 && w.B === 2) {
    const bishopColour = whiteBishopColour(board, 'b');
    if (bishopColour && wFixed[bishopColour] >= 4) {
      sign = -1;
      note = `Black has 2N+B with enemy pawns fixed on the ${bishopColour} colour`;
    }
  }
  return { sign, note };
}

function knightBishopMix(board, color) {
  let N = 0, B = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (!p || p.color !== color) continue;
    if (p.type === 'n') N++;
    if (p.type === 'b') B++;
  }
  return { N, B };
}
function whiteBishopColour(board, color) {
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (p && p.type === 'b' && p.color === color) {
      return ((r + f) % 2 === 0) ? 'light' : 'dark';
    }
  }
  return null;
}
function pawnsOnColourFixed(board) {
  let light = 0, dark = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (!p || p.type !== 'p') continue;
    if ((r + f) % 2 === 0) light++;
    else                   dark++;
  }
  return { light, dark };
}

// ─── 7. Critical-moment detector ────────────────────────────────────

function detectCriticalMoment(chess, board) {
  const moves = chess.moves({ verbose: true });
  // (a) any capture-recapture chain (at least one capture move)
  const hasCapture = moves.some(m => m.flags.includes('c') || m.flags.includes('e'));
  // (b) central pawn (d/e files, ranks 4-5) can push
  const centralPush = moves.some(m => {
    if (m.piece !== 'p') return false;
    const file = m.from[0];
    return (file === 'd' || file === 'e') && (m.to[1] === '4' || m.to[1] === '5' || m.to[1] === '6' || m.to[1] === '3');
  });
  // (c) position is currently in check — last move was likely forced
  const inCheck = chess.inCheck();

  const triggers = [];
  if (hasCapture)   triggers.push('possible exchange on the board');
  if (centralPush)  triggers.push('central pawn push available');
  if (inCheck)      triggers.push('side to move is in check');

  return {
    isCritical: triggers.length > 0,
    triggers,
    note: triggers.length
      ? 'Critical moment — spend extra time here: ' + triggers.join(' · ')
      : 'not a critical moment — play within your plan',
  };
}

// ─── 8. Independence of plan ────────────────────────────────────────

function independenceOfPlan(chess, board) {
  // Very rough: count moves that don't capture or check — "quiet plan
  // moves". The side with more quiet moves available has more
  // "independent" plans to pursue.
  const wQuiet = quietMoveCount(chess, 'w');
  const bQuiet = quietMoveCount(chess, 'b');
  let sign = 0, note;
  if (wQuiet > bQuiet + 4) { sign = +1; note = `White has more independent plan moves (${wQuiet} vs ${bQuiet})`; }
  else if (bQuiet > wQuiet + 4) { sign = -1; note = `Black has more independent plan moves (${bQuiet} vs ${wQuiet})`; }
  else { note = `roughly equal plan flexibility (${wQuiet} vs ${bQuiet})`; }
  return { sign, note, wQuiet, bQuiet };
}
function quietMoveCount(chess, color) {
  const fen = chess.fen().split(' ');
  fen[1] = color;
  fen[3] = '-';
  let tmp;
  try { tmp = new Chess(fen.join(' ')); }
  catch { return 0; }
  return tmp.moves({ verbose: true }).filter(m =>
    !m.flags.includes('c') && !m.flags.includes('e') && !m.san.includes('+')
  ).length;
}

// ─── 9. Opposite-side castling pawn-storm ───────────────────────────

function oppositeCastleStorm(chess, board) {
  // Locate kings
  let wK = null, bK = null;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (p && p.type === 'k') {
      if (p.color === 'w') wK = { r, f };
      else                 bK = { r, f };
    }
  }
  if (!wK || !bK) return { active: false, note: 'kings not located' };

  // Opposite side means kings on opposite halves of the board (file < 4 vs file >= 4).
  // Standard short vs long castle → wK on g/h side, bK on c/b side (or vice versa).
  const wSide = wK.f >= 4 ? 'king' : 'queen';
  const bSide = bK.f >= 4 ? 'king' : 'queen';
  if (wSide === bSide) return { active: false, note: 'kings on same side — no opposite-castle dynamic' };

  // Measure pawn storm distance: for each attacker's pawns on files toward
  // enemy king, count how far they've advanced.
  const wStorm = pawnStormAdvance(board, 'w', bK.f);
  const bStorm = pawnStormAdvance(board, 'b', wK.f);
  let sign = 0;
  let note = `opposite-side castling · White storm ${wStorm} vs Black storm ${bStorm}`;
  if (wStorm - bStorm >= 3)      { sign = +1; note += ' — White storm faster'; }
  else if (bStorm - wStorm >= 3) { sign = -1; note += ' — Black storm faster'; }
  return { active: true, sign, note, wStorm, bStorm };
}
function pawnStormAdvance(board, color, enemyKingFile) {
  // Sum "rank of advance" for color's pawns on files within ±2 of enemy king
  let sum = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (!p || p.type !== 'p' || p.color !== color) continue;
    if (Math.abs(f - enemyKingFile) > 2) continue;
    // For white, "advance" = 8 - r (since r=0 is rank 8); for black, r (since r=7 is rank 1).
    const adv = color === 'w' ? (6 - r) : (r - 1);
    sum += Math.max(0, adv);
  }
  return sum;
}

// ─── Lexicographic verdict ──────────────────────────────────────────

function lexicographicVerdict(factors) {
  // Walk factors in priority order; first non-zero sign wins.
  for (const f of factors) {
    if (f && f.sign && f.sign !== 0) {
      return { sign: f.sign, dominant: f.note };
    }
  }
  return { sign: 0, dominant: 'no decisive static factor — the position is balanced' };
}
