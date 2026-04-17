// narrate.js — real explanations driven by engine data + position geometry.
// No DOM; pure transforms.

import { Chess } from '../vendor/chess.js/chess.js';

const PIECE_NAME = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CENTRAL = new Set(['d4', 'd5', 'e4', 'e5', 'c4', 'c5', 'f4', 'f5']);

// ──────────────────────────────────────────────────────────────────
// POV helpers — the engine reports scores from side-to-move.
// Everywhere in the UI we show scores from WHITE's point of view.
// ──────────────────────────────────────────────────────────────────

export function toWhitePOV(scoreKind, score, sideToMove /* 'w'|'b' */) {
  if (sideToMove === 'w') return { scoreKind, score };
  // Negate both cp and mate scores
  return { scoreKind, score: -score };
}

// ──────────────────────────────────────────────────────────────────
// Move description — USES engine context, not just move geometry.
// ──────────────────────────────────────────────────────────────────

/**
 * @param {import('chess.js').Move} move    chess.js move object AFTER it's been played
 * @param {Chess} boardBefore                clone of the board BEFORE the move
 * @param {Chess} boardAfter                 clone of the board AFTER the move
 * @param {object} [ctx]                     optional engine context
 * @param {number} [ctx.cpBefore]            white-POV cp before move
 * @param {number} [ctx.cpAfter]             white-POV cp after move
 * @param {boolean} [ctx.isOnlyMove]         true if margin over 2nd-best is large
 * @param {boolean} [ctx.isForcing]          true if opponent has few legal replies
 */
export function describeMove(move, boardBefore, boardAfter, ctx = {}) {
  const side = move.color === 'w' ? 'White' : 'Black';
  const piece = PIECE_NAME[move.piece] || 'piece';
  const isCapture = move.flags.includes('c') || move.flags.includes('e');
  const isCheck = move.san.endsWith('+');
  const isMate = move.san.endsWith('#');
  const isPromo = move.flags.includes('p');
  const isCastleK = move.flags.includes('k');
  const isCastleQ = move.flags.includes('q');

  // — build the main sentence
  let mainVerb;
  if (isCastleK)       mainVerb = `${side} castles kingside`;
  else if (isCastleQ)  mainVerb = `${side} castles queenside`;
  else if (isCapture) {
    const cap = PIECE_NAME[move.captured] || 'piece';
    mainVerb = `${side} plays ${move.san}, capturing a ${cap}`;
  }
  else if (isPromo) {
    const np = PIECE_NAME[move.promotion] || 'queen';
    mainVerb = `${side} promotes to a ${np} with ${move.san}`;
  }
  else if (move.piece === 'p') {
    mainVerb = `${side} pushes the ${move.from[0]}-pawn to ${move.to}`;
  }
  else if (move.piece === 'n' && fromBackRank(move.from, move.color) && !isBackRankSquare(move.to)) {
    mainVerb = `${side} develops a knight to ${move.to}`;
  }
  else if ((move.piece === 'b') && fromBackRank(move.from, move.color) && !isBackRankSquare(move.to)) {
    mainVerb = `${side} develops a bishop to ${move.to}`;
  }
  else if (CENTRAL.has(move.to) && !isBackRankSquare(move.from)) {
    mainVerb = `${side} centralizes the ${piece} on ${move.to}`;
  }
  else {
    mainVerb = `${side} plays ${move.san}`;
  }

  // — gather modifiers (pattern + threat + delta)
  const modifiers = [];

  // Tactical patterns
  const threats = computeThreats(boardAfter, move.to, move.color);
  if (threats.fork) modifiers.push(threats.fork);
  else if (threats.doubleAttack) modifiers.push(threats.doubleAttack);
  else if (threats.hangingTarget) modifiers.push(threats.hangingTarget);

  const pin = detectPin(boardAfter, move.to, move.color);
  if (pin) modifiers.push(pin);

  // Eval delta from white POV
  if (typeof ctx.cpBefore === 'number' && typeof ctx.cpAfter === 'number') {
    const dirBefore = Math.abs(ctx.cpBefore);
    const delta = ctx.cpAfter - ctx.cpBefore; // positive = better for white
    // Sign relative to the mover: White benefits from +, Black from -
    const forMover = move.color === 'w' ? delta : -delta;
    if (forMover >= 150)      modifiers.push(`clearly gaining ground (${signedPawns(forMover)})`);
    else if (forMover >= 60)  modifiers.push(`improving the position by ${signedPawns(forMover)}`);
    else if (forMover <= -150)modifiers.push(`giving up significant ground (${signedPawns(forMover)})`);
    else if (forMover <= -60) modifiers.push(`losing a bit of ground (${signedPawns(forMover)})`);
    // ≤60cp swings don't rate a comment — it's noise
  }

  if (ctx.isOnlyMove)       modifiers.push('this is the only move that holds');
  else if (ctx.isForcing)   modifiers.push('a forcing continuation');

  // — assembly
  let sentence = mainVerb;
  if (modifiers.length) sentence += ` — ${modifiers.join(', ')}`;
  sentence += '.';
  if (isMate)       sentence += ' **Checkmate.**';
  else if (isCheck) sentence += ' **Check!**';
  return sentence;
}

