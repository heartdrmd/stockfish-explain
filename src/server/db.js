// src/server/db.js — Postgres connection pool + schema migrations.
//
// Migrations are idempotent and run once at server startup. Each new
// schema change is a `migrations.push(...)` call at the bottom of the
// file — we track which ones have run via a `_migrations` table.
//
// Reading this file tells you the entire schema. No separate SQL files.

import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
export const db = connectionString
  ? new Pool({
      connectionString,
      // Render's managed Postgres requires SSL; the default self-signed
      // cert isn't in Node's root bundle so we relax rejectUnauthorized.
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  : null;

export const dbEnabled = () => !!db;

export async function query(sql, params = []) {
  if (!db) throw new Error('DATABASE_URL not configured — DB queries are disabled');
  return db.query(sql, params);
}

// ─── Migrations ────────────────────────────────────────────────────
// Each migration is { name, sql }. Names must be unique + stable —
// they're stored in the _migrations table to prevent re-runs.

const migrations = [
  {
    name: '001_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id           SERIAL PRIMARY KEY,
        username     TEXT UNIQUE NOT NULL,
        pw_hash      TEXT NOT NULL,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: '002_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        expires_at  TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);
    `,
  },
  {
    name: '003_games',
    sql: `
      CREATE TABLE IF NOT EXISTS games (
        id              SERIAL PRIMARY KEY,
        user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pgn             TEXT NOT NULL,
        result          TEXT,
        opening_name    TEXT,
        opening_eco     TEXT,
        white_name      TEXT,
        black_name      TEXT,
        user_color      TEXT,                -- 'white' | 'black' | null
        mode            TEXT,                -- 'practice' | 'analysis'
        plies           JSONB,               -- per-ply eval data
        mistakes_count  INT DEFAULT 0,
        blunders_count  INT DEFAULT 0,
        played_at       TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_games_user_played
        ON games(user_id, played_at DESC);
    `,
  },
  {
    name: '004_mistakes',
    sql: `
      CREATE TABLE IF NOT EXISTS mistakes (
        id               SERIAL PRIMARY KEY,
        user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_id          INT REFERENCES games(id) ON DELETE CASCADE,
        fen              TEXT NOT NULL,
        played_san       TEXT NOT NULL,
        best_uci         TEXT,
        eval_before_cp   INT,
        eval_after_cp    INT,
        severity         TEXT NOT NULL,       -- 'inaccuracy' | 'mistake' | 'blunder'
        win_chance_drop  REAL,
        ply              INT,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_mistakes_user ON mistakes(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mistakes_game ON mistakes(game_id);
    `,
  },
  {
    name: '005_srs_cards',
    sql: `
      CREATE TABLE IF NOT EXISTS srs_cards (
        id             SERIAL PRIMARY KEY,
        user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mistake_id     INT NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
        ease           REAL DEFAULT 2.5,
        interval_days  REAL DEFAULT 1,
        due_at         TIMESTAMPTZ DEFAULT NOW(),
        review_count   INT  DEFAULT 0,
        last_graded_at TIMESTAMPTZ,
        UNIQUE(user_id, mistake_id)
      );
      CREATE INDEX IF NOT EXISTS idx_srs_user_due ON srs_cards(user_id, due_at);
    `,
  },
  {
    name: '006_favourites',
    sql: `
      CREATE TABLE IF NOT EXISTS favourites (
        user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opening_key TEXT NOT NULL,
        side        TEXT NOT NULL,            -- 'white' | 'black' | 'both'
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, opening_key)
      );
    `,
  },
  {
    name: '007_user_prefs',
    sql: `
      CREATE TABLE IF NOT EXISTS user_prefs (
        user_id     INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        prefs_json  JSONB NOT NULL DEFAULT '{}',
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
];

export async function runMigrations() {
  if (!db) {
    console.log('[db] DATABASE_URL not set — skipping migrations (DB features disabled)');
    return;
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name      TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const { rows } = await db.query('SELECT name FROM _migrations');
  const applied = new Set(rows.map(r => r.name));
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    console.log(`[db] applying migration ${m.name}`);
    await db.query('BEGIN');
    try {
      await db.query(m.sql);
      await db.query('INSERT INTO _migrations(name) VALUES ($1)', [m.name]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw new Error(`Migration ${m.name} failed: ${err.message}`);
    }
  }
  console.log(`[db] schema ready — ${migrations.length} migrations tracked`);
}
