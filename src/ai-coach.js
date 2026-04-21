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

// Model suggestions — trimmed to the top/current version of each family.
// Users can still type any other snapshot directly into the input; this is
// just the default dropdown.
export const MODEL_SUGGESTIONS = [
  'claude-opus-4-7',     // highest capability
  'claude-sonnet-4-6',   // balanced (good default)
  'claude-haiku-4-5',    // fastest / cheapest
];

// Which models support extended thinking. Haiku 4.5 does not; Sonnet 4+
// and Opus 4+ do.
export const THINKING_SUPPORTED = new Set([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
]);

// Per-million-token pricing (USD) for the top version of each family.
export const MODEL_PRICES = {
  'claude-opus-4-7':   { input: 15, output: 75 },
  'claude-sonnet-4-6': { input:  3, output: 15 },
  'claude-haiku-4-5':  { input:  1, output:  5 },
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
export async function probeEngine(engine, fen, depth = 18, multipv = 5, movetimeMs = 0) {
  const originalMultiPV = engine.multipv;
  engine.setMultiPV(multipv);
  try {
    // Start search and wait for bestmove
    engine.stop();
    const done = new Promise(resolve => {
      const onBest = (ev) => { engine.removeEventListener('bestmove', onBest); resolve(ev.detail); };
      engine.addEventListener('bestmove', onBest);
    });
    // When movetimeMs > 0 it overrides depth; lets callers trade depth
    // for fixed wall-clock time per position (used by reanalyze-for-
    // mistakes so the user can pick 'analyse at 2 seconds a move').
    if (movetimeMs > 0) engine.start(fen, { movetime: movetimeMs });
    else                engine.start(fen, { depth });
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
    system: `You are a chess coach explaining the position using the Stockfish data and the rich positional research provided as ground truth. Do not invent moves.

EVAL CONVENTION: Every eval below is from WHITE's perspective. Positive = White better, negative = Black better. Never re-interpret signs from the side-to-move's view — the conversion has already been done.

ABSOLUTE RULES:
1. Any move you recommend MUST appear in the engine's top-5 candidates.
2. Quote the engine's score (in White's POV) whenever making an evaluative claim.
3. If #1 vs #2 is under 30 cp, explicitly say the choice isn't forced.
4. Never claim a tactic without pointing to the specific engine PV.
5. Treat the tablebase verdict (if present) as mathematically authoritative.

USE ALL AVAILABLE RESEARCH. You are given several context blocks below the engine lines: the Positional Coach synthesis (Dorfman / Silman / Nimzowitsch / Aagaard / Capablanca / Dvoretsky / Watson / AlphaZero lenses with a ranked TOP-3 weighted factors), the detected opening (or structural transposition match), pawn-lever availability, king-attack geometry, imbalance analysis, archetype-specific plans, master-game statistics, and prophylaxis. REFERENCE EVERY BLOCK THAT IS PRESENT — do not ignore them. Quote specific signals from them in your analysis.

STRUCTURE your response with these sections (bold the headings):
**Position assessment** — one clear sentence on who stands better and WHY, citing the engine eval and the dominant positional factor.
**Pawn structure & archetype** — what kind of position this is structurally; what family it belongs to; which levers are available for each side.
**White's plan** — concrete plan for White over the next 5-10 moves, anchored to engine #1 if White is to move, or the master-game statistics / archetype playbook otherwise. Name specific pieces, squares, and breaks.
**Black's plan** — concrete plan for Black over the next 5-10 moves, symmetric treatment. Both sides always get their own plan paragraph, regardless of who is to move.
**Critical moves / best continuation** — the engine's top line with your narrative, plus alternatives if #2 is close.
**Tactical alerts** — any forced sequences, traps, sacrificial motifs (Greek gift, knight outpost, h-file pry, back-rank, etc.) active on the board.
**What to avoid** — moves and plan-ideas that would throw the position away, with specific squares / piece moves.

STYLE: Rich and specific — like a GM writing notes for a student. Use every research signal available. Bold key moves, pieces, squares, and concepts. 500-800 words.`,
  },

  position: {
    focus: 'Positional analysis (strategy, structure, piece placement)',
    system: `You are a chess coach giving a rich PURE POSITIONAL analysis. Do NOT discuss tactics — focus on structure, piece quality, long-term factors.

Use the Stockfish data as ground truth for who stands better. All engine evals below are from WHITE's perspective (positive = White better).

ABSOLUTE RULES:
1. Any move you mention MUST be in the engine's top-5.
2. Quote engine eval (White POV) when claiming an advantage.
3. Focus on: pawn structure, weak squares, good/bad bishops, worst-placed piece (Silman), plan for next 5-10 moves.
4. Reference every available context block — archetype, imbalances, levers, king-attack geometry, opening, master stats.

STRUCTURE your response:
**Structure assessment** — what kind of pawn formation this is, which archetype (if any), which family it belongs to, and what that implies.
**Piece evaluation (White side)** — each non-pawn piece: where it stands, what it does, is it good or bad, where would it ideally go. Name the worst piece.
**Piece evaluation (Black side)** — same treatment, symmetric. Both sides always get a full piece assessment.
**Weaknesses and targets** — for each side: pawn weaknesses, weak squares, exposed pieces. Which side has more long-term problems.
**White's positional plan** — next 5-10 moves from White's perspective, with specific piece manoeuvres and lever pushes.
**Black's positional plan** — next 5-10 moves from Black's perspective. Both plans always present regardless of side-to-move.
**Long-term evaluation** — who should prefer endgame, who wants middlegame complications, how the position might transform.

STYLE: Like Silman ("How to Reassess Your Chess") or Watson ("Secrets of Modern Chess Strategy"). Concrete and thorough. Bold key squares, pieces, and plan concepts. 500-800 words.`,
  },

  tactics: {
    focus: 'Tactical analysis (forced sequences, combinations, patterns)',
    system: `You are a chess coach giving a rich PURE TACTICAL analysis. Focus on forced sequences, pins, forks, skewers, discovered attacks, sacrifices, and combinations that exist IN THIS POSITION.

Use the Stockfish data as ground truth. All engine evals are from WHITE's perspective (positive = White better). If the engine's top move is tactical (big eval jump or forced sequence), explain the combination. If there's no tactic, say so honestly.

ABSOLUTE RULES:
1. Any move you show MUST be in the engine's top-5 PV.
2. If you show a combination, it must match what the engine's PV shows.
3. If the engine's #1 is just a quiet positional move, you must say "no immediate tactics — the position is strategic."
4. Name the specific tactical pattern (fork / pin / double attack / discovered check / deflection / overload / interference / back-rank / Greek gift / knight outpost / h-file pry / etc.).
5. Reference every context block — trap warnings, king-attack geometry, pawn levers (some are tactical breakthroughs), master stats.

STRUCTURE your response:
**Tactical state of the position** — is there an immediate tactic, a tactical threat brewing, or is it strategic. Which side's pieces threaten the opponent's king.
**Threats to White's king** — named attacking geometries (Greek gift setup / h-file pry / knight outpost near the king / opposite castling race / back-rank) and how concrete they are.
**Threats to Black's king** — symmetric treatment. Both kings always get assessed.
**Forced sequence (if any)** — the engine's top line with tactical names and specific square sacrifices.
**Key patterns currently loaded** — which of the 11 trap/attack detectors fired, what they mean concretely.
**Tactical blunders to avoid** — moves that would walk into a combination, with specific refutations from the engine lines.
**White's tactical plan** — how White can build/execute tactical threats in the next few moves.
**Black's tactical plan** — same for Black. Both sides.

STYLE: Short sharp concrete sequences, like a tactics trainer. Bold moves, squares, and pattern names. 450-700 words.`,
  },
};

export function getPromptModes() { return Object.keys(PROMPT_MODES); }

/**
 * Phase 2: ask Claude, seeded with engine ground truth. Mode selects the
 * system prompt — 'general', 'position', or 'tactics'.
 */
// Thinking-budget tiers. Maps UI preset → token budget the model is
// allowed to spend on internal reasoning before producing its answer.
// Extended thinking is supported on Opus 4.7 and Sonnet 4.6; it's a no-op
// on Haiku 4.5 (we skip sending the parameter there).
export const THINKING_TIERS = {
  off:        { tokens:     0, label: '⏸ Off' },
  low:        { tokens:  2000, label: '💭 Low' },
  medium:     { tokens:  8000, label: '🧠 Medium' },
  high:       { tokens: 20000, label: '🔮 High' },
  exhaustive: { tokens: 32000, label: '♾ Exhaustive' },
};

export async function askCoach({
  fen, coachReport, engineLines, recentMoves = [], model = null, mode = 'general',
  coachV2Report = null,     // rich CoachV2 output (Dorfman + archetype + imbalance + strategy)
  openingExplorer = null,   // Lichess master-games stats for current FEN
  tablebase = null,         // Syzygy tablebase result if ≤7 pieces
  refinementContext = null, // { cycle, priorAnswer, deeperLines } for multi-cycle analysis
  thinkingTier = 'off',     // extended-thinking tier — off/low/medium/high/exhaustive
} = {}) {
  const m = model || getModel();
  // In proxy mode the server holds the API key. Otherwise fall back to the
  // legacy browser-held key (file:// dev and old static deploys).
  const apiKey = PROXY_MODE ? null : localStorage.getItem(KEY_STORAGE);
  if (!PROXY_MODE && !apiKey) throw new Error('No Anthropic API key set. Click 🔑 Key to enter one.');
  const modeConfig = PROMPT_MODES[mode] || PROMPT_MODES.general;
  const systemPrompt = modeConfig.system;

  // Stockfish reports scores from the SIDE-TO-MOVE perspective (UCI
  // convention). Convert to WHITE'S perspective so the sign is
  // unambiguous — positive means White is better, negative means Black
  // is better. This matches the main eval gauge convention.
  const sideToMove = (fen.split(' ')[1] || 'w');
  const toWhitePOV = (scoreKind, score) => sideToMove === 'w'
    ? { scoreKind, score }
    : { scoreKind, score: -score };
  const fmtScoreWhitePOV = (l) => {
    const n = toWhitePOV(l.scoreKind, l.score);
    if (n.scoreKind === 'mate') {
      return n.score > 0 ? `mate in ${n.score} for White` : `mate in ${Math.abs(n.score)} for Black`;
    }
    const cp = (n.score / 100);
    const sign = cp >= 0 ? '+' : '';
    return `${sign}${cp.toFixed(2)}`;
  };
  const linesText = (engineLines || []).map((l, i) =>
    `#${i+1}  ${l.san || l.uci}   eval ${fmtScoreWhitePOV(l)} (White's POV — positive means White is better, negative means Black)   PV: ${l.pvSan || '?'}`
  ).join('\n') || '(engine data unavailable)';

  // ─── Enriched context blocks from CoachV2, tablebase, and opening DB ───
  // The AI gets ALL the research output, not just the minimal old heuristics.
  // It's instructed later to SYNTHESIZE these with the engine lines rather
  // than treat them as isolated hints.
  const coachV2Block = coachV2Report ? buildCoachV2Block(coachV2Report) : '';
  const tablebaseBlock = tablebase ? buildTablebaseBlock(tablebase) : '';
  const openingBlock = openingExplorer ? buildOpeningBlock(openingExplorer) : '';

  // Refinement header. Cycle 2+ supplies additional lookahead engine
  // data — the AI's primary target remains the CURRENT position and
  // the canonical engine lines above describe that position. The
  // lookahead is supplementary evidence only: SF walked forward N
  // plies and evaluated the resulting position; does the planned line
  // actually hold up? The AI is NOT told to switch its analysis target.
  // We deliberately do not send prior drafts so there is nothing the
  // model can self-reference.
  const lookaheadBlock = (refinementContext && refinementContext.lookahead)
    ? (() => {
        const la = refinementContext.lookahead;
        if (!la.lines || !la.lines.length) return '';
        const laStm = (la.fen || '').split(' ')[1] || 'w';
        const laToWhite = (l) => laStm === 'w' ? l.score : -l.score;
        const fmtLa = (l) => {
          const s = laToWhite(l);
          if (l.scoreKind === 'mate') {
            return s > 0 ? `mate in ${s} for White` : `mate in ${Math.abs(s)} for Black`;
          }
          const cp = (s / 100).toFixed(2);
          return `${s >= 0 ? '+' : ''}${cp}`;
        };
        const laLines = la.lines.map((l, i) =>
          `  #${i+1}  ${l.san || l.uci}   eval ${fmtLa(l)} (White's POV)   PV: ${l.pvSan || '?'}`
        ).join('\n');
        return `
LOOK-AHEAD EVIDENCE (supplementary — NOT the position to analyze).
Stockfish has walked ${la.pliesAhead} plies forward along the principal line and searched the resulting position at depth ${la.depth}.
  Path walked from the current position: ${la.pathMoves.join(' ')}
  Lookahead FEN: ${la.fen}
  Stockfish's top ${la.lines.length} moves AT the lookahead position (evals in White's POV):
${laLines}

How to USE this evidence:
  - Your job is still to analyze the CURRENT position (the FEN above and its engine top-5, which are the moves the user can actually play right now).
  - Every move you RECOMMEND must be in the CURRENT position's engine top-5, not the lookahead top-5.
  - The lookahead tells you whether the planned line actually leads somewhere good N plies out. If the current eval looks good but the lookahead eval collapsed, flag that the natural continuation is worse than it first looks, and refine the plan accordingly.
  - If the lookahead confirms the plan, cite the specific future move that makes it work.
  - DO NOT describe the lookahead position as if it were the current board. DO NOT recommend moves from the lookahead top-5 as if they were immediately playable.
  - Do not reference prior drafts or narrate your reasoning process — just write a clean final analysis.
`;
      })()
    : '';
  const refinementHeader = lookaheadBlock;
  const userPrompt = `${refinementHeader}POSITION
FEN: ${fen}
Side to move: ${coachReport.sideName}
${recentMoves.length ? `Last ${recentMoves.length} moves: ${recentMoves.join(' ')}` : ''}

STOCKFISH TOP CANDIDATES (search depth ${engineLines[0]?.depth || '?'}). ALL evaluations below are expressed from WHITE'S perspective: positive = White better, negative = Black better. Do NOT interpret the sign from the side-to-move's view — the conversion has already been done for you.
${linesText}
${tablebaseBlock}${openingBlock}${coachV2Block}
HEURISTIC CONTEXT (geometry + pawn structure — already verified by static analysis):
• Threats: ${coachReport.threats.map(t => stripHtml(t.text)).join(' | ') || 'none significant'}
• ${coachReport.sideName}'s weaknesses: ${coachReport.weaknesses.map(t => stripHtml(t.text)).join(' | ') || 'none'}
• Worst piece: ${coachReport.worstPiece ? stripHtml(coachReport.worstPiece.text) : 'none obvious'}
• Best piece: ${coachReport.bestPiece ? stripHtml(coachReport.bestPiece.text) : 'none obvious'}
• Pawn story: ${coachReport.structureStory.map(stripHtml).join(' | ')}
• Initiative: ${stripHtml(coachReport.initiative.text)}

SYNTHESIS INSTRUCTIONS
You have MANY sources of ground truth above, each in its own labelled block:
  (1) Stockfish's top candidate lines — evals ALREADY CONVERTED TO WHITE'S POV.
  (2) Tablebase verdict (Syzygy) — authoritative for ≤7 pieces; never second-guess.
  (3) Master-game statistics (Lichess) — quote the most common move and its win-rate;
      works for both opening and middlegame positions.
  (4) Positional Coach synthesis:
      - TOP 3 WEIGHTED FACTORS (ranked by magnitude) with author attribution.
      - Detected opening (exact, structural, or colour-mirrored transposition).
      - AVAILABLE PAWN LEVERS — the breaks this position is structurally about.
      - ATTACK-READINESS GEOMETRY — Greek gift / knight outpost / h-file pry /
        opposite castling race / back-rank pressure when loaded on the board.
      - Pawn-structure archetype (IQP / Carlsbad / Hanging / Maroczy).
      - Imbalance analysis (Kaufman / Avrukh).
      - Archetype-specific plans per side.
      - Strategy narrative per side.
      - Prophylaxis — opponent's sharpest idea.
      - Trap / tactical-pattern warnings.
  (5) Legacy heuristic context (threats / weaknesses / worst piece / pawn story / initiative).

YOUR JOB: weave ALL of these into a single rich analysis — don't recite them separately, but don't ignore any block that is present either. If a block is in the prompt, reference its content concretely. If it's absent, don't mention it.

Rules:
1. Every move you recommend MUST appear in the engine's top-5 candidates.
2. Every eval sign you discuss is from WHITE's perspective. Positive means White better.
3. Your overall assessment MUST match the engine's eval direction; if the Positional Coach disagrees with Stockfish, trust Stockfish and flag the disagreement in one sentence.
4. Whenever an archetype, lever, or attacking geometry is detected, name it explicitly and use its specific plan language rather than generic advice.
5. Whenever master-game statistics are provided, quote the most common move and its win-rate.
6. Whenever a tablebase verdict is provided, it is mathematically authoritative.
7. ALWAYS give both sides' plans. Even when it's not a side's move, their plan matters for understanding the position.

Write the explanation now. Rich, specific, and grounded in every piece of research above.`;

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
  // Extended thinking: only send the param when a non-off tier was
  // picked AND the model supports it. Anthropic requires max_tokens >
  // thinking.budget_tokens, so we bump max_tokens above the budget by
  // an output buffer of 3000 for the final response.
  const tierConfig = THINKING_TIERS[thinkingTier] || THINKING_TIERS.off;
  const thinkingBudget = (tierConfig.tokens > 0 && THINKING_SUPPORTED.has(m))
    ? tierConfig.tokens : 0;
  const responseBuffer = 3000;
  const body = {
    model: m,
    max_tokens: thinkingBudget > 0 ? thinkingBudget + responseBuffer : responseBuffer,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (thinkingBudget > 0) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    // With extended thinking enabled, Anthropic requires temperature = 1.
    body.temperature = 1;
  }
  // ─── Fetch with retry on transient errors ────────────────────────
  // Retry up to 2 times on: network failures, 429 (rate limit),
  // 500/502/503/504 (server hiccups), 529 (Anthropic overload).
  // Do NOT retry on 400 (bad request), 401 (auth), 402 (premium gate),
  // 403 (forbidden), 404 — those are hard client-side errors that
  // won't improve on retry.
  const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
  const MAX_ATTEMPTS = 3;
  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        credentials: PROXY_MODE ? 'include' : 'omit',
        body: JSON.stringify(body),
      });
      // Hard errors → throw immediately, no retry
      if (response.status === 401) throw new Error('SITE_LOCKED');
      if (response.status === 402) throw new Error('PREMIUM_REQUIRED');
      // Transient → retry with backoff (unless this was the last attempt)
      if (TRANSIENT_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        const backoffMs = 1500 * attempt; // 1.5s, 3s
        console.warn(`[ai-coach] API ${response.status} on attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${backoffMs}ms`);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      // Non-transient failure or final attempt → break and let the
      // ok-check below throw the actual error with body text.
      break;
    } catch (err) {
      // Network error / fetch threw. Retry unless this is a hard
      // error we already unwrapped above.
      if (err.message === 'SITE_LOCKED' || err.message === 'PREMIUM_REQUIRED') throw err;
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = 1500 * attempt;
        console.warn(`[ai-coach] Network error on attempt ${attempt}/${MAX_ATTEMPTS}: ${err.message}, retrying in ${backoffMs}ms`);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      throw new Error(`Network failure after ${MAX_ATTEMPTS} attempts: ${err.message}`);
    }
  }
  if (!response) {
    throw new Error(`Network failure after ${MAX_ATTEMPTS} attempts${lastError ? ': ' + lastError.message : ''}`);
  }

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 402) throw new Error('PREMIUM_REQUIRED');
    if (response.status === 401) throw new Error('SITE_LOCKED');
    throw new Error(`Anthropic API ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  // Extended thinking responses interleave "thinking" blocks and "text"
  // blocks. Skip thinking and concatenate only text blocks. If no blocks
  // have type "text", fall back to the first block's text field.
  let text;
  if (Array.isArray(data.content)) {
    const textBlocks = data.content.filter(b => b.type === 'text').map(b => b.text);
    text = textBlocks.length ? textBlocks.join('\n\n') : (data.content[0]?.text || '(empty response)');
  } else {
    text = '(empty response)';
  }
  const cost = addCost(data.model || m, data.usage);
  return {
    text, usage: data.usage, model: data.model, cost, mode,
    thinkingTier, thinkingBudget,
  };
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

// ─── enriched-context formatters for the AI prompt ─────────────────
//
// These take the structured output of coach_v2 / tablebase /
// opening_explorer and produce plain-text blocks that slot into the
// AI prompt. Keeping each block under ~25 lines so the prompt stays
// within a reasonable token budget.

function buildCoachV2Block(rep) {
  if (!rep) return '';
  const sign = rep.verdict?.sign;
  const verdictSide = sign > 0 ? 'White' : sign < 0 ? 'Black' : 'neither side';
  const fmt = (f) => {
    if (!f) return '';
    const s = f.sign > 0 ? '[W]' : f.sign < 0 ? '[B]' : '[=]';
    return `${s} ${f.note || ''}`;
  };

  const factors = rep.factors || {};
  const factorLines = [
    `  • King safety:      ${fmt(factors.kingSafety)}`,
    `  • Material:         ${fmt(factors.material)}`,
    `  • Phantom Q-trade:  ${fmt(factors.queensOff)}`,
    `  • Piece activity:   ${fmt(factors.activity)}`,
    `  • Pawn structure:   ${fmt(factors.pawns)}`,
    `  • Space:            ${fmt(factors.space)}`,
    `  • Files/diagonals:  ${fmt(factors.files)}`,
    `  • Initiative/tempo: ${fmt(factors.dynamics)}`,
  ].filter(l => l.includes('[')).join('\n');

  // ─── Top-3 weighted lenses ───────────────────────────────────────
  // Rank each factor by the absolute magnitude of its numeric diff
  // (sign * 40 for factors that only carry a sign). Surface the three
  // biggest influences with their theoretical attribution so the AI
  // focuses on what actually matters in THIS position rather than
  // treating every lens equally.
  const LENS_META = {
    kingSafety: { label: 'King safety',       author: 'Dorfman / Aagaard',        proxy: 40 },
    material:   { label: 'Material balance',  author: 'Classical / Kaufman',      proxy: null },
    queensOff:  { label: 'Phantom Q-trade',   author: 'Dorfman',                  proxy: 30 },
    activity:   { label: 'Piece activity',    author: 'AlphaZero / Nimzowitsch',  proxy: null },
    pawns:      { label: 'Pawn structure',    author: 'Silman / Capablanca',      proxy: null },
    space:      { label: 'Space',             author: 'Nimzowitsch / Watson',     proxy: null },
    files:      { label: 'Files & diagonals', author: 'Nimzowitsch / Dvoretsky',  proxy: null },
    dynamics:   { label: 'Initiative / tempo',author: 'Aagaard / Dvoretsky',      proxy: null },
  };
  const magnitudeOf = (key, f) => {
    if (!f || !f.sign) return 0;
    if (key === 'activity') return Math.abs((f.wAct || 0) - (f.bAct || 0));
    if (typeof f.diff === 'number') return Math.abs(f.diff);
    return Math.abs(f.sign) * (LENS_META[key]?.proxy || 20);
  };
  const ranked = Object.keys(LENS_META)
    .map(key => ({ key, meta: LENS_META[key], f: factors[key], mag: magnitudeOf(key, factors[key]) }))
    .filter(x => x.f && x.f.sign && x.mag > 0)
    .sort((a, b) => b.mag - a.mag)
    .slice(0, 3);
  const topFactorsBlock = ranked.length
    ? `\n  TOP 3 WEIGHTED FACTORS (rank by magnitude — focus your analysis here):\n` +
      ranked.map((x, i) => {
        const side = x.f.sign > 0 ? 'White' : 'Black';
        return `    ${i + 1}. ${x.meta.label} [${x.meta.author}] — favours ${side}, magnitude ≈${Math.round(x.mag)}\n       Rationale: ${x.f.note || '(no note)'}`;
      }).join('\n')
    : '';

  const archBlock = rep.archetype
    ? `\n• Pawn-structure archetype: ${rep.archetype.label}` +
      (rep.archetype.signals?.length ? `\n  Signals: ${rep.archetype.signals.join(' · ')}` : '') +
      (rep.archetype.minorityViability
        ? `\n  Minority-attack viability: ${rep.archetype.minorityViability.verdict} (${rep.archetype.minorityViability.notes?.join('; ') || 'no notes'})`
        : '')
    : '';

  const imbBlock = rep.imbalance?.length
    ? `\n• Imbalances (Kaufman/Avrukh):\n${rep.imbalance.map(i => `  - ${i.text}`).join('\n')}`
    : '';

  const planBlock = (side, label) => {
    const ps = rep.plans?.[side] || [];
    if (!ps.length) return '';
    return `\n• ${label} plans (top ${Math.min(ps.length, 4)}):\n` +
      ps.slice(0, 4).map((p, i) => `  ${i + 1}. ${p.text}`).join('\n');
  };

  const strategyBlock = rep.strategy
    ? `\n• Strategy narrative (White): ${rep.strategy.white}\n• Strategy narrative (Black): ${rep.strategy.black}`
    : '';

  const prophyBlock = rep.prophylaxis?.opponentIdea
    ? `\n• Prophylaxis — opponent's sharpest idea: ${rep.prophylaxis.opponentIdea}`
    : '';

  const trapBlock = rep.trapWarnings?.length
    ? `\n• Trap / tactical warnings (static detection):\n${rep.trapWarnings.map(w => `  - [${w.severity}] ${w.message}`).join('\n')}`
    : '';

  // Worst-piece identification per side. coach_v2 computes this for BOTH
  // colours (the legacy coachReport only did side-to-move). Very useful
  // as Silman's "most important imbalance" anchor.
  const worstPieceBlock = rep.worstPiece
    ? `\n• Worst-placed piece (Silman method — the first thing to improve):${
        rep.worstPiece.white ? `\n  - White: ${typeof rep.worstPiece.white === 'string' ? rep.worstPiece.white : (rep.worstPiece.white.text || JSON.stringify(rep.worstPiece.white))}` : ''
      }${
        rep.worstPiece.black ? `\n  - Black: ${typeof rep.worstPiece.black === 'string' ? rep.worstPiece.black : (rep.worstPiece.black.text || JSON.stringify(rep.worstPiece.black))}` : ''
      }`
    : '';

  // Watson-style context cancellations — rules that normally matter but
  // don't in this specific position, or vice versa. Helps the AI not
  // give textbook advice that doesn't apply.
  const contextBlock = (rep.contextNotes && rep.contextNotes.length)
    ? `\n• Rule-independence notes (Watson — cases where general rules don't apply here):\n${rep.contextNotes.map(n => `  - ${typeof n === 'string' ? n : (n.text || JSON.stringify(n))}`).join('\n')}`
    : '';

  const openingBlock = rep.opening
    ? `\n• Opening identified: ${rep.opening.name} (${rep.opening.eco || '?'})\n  Structure: ${rep.opening.structure || ''}\n  White plans: ${(rep.opening.whitePlans || []).join(' / ')}\n  Black plans: ${(rep.opening.blackPlans || []).join(' / ')}${rep.opening.pitfalls?.length ? '\n  Pitfalls: ' + rep.opening.pitfalls.join(' / ') : ''}${rep.opening.motifs?.length ? '\n  Motifs: ' + rep.opening.motifs.join(' / ') : ''}`
    : '';

  const leversBlock = (rep.levers && rep.levers.length)
    ? `\n• Pawn levers available (the breaks this position is structurally about):\n${
        rep.levers.slice(0, 4).map(L => {
          const side = L.side === 'w' ? 'White' : 'Black';
          const status = L.live ? 'LIVE (legal now)' : 'available';
          const atk = L.attacks.length ? ` · attacks ${L.attacks.join(',')}` : '';
          return `  - ${side} ...${L.lever} (from ${L.from}) — ${status}, sup ${L.supporters}/blk ${L.blockers}${atk}\n      ${L.strategic}`;
        }).join('\n')
      }`
    : '';

  const kingAttackBlock = (rep.kingAttack && rep.kingAttack.length)
    ? `\n• King-attack geometry loaded (canonical attacking patterns currently on the board):\n${
        rep.kingAttack.slice(0, 3).map(r => {
          const sideLabel = r.side ? (r.side === 'w' ? 'White' : 'Black') : '—';
          return `  - ${r.pattern} [${sideLabel}] — readiness ${r.readiness}\n      ${r.plan}\n      Ingredients: ${r.ingredients.join(' · ')}`;
        }).join('\n')
      }`
    : '';

  return `
POSITIONAL COACH (synthesised from Dorfman method + Silman imbalances + Nimzowitsch/Aagaard/Capablanca/Dvoretsky/Watson concepts + AlphaZero observations):
  Verdict: ${verdictSide} is statically better.
  Dominant factor: ${rep.verdict?.dominant || 'mixed'}.
  Reason: ${rep.verdict?.reason || ''}
  Phase: ${rep.phase}
  Mode (White): ${rep.mode?.white || 'n/a'}
  Mode (Black): ${rep.mode?.black || 'n/a'}${topFactorsBlock}

  Full factor scan (for reference only — the TOP 3 above are the load-bearing ones):
${factorLines}${openingBlock}${leversBlock}${kingAttackBlock}${archBlock}${imbBlock}${worstPieceBlock}${planBlock('white', 'White')}${planBlock('black', 'Black')}${strategyBlock}${prophyBlock}${contextBlock}${trapBlock}
`;
}

