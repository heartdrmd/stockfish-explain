// src/eval-graph.js — Lichess-faithful evaluation timeline chart.
//
// This module is a JS port of lichess-org/lila's `ui/chart/src/acpl.ts`
// (plus index.ts / division.ts) adapted to our data shapes. Our app is
// AGPL-3.0-or-later (same as lila), so direct code reuse is permitted.
// The port preserves lila's chartYMax = 1.05 asymptote, orange accent,
// split fill, y=0 grid-callback zero line, and pseudo-annotation phase
// dividers.
//
// Upstream: https://github.com/lichess-org/lila/blob/master/ui/chart/src/acpl.ts
//
// Differences from upstream (necessity, not style):
//   - JS (not TS), Chart.js UMD global (no `import { Chart }`),
//   - No lila `pubsub` / `i18n` — we expose click as a callback
//     and hard-code the "Advantage" string,
//   - No lila `TreeNode` shape — we accept plies:[{cpWhite, mate, san}],
//   - No blur (cheating) detection — N/A for a single-user local tool,
//   - Division computed client-side by counting pieces (lila computes
//     it server-side; we don't have a backend for that).

// ─── Constants (lila: ui/chart/src/index.ts) ──────────────────────
const CHART_Y_MAX = 1.05;
const CHART_Y_MIN = -CHART_Y_MAX;
const ORANGE_ACCENT = '#d85000';            // lila orange
const WHITE_FILL    = 'rgba(255,255,255,0.30)';
const BLACK_FILL    = 'rgba(0,0,0,1)';
const FONT_COLOR    = 'hsl(0, 0%, 73%)';
const TOOLTIP_BG    = 'rgba(22, 21, 18, 0.7)';
const ZERO_LINE     = '#676664';
const DIV_ANNOT     = '#707070';

// Winning-chance sigmoid (lila: lib/ceval/winningChances.ts).
// POV = white. Output in [-1, +1].
const MULTIPLIER = -0.00368208;
export function povChances(cp, mate) {
  if (mate != null) return mate > 0 ? CHART_Y_MAX : -CHART_Y_MAX;
  if (cp == null || !Number.isFinite(cp)) return 0;
  return 2 / (1 + Math.exp(MULTIPLIER * cp)) - 1;
}

// Backward-compat for game-stats.js callers.
export const cpToWinChance = povChances;

// plyToTurn: ply 1 → move 1; ply 2 → move 1; ply 3 → move 2…
function plyToTurn(ply) { return Math.ceil(ply / 2); }

// Convert stored plies array to {pts, raw, sans}.
export function pliesToSeries(plies) {
  const pts  = [];
  const raw  = [];
  const sans = [];
  for (let i = 0; i < plies.length; i++) {
    const p = plies[i] || {};
    pts.push(povChances(p.cpWhite, p.mate));
    raw.push({ cp: p.cpWhite, mate: p.mate });
    sans.push(p.san || '');
  }
  return { pts, raw, sans };
}

