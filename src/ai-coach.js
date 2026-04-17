// ai-coach.js — optional LLM-augmented analysis, Stockfish-verified.
//
// Two-phase flow (fixes "coach makes up plans"):
//   1. Query Stockfish for MultiPV=5 top candidates + eval after each
//   2. Send FEN + engine ground-truth + heuristic findings to Claude
//      with a strict "you must cite the engine data" prompt
//   3. Verify every SAN move Claude names by re-probing the engine
//   4. Flag any Claude suggestion the engine disagrees with
//
// API key is stored in localStorage only; never sent except to Anthropic.

import { Chess } from '../vendor/chess.js/chess.js';

const KEY_STORAGE    = 'stockfish-explain.anthropic-key';  // legacy — ignored when PROXY_MODE
const MODEL_STORAGE  = 'stockfish-explain.anthropic-model';
// Default to the cheapest tier. Premium (Sonnet/Opus) requires a second
// password unlock in the server-proxied flow — see server.js /api/ai.
const DEFAULT_MODEL  = 'claude-haiku-4-5';

// When the page is served by our own server.js, we proxy every request to
// Anthropic through /api/ai (so the key stays server-side). When it's opened
// via file:// or a plain static host, we fall back to the old "paste your own
// key" behaviour. Detection: absence of window.location.origin being file:
// or the presence of /api/whoami.
const PROXY_MODE = (typeof window !== 'undefined')
  && (window.location.protocol === 'http:' || window.location.protocol === 'https:');

// Known model strings. Users can type any string (including ones newer
// than this list) in the model input; this list is just for the dropdown.
// If a given model returns 404, the error is shown verbatim.
// Full list of known Anthropic model strings. The API accepts aliases (like
// `claude-opus-4-5`) that resolve to the current stable snapshot, and dated
// snapshots (like `claude-opus-4-1-20250805`). Type any model — the API
// returns 404 with the exact error if a name isn't valid.
export const MODEL_SUGGESTIONS = [
  // Opus family — highest capability
  'claude-opus-4-7',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-opus-4-1-20250805',
  'claude-opus-4',
  'claude-opus-4-20250514',
  'claude-3-opus-20240229',
  // Sonnet family — balanced (good default)
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-latest',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-sonnet-20240229',
  // Haiku family — fastest / cheapest
  'claude-haiku-4-5',
  'claude-3-5-haiku-latest',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
];

// Per-million-token pricing (approximate, USD). Used for cost estimates.
// Update when Anthropic changes pricing.
export const MODEL_PRICES = {
  // Opus — $15 input / $75 output per million tokens
  'claude-opus-4-7':            { input: 15,  output: 75 },
  'claude-opus-4-5':            { input: 15,  output: 75 },
  'claude-opus-4-1':            { input: 15,  output: 75 },
  'claude-opus-4-1-20250805':   { input: 15,  output: 75 },
  'claude-opus-4':              { input: 15,  output: 75 },
  'claude-opus-4-20250514':     { input: 15,  output: 75 },
  'claude-3-opus-20240229':     { input: 15,  output: 75 },
  // Sonnet — $3 input / $15 output per million tokens
  'claude-sonnet-4-6':          { input:  3,  output: 15 },
  'claude-sonnet-4-5':          { input:  3,  output: 15 },
  'claude-sonnet-4-5-20250929': { input:  3,  output: 15 },
  'claude-sonnet-4':            { input:  3,  output: 15 },
  'claude-sonnet-4-20250514':   { input:  3,  output: 15 },
  'claude-3-7-sonnet-20250219': { input:  3,  output: 15 },
  'claude-3-5-sonnet-latest':   { input:  3,  output: 15 },
  'claude-3-5-sonnet-20241022': { input:  3,  output: 15 },
  'claude-3-5-sonnet-20240620': { input:  3,  output: 15 },
  'claude-3-sonnet-20240229':   { input:  3,  output: 15 },
  // Haiku — cheap
  'claude-haiku-4-5':           { input:  1,    output:  5 },
  'claude-3-5-haiku-latest':    { input:  0.8,  output:  4 },
  'claude-3-5-haiku-20241022':  { input:  0.8,  output:  4 },
  'claude-3-haiku-20240307':    { input:  0.25, output: 1.25 },
};
export function priceFor(model) {
  return MODEL_PRICES[model] || { input: 3, output: 15 };  // default to Sonnet
}
export function estimateCost(model, inputTokens, outputTokens) {
  const p = priceFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1e6;
}

