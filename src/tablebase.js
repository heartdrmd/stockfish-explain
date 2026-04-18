// tablebase.js — Syzygy endgame tablebase integration.
//
// When a position has ≤ 7 pieces (including kings), Lichess hosts a
// public Syzygy tablebase API that returns the PERFECT evaluation and
// best move. In practical terms: in any ≤7-piece endgame our coach can
// upgrade from engine-approximation to ground-truth.
//
// API: https://tablebase.lichess.ovh/standard?fen=<urlencoded FEN>
//
// Response shape (relevant fields):
//   {
//     "checkmate":  boolean,
//     "stalemate":  boolean,
//     "variant_win":boolean,
//     "variant_loss":boolean,
//     "insufficient_material": boolean,
//     "category":   "win" | "loss" | "draw" | "cursed-win" | "blessed-loss" | "maybe-win" | "maybe-loss",
//     "dtz":        int | null,      // distance to zeroing
//     "dtm":        int | null,      // distance to mate (≤ 5-man only)
//     "moves": [
//       { "uci", "san", "category", "dtz", "dtm", "zeroing", "checkmate", ... }
//     ]
//   }
//
// Usage pattern:
//   import { isTablebasePosition, queryTablebase } from './tablebase.js';
//   if (isTablebasePosition(fen)) {
//     const tb = await queryTablebase(fen);
//     ...use tb.category + tb.moves[0].san as ground truth...
//   }

const API_BASE = 'https://tablebase.lichess.ovh/standard';
const MAX_PIECES = 7;

// In-memory cache keyed by FEN. Tablebase answers never change, so
// caching is safe indefinitely within a session. Size-capped to avoid
// unbounded growth in a long session.
const CACHE = new Map();
const CACHE_LIMIT = 500;

/** Count the number of pieces (both sides, including kings) from a FEN. */
export function pieceCount(fen) {
  const board = fen.split(' ')[0];
  let n = 0;
  for (const c of board) {
    if (/[pnbrqkPNBRQK]/.test(c)) n++;
  }
  return n;
}

/** True when the position is covered by Syzygy ≤ 7-man tables. */
export function isTablebasePosition(fen) {
  return pieceCount(fen) <= MAX_PIECES;
}

/** Query the public Lichess Syzygy API. Returns a normalized object or
 *  null on network / parse / 404 failure. Results are cached by FEN. */
export async function queryTablebase(fen) {
  if (!isTablebasePosition(fen)) return null;
  if (CACHE.has(fen)) return CACHE.get(fen);
  try {
    const url = API_BASE + '?fen=' + encodeURIComponent(fen);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[tablebase] HTTP ' + res.status + ' for fen ' + fen);
      return null;
    }
    const data = await res.json();
    const normalized = normalize(data);
    // Evict oldest entry when cache fills up
    if (CACHE.size >= CACHE_LIMIT) {
      const firstKey = CACHE.keys().next().value;
      CACHE.delete(firstKey);
    }
    CACHE.set(fen, normalized);
    return normalized;
  } catch (err) {
    console.warn('[tablebase] fetch failed: ' + err.message);
    return null;
  }
}

function normalize(raw) {
  if (!raw) return null;
  return {
    checkmate:             !!raw.checkmate,
    stalemate:             !!raw.stalemate,
    insufficientMaterial:  !!raw.insufficient_material,
    category:              raw.category || null,         // 'win' | 'draw' | 'loss' | ...
    dtz:                   raw.dtz ?? null,
    dtm:                   raw.dtm ?? null,
    moves: Array.isArray(raw.moves) ? raw.moves.map(m => ({
      san:       m.san,
      uci:       m.uci,
      category:  m.category,
      dtz:       m.dtz ?? null,
      dtm:       m.dtm ?? null,
      zeroing:   !!m.zeroing,
      checkmate: !!m.checkmate,
    })) : [],
  };
}

/** Render a short human-readable evaluation line for the coach panel. */
export function describeTablebaseResult(tb, sideToMove) {
  if (!tb) return null;
  if (tb.checkmate) return 'Checkmate on the board.';
  if (tb.stalemate) return 'Stalemate — draw.';
  if (tb.insufficientMaterial) return 'Insufficient material — draw.';
  const who = sideToMove === 'w' ? 'White' : 'Black';
  const opp = sideToMove === 'w' ? 'Black' : 'White';
  const cat = tb.category;
  let verdict = '';
  if (cat === 'win')            verdict = `${who} wins`;
  else if (cat === 'loss')      verdict = `${who} loses (${opp} wins)`;
  else if (cat === 'draw')      verdict = 'Theoretically drawn';
  else if (cat === 'cursed-win') verdict = `${who} wins in theory, but the 50-move rule saves the defender (cursed win)`;
  else if (cat === 'blessed-loss') verdict = `${who} loses in theory, but the 50-move rule saves the defender (blessed loss)`;
  else if (cat === 'maybe-win')  verdict = `${who} probably wins (tablebase edge case)`;
  else if (cat === 'maybe-loss') verdict = `${who} probably loses (tablebase edge case)`;
  else                           verdict = `Tablebase: ${cat}`;
  const dtz = tb.dtz != null ? ` · DTZ ${Math.abs(tb.dtz)}` : '';
  const dtm = tb.dtm != null ? ` · mate in ${Math.abs(tb.dtm)}` : '';
  return verdict + dtz + dtm;
}

/** Extract a short label for the best move per tablebase. */
export function tablebaseBestMoveLabel(tb) {
  if (!tb || !tb.moves || !tb.moves.length) return null;
  const best = tb.moves[0];          // Lichess returns moves sorted by result
  if (!best) return null;
  const cat = best.category;
  const suffix =
    cat === 'win'        ? '— wins'        :
    cat === 'loss'       ? '— loses'       :
    cat === 'draw'       ? '— draws'       :
    cat === 'cursed-win' ? '— cursed win'  :
    cat === 'blessed-loss' ? '— blessed loss' : '';
  const dtz = best.dtz != null ? ` (DTZ ${Math.abs(best.dtz)})` : '';
  return `${best.san} ${suffix}${dtz}`.trim();
}

/** Clear the in-memory cache (exposed for dev / test use). */
export function clearCache() { CACHE.clear(); }