// ─── Phase division (lila: chess/Division.scala) ──────────────────
// We don't have server-side analysis so we compute client-side by
// counting pieces across the mainline. Heuristic tuned to match
// lila's divisions reasonably often:
//   • opening ends at first ply where both kings have castled OR
//     ply ≥ 16 AND at least one minor piece has been traded.
//   • endgame starts at first ply where total non-king material
//     drops below 14 (queens removed + a rook or two minors).
// Returns { middle: plyIndex | null, end: plyIndex | null } in units
// matching our plies array (1-indexed ply of transition).
export function computeDivision(plies) {
  if (!Array.isArray(plies) || plies.length < 8) return { middle: null, end: null };
  let middle = null;
  let end = null;
  // We need to know piece counts at each position — replay SAN on a
  // temporary board. If Chess isn't injected, fall back to heuristic
  // based on ply counts.
  try {
    if (typeof window !== 'undefined' && window.__chessForDivision) {
      const Chess = window.__chessForDivision;
      const replay = new Chess();
      const pieceValue = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
      for (let i = 0; i < plies.length; i++) {
        const p = plies[i]; if (!p || !p.san || p.san === 'start') continue;
        try { if (!replay.move(p.san, { sloppy: true })) break; } catch { break; }
        const board = replay.board();
        let totalMaterial = 0;
        let minors = 0;
        for (const row of board) for (const sq of row) {
          if (!sq) continue;
          const v = pieceValue[sq.type.toLowerCase()] || 0;
          totalMaterial += v;
          if (sq.type === 'n' || sq.type === 'b') minors++;
        }
        const ply = i + 1;
        if (middle === null && ply >= 12 && minors <= 3) middle = ply;
        if (end === null && totalMaterial <= 14) { end = ply; break; }
      }
    }
  } catch {}
  // Last-ditch fallback if the replay didn't run
  if (middle === null && plies.length >= 16) middle = 16;
  if (end === null && plies.length >= 40) end = 40;
  return { middle, end };
}

// ─── plyLine: the current-move vertical indicator (lila: index.ts) ─
function plyLine(ply, onMainline = true) {
  return {
    _role: 'cursor',
    xAxisID: 'x',
    type: 'line',
    label: 'ply',
    data: [
      { x: ply, y: CHART_Y_MIN },
      { x: ply, y: CHART_Y_MAX },
    ],
    borderColor: ORANGE_ACCENT,
    pointRadius: 0,
    pointHoverRadius: 0,
    borderWidth: 1,
    animation: false,
    segment: !onMainline ? { borderDash: [5] } : undefined,
    order: 0,
  };
}

// ─── Division annotation lines (lila: division.ts) ────────────────
function divisionDatasets(div) {
  const lines = [];
  if (div?.middle) {
    if (div.middle > 1) lines.push({ label: 'Opening', loc: 1 });
    lines.push({ label: 'Middlegame', loc: div.middle });
  }
  if (div?.end) {
    if (div.end > 1 && !div?.middle) lines.push({ label: 'Middlegame', loc: 0 });
    lines.push({ label: 'Endgame', loc: div.end });
  }
  return lines.map(line => ({
    _role: 'division',
    type: 'line',
    xAxisID: 'x',
    yAxisID: 'y',
    label: line.label,
    data: [
      { x: line.loc, y: CHART_Y_MIN },
      { x: line.loc, y: CHART_Y_MAX },
    ],
    pointHoverRadius: 0,
    borderWidth: 1,
    borderColor: DIV_ANNOT,
    pointRadius: 0,
    order: 1,
  }));
}

// ─── Main chart class ─────────────────────────────────────────────
export class EvalGraph {
  constructor(canvasEl, { onClickPly } = {}) {
    this.canvas = canvasEl;
    this.onClickPly = onClickPly || (() => {});
    this.chart = null;
    this._currentPly = 0;
    this._moveLabels = [];
    this._rawEvals = [];
  }

  destroy() {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  }

  setCurrentPly(ply) {
    this._currentPly = Math.max(0, ply | 0);
    if (!this.chart) return;
    const idx = this.chart.data.datasets.findIndex(d => d._role === 'cursor');
    if (idx >= 0) {
      this.chart.data.datasets[idx] = plyLine(this._currentPly);
      this.chart.update('none');
    }
  }

