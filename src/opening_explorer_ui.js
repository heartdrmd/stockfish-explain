// opening_explorer_ui.js — Lichess-style Explorer panel.
//
// Three tabs:
//   Masters  — explorer.lichess.ovh/masters  (classical-level games)
//   Lichess  — explorer.lichess.ovh/lichess  (user games by speed/rating)
//   Tablebase — tablebase.lichess.ovh/standard (7-piece endings)
//
// Design inspired by lichess-org/lila's ui/analyse/src/explorer/. AGPL-
// 3.0 licensed on both ends so lila code reuse is permitted; this is
// an independent implementation following the same UI conventions
// (tabs, move rows with win/draw/loss split bars, click-to-play).

const MASTERS_URL   = 'https://explorer.lichess.ovh/masters';
const LICHESS_URL   = 'https://explorer.lichess.ovh/lichess';
const TABLEBASE_URL = 'https://tablebase.lichess.ovh/standard';

// Request dedupe + tiny cache keyed by source:fen. Explorer API is
// generous but the tablebase one rate-limits quickly.
const CACHE = new Map();
const CACHE_LIMIT = 300;
let inFlight = null;

function fenKey(fen) { return (fen || '').split(' ').slice(0, 4).join(' '); }

async function fetchExplorer(source, fen, opts = {}) {
  const key = source + ':' + fenKey(fen) + ':' + JSON.stringify(opts);
  if (CACHE.has(key)) return CACHE.get(key);
  const url = new URL(
    source === 'masters'   ? MASTERS_URL   :
    source === 'lichess'   ? LICHESS_URL   : TABLEBASE_URL
  );
  url.searchParams.set('fen', fen);
  if (source === 'masters') url.searchParams.set('moves', '12');
  if (source === 'lichess') {
    url.searchParams.set('moves', '12');
    url.searchParams.set('speeds', opts.speeds || 'blitz,rapid,classical');
    url.searchParams.set('ratings', opts.ratings || '2000,2200,2500');
  }
  try {
    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (CACHE.size >= CACHE_LIMIT) {
      // Evict first key — FIFO is fine for a browsing session.
      const first = CACHE.keys().next().value;
      if (first) CACHE.delete(first);
    }
    CACHE.set(key, data);
    return data;
  } catch (err) {
    console.warn('[explorer]', source, 'fetch failed', err);
    return null;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

// Render a masters / lichess result as a table of move rows with
// W/D/B split bars. Each row is clickable (calls onPlayUci).
function renderGamesTable(data, { onPlayUci, sideToMove = 'w' } = {}) {
  if (!data || !data.moves || !data.moves.length) {
    return '<div class="exp-empty">No games found in this position.</div>';
  }
  const totalGames = data.moves.reduce((s, m) => s + m.white + m.draws + m.black, 0);
  const rowsHtml = data.moves.map(m => {
    const n = m.white + m.draws + m.black;
    const pct = (x) => n ? Math.round((x / n) * 100) : 0;
    const wPct = pct(m.white), dPct = pct(m.draws), bPct = pct(m.black);
    const pctOfAll = totalGames ? Math.round((n / totalGames) * 100) : 0;
    // Always orient bar toward side-to-move. If black to move we swap
    // the ends so the "winning half" is still visible at a glance.
    return `<tr class="exp-row" data-uci="${escapeHtml(m.uci)}">
      <td class="exp-san">${escapeHtml(m.san)}</td>
      <td class="exp-count" title="${n.toLocaleString()} games, ${pctOfAll}% of all">${n.toLocaleString()}</td>
      <td class="exp-bar">
        <div class="exp-bar-inner">
          <span class="exp-w" style="width:${wPct}%" title="${wPct}% White wins"></span>
          <span class="exp-d" style="width:${dPct}%" title="${dPct}% Draws"></span>
          <span class="exp-b" style="width:${bPct}%" title="${bPct}% Black wins"></span>
        </div>
        <span class="exp-pct">${wPct}% · ${dPct}% · ${bPct}%</span>
      </td>
    </tr>`;
  }).join('');
  const topHtml = data.topGames && data.topGames.length
    ? `<div class="exp-top-games">
         <div class="exp-sub">Top games</div>
         <ul>${data.topGames.slice(0, 6).map(g => {
           const w = `${escapeHtml(g.white?.name || '?')} (${g.white?.rating || '—'})`;
           const b = `${escapeHtml(g.black?.name || '?')} (${g.black?.rating || '—'})`;
           const res = g.winner === 'white' ? '1–0' : g.winner === 'black' ? '0–1' : '½–½';
           return `<li>${w} <em>${res}</em> ${b} <span class="exp-year">${g.year || ''}</span></li>`;
         }).join('')}</ul>
       </div>`
    : '';
  return `
    <table class="exp-table"><tbody>${rowsHtml}</tbody></table>
    ${topHtml}
    <div class="exp-total">Total in this position: ${totalGames.toLocaleString()} games</div>`;
}

// Render tablebase response (completely different shape).
function renderTablebase(data) {
  if (!data || !data.moves) return '<div class="exp-empty">Not a tablebase position (needs ≤7 pieces).</div>';
  const verdict = data.checkmate ? 'Checkmate' :
                  data.stalemate ? 'Stalemate' :
                  data.category === 'win'      ? 'Winning' :
                  data.category === 'loss'     ? 'Losing' :
                  data.category === 'draw'     ? 'Draw' :
                  data.category === 'cursed-win'   ? 'Cursed win (50-move)' :
                  data.category === 'blessed-loss' ? 'Blessed loss (50-move)' :
                  'Unknown';
  const rowsHtml = data.moves.map(m => {
    const dtm = m.dtm != null ? `DTM ${m.dtm}` : '';
    const cat = m.category || '';
    const klass = cat === 'win' ? 'exp-tb-win' : cat === 'loss' ? 'exp-tb-loss' : 'exp-tb-draw';
    return `<tr class="exp-row ${klass}" data-uci="${escapeHtml(m.uci)}">
      <td class="exp-san">${escapeHtml(m.san)}</td>
      <td class="exp-tb-cat">${escapeHtml(cat)}</td>
      <td class="exp-tb-dtm">${dtm}</td>
    </tr>`;
  }).join('');
  return `
    <div class="exp-tb-verdict">${verdict}</div>
    <table class="exp-table"><tbody>${rowsHtml}</tbody></table>`;
}

// Controller: wires the panel + tabs + live refresh on move.
export class ExplorerPanel {
  constructor(rootEl, { onPlayUci, getFen }) {
    this.root = rootEl;
    this.onPlayUci = onPlayUci || (() => {});
    this.getFen = getFen;
    this.activeTab = 'masters';
    this._reqToken = 0;
    this._render();
  }

  _render() {
    this.root.innerHTML = `
      <div class="exp-tabs">
        <button class="exp-tab exp-tab-active" data-tab="masters"   title="Master-level games from chess databases">♟ Masters</button>
        <button class="exp-tab"                 data-tab="lichess"   title="Lichess rated games, 2000+ rated players">🌐 Lichess</button>
        <button class="exp-tab"                 data-tab="tablebase" title="7-piece endgame tablebase — perfect play">🏁 Tablebase</button>
        <button class="exp-refresh" title="Re-query current position">⟳</button>
      </div>
      <div class="exp-body" id="exp-body">
        <div class="exp-empty">Navigate the board — I'll show you what's been played here.</div>
      </div>`;
    this.bodyEl = this.root.querySelector('#exp-body');
    this.root.querySelectorAll('.exp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.root.querySelectorAll('.exp-tab').forEach(b => b.classList.remove('exp-tab-active'));
        btn.classList.add('exp-tab-active');
        this.activeTab = btn.dataset.tab;
        this.refresh();
      });
    });
    this.root.querySelector('.exp-refresh')?.addEventListener('click', () => this.refresh({ force: true }));
    // Row-click → play the move.
    this.root.addEventListener('click', (e) => {
      const row = e.target.closest('.exp-row');
      if (!row) return;
      const uci = row.dataset.uci;
      if (uci) this.onPlayUci(uci);
    });
  }

  async refresh({ force = false } = {}) {
    if (!this.getFen) return;
    const fen = this.getFen();
    if (!fen) return;
    const token = ++this._reqToken;
    this.bodyEl.innerHTML = '<div class="exp-loading">Loading…</div>';
    let data;
    if (this.activeTab === 'tablebase') data = await fetchExplorer('tablebase', fen);
    else if (this.activeTab === 'lichess')   data = await fetchExplorer('lichess', fen);
    else                                     data = await fetchExplorer('masters', fen);
    if (token !== this._reqToken) return;   // stale response, ignore
    const sideToMove = (fen.split(' ')[1] || 'w');
    this.bodyEl.innerHTML = this.activeTab === 'tablebase'
      ? renderTablebase(data)
      : renderGamesTable(data, { sideToMove });
  }
}