// Session-wide cost tracker (reset on page reload)
let sessionCost = 0;
let sessionCalls = 0;
export function addCost(model, usage) {
  const c = estimateCost(model, usage?.input_tokens || 0, usage?.output_tokens || 0);
  sessionCost += c; sessionCalls++;
  return { thisCall: c, sessionTotal: sessionCost, callsThisSession: sessionCalls };
}
export function getSessionCost() {
  return { sessionTotal: sessionCost, callsThisSession: sessionCalls };
}

// ─── legacy direct-API-key helpers (only used when not in PROXY_MODE) ───
export function hasApiKey() {
  if (PROXY_MODE) return true;  // server holds the key
  return !!localStorage.getItem(KEY_STORAGE);
}
export function setApiKey(key) { localStorage.setItem(KEY_STORAGE, key); }
export function clearApiKey() { localStorage.removeItem(KEY_STORAGE); }
export function getModel() { return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL; }
export function setModel(m) { localStorage.setItem(MODEL_STORAGE, m); }

// ─── proxy-mode tier tracking (server tells us on /api/whoami) ───
// tier: 'none' (locked out), 'basic' (haiku only), 'premium' (all models)
let currentTier = 'none';
export function getTier() { return currentTier; }
export function setTier(t) { currentTier = t; }
export async function refreshTier() {
  if (!PROXY_MODE) { currentTier = 'premium'; return currentTier; }
  try {
    const r = await fetch('/api/whoami', { credentials: 'include' });
    const j = await r.json();
    currentTier = j.tier || 'none';
  } catch {
    currentTier = 'none';
  }
  return currentTier;
}
export async function submitGatePassword(password) {
  const r = await fetch('/api/gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password }),
  });
  const j = await r.json();
  currentTier = j.tier || 'none';
  return j;
}
export async function logout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  currentTier = 'none';
}
export function isPremiumModel(model) {
  return !String(model || '').toLowerCase().includes('haiku');
}

/**
 * Phase 1: collect ground truth from Stockfish.
 * @param {Engine} engine    the app's Engine instance (must be ready)
 * @param {string} fen
 * @param {number} depth     search depth (default 18)
 * @param {number} multipv   how many candidate lines to fetch (default 5)
 * @returns {Promise<{lines: Array<{uci, san, scoreKind, score, pvSan}>, depth, nodes}>}
 */
export async function probeEngine(engine, fen, depth = 18, multipv = 5) {
  const originalMultiPV = engine.multipv;
  engine.setMultiPV(multipv);
  try {
    // Start search and wait for bestmove
    engine.stop();
    const done = new Promise(resolve => {
      const onBest = (ev) => { engine.removeEventListener('bestmove', onBest); resolve(ev.detail); };
      engine.addEventListener('bestmove', onBest);
    });
    engine.start(fen, { depth });
    const result = await done;

    // Convert UCI PVs to SAN for the LLM
    const lines = (result.topMoves || []).map((t) => {
      const chess = new Chess(fen);
      const pvSan = [];
      let firstSan = null;
      for (const uci of t.pv || []) {
        try {
          const mv = chess.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci.length>4?uci[4]:undefined });
          if (!mv) break;
          if (!firstSan) firstSan = mv.san;
          pvSan.push(mv.san);
          if (pvSan.length >= 8) break;
        } catch { break; }
      }
      return {
        uci: t.pv[0],
        san: firstSan,
        scoreKind: t.scoreKind,
        score: t.score,           // from side-to-move POV
        pvSan: pvSan.join(' '),
      };
    });
    return { lines, depth: result.history?.[result.history.length-1]?.depth || depth };
  } finally {
    engine.setMultiPV(originalMultiPV);
  }
}