function buildTablebaseBlock(tb) {
  if (!tb) return '';
  const parts = [`TABLEBASE (authoritative for ≤7 pieces):`];
  if (tb.checkmate) parts.push(`  Checkmate on the board.`);
  else if (tb.stalemate) parts.push(`  Stalemate — draw.`);
  else if (tb.category) parts.push(`  Category: ${tb.category}${tb.dtz != null ? `, DTZ ${Math.abs(tb.dtz)}` : ''}${tb.dtm != null ? `, mate in ${Math.abs(tb.dtm)}` : ''}`);
  if (tb.moves?.length) {
    parts.push(`  Top moves:`);
    tb.moves.slice(0, 3).forEach(m => {
      parts.push(`    • ${m.san} — ${m.category}${m.dtz != null ? ` (DTZ ${Math.abs(m.dtz)})` : ''}`);
    });
  }
  return '\n' + parts.join('\n') + '\n';
}

function buildOpeningBlock(data) {
  if (!data || !data.total) return '';
  // Below this threshold the sample is too small to draw strategic
  // conclusions from — skip to keep the prompt lean.
  if (data.total < 5) return '';
  const isDeepPosition = data.total < 100;
  const headerLabel = isDeepPosition
    ? 'MASTER-GAME STATISTICS (Lichess masters — rare position, small sample):'
    : 'MASTER-GAME STATISTICS (Lichess masters database):';
  const parts = [headerLabel];
  if (data.opening?.name) parts.push(`  Named opening: ${data.opening.name} (${data.opening.eco || '?'})`);
  parts.push(`  Sample size: ${data.total.toLocaleString()} master games`);
  parts.push(`  Results: White ${data.pctWhite}% · Draws ${data.pctDraw}% · Black ${data.pctBlack}%`);
  if (data.moves?.length) {
    parts.push(`  Most common moves:`);
    data.moves.slice(0, 5).forEach(m => {
      const pct = data.total ? ((m.total / data.total) * 100).toFixed(1) : '0';
      const wRate = m.total ? ((m.white / m.total) * 100).toFixed(0) : '0';
      const dRate = m.total ? ((m.draws / m.total) * 100).toFixed(0) : '0';
      const bRate = m.total ? ((m.black / m.total) * 100).toFixed(0) : '0';
      parts.push(`    • ${m.san} — ${m.total.toLocaleString()} games (${pct}%), scored W/D/B = ${wRate}/${dRate}/${bRate}%${m.rating ? ', avg rating ' + m.rating : ''}`);
    });
  }
  return '\n' + parts.join('\n') + '\n';
}
