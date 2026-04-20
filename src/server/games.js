// src/server/games.js — game archive + mistakes endpoints.
//
// All endpoints require auth (via requireAuth middleware from auth.js).
// Games are stored with per-ply eval data (JSONB) so the client can
// reconstruct the eval timeline + mistake pills without re-analysing.
//
// Wired as a group in server.js: wireGames(app).

import { query } from './db.js';
import { requireAuth } from './auth.js';

export function wireGames(app) {
  // POST /api/games
  // Body: { pgn, result, opening_name, opening_eco, white_name, black_name,
  //         user_color, mode, plies, mistakes_count, blunders_count }
  // Response: { id, played_at }
  app.post('/api/games', requireAuth, async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.pgn || typeof b.pgn !== 'string') {
        return res.status(400).json({ error: 'pgn required' });
      }
      // Sanity cap: ~100 KB per game — eval-per-ply JSON is the bulky
      // part; even a 100-move game with full plies stays under 30 KB.
      if (b.pgn.length > 100_000) return res.status(413).json({ error: 'pgn too large' });

      const { rows } = await query(`
        INSERT INTO games(
          user_id, pgn, result, opening_name, opening_eco,
          white_name, black_name, user_color, mode, plies,
          mistakes_count, blunders_count
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id, played_at
      `, [
        req.user.id,
        b.pgn,
        b.result || null,
        b.opening_name || null,
        b.opening_eco || null,
        b.white_name || null,
        b.black_name || null,
        b.user_color || null,
        b.mode || null,
        b.plies ? JSON.stringify(b.plies) : null,
        Number.isFinite(+b.mistakes_count) ? +b.mistakes_count : 0,
        Number.isFinite(+b.blunders_count) ? +b.blunders_count : 0,
      ]);
      res.json({ id: rows[0].id, played_at: rows[0].played_at });
    } catch (err) {
      console.error('[games] insert failed', err);
      res.status(500).json({ error: 'insert failed' });
    }
  });

  // GET /api/games  — list user's games.
  // Query params:
  //   from=YYYY-MM-DD (inclusive)  to=YYYY-MM-DD (exclusive)
  //   limit (default 100, max 500)  offset (default 0)
  app.get('/api/games', requireAuth, async (req, res) => {
    try {
      const limit  = Math.min(500, Math.max(1, +req.query.limit  || 100));
      const offset = Math.max(0, +req.query.offset || 0);
      const params = [req.user.id];
      const where = ['user_id = $1'];
      if (req.query.from) { params.push(req.query.from); where.push(`played_at >= $${params.length}`); }
      if (req.query.to)   { params.push(req.query.to);   where.push(`played_at <  $${params.length}`); }
      params.push(limit); params.push(offset);
      const { rows } = await query(`
        SELECT id, result, opening_name, opening_eco, white_name, black_name,
               user_color, mode, mistakes_count, blunders_count, played_at
          FROM games
         WHERE ${where.join(' AND ')}
         ORDER BY played_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);
      // Total count so the client can show "showing 100 of 347".
      const total = await query(`SELECT COUNT(*)::int AS c FROM games WHERE ${where.join(' AND ')}`, params.slice(0, -2));
      res.json({ games: rows, total: total.rows[0].c });
    } catch (err) {
      console.error('[games] list failed', err);
      res.status(500).json({ error: 'list failed' });
    }
  });

  // GET /api/games/:id — fetch full PGN + plies for replay.
  app.get('/api/games/:id', requireAuth, async (req, res) => {
    try {
      const id = +req.params.id;
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
      const { rows } = await query(
        'SELECT * FROM games WHERE id = $1 AND user_id = $2',
        [id, req.user.id],
      );
      if (!rows.length) return res.status(404).json({ error: 'not found' });
      res.json({ game: rows[0] });
    } catch (err) {
      console.error('[games] get failed', err);
      res.status(500).json({ error: 'get failed' });
    }
  });

  // DELETE /api/games/:id — "don't save this game" or user purge.
  app.delete('/api/games/:id', requireAuth, async (req, res) => {
    try {
      const id = +req.params.id;
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
      const result = await query(
        'DELETE FROM games WHERE id = $1 AND user_id = $2',
        [id, req.user.id],
      );
      res.json({ deleted: result.rowCount });
    } catch (err) {
      console.error('[games] delete failed', err);
      res.status(500).json({ error: 'delete failed' });
    }
  });

  // GET /api/games/export.pgn  — download games as a single PGN file.
  // Optional date range same as /api/games.
  app.get('/api/games/export.pgn', requireAuth, async (req, res) => {
    try {
      const params = [req.user.id];
      const where = ['user_id = $1'];
      if (req.query.from) { params.push(req.query.from); where.push(`played_at >= $${params.length}`); }
      if (req.query.to)   { params.push(req.query.to);   where.push(`played_at <  $${params.length}`); }
      const { rows } = await query(
        `SELECT pgn, played_at FROM games
          WHERE ${where.join(' AND ')}
          ORDER BY played_at ASC`,
        params,
      );
      const filename = 'stockfish-explain-games' +
        (req.query.from ? `-${req.query.from}` : '') +
        (req.query.to   ? `-to-${req.query.to}` : '') +
        '.pgn';
      res.setHeader('Content-Type', 'application/x-chess-pgn');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      // Each game separated by a blank line — canonical PGN multi-game
      // format readable by ChessBase, lichess, chess.com, etc.
      const body = rows.map(r => r.pgn.trim()).join('\n\n') + '\n';
      res.send(body);
    } catch (err) {
      console.error('[games] export failed', err);
      res.status(500).json({ error: 'export failed' });
    }
  });
}