// Three prompt "modes" — each tab uses a different one, tailored to what
// the tab is supposed to answer.
const PROMPT_MODES = {
  general: {
    focus: 'Overall coaching',
    system: `You are a chess coach EXPLAINING the position using the Stockfish data provided as ground truth. Do not invent moves.

ABSOLUTE RULES:
1. Any move you recommend MUST be in the engine's top-5 candidates.
2. Quote the engine's score when making claims.
3. If #1 vs #2 is < 30 cp, say the choice isn't forced.
4. Never claim a tactic/win without pointing to the specific engine PV.

STYLE: GM-like, concise. 4-6 short paragraphs structured:
**Position in one sentence** · **Threats and weaknesses** · **Best plan (from engine #1)** · **Alternative ideas** · **What to avoid**
Bold key moves and squares. Under 300 words.`,
  },

  position: {
    focus: 'Positional analysis (strategy, structure, piece placement)',
    system: `You are a chess coach giving a PURE POSITIONAL analysis. Do NOT discuss tactics — focus on structure, piece quality, long-term factors.

Use the Stockfish data as ground truth for who stands better. Do not invent moves.

ABSOLUTE RULES:
1. Any move you mention MUST be in the engine's top-5.
2. Quote engine eval when claiming an advantage.
3. Focus on: pawn structure, weak squares, good/bad bishops, worst-placed piece (Silman), plan for next 5-10 moves.

STYLE: Like Silman's "How to Reassess Your Chess" or Watson's "Secrets of Modern Chess Strategy". Concrete and concise. Sections:
**Structure assessment** · **Piece evaluation (both sides)** · **Weaknesses to target / protect** · **Long-term plan**
Bold key squares and piece names. Under 350 words.`,
  },

  tactics: {
    focus: 'Tactical analysis (forced sequences, combinations, patterns)',
    system: `You are a chess coach giving a PURE TACTICAL analysis. Focus on forced sequences, pins, forks, skewers, discovered attacks, sacrifices, combinations that exist IN THIS POSITION.

Use the Stockfish data as ground truth. If the engine's top move is tactical (big eval jump or forced sequence), explain the combination. If there's no tactic, say so honestly.

ABSOLUTE RULES:
1. Any move you show MUST be in the engine's top-5 PV.
2. If you show a combination, it must match what the engine's PV shows.
3. If the engine's #1 is just a quiet positional move, you must say "no immediate tactics — the position is strategic."
4. Name the specific tactical pattern (fork / pin / double attack / discovered check / deflection / overloading / interference / back-rank / greek gift / etc.) when relevant.

STYLE: Short, sharp, concrete move sequences. Like a tactics trainer. Sections:
**Is there a tactic?** (yes/no with certainty) · **Forced sequence (if any)** · **Key patterns present** · **Moves to avoid (tactical blunders)**
Bold moves. Under 300 words.`,
  },
};

export function getPromptModes() { return Object.keys(PROMPT_MODES); }

/**
 * Phase 2: ask Claude, seeded with engine ground truth. Mode selects the
 * system prompt — 'general', 'position', or 'tactics'.
 */