  render(plies) {
    if (typeof Chart === 'undefined') {
      console.warn('[eval-graph] Chart.js not loaded yet — skipping render');
      return;
    }
    this.destroy();
    const { pts, raw, sans } = pliesToSeries(plies);
    const division = computeDivision(plies);

    // Per-ply point colors — mistakes/blunders/inaccuracies tinted
    // like lila's "christmas tree" hover effect, but always-on (we
    // don't have a mouse-hover-summary trigger).
    const pointColors = [];
    const pointSizes = [];
    const moveLabels = [];
    for (let i = 0; i < pts.length; i++) {
      const ply = i + 1;
      const san = sans[i] || '';
      const turn = plyToTurn(ply);
      const dots = (ply & 1) === 1 ? '.' : '...';
      moveLabels.push(`${turn}${dots} ${san}`);
      // Classify this move's win-% drop vs previous; tint the point.
      let color = ORANGE_ACCENT;
      let size = 0;
      if (i > 0) {
        const mover = (ply & 1) === 1 ? 'white' : 'black';
        const wBefore = pts[i - 1];
        const wAfter = pts[i];
        const wb = mover === 'white' ? wBefore : -wBefore;
        const wa = mover === 'white' ? wAfter : -wAfter;
        const drop = wb - wa;
        if      (drop >= 0.20) { color = '#db3031'; size = 4; } // blunder
        else if (drop >= 0.12) { color = '#e69d00'; size = 4; } // mistake
        else if (drop >= 0.06) { color = '#4da3d5'; size = 3; } // inaccuracy
      }
      pointColors.push(color);
      pointSizes.push(size);
    }
    this._moveLabels = moveLabels;
    this._rawEvals = raw;

    const data = pts.map((y, i) => ({ x: i + 1, y }));

    const acplDataset = {
      _role: 'curve',
      label: 'Advantage',
      data,
      borderWidth: 1,
      fill: { target: 'origin', above: WHITE_FILL, below: BLACK_FILL },
      pointRadius: pointSizes,
      pointHoverRadius: 5,
      pointHitRadius: 100,
      borderColor: ORANGE_ACCENT,
      pointBackgroundColor: pointColors,
      pointBorderColor: pointColors,
      hoverBackgroundColor: ORANGE_ACCENT,
      order: 5,
    };

    const ctx = this.canvas.getContext('2d');
    const self = this;
    // eslint-disable-next-line no-undef
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: moveLabels.map((_, i) => i),
        datasets: [acplDataset, plyLine(this._currentPly), ...divisionDatasets(division)],
      },
      options: {
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        scales: {
          x: { display: false, type: 'linear', min: 1, max: Math.max(1, pts.length), offset: false },
          y: {
            min: CHART_Y_MIN,
            max: CHART_Y_MAX,
            border: { display: false },
            ticks: { display: false },
            grid: {
              // Lila's trick: only the y=0 gridline is drawn, all others
              // suppressed. That's the equality line, crisp and always
              // visible regardless of where the curve sits.
              color: (ctx) => ctx.tick.value === 0 ? ZERO_LINE : 'transparent',
              lineWidth: 1,
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            borderColor: FONT_COLOR,
            borderWidth: 1,
            backgroundColor: TOOLTIP_BG,
            bodyColor: FONT_COLOR,
            titleColor: FONT_COLOR,
            caretPadding: 10,
            displayColors: false,
            filter: item => item.datasetIndex === 0,
            callbacks: {
              label: (item) => {
                const i = Math.round(item.parsed.x) - 1;
                const r = self._rawEvals[i] || {};
                if (r.mate != null) return 'Advantage: ' + (r.mate > 0 ? '#+' + r.mate : '#' + r.mate);
                if (r.cp == null) return '';
                const e = Math.max(Math.min(Math.round(r.cp / 10) / 10, 99), -99);
                const sign = r.cp > 0 ? '+' : '';
                return 'Advantage: ' + sign + e;
              },
              title: (items) => {
                if (!items.length) return '';
                const i = Math.round(items[0].parsed.x) - 1;
                return self._moveLabels[i] || '';
              },
            },
          },
        },
        onClick: (evt) => {
          const hits = self.chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
          if (!hits.length) return;
          const hit = hits.find(h => h.datasetIndex === 0) || hits[0];
          const dataIdx = hit.index;
          self.onClickPly(dataIdx + 1);
        },
      },
    });
  }
}
