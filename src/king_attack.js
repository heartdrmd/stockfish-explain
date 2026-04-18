// king_attack.js — detect canonical attacking geometries from a FEN.
//
// Works alongside archetype.js (pawn structure) and pawn_levers.js
// (break moves). Where those modules answer "what kind of position is
// this structurally?", this module answers "is there a textbook
// attacking pattern loaded against the enemy king right now?"
//
// Patterns detected:
//   1. Greek-gift setup — Bxh7+ sacrifice is on the board (bishop on
//      the b1-h7 diagonal, knight ready for Ng5+ follow-up, enemy king
//      on g8 with h7 pawn still present).
//   2. Knight outpost near the enemy king — N on f5 or e5 with pawn
//      support, enemy king castled on the same wing.
//   3. Open or semi-open h-file with a rook either there or ready.
//   4. Opposite-side castling race — kings on different wings with
//      advanced pawns on both sides.
//   5. Back-rank pressure — heavy piece on enemy back rank while the
//      enemy king is boxed in by its own pawns.
//
// Each pattern returns a reading { pattern, side, readiness, target,
// plan, ingredients }. Readiness is a 0-6 rough score (higher = more
// loaded). Plan text is original paraphrase of well-known attacking
// motifs — no copyrighted prose.

import { Chess } from '../vendor/chess.js/chess.js';

// Convert algebraic "d3" to chess.js board coords. Board row 0 is
// rank 8, so rank r → board[8-r], file f ('a'..'h') → column f.charCodeAt-97.
const sqToRC = (s) => ({ r: 8 - parseInt(s[1], 10), c: s.charCodeAt(0) - 97 });
const pieceAt = (board, s) => {
  const { r, c } = sqToRC(s);
  if (r < 0 || r > 7 || c < 0 || c > 7) return null;
  return board[r][c];
};
const isP = (p, type, colour) => p && p.type === type && (!colour || p.color === colour);

function findKing(board, colour) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const sq = board[r][c];
    if (sq && sq.type === 'k' && sq.color === colour) return { r, c };
  }
  return null;
}

// ─── 1. Greek Gift (Bxh7+) setup ───────────────────────────────
function detectGreekGiftForSide(board, attacker) {
  // attacker = 'w' trying to Bxh7+, or 'b' trying to ...Bxh2+
  const opp = attacker === 'w' ? 'b' : 'w';
  const targetSq = attacker === 'w' ? 'h7' : 'h2';
  const kingHome = attacker === 'w' ? 'g8' : 'g1';
  // Opp king on its castled kingside square
  const oppK = pieceAt(board, kingHome);
  if (!isP(oppK, 'k', opp)) return null;
  // Target pawn still on h7 / h2
  const targetP = pieceAt(board, targetSq);
  if (!isP(targetP, 'p', opp)) return null;
  // Our bishop somewhere on the long light-squared diagonal pointing at
  // h7 / h2. For W: b1/c2/d3/e4/f5/g6. For B: b8/c7/d6/e5/f4/g3.
  const diag = attacker === 'w'
    ? ['b1','c2','d3','e4','f5','g6']
    : ['b8','c7','d6','e5','f4','g3'];
  const bishopSq = diag.find(s => isP(pieceAt(board, s), 'b', attacker));
  if (!bishopSq) return null;
  // Our knight on f3/f6 or already on e5/e4 (ready for Ng5+ / ...Ng4+)
  const knightSq = attacker === 'w'
    ? ['f3','e5','g5'].find(s => isP(pieceAt(board, s), 'n', attacker))
    : ['f6','e4','g4'].find(s => isP(pieceAt(board, s), 'n', attacker));
  if (!knightSq) return null;
  // Readiness bumps for Q-battery support
  let readiness = 3;
  const qSq = attacker === 'w' ? ['c2','d3','e2','d1'] : ['c7','d6','e7','d8'];
  if (qSq.some(s => isP(pieceAt(board, s), 'q', attacker))) readiness += 1;
  // No Nf6 (or ...Nf3) defender for enemy h-pawn = extra threat
  const defenderSq = attacker === 'w' ? 'f6' : 'f3';
  if (!isP(pieceAt(board, defenderSq), 'n', opp)) readiness += 1;
  const sideLabel = attacker === 'w' ? 'White' : 'Black';
  return {
    pattern: 'Greek-gift setup',
    side: attacker,
    readiness,
    target: targetSq,
    plan: `${sideLabel} can consider the classic bishop sacrifice on ${targetSq} followed by a knight check on ${attacker === 'w' ? 'g5' : 'g4'} and the queen joining via Q${attacker === 'w' ? 'h5' : 'h4'}. Works when the defender knight is missing from ${defenderSq} and the target pawn still sits on ${targetSq}.`,
    ingredients: [`${sideLabel} bishop on ${bishopSq}`, `${sideLabel} knight on ${knightSq}`, `opponent king on ${kingHome}`, `target pawn on ${targetSq}`],
  };
}