export async function askCoach({ fen, coachReport, engineLines, recentMoves = [], model = null, mode = 'general' } = {}) {
  const m = model || getModel();
  // In proxy mode the server holds the API key. Otherwise fall back to the
  // legacy browser-held key (file:// dev and old static deploys).
  const apiKey = PROXY_MODE ? null : localStorage.getItem(KEY_STORAGE);
  if (!PROXY_MODE && !apiKey) throw new Error('No Anthropic API key set. Click 🔑 Key to enter one.');
  const modeConfig = PROMPT_MODES[mode] || PROMPT_MODES.general;
  const systemPrompt = modeConfig.system;

  const linesText = (engineLines || []).map((l, i) =>
    `#${i+1}  ${l.san || l.uci}   eval ${l.scoreKind === 'mate' ? ('mate in ' + l.score) : ((l.score/100).toFixed(2))} (side-to-move view)   PV: ${l.pvSan || '?'}`
  ).join('\n') || '(engine data unavailable)';

  const userPrompt = `
POSITION
FEN: ${fen}
Side to move: ${coachReport.sideName}
${recentMoves.length ? `Last ${recentMoves.length} moves: ${recentMoves.join(' ')}` : ''}

STOCKFISH TOP CANDIDATES (search depth ${engineLines[0]?.depth || '?'}, from side-to-move's view)
${linesText}

HEURISTIC CONTEXT (geometry + pawn structure — already verified by static analysis):
• Threats: ${coachReport.threats.map(t => stripHtml(t.text)).join(' | ') || 'none significant'}
• ${coachReport.sideName}'s weaknesses: ${coachReport.weaknesses.map(t => stripHtml(t.text)).join(' | ') || 'none'}
• Worst piece: ${coachReport.worstPiece ? stripHtml(coachReport.worstPiece.text) : 'none obvious'}
• Best piece: ${coachReport.bestPiece ? stripHtml(coachReport.bestPiece.text) : 'none obvious'}
• Pawn story: ${coachReport.structureStory.map(stripHtml).join(' | ')}
• Initiative: ${stripHtml(coachReport.initiative.text)}

Write the explanation now. Remember: every move you mention must be one of the engine's 5 candidates, and your assessment of who-is-better must match the engine's eval.`;

  // Two code paths:
  //   - PROXY_MODE: POST /api/ai on our own server. Server adds the x-api-key
  //     header from its env var, checks the cookie tier, forwards to Anthropic.
  //   - direct:    POST to api.anthropic.com with user-supplied key.
  const url = PROXY_MODE ? '/api/ai' : 'https://api.anthropic.com/v1/messages';
  const headers = PROXY_MODE
    ? { 'content-type': 'application/json' }
    : {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    credentials: PROXY_MODE ? 'include' : 'omit',
    body: JSON.stringify({
      model: m,
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    // Special case 402 → premium password required
    if (response.status === 402) {
      throw new Error('PREMIUM_REQUIRED');
    }
    if (response.status === 401) {
      throw new Error('SITE_LOCKED');
    }
    throw new Error(`Anthropic API ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '(empty response)';
  const cost = addCost(data.model || m, data.usage);
  return { text, usage: data.usage, model: data.model, cost, mode };
}

/**
 * Phase 3 (optional): verify any SAN move the coach mentions by probing
 * the engine on that specific move and checking its eval matches.
 *
 * Extracts SAN-looking tokens from the coach text, matches them against the
 * engine candidate list, and flags any that AREN'T in the top-N candidates.
 *
 * Returns an array of {san, verified: boolean, engineRank|null, note}.
 */
export function verifyCoachSuggestions(coachText, engineLines) {
  const sanRegex = /\b(O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;
  const found = new Set();
  const matches = [];
  const tokens = coachText.match(sanRegex) || [];
  for (const t of tokens) {
    if (found.has(t)) continue;
    found.add(t);
    const rank = engineLines.findIndex(l => l.san === t || strippedSan(l.san) === strippedSan(t));
    matches.push({
      san: t,
      verified: rank >= 0,
      engineRank: rank >= 0 ? rank + 1 : null,
      note: rank >= 0
        ? `Engine #${rank+1}, eval ${formatScore(engineLines[rank].scoreKind, engineLines[rank].score)}`
        : 'Not in engine\'s top candidates — potential hallucination',
    });
  }
  return matches;
}

function strippedSan(s) { return (s||'').replace(/[+#]$/, ''); }
function formatScore(kind, score) {
  if (kind === 'mate') return `#${score > 0 ? '' : '-'}${Math.abs(score)}`;
  return `${score >= 0 ? '+' : ''}${(score/100).toFixed(2)}`;
}
function stripHtml(s) { return String(s).replace(/<[^>]+>/g, ''); }
