// src/server/auth.js — simple username/password auth.
//
// Design choices (deliberately small):
//   * Random opaque session tokens stored in Postgres, 30-day expiry
//   * bcryptjs password hashing (pure JS so no native build deps)
//   * Session cookie set HttpOnly + SameSite=Lax
//   * No email recovery, no OAuth — friend group only
//
// Endpoints wired into server.js:
//   POST /api/auth/signup  { username, password } → sets session
//   POST /api/auth/login   { username, password } → sets session
//   POST /api/auth/logout                          → clears session
//   GET  /api/auth/me                              → { user } or 401

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from './db.js';

const SESSION_COOKIE = 'sfe_sid';
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function validateUsername(u) {
  if (typeof u !== 'string') return 'username must be a string';
  const s = u.trim();
  if (s.length < 2 || s.length > 32) return 'username must be 2–32 characters';
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(s)) return 'username: letters / digits / _ . -';
  return null;
}
function validatePassword(p) {
  if (typeof p !== 'string') return 'password must be a string';
  if (p.length < 6 || p.length > 128) return 'password must be 6–128 characters';
  return null;
}

async function createSession(userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    'INSERT INTO sessions(token, user_id, expires_at) VALUES($1, $2, $3)',
    [token, userId, expiresAt],
  );
  return { token, expiresAt };
}

function setSessionCookie(res, token, expiresAt, req) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!req.secure || req.get('x-forwarded-proto') === 'https',
    expires: expiresAt,
    path: '/',
  });
}

async function readSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await query(
    `SELECT s.user_id, u.username, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token],
  );
  if (!rows.length) return null;
  // Touch last_seen
  await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [rows[0].user_id]);
  return { id: rows[0].user_id, username: rows[0].username };
}

export function requireAuth(req, res, next) {
  readSession(req).then(session => {
    if (!session) return res.status(401).json({ error: 'not authenticated' });
    req.user = session;
    next();
  }).catch(err => {
    console.error('[auth] session lookup failed', err);
    res.status(500).json({ error: 'session lookup failed' });
  });
}

export function wireAuth(app) {
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const username = (req.body?.username || '').trim();
      const password = req.body?.password || '';
      const uErr = validateUsername(username);
      if (uErr) return res.status(400).json({ error: uErr });
      const pErr = validatePassword(password);
      if (pErr) return res.status(400).json({ error: pErr });
      const existing = await query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
      if (existing.rows.length) return res.status(409).json({ error: 'username taken' });
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await query(
        'INSERT INTO users(username, pw_hash) VALUES($1, $2) RETURNING id, username',
        [username, hash],
      );
      const { token, expiresAt } = await createSession(rows[0].id);
      setSessionCookie(res, token, expiresAt, req);
      res.json({ user: { id: rows[0].id, username: rows[0].username } });
    } catch (err) {
      console.error('[auth] signup failed', err);
      res.status(500).json({ error: 'signup failed' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const username = (req.body?.username || '').trim();
      const password = req.body?.password || '';
      if (!username || !password) return res.status(400).json({ error: 'username + password required' });
      const { rows } = await query(
        'SELECT id, username, pw_hash FROM users WHERE lower(username) = lower($1)',
        [username],
      );
      if (!rows.length) return res.status(401).json({ error: 'invalid username or password' });
      const ok = await bcrypt.compare(password, rows[0].pw_hash);
      if (!ok) return res.status(401).json({ error: 'invalid username or password' });
      const { token, expiresAt } = await createSession(rows[0].id);
      setSessionCookie(res, token, expiresAt, req);
      res.json({ user: { id: rows[0].id, username: rows[0].username } });
    } catch (err) {
      console.error('[auth] login failed', err);
      res.status(500).json({ error: 'login failed' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      if (token) await query('DELETE FROM sessions WHERE token = $1', [token]);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[auth] logout failed', err);
      res.status(500).json({ error: 'logout failed' });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    const session = await readSession(req).catch(() => null);
    if (!session) return res.status(401).json({ error: 'not authenticated' });
    res.json({ user: session });
  });
}