// ──────────────────────────────────────────────────────────────────
// Tactical pattern detection (lightweight geometry-based)
// ──────────────────────────────────────────────────────────────────

/**
 * Returns a short phrase like "forking the queen and rook" if our piece
 * attacks ≥2 valuable enemy targets, plus a hangingTarget phrase if it
 * attacks one undefended piece.
 */
export function computeThreats(boardAfter, attackerSquare, attackerColor) {
  // To compute what our piece attacks, we flip side-to-move in the FEN
  // so chess.js will generate OUR moves from that square.
  const fen = boardAfter.fen();
  const parts = fen.split(' ');
  parts[1] = attackerColor;                // our side to "move"
  parts[3] = '-';                          // clear en-passant
  const ghost = (() => { try { return new Chess(parts.join(' ')); } catch { return null; } })();
  if (!ghost) return {};

  let captures;
  try {
    captures = ghost.moves({ square: attackerSquare, verbose: true })
                    .filter(m => m.flags.includes('c'));
  } catch { return {}; }

  const attacker = boardAfter.get(attackerSquare);
  if (!attacker) return {};
  const attackerVal = PIECE_VALUE[attacker.type];

  // Filter to "profitable" captures — target value ≥ our value, OR defender-less.
  const valuable = captures.filter(c => PIECE_VALUE[c.captured] >= attackerVal);
  const hanging = captures.filter(c => !isDefended(boardAfter, c.to, attackerColor));

  const out = {};
  if (valuable.length >= 2) {
    const names = valuable.map(c => PIECE_NAME[c.captured]);
    out.fork = `forking ${uniqueList(names)}`;
  } else if (captures.length >= 2) {
    out.doubleAttack = `attacking two pieces at once`;
  } else if (hanging.length === 1 && PIECE_VALUE[hanging[0].captured] >= 3) {
    out.hangingTarget = `threatening the undefended ${PIECE_NAME[hanging[0].captured]} on ${hanging[0].to}`;
  }
  return out;
}

/** Is the square defended by any piece of `color`? */
function isDefended(board, square, color) {
  // Check every enemy piece that would capture to this square.
  const fen = board.fen().split(' ');
  fen[1] = color;   // side-to-move = defenders
  fen[3] = '-';
  let ghost;
  try { ghost = new Chess(fen.join(' ')); } catch { return false; }
  try {
    const moves = ghost.moves({ verbose: true });
    return moves.some(m => m.to === square && m.flags.includes('c'));
  } catch { return false; }
}

/**
 * Detect a pin: our attacker aims at an enemy piece, and moving that
 * piece would expose a more-valuable piece on the same ray.
 * Returns a phrase like "pinning the rook to the king" or null.
 */
export function detectPin(boardAfter, attackerSquare, attackerColor) {
  const attacker = boardAfter.get(attackerSquare);
  if (!attacker) return null;
  if (!['b','r','q'].includes(attacker.type)) return null;  // only sliding pieces pin

  const rays = slidingRays(attacker.type);
  for (const [df, dr] of rays) {
    const line = rayScan(boardAfter, attackerSquare, df, dr, attackerColor);
    if (!line) continue;
    // Need two enemy pieces in a row along this ray, with nothing between.
    if (line.hits.length < 2) continue;
    const [p1, p2] = line.hits;
    const v1 = PIECE_VALUE[p1.piece.type];
    const v2 = PIECE_VALUE[p2.piece.type];
    // Classic pin: more valuable piece is BEHIND (further from attacker)
    if (v2 > v1 || (p2.piece.type === 'k' && v1 < 9)) {
      const p1name = PIECE_NAME[p1.piece.type];
      const p2name = PIECE_NAME[p2.piece.type];
      return p2.piece.type === 'k'
        ? `pinning the ${p1name} to the king`
        : `pinning the ${p1name} against the ${p2name}`;
    }
    // Skewer: more valuable piece is IN FRONT
    if (v1 > v2 && p1.piece.type !== 'k') {
      const p1name = PIECE_NAME[p1.piece.type];
      const p2name = PIECE_NAME[p2.piece.type];
      return `skewering the ${p1name} with a ${p2name} behind`;
    }
  }
  return null;
}

function slidingRays(type) {
  const diag = [[ 1, 1], [ 1,-1], [-1, 1], [-1,-1]];
  const orth = [[ 1, 0], [-1, 0], [ 0, 1], [ 0,-1]];
  if (type === 'b') return diag;
  if (type === 'r') return orth;
  return [...diag, ...orth];
}

function rayScan(board, sq, df, dr, ourColor) {
  const f = sq.charCodeAt(0) - 97;
  const r = parseInt(sq[1], 10) - 1;
  const hits = [];
  for (let i = 1; i < 8; i++) {
    const nf = f + df * i, nr = r + dr * i;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) break;
    const nk = String.fromCharCode(97 + nf) + (nr + 1);
    const p = board.get(nk);
    if (!p) continue;
    if (p.color === ourColor) break;    // friendly piece blocks the ray
    hits.push({ sq: nk, piece: p });
    if (hits.length >= 2) break;
  }
  return hits.length ? { hits } : null;
}

