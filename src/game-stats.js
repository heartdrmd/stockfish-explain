// src/game-stats.js — per-side accuracy / ACPL / inaccuracy / mistake /
// blunder computation from a plies array.
//
// Thresholds mirror the lichess "winning-chance delta" convention — we
// compute the drop in win-chance between consecutive evals from the
// moving side's POV, not raw cp. Same formula used by our
// `classifyAccuracy` path in main.js.
//
// This module only DERIVES stats from already-computed plies; it does
// not call the engine. Safe to run synchronously inside the render
// loop of the My Games tab or the live analysis panel.

import { cpToWinChance } from './eval-graph.js';

const T = {
  inaccuracy: 0.06,
  mistake:    0.12,
  blunder:    0.20,
};

// Signed win-chance from the given side's perspective, clamped to [-1,+1].
function winFor(side, cp, mate) {
  const w = cpToWinChance(cp, mate);
  return side === 'white' ? w : -w;
}

// Classify a single move by the drop in its mover's win-chance.
// `before` = eval BEFORE the move (from the mover's POV it should be
// high); `after` = eval AFTER the move (lower if it was a bad move).
function classify(side, before, after) {
  const wb = winFor(side, before.cpWhite, before.mate);
  const wa = winFor(side, after.cpWhite,  after.mate);
  const drop = wb - wa;
  if (drop >= T.blunder)    return { kind: 'blunder',    drop };
  if (drop >= T.mistake)    return { kind: 'mistake',    drop };
  if (drop >= T.inaccuracy) return { kind: 'inaccuracy', drop };
  return { kind: 'ok', drop };
}

// Accuracy% for a single move — Lichess formula. Input is the drop in
// win-chance (already clamped ≥ 0 for bad moves, 0 for good ones).
// Output is a percent in [0, 100].
function moveAccuracy(drop) {
  if (drop <= 0) return 100;
  // Lichess: accuracy = 103.1668 * exp(-0.04354 * (win%before - win%after))
  //                     - 3.1669 + random 1%  (skip the jitter)
  // win% here is 0..100, so multiply our [0,1] drop by 100.
  const delta100 = drop * 100;
  const v = 103.1668 * Math.exp(-0.04354 * delta100) - 3.1669;
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

// Plies shape assumed: [{ cpWhite, mate, san }, ...]
// Index i is the position AFTER ply i+1 has been played.
// Index 0 corresponds to the position after move 1 (white's first move).
// Returns { white, black, byKind } — byKind maps 'inaccuracy'/'mistake'/
// 'blunder' → { white: [plyNum...], black: [plyNum...] } so callers
// can cycle through mistakes Lichess-style.
export function computeGameStats(plies) {
  const empty = () => ({
    moves: 0, inaccuracies: 0, mistakes: 0, blunders: 0,
    acpl: 0, accuracy: 0,
    _sumLoss: 0, _sumAcc: 0,
  });
  const white = empty();
  const black = empty();
  const byKind = {
    inaccuracy: { white: [], black: [] },
    mistake:    { white: [], black: [] },
    blunder:    { white: [], black: [] },
  };
  if (!Array.isArray(plies) || plies.length < 2) {
    return { white: finalise(white), black: finalise(black), byKind };
  }
  for (let i = 0; i < plies.length; i++) {
    // Move at ply i was played by the side whose turn it was BEFORE
    // that ply. With ply index starting at 0 representing the position
    // after move 1 (white's move): i=0 → white, i=1 → black, etc.
    const mover = i % 2 === 0 ? 'white' : 'black';
    const before = i === 0
      ? { cpWhite: 20, mate: null }        // startpos ≈ +0.2 for white
      : plies[i - 1];
    const after = plies[i];
    const cls = classify(mover, before, after);
    const acc = moveAccuracy(Math.max(0, cls.drop));
    const cpl = Math.max(0, Math.round(cls.drop * 250));   // rough cp-loss estimate from win-% drop
    const bucket = mover === 'white' ? white : black;
    bucket.moves++;
    bucket._sumLoss += cpl;
    bucket._sumAcc  += acc;
    const plyNum = i + 1;
    if      (cls.kind === 'blunder')    { bucket.blunders++;     byKind.blunder[mover].push(plyNum); }
    else if (cls.kind === 'mistake')    { bucket.mistakes++;     byKind.mistake[mover].push(plyNum); }
    else if (cls.kind === 'inaccuracy') { bucket.inaccuracies++; byKind.inaccuracy[mover].push(plyNum); }
  }
  return { white: finalise(white), black: finalise(black), byKind };
}

function finalise(b) {
  if (b.moves === 0) {
    return { moves: 0, inaccuracies: 0, mistakes: 0, blunders: 0, acpl: 0, accuracy: 0 };
  }
  return {
    moves:         b.moves,
    inaccuracies:  b.inaccuracies,
    mistakes:      b.mistakes,
    blunders:      b.blunders,
    acpl:          Math.round(b._sumLoss / b.moves),
    accuracy:      Math.round(b._sumAcc / b.moves),
  };
}

// Format for the stats-panel UI. Returns an HTML string.
// `side` = 'white' | 'black'. `name` = display name. `isUser` flag
// colours the accuracy pill blue like Lichess's own-side highlight.
// `byKind` (optional) lets inaccuracy/mistake/blunder rows become
// clickable — they get data-plies attributes with CSV ply indexes so
// callers can cycle through each mistake.
export function renderStatsPanel({ side, name, stats, isUser, byKind }) {
  const dot = side === 'white' ? '●' : '○';
  const klass = isUser ? 'gs-side gs-side-user' : 'gs-side';
  const acc = stats.accuracy;
  const accColor = acc >= 90 ? '#4ec9b0' : acc >= 75 ? '#9cdcfe' : acc >= 60 ? '#dcdcaa' : '#f48771';
  const kindRow = (n, label, kind, kindKey) => {
    const plies = (byKind && byKind[kindKey] && byKind[kindKey][side]) || [];
    const clickable = plies.length > 0;
    const cls = `gs-row gs-${kind}${clickable ? ' gs-clickable' : ''}`;
    const dataAttrs = clickable
      ? ` data-side="${side}" data-kind="${kindKey}" data-plies="${plies.join(',')}" title="Click to cycle through each ${label.toLowerCase()}"`
      : '';
    return `<div class="${cls}"${dataAttrs}><span class="gs-n">${n}</span><span class="gs-label">${label}</span></div>`;
  };
  return `
    <div class="${klass}" data-side="${side}">
      <div class="gs-head"><span class="gs-dot">${dot}</span><strong>${escapeHtml(name || (side === 'white' ? 'White' : 'Black'))}</strong></div>
      ${kindRow(stats.inaccuracies, 'Inaccuracies', 'inacc', 'inaccuracy')}
      ${kindRow(stats.mistakes,     'Mistakes',     'mist',  'mistake')}
      ${kindRow(stats.blunders,     'Blunders',     'blun',  'blunder')}
      <div class="gs-row gs-acpl">
        <span class="gs-n">${stats.acpl}</span>
        <span class="gs-label">Average centipawn loss</span>
      </div>
      <div class="gs-row gs-acc">
        <span class="gs-n" style="color:${accColor}">${stats.accuracy}%</span>
        <span class="gs-label">Accuracy</span>
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}
