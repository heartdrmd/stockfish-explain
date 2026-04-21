// puzzles.js — Lichess puzzle trainer (daily + by-id lookup).
//
// Uses the public Lichess API at lichess.org/api/puzzle which returns
// JSON with { puzzle: { id, solution: [UCI...], rating, themes }, game:
// { pgn: "...", id: "..." } }. No auth needed for the daily endpoint.
//
// Puzzle flow (matches lila's ui/puzzle/src/):
//   1. Load the game's PGN and play through to the puzzle start ply
//   2. Play the opponent's set-up move (puzzle.initialPly + 1)
//   3. User must find solution[0]. Each correct move triggers the
//      engine to play solution[i+1]. Wrong move → shake + try again.
//   4. Complete → show success + rating delta + Next button.

const API = 'https://lichess.org/api/puzzle';

// Fetch daily puzzle. Returns:
//   { puzzle: { id, solution, rating, themes, initialPly }, game: { pgn } }
// or null on failure.
export async function fetchDaily() {
  try {
    const r = await fetch(`${API}/daily`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Fetch a specific puzzle by id.
export async function fetchById(id) {
  try {
    const r = await fetch(`${API}/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Replay a PGN up to `plies` half-moves and return an array of UCI
// moves for the mainline — needed because the puzzle ships a PGN
// (SAN) but we want to feed UCIs into our board.
export function pgnToUciList(Chess, pgn, maxPlies) {
  const c = new Chess();
  try { c.load_pgn(pgn, { sloppy: true }); } catch {}
  const hist = c.history({ verbose: true });
  const out = [];
  for (let i = 0; i < hist.length; i++) {
    if (maxPlies != null && i >= maxPlies) break;
    const m = hist[i];
    out.push(m.from + m.to + (m.promotion || ''));
  }
  return out;
}

// Shape helper for the UI — consistent view-model regardless of
// API endpoint shape quirks.
export function normalise(raw) {
  if (!raw || !raw.puzzle || !raw.game) return null;
  return {
    id:         raw.puzzle.id,
    rating:     raw.puzzle.rating,
    plays:      raw.puzzle.plays,
    themes:     raw.puzzle.themes || [],
    initialPly: raw.puzzle.initialPly,
    solution:   raw.puzzle.solution || [],
    pgn:        raw.game.pgn || '',
    gameId:     raw.game.id,
  };
}