// ─── 2. Knight outpost near enemy king ─────────────────────────
function detectKnightOutpost(board, attacker) {
  const opp = attacker === 'w' ? 'b' : 'w';
  const oppK = findKing(board, opp);
  if (!oppK) return null;
  // Outpost squares close to enemy king
  const outposts = attacker === 'w'
    ? ['f5','e5','d5','f6','e6','d6','g5']
    : ['f4','e4','d4','f3','e3','d3','g4'];
  for (const sq of outposts) {
    const p = pieceAt(board, sq);
    if (!isP(p, 'n', attacker)) continue;
    // Pawn-support check: our pawn diagonally behind
    const { r, c } = sqToRC(sq);
    const backRank = attacker === 'w' ? r + 1 : r - 1;
    const supports = [];
    for (const df of [-1, 1]) {
      if (c + df < 0 || c + df > 7) continue;
      if (backRank < 0 || backRank > 7) continue;
      const sp = board[backRank][c + df];
      if (isP(sp, 'p', attacker)) supports.push(`pawn on ${String.fromCharCode(97 + c + df)}${8 - backRank}`);
    }
    if (!supports.length) continue;
    // Distance to enemy king
    const dist = Math.max(Math.abs(r - oppK.r), Math.abs(c - oppK.c));
    if (dist > 3) continue;
    const sideLabel = attacker === 'w' ? 'White' : 'Black';
    return {
      pattern: `Knight outpost on ${sq}`,
      side: attacker,
      readiness: 3 + (dist <= 2 ? 1 : 0) + supports.length,
      target: sq,
      plan: `${sideLabel}'s knight on ${sq} is pawn-supported and close to the enemy king. Typical follow-ups: double heavy pieces on the file in front of the knight, prepare a sacrificial break, or stack pressure until the defender concedes an exchange.`,
      ingredients: [`${sideLabel} knight on ${sq}`, ...supports, `opponent king on ${String.fromCharCode(97 + oppK.c)}${8 - oppK.r}`],
    };
  }
  return null;
}

// ─── 3. Open / semi-open h-file with rook aiming ───────────────
function detectOpenHFile(board, attacker) {
  const opp = attacker === 'w' ? 'b' : 'w';
  const oppK = findKing(board, opp);
  if (!oppK) return null;
  // Enemy king needs to be on kingside
  if (oppK.c < 5) return null;
  // Count pawns on h-file
  let ourH = 0, oppH = 0;
  for (let r = 0; r < 8; r++) {
    const p = board[r][7];
    if (isP(p, 'p', attacker)) ourH++;
    if (isP(p, 'p', opp)) oppH++;
  }
  // Open or semi-open for attacker
  if (ourH > 0) return null; // h-file not open for us
  // Our rook on h-file or ready (h1/h3/h6/h8 depending)
  let rookSq = null;
  for (let r = 0; r < 8; r++) {
    const p = board[r][7];
    if (isP(p, 'r', attacker)) { rookSq = `h${8 - r}`; break; }
  }
  if (!rookSq) {
    // Rook could still be on d1/e1/a1 ready to swing, but we only fire
    // when the geometry is already loaded. No rook on h-file = bail.
    return null;
  }
  const readiness = 2 + (oppH === 0 ? 2 : 1); // fully open is better
  const sideLabel = attacker === 'w' ? 'White' : 'Black';
  return {
    pattern: `Open h-file attack (rook on ${rookSq})`,
    side: attacker,
    readiness,
    target: `h${attacker === 'w' ? 7 : 2}`,
    plan: `${sideLabel}'s heavy piece on the ${oppH === 0 ? 'open' : 'semi-open'} h-file pries at the castled king. Typical follow-ups: double rooks / queen on the file, play a pawn sacrifice to open the g- or h-file further, or combine with a bishop on the b1-h7 diagonal for mating threats.`,
    ingredients: [`${sideLabel} rook on ${rookSq}`, `${oppH === 0 ? 'h-file fully open' : 'h-file semi-open'}`, `opponent king on kingside`],
  };
}