// ──────────────────────────────────────────────────────────────────
// PV narration — uses real engine context for the main line
// ──────────────────────────────────────────────────────────────────

export function narratePV(startChess, uciMoves, { maxMoves = 5, topMoves = null } = {}) {
  const sentences = [];
  const clone = new Chess(startChess.fen());
  for (let i = 0; i < Math.min(uciMoves.length, maxMoves); i++) {
    const boardBefore = new Chess(clone.fen());
    const mv = tryMove(clone, uciMoves[i]);
    if (!mv) break;
    const ctx = {};
    if (i === 0 && topMoves && topMoves.length >= 2) {
      const bestCp = topMoves[0].scoreKind === 'cp' ? topMoves[0].score : null;
      const altCp  = topMoves[1].scoreKind === 'cp' ? topMoves[1].score : null;
      if (bestCp != null && altCp != null && Math.abs(bestCp - altCp) >= 120) {
        ctx.isOnlyMove = true;
      }
    }
    sentences.push(describeMove(mv, boardBefore, clone, ctx));
  }
  return sentences;
}

// ──────────────────────────────────────────────────────────────────
// Confidence signal from score stability + 2nd-best margin
// ──────────────────────────────────────────────────────────────────

export function confidenceFromHistory(history, topMoves) {
  if (!history || history.length < 5) {
    return { level: 'unknown', reason: "Still searching — need a few more iterations." };
  }
  const last5 = history.slice(-5);
  const anyMate = last5.some(h => h.scoreKind === 'mate');
  const bests = last5.map(h => h.best);
  const allSame = bests.every(b => b === bests[0]);
  const scores = last5.map(h => h.scoreKind === 'mate' ? Math.sign(h.score) * 10000 : h.score);
  const spread = Math.max(...scores) - Math.min(...scores);

  let gap = Infinity;
  if (topMoves && topMoves.length >= 2
      && topMoves[0].scoreKind === 'cp' && topMoves[1].scoreKind === 'cp') {
    gap = Math.abs(topMoves[0].score - topMoves[1].score);
  }

  if (anyMate)                                return { level: 'high', reason: 'Forced mate sequence found.' };
  if (allSame && spread <= 20 && gap >= 80)   return { level: 'high',   reason: `Best move stable across last ${last5.length} iterations; 2nd-best is ${gap}cp worse.` };
  if (allSame && spread <= 60)                return { level: 'medium', reason: `Best move holds but score still moving (${spread}cp spread).` };
  if (!allSame) {
    const changes = bests.filter((v,i)=>i&&v!==bests[i-1]).length;
    return { level: 'low', reason: `Best move changed ${changes} time(s) recently — position is unclear.` };
  }
  return { level: 'medium', reason: `Score swinging ${spread}cp; narrow margin vs 2nd-best (${Math.round(gap)}cp).` };
}

// ──────────────────────────────────────────────────────────────────
// Formatting
// ──────────────────────────────────────────────────────────────────

export function formatScore(scoreKind, score) {
  if (scoreKind === 'mate') {
    const n = Math.abs(score);
    return score > 0 ? `#${n}` : `#-${n}`;
  }
  const pawns = score / 100;
  const sign = pawns >= 0 ? '+' : '';
  return `${sign}${pawns.toFixed(2)}`;
}

export function scoreWord(scoreKind, score) {
  if (scoreKind === 'mate') return score > 0 ? 'winning' : 'losing';
  if (score >=  500) return 'winning';
  if (score >=  150) return 'much better';
  if (score >=   50) return 'slightly better';
  if (score >   -50) return 'equal';
  if (score >  -150) return 'slightly worse';
  if (score >  -500) return 'much worse';
  return 'losing';
}

// ──────────────────────────────────────────────────────────────────
// utility
// ──────────────────────────────────────────────────────────────────

function signedPawns(cp) {
  const p = cp / 100;
  const s = p >= 0 ? '+' : '';
  return `${s}${p.toFixed(2)}`;
}

function tryMove(chess, uci) {
  if (!uci || uci.length < 4) return null;
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const promo = uci.length > 4 ? uci[4] : undefined;
  try { return chess.move({ from, to, promotion: promo }); } catch { return null; }
}

function fromBackRank(sq, color) {
  return color === 'w' ? sq[1] === '1' : sq[1] === '8';
}
function isBackRankSquare(sq) {
  return sq[1] === '1' || sq[1] === '8';
}
function uniqueList(items) {
  const seen = new Map();
  for (const i of items) seen.set(i, (seen.get(i) || 0) + 1);
  const parts = [];
  for (const [name, count] of seen)
    parts.push(count > 1 ? `${count} ${name}s` : `the ${name}`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts.join(' and ');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length-1];
}

export { tryMove };
