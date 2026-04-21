// src/api.js — thin fetch wrapper for the /api/* JSON endpoints.
//
// All helpers include credentials so the session cookie rides along.
// Errors throw with { status, message } so callers can pattern-match
// on HTTP 401 to prompt for login, 413 for too-big payloads, etc.

async function req(method, url, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  const ct = r.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  let data = null;
  try { data = isJson ? await r.json() : await r.text(); } catch {}
  if (!r.ok) {
    const err = new Error((data && data.error) || `HTTP ${r.status}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const api = {
  // auth
  me:     ()    => req('GET',  '/api/auth/me'),
  signup: (u,p) => req('POST', '/api/auth/signup', { username: u, password: p }),
  login:  (u,p) => req('POST', '/api/auth/login',  { username: u, password: p }),
  logout: ()    => req('POST', '/api/auth/logout'),

  // games
  saveGame:   (g)       => req('POST',   '/api/games', g),
  // Full filter surface: from, to, result, color, mode, opening,
  // cleanliness (clean|mistakes|blunders), sort (newest|oldest|
  // most_mistakes|fewest_mistakes|most_moves), limit, offset.
  listGames:  (q = {})  => {
    const qs = new URLSearchParams(Object.entries(q).filter(([,v]) => v != null && v !== ''));
    return req('GET',    '/api/games' + (qs.toString() ? '?' + qs : ''));
  },
  // Aggregate counts honouring the same filters. Used for the My Games
  // header strip (total, W/L/D, avg mistakes, etc.).
  statsGames: (q = {})  => {
    const qs = new URLSearchParams(Object.entries(q).filter(([,v]) => v != null && v !== ''));
    return req('GET',    '/api/games/stats' + (qs.toString() ? '?' + qs : ''));
  },
  getGame:    (id)      => req('GET',    `/api/games/${+id}`),
  deleteGame: (id)      => req('DELETE', `/api/games/${+id}`),
  // Returns the export URL so the caller can set window.location or
  // create an <a download> — lets the browser stream the file directly.
  exportUrl:  (q = {})  => {
    const qs = new URLSearchParams(Object.entries(q).filter(([,v]) => v != null && v !== ''));
    return '/api/games/export.pgn' + (qs.toString() ? '?' + qs : '');
  },
};

// Convenience: return current user or null (catches 401).
export async function currentUser() {
  try { const r = await api.me(); return r.user; } catch { return null; }
}