// ─── 4. Opposite-side castling race ────────────────────────────
function detectOppositeCastling(board) {
  const wK = findKing(board, 'w');
  const bK = findKing(board, 'b');
  if (!wK || !bK) return null;
  // Both kings still on their home rank (likely castled/hidden)
  if (wK.r !== 7 || bK.r !== 0) return null;
  const wSide = wK.c < 4 ? 'q' : wK.c > 4 ? 'k' : 'centre';
  const bSide = bK.c < 4 ? 'q' : bK.c > 4 ? 'k' : 'centre';
  if (wSide === 'centre' || bSide === 'centre') return null;
  if (wSide === bSide) return null;
  // Count advanced pawns on both wings
  let wStormPawns = 0, bStormPawns = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p.type !== 'p') continue;
    const advanced = p.color === 'w' ? r <= 3 : r >= 4;
    if (!advanced) continue;
    // White storming the side where Black castled
    const targetingBlack = bSide === 'q' ? c < 4 : c > 4;
    if (p.color === 'w' && targetingBlack) wStormPawns++;
    const targetingWhite = wSide === 'q' ? c < 4 : c > 4;
    if (p.color === 'b' && targetingWhite) bStormPawns++;
  }
  if (wStormPawns === 0 && bStormPawns === 0) return null;
  return {
    pattern: 'Opposite-side castling race',
    side: null,
    readiness: 3 + Math.min(wStormPawns + bStormPawns, 3),
    target: null,
    plan: `Kings on opposite wings (White ${wSide === 'k' ? 'kingside' : 'queenside'}, Black ${bSide === 'k' ? 'kingside' : 'queenside'}). Whichever side opens lines against the enemy king first wins. Principles: push the pawns in front of your own king slower than your attacking pawns, avoid defensive piece trades, sacrifice a pawn to rip open the target side when concrete.`,
    ingredients: [`White castled ${wSide === 'k' ? 'kingside' : 'queenside'}`, `Black castled ${bSide === 'k' ? 'kingside' : 'queenside'}`, `White storm pawns: ${wStormPawns}`, `Black storm pawns: ${bStormPawns}`],
  };
}

// ─── 5. Back-rank pressure ─────────────────────────────────────
function detectBackRankPressureForSide(board, attacker) {
  const opp = attacker === 'w' ? 'b' : 'w';
  const oppBackRank = attacker === 'w' ? 0 : 7;
  const oppK = findKing(board, opp);
  if (!oppK || oppK.r !== oppBackRank) return null;
  // King has a pawn wall in front (all 3 pawns in front of king still on
  // their 2nd/7th rank = no flight square)
  const pawnRankIdx = attacker === 'w' ? 1 : 6;
  const pawnsInFront = [-1, 0, 1]
    .filter(df => oppK.c + df >= 0 && oppK.c + df <= 7)
    .filter(df => isP(board[pawnRankIdx][oppK.c + df], 'p', opp));
  if (pawnsInFront.length < 2) return null;
  // Our heavy piece on the enemy back rank (or 1st rank from our side)
  let hittingBack = null;
  for (let c = 0; c < 8; c++) {
    const p = board[oppBackRank][c];
    if (p && p.color === attacker && (p.type === 'r' || p.type === 'q')) {
      hittingBack = { sq: `${String.fromCharCode(97 + c)}${8 - oppBackRank}`, type: p.type };
      break;
    }
  }
  if (!hittingBack) return null;
  const sideLabel = attacker === 'w' ? 'White' : 'Black';
  return {
    pattern: 'Back-rank pressure',
    side: attacker,
    readiness: 3 + (pawnsInFront.length === 3 ? 1 : 0),
    target: `${String.fromCharCode(97 + oppK.c)}${8 - oppBackRank}`,
    plan: `${sideLabel}'s ${hittingBack.type === 'r' ? 'rook' : 'queen'} on ${hittingBack.sq} threatens the opponent's boxed-in king. Typical follow-ups: double heavy pieces on the back rank, watch for deflection / overload tactics that remove a defender, and avoid giving the opponent time to create a flight square with a pawn push.`,
    ingredients: [`${sideLabel} ${hittingBack.type} on ${hittingBack.sq}`, `opponent king on ${String.fromCharCode(97 + oppK.c)}${8 - oppBackRank}`, `${pawnsInFront.length} pawns walling king`],
  };
}

// ─── public entrypoint ─────────────────────────────────────────
export function detectKingAttack(fen) {
  let chess;
  try { chess = new Chess(fen); } catch (_) { return []; }
  const board = chess.board();
  const results = [];
  for (const r of [
    detectGreekGiftForSide(board, 'w'),
    detectGreekGiftForSide(board, 'b'),
    detectKnightOutpost(board, 'w'),
    detectKnightOutpost(board, 'b'),
    detectOpenHFile(board, 'w'),
    detectOpenHFile(board, 'b'),
    detectOppositeCastling(board),
    detectBackRankPressureForSide(board, 'w'),
    detectBackRankPressureForSide(board, 'b'),
  ]) {
    if (r) results.push(r);
  }
  return results.sort((a, b) => b.readiness - a.readiness);
}

/**
 * Compact AI-prompt block listing the top N detected attack patterns.
 */
export function renderKingAttackForAI(results, maxCount = 3) {
  if (!results || !results.length) return '';
  const top = results.slice(0, maxCount);
  return `\nATTACK-READINESS GEOMETRY (canonical attacking patterns currently on the board):\n${
    top.map(r => `  - ${r.pattern}${r.side ? ' [' + (r.side === 'w' ? 'White' : 'Black') + ']' : ''} — readiness ${r.readiness}\n    ${r.plan}\n    Ingredients: ${r.ingredients.join(' · ')}`).join('\n')
  }\n`;
}
