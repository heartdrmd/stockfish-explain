// movetime.js — per-move time-spent bar chart.
//
// Port of the spirit of lichess-org/lila's ui/chart/src/movetime.ts.
// Chart.js bar chart split by side (white above zero, black below).
// Lila stores per-move seconds in the game DB; we track live with a
// module-scoped Map<plyNumber, ms> populated from the board's 'move'
// event. Historical games without move-time show an empty chart + a
// note explaining why.

const WHITE_COLOR = 'rgba(240, 240, 235, 0.85)';
const BLACK_COLOR = 'rgba(50, 50, 55, 0.85)';
const ZERO_COLOR  = '#676664';

// Global store — exposed on window so it survives across board
// replacement / tab switches and so other modules can read if needed.
export function getTimesMap() {
  if (typeof window === 'undefined') return null;
  if (!window.__stockfishMoveTimes) window.__stockfishMoveTimes = new Map();
  return window.__stockfishMoveTimes;
}

// Hook onto a board instance — resets map on new-game, records time
// since previous move on each 'move' event. Idempotent: calling
// install() twice is harmless.
export function install(board) {
  if (!board || board._movetimeInstalled) return;
  board._movetimeInstalled = true;
  const map = getTimesMap();
  let last = Date.now();
  board.addEventListener('new-game', () => {
    map.clear();
    last = Date.now();
  });
  board.addEventListener('move', () => {
    const now = Date.now();
    const dt = Math.max(0, now - last);
    last = now;
    try {
      const ply = board.chess.history().length;
      if (ply > 0) map.set(ply, dt);
    } catch {}
  });
}

// Render: accepts a canvas element + optional override times Map.
// Returns a Chart.js instance (caller keeps ref for destroy()).
export function render(canvas, { timesMap, maxPly } = {}) {
  if (typeof Chart === 'undefined') {
    console.warn('[movetime] Chart.js not loaded');
    return null;
  }
  const map = timesMap || getTimesMap();
  const plies = maxPly || (map ? Math.max(0, ...map.keys()) : 0);
  const whiteData = [];
  const blackData = [];
  let allZero = true;
  for (let i = 1; i <= plies; i++) {
    const ms = map?.get(i) || 0;
    if (ms > 0) allZero = false;
    const secs = ms / 1000;
    if ((i & 1) === 1) { whiteData.push({ x: i, y:  secs }); blackData.push({ x: i, y: 0 }); }
    else               { whiteData.push({ x: i, y: 0 });     blackData.push({ x: i, y: -secs }); }
  }
  const ctx = canvas.getContext('2d');
  // eslint-disable-next-line no-undef
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      datasets: [
        { label: 'White',  data: whiteData, backgroundColor: WHITE_COLOR, borderWidth: 0, categoryPercentage: 1.0, barPercentage: 1.0 },
        { label: 'Black',  data: blackData, backgroundColor: BLACK_COLOR, borderWidth: 0, categoryPercentage: 1.0, barPercentage: 1.0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const secs = Math.abs(item.parsed.y);
              return `${item.dataset.label}: ${secs.toFixed(1)} s`;
            },
          },
        },
      },
      scales: {
        x: { type: 'linear', min: 1, max: Math.max(1, plies), display: false, stacked: true },
        y: {
          stacked: true,
          display: false,
          grid: { color: (ctx) => ctx.tick.value === 0 ? ZERO_COLOR : 'transparent' },
        },
      },
    },
  });
  // Empty-state banner draws ONTO the canvas if there are no times yet
  // — easier than wrangling absolute-positioned DOM.
  if (allZero) {
    requestAnimationFrame(() => {
      const cx = canvas.getContext('2d');
      cx.save();
      cx.fillStyle = 'rgba(255,255,255,0.35)';
      cx.font = '11px system-ui, sans-serif';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText('No move-time data (only tracked for games played after this update).',
                  canvas.width / 2, canvas.height / 2);
      cx.restore();
    });
  }
  return chart;
}
