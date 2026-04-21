// src/eval-graph.js — Lichess-style evaluation timeline chart.
//
// Thin wrapper around Chart.js (MIT-licensed, loaded from CDN in
// index.html). Renders a per-ply evaluation curve with a split fill:
// the area above y=0 is white, below is black — same visual idiom
// Lichess popularised in their `ui/chart/src/acpl.ts` module.
//
// Key transformation: we plot NOT raw centipawns but win-chance via the
// standard logistic `2/(1+exp(-0.004*cp)) - 1`. That's what flattens
// lopsided positions (+8 and +10 look nearly identical on the y-axis)
// while amplifying swings near the equality line. Every good chess
// eval graph — Lichess, chess.com, ChessBase — uses this same shape.
//
// This file contains NO code copied from lila; it's an independent
// implementation of the same approach.

const WIN_CAP = 1.0;         // sigmoid asymptote
const CP_SCALE = 0.004;      // lichess-compatible slope (≈ chess.com)

// cp → winning chance from white's POV in [-1, +1].
// Mate → ±1 exactly.
export function cpToWinChance(cp, mate) {
  if (mate != null) return mate > 0 ? WIN_CAP : -WIN_CAP;
  if (cp == null || !Number.isFinite(cp)) return 0;
  return 2 / (1 + Math.exp(-CP_SCALE * cp)) - 1;
}

// plies: array of { cpWhite, mate, san } — same shape we already store
//                in Postgres + localStorage archives.
// Returns chart-ready arrays.
export function pliesToSeries(plies) {
  const pts = [];
  const raw = [];
  const sans = [];
  for (let i = 0; i < plies.length; i++) {
    const p = plies[i] || {};
    pts.push(cpToWinChance(p.cpWhite, p.mate));
    raw.push({ cp: p.cpWhite, mate: p.mate });
    sans.push(p.san || '');
  }
  return { pts, raw, sans };
}

// Colors tuned to match the screenshot reference (Lichess-style).
// Black fill is a deep charcoal, white fill is off-white with enough
// contrast to read on a dark app background.
const STYLE = {
  whiteFill:      'rgba(235, 235, 230, 0.92)',
  blackFill:      'rgba(20, 20, 22, 0.92)',
  lineColor:      '#f57c00',       // orange spine — matches screenshot
  lineWidth:      1.4,
  pointRadius:    0,
  pointHitRadius: 10,
  axisLine:       'rgba(200,200,200,0.2)',
  gridColor:      'rgba(200,200,200,0.05)',
  currentMove:    '#ff9800',
};

// Destroy+recreate chart on each full update. The underlying Chart.js
// instance does not play well with swapping dataset shapes live.
export class EvalGraph {
  constructor(canvasEl, { onClickPly } = {}) {
    this.canvas = canvasEl;
    this.onClickPly = onClickPly || (() => {});
    this.chart = null;
    this._currentPly = 0;
  }

  destroy() {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  }

  setCurrentPly(ply) {
    this._currentPly = Math.max(0, ply | 0);
    if (!this.chart) return;
    // Redraw just the vertical "current move" marker dataset.
    const d = this.chart.data.datasets.find(x => x._role === 'cursor');
    if (d) {
      d.data = [
        { x: this._currentPly, y: -WIN_CAP },
        { x: this._currentPly, y:  WIN_CAP },
      ];
      this.chart.update('none');
    }
  }

  // Replace entire series.
  render(plies) {
    if (typeof Chart === 'undefined') {
      console.warn('[eval-graph] Chart.js not loaded yet — skipping render');
      return;
    }
    this.destroy();
    const { pts, raw, sans } = pliesToSeries(plies);

    // Build {x, y} tuples so Chart.js uses our own ply index as x.
    // Starting ply is 1 (first move), not 0.
    const data = pts.map((y, i) => ({ x: i + 1, y }));

    const datasets = [
      {
        _role: 'curve',
        data,
        borderColor: STYLE.lineColor,
        borderWidth: STYLE.lineWidth,
        pointRadius: STYLE.pointRadius,
        pointHitRadius: STYLE.pointHitRadius,
        tension: 0.18,
        fill: {
          // Split fill — above y=0 uses whiteFill, below uses blackFill.
          // This is Chart.js's native `target: 'origin'` split syntax.
          target: 'origin',
          above: STYLE.whiteFill,
          below: STYLE.blackFill,
        },
      },
      {
        _role: 'cursor',
        data: [
          { x: this._currentPly, y: -WIN_CAP },
          { x: this._currentPly, y:  WIN_CAP },
        ],
        borderColor: STYLE.currentMove,
        borderWidth: 1.6,
        pointRadius: 0,
        pointHitRadius: 0,
        showLine: true,
        fill: false,
      },
    ];

    const ctx = this.canvas.getContext('2d');
    // eslint-disable-next-line no-undef
    this.chart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 180 },
        interaction: { intersect: false, mode: 'nearest', axis: 'x' },
        scales: {
          x: {
            type: 'linear',
            min: 1,
            max: Math.max(1, pts.length),
            ticks: { display: false },
            grid: { color: STYLE.gridColor, drawBorder: false },
          },
          y: {
            min: -WIN_CAP,
            max:  WIN_CAP,
            ticks: { display: false },
            grid: { color: STYLE.gridColor, drawBorder: false },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            displayColors: false,
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                const ply = items[0].parsed.x;
                const move = Math.ceil(ply / 2);
                const side = ply % 2 === 1 ? '' : '…';
                const san = sans[ply - 1] || '';
                return `${move}${side} ${san}`;
              },
              label: (item) => {
                const i = Math.round(item.parsed.x) - 1;
                const r = raw[i] || {};
                if (r.mate != null) return r.mate > 0 ? `#${r.mate}` : `#${r.mate}`;
                if (r.cp == null) return '—';
                const v = r.cp / 100;
                return (v >= 0 ? '+' : '') + v.toFixed(2);
              },
            },
          },
        },
        onClick: (evt, elements) => {
          const pts = this.chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
          if (!pts.length) return;
          const dataIdx = pts[0].index;
          const ply = dataIdx + 1;
          this.onClickPly(ply);
        },
      },
    });
  }
}
