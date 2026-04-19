// game_archive.js — persistent storage for completed games.
//
// Archives every finished game (practice or analysis review) with
// per-move engine data so downstream features (eval timeline, pawn-
// structure strip, mistake bank, spaced repetition) all read from the
// same source.
//
// Shape of an archived game:
//   {
//     id:        number (Date.now milliseconds)
//     date:      "YYYY-MM-DD"
//     result:    "1-0" | "0-1" | "1/2-1/2" | "*"
//     ending:    string (human readable — "You resigned", "Checkmate", etc.)
//     mode:      "practice" | "analysis"
//     userColor: "white" | "black" | null   (null for analysis review)
//     opponent:  string (e.g., "Stockfish (skill 12)")
//     opening:   { name, eco } | null       (from openings_book detector)
//     startingFen: string
//     pgn:       string (full PGN with tags)
//     plies: [
//       {
//         ply:     number (1-based)
//         san:     string
//         fen:     string (position AFTER this move)
//         cpWhite: number | null   (centipawn eval in WHITE POV; null if unknown)
//         mate:    number | null   (plies-to-mate if positive = White wins)
//         depth:   number | null
//       }, ...
//     ]
//   }
//
// Storage uses localStorage. A 5MB browser quota holds ~200-300 games
// at ~400 bytes/ply × 40 plies. When near the cap we drop the oldest.
// Individual games larger than ~50KB are trimmed to fit.
//
// Mistake bank derivation is computed on-the-fly from archived games
// — we scan plies[] for eval-swings that exceed the classification
// thresholds and project them as virtual mistake entries.

const GAMES_KEY   = 'stockfish-explain.archive.games';
const MAX_GAMES   = 300;
const MAX_BYTES   = 4_500_000;  // leave headroom under the 5 MB browser quota

// Classify an eval swing (in centipawns, from side-to-move's POV
// BEFORE the move). Positive "drop" = the side that moved got worse.
// Thresholds follow the Lichess/Chess.com convention (rough).
export const THRESHOLDS = {
  blunder:    200,    // ?? — catastrophic
  mistake:    100,    // ?  — serious
  inaccuracy:  50,    // ?! — meaningful
};

/**
 * Classify an eval swing. `cpBefore` and `cpAfter` are both in the
 * POV of the side that *just moved* (so a drop from +80 to -100 means
 * they threw away ~180 cp).
 * @returns {null | 'blunder' | 'mistake' | 'inaccuracy'}
 */
export function classifySwing(cpBefore, cpAfter) {
  if (cpBefore == null || cpAfter == null) return null;
  const drop = cpBefore - cpAfter;
  if (drop >= THRESHOLDS.blunder)    return 'blunder';
  if (drop >= THRESHOLDS.mistake)    return 'mistake';
  if (drop >= THRESHOLDS.inaccuracy) return 'inaccuracy';
  return null;
}

export function loadGames() {
  try {
    const raw = localStorage.getItem(GAMES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveGames(arr) {
  try {
    localStorage.setItem(GAMES_KEY, JSON.stringify(arr));
    return true;
  } catch (err) {
    console.warn('[archive] save failed (quota?):', err.message);
    return false;
  }
}

/**
 * Archive a finished game. Trims to the most recent MAX_GAMES before
 * writing, and if the serialised payload is over MAX_BYTES, drops the
 * oldest games until it fits.
 */
export function archiveGame(game) {
  if (!game || !game.plies || !game.plies.length) return false;
  const all = loadGames();
  all.push({ ...game, id: game.id || Date.now() });
  // Keep newest MAX_GAMES
  all.sort((a, b) => b.id - a.id);
  let trimmed = all.slice(0, MAX_GAMES);
  // Byte-size trim: drop oldest until under cap
  while (trimmed.length > 1) {
    const size = JSON.stringify(trimmed).length;
    if (size < MAX_BYTES) break;
    trimmed.pop();
  }
  return saveGames(trimmed);
}

export function deleteGame(id) {
  const all = loadGames().filter(g => g.id !== id);
  return saveGames(all);
}

export function getGame(id) {
  return loadGames().find(g => g.id === id) || null;
}

/**
 * Derive the mistake bank from all archived games. A "mistake entry" is
 * produced for each ply whose eval-swing (from side-to-move's POV)
 * crosses one of the THRESHOLDS above.
 *
 * Returns array of {
 *   gameId, ply, san, fenBefore, fenAfter, cpBefore, cpAfter,
 *   swing, severity, userColor, date, opening, result
 * } sorted by severity then recency.
 */
export function deriveMistakes() {
  const mistakes = [];
  for (const g of loadGames()) {
    const plies = g.plies || [];
    for (let i = 0; i < plies.length; i++) {
      const p = plies[i];
      const prev = i === 0 ? null : plies[i - 1];
      const fenBefore = prev ? prev.fen : g.startingFen;
      // POV of the side that JUST moved. Engine stores cpWhite. If white
      // moved and cp went +100 → +20, white "gave up 80". If black
      // moved and cp went -100 → -20, black gave up 80 from black's POV.
      // Figure out who moved by checking what colour is to move in fenBefore.
      const stmBefore = (fenBefore.split(' ')[1] || 'w') === 'w' ? 1 : -1;
      // cp in side-to-move's POV = stmBefore * cpWhite
      const cpBefore = prev && prev.cpWhite != null ? stmBefore * prev.cpWhite : null;
      // Side who moved is the opposite of stm AFTER — but we want cp in
      // THEIR pov after their move; cpWhite after the move * their sign.
      // Simpler: if stmBefore was white, the mover was white; their POV
      // cp after move = cpWhite. For black mover, POV = -cpWhite.
      const cpAfter = p.cpWhite != null ? stmBefore * p.cpWhite : null;
      const severity = classifySwing(cpBefore, cpAfter);
      if (!severity) continue;
      mistakes.push({
        gameId: g.id,
        ply: p.ply,
        san: p.san,
        fenBefore,
        fenAfter: p.fen,
        cpBefore,
        cpAfter,
        swing: (cpBefore ?? 0) - (cpAfter ?? 0),
        severity,
        userColor: g.userColor,
        byUser: g.userColor ? (stmBefore === 1 ? 'white' : 'black') === g.userColor : null,
        date: g.date,
        opening: g.opening,
        result: g.result,
      });
    }
  }
  // Sort: blunders first, then mistakes, then inaccuracies; within
  // severity, newest first.
  const rank = { blunder: 3, mistake: 2, inaccuracy: 1 };
  mistakes.sort((a, b) => (rank[b.severity] - rank[a.severity]) || (b.gameId - a.gameId));
  return mistakes;
}

export function archiveStats() {
  const games = loadGames();
  const byResult = { '1-0': 0, '0-1': 0, '1/2-1/2': 0, '*': 0 };
  let practiceCount = 0, analysisCount = 0;
  for (const g of games) {
    byResult[g.result] = (byResult[g.result] || 0) + 1;
    if (g.mode === 'practice') practiceCount++; else analysisCount++;
  }
  return {
    total: games.length,
    byResult,
    practiceCount,
    analysisCount,
    oldest: games.length ? games[games.length - 1].date : null,
    newest: games.length ? games[0].date : null,
    bytesUsed: JSON.stringify(games).length,
  };
}

export function clearArchive() {
  try { localStorage.removeItem(GAMES_KEY); return true; }
  catch { return false; }
}
