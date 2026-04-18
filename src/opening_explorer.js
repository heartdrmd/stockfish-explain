// opening_explorer.js — Lichess Masters opening database integration.
//
// Queries https://explorer.lichess.ovh/masters for a position's
// historical win/draw/loss statistics in master-level games. Turns the
// opening coach from purely principle-based into empirically-grounded:
//   "In 12,345 master games this position has scored 54% White /
//    32% drawn / 14% Black. Most common reply is Nf3 (played 62% of
//    the time, scoring +0.08 for White on average)."
//
// The API is free, no auth, ~60 req/min rate limit. Responses are
// cached by FEN in memory for the session.

const API_BASE = 'https://explorer.lichess.ovh/masters';
const CACHE = new Map();
const CACHE_LIMIT = 300;
// Throttle: never more than one request per 120 ms to stay under their
// 60/min envelope.
let lastFetchAt = 0;
const MIN_INTERVAL_MS = 120;

/** Fetch the master-games stats for a FEN. Returns null on failure. */
export async function queryOpeningExplorer(fen, { moves = 12 } = {}) {
  if (CACHE.has(fen)) return CACHE.get(fen);
  // Throttle
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastFetchAt = Date.now();
  try {
    const url = API_BASE
              + '?fen=' + encodeURIComponent(fen)
              + '&moves=' + moves
              + '&topGames=0';
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[openings] HTTP ' + res.status);
      return null;
    }
    const data = await res.json();
    const out = normalize(data);
    if (CACHE.size >= CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value);
    CACHE.set(fen, out);
    return out;
  } catch (err) {
    console.warn('[openings] fetch failed: ' + err.message);
    return null;
  }
}

function normalize(raw) {
  if (!raw) return null;
  const total = (raw.white || 0) + (raw.draws || 0) + (raw.black || 0);
  return {
    total,
    white:   raw.white  || 0,
    draws:   raw.draws  || 0,
    black:   raw.black  || 0,
    pctWhite: total ? +(raw.white  / total * 100).toFixed(1) : 0,
    pctDraw:  total ? +(raw.draws  / total * 100).toFixed(1) : 0,
    pctBlack: total ? +(raw.black  / total * 100).toFixed(1) : 0,
    opening:  raw.opening ? { eco: raw.opening.eco, name: raw.opening.name } : null,
    moves:    Array.isArray(raw.moves) ? raw.moves.map(m => ({
      san:      m.san,
      uci:      m.uci,
      white:    m.white || 0,
      draws:    m.draws || 0,
      black:    m.black || 0,
      total:    (m.white || 0) + (m.draws || 0) + (m.black || 0),
      rating:   m.averageRating || null,
    })) : [],
  };
}

/** Return true when the position is plausibly still "in the opening"
 *  and worth a master-DB lookup. Heuristic: ≤ 20 plies played AND
 *  non-pawn material hasn't dropped much. */
export function worthExplorerLookup(fen, movesPlayed) {
  if (movesPlayed != null && movesPlayed > 20) return false;
  return true;
}

/** Render a short HTML block summarising the explorer data. Safe for
 *  innerHTML — all user-controlled strings escaped / constrained. */
export function renderExplorerBlock(data) {
  if (!data || !data.total) {
    return '<em class="muted">No master-game data for this position.</em>';
  }
  const openingLine = data.opening
    ? `<div class="oe-opening"><strong>${escapeHtml(data.opening.name)}</strong> <span class="muted">(${escapeHtml(data.opening.eco)})</span></div>`
    : '';
  const summary = `
    <div class="oe-summary">
      <span>${data.total.toLocaleString()} master games</span>
      <span class="oe-bar">
        <span class="oe-bar-w" style="width:${data.pctWhite}%"></span>
        <span class="oe-bar-d" style="width:${data.pctDraw}%"></span>
        <span class="oe-bar-b" style="width:${data.pctBlack}%"></span>
      </span>
      <span class="oe-pct">W ${data.pctWhite}% · D ${data.pctDraw}% · B ${data.pctBlack}%</span>
    </div>`;
  const topMoves = data.moves.slice(0, 5);
  const movesHtml = topMoves.length
    ? `<table class="oe-moves">
         <thead><tr><th>Move</th><th>Games</th><th>%</th><th>W/D/B</th><th>Avg</th></tr></thead>
         <tbody>${topMoves.map(m => {
           const pct = data.total ? ((m.total / data.total) * 100).toFixed(1) : '0.0';
           const wp  = m.total ? ((m.white / m.total) * 100).toFixed(0) : '0';
           const dp  = m.total ? ((m.draws / m.total) * 100).toFixed(0) : '0';
           const bp  = m.total ? ((m.black / m.total) * 100).toFixed(0) : '0';
           return `<tr>
             <td class="oe-san">${escapeHtml(m.san)}</td>
             <td>${m.total.toLocaleString()}</td>
             <td>${pct}%</td>
             <td class="oe-wdl">${wp}/${dp}/${bp}</td>
             <td>${m.rating || '—'}</td>
           </tr>`;
         }).join('')}</tbody>
       </table>`
    : '';
  return openingLine + summary + movesHtml;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}

export function clearCache() { CACHE.clear(); }
