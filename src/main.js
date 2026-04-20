// main.js — entry point. Wires UI controls, engine events, and the
// engine ↔ board loop.

import { Engine, ENGINE_FLAVORS } from './engine.js';
import { BoardController, toDests as toDestsFrom } from './board.js';
import { Explainer }              from './explain.js';
import { Chess }                  from '../vendor/chess.js/chess.js';
import * as Analysis              from './analysis.js';
import * as Values                from './values.js';
import { Tournament }             from './tournament.js';
import { OPENINGS, playOpening }  from './openings.js';
import { coachReport }            from './coach.js';
import * as AICoach               from './ai-coach.js';
import { MODEL_SUGGESTIONS }      from './ai-coach.js';
import { setupEditor }            from './editor.js';
import * as Dorfman                from './dorfman.js';
import * as CoachV2                from './coach_v2.js';
import * as Tablebase              from './tablebase.js';
import * as OpeningExplorer        from './opening_explorer.js';
import { renderOpeningBlock, renderOpeningForAI, detectOpening } from './openings_book.js';
import { LICHESS_OPENINGS } from './openings_lichess.js';
import * as Archive from './game_archive.js';
import                                './validation_harness.js';

// ─── Diagnostic log capture ─────────────────────────────────────────
// Tees every console.log/.warn/.error/.info into an in-memory ring
// buffer so the user can click "📄 Log" and download the whole session
// as a text file to send back for debugging — no devtools needed.
const LOG_BUFFER = [];
const LOG_MAX    = 2000;                 // cap at ~2000 lines
function captureLog(level, args) {
  try {
    const stamp = new Date().toISOString();
    const msg = args.map(a => {
      if (typeof a === 'string') return a;
      // Error objects don't JSON-stringify usefully (message/stack
      // are non-enumerable). Serialise them manually so the log
      // actually tells us what went wrong.
      if (a instanceof Error) {
        return `Error: ${a.message}${a.stack ? '\n' + a.stack.split('\n').slice(0, 5).join('\n') : ''}`;
      }
      if (a && typeof a === 'object') {
        try {
          const seen = new WeakSet();
          const json = JSON.stringify(a, (k, v) => {
            if (v && typeof v === 'object') {
              if (seen.has(v)) return '[circular]';
              seen.add(v);
            }
            if (v instanceof Error) return `Error: ${v.message}`;
            return v;
          });
          // If it stringified to "{}", fall back to key listing (more
          // informative than empty braces).
          if (json === '{}') {
            const keys = Object.getOwnPropertyNames(a);
            if (keys.length) return `{${keys.map(k => `${k}: ${String(a[k]).slice(0, 80)}`).join(', ')}}`;
          }
          return json;
        } catch { return String(a); }
      }
      return String(a);
    }).join(' ');
    LOG_BUFFER.push(`[${stamp}] ${level.padEnd(5)} ${msg}`);
    if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.splice(0, LOG_BUFFER.length - LOG_MAX);
  } catch {}
}
for (const lvl of ['log', 'info', 'warn', 'error']) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...args) => { captureLog(lvl, args); orig(...args); };
}
// Also catch uncaught errors and unhandled promise rejections
window.addEventListener('error', (e) => {
  captureLog('error', [`uncaught: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`]);
  // Silence the scary banner for Stockfish-worker crashes — bootEngine
  // already has its own recovery UI (auto-fallback to the default
  // flavor + retry). Showing BOTH the banner and the recovery UI just
  // confuses users. The worker error still reaches the engine via its
  // own onerror handler.
  const filename = String(e.filename || '');
  const isStockfishWorker = /\/assets\/stockfish\//.test(filename) ||
                            /unreachable/.test(String(e.message || ''));
  if (isStockfishWorker) return;
  try { if (typeof showFatalBanner === 'function') showFatalBanner(new Error(`${e.message} @ ${e.filename}:${e.lineno}`)); } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  captureLog('error', [`unhandled-promise: ${(e.reason && e.reason.message) || e.reason}`]);
  try { if (typeof showFatalBanner === 'function') showFatalBanner(e.reason); } catch {}
});
function buildLogFile() {
  const header = [
    '=== stockfish.explain diagnostic log ===',
    `generated:  ${new Date().toISOString()}`,
    `userAgent:  ${navigator.userAgent}`,
    `hostname:   ${location.hostname}`,
    `deviceRAM:  ${navigator.deviceMemory || 'unknown'} GB (quantized)`,
    `cores:      ${navigator.hardwareConcurrency || 'unknown'}`,
    `coop/coep:  ${typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'unknown'}`,
    '',
    '---- captured console output ----',
    '',
  ].join('\n');
  return header + LOG_BUFFER.join('\n') + '\n';
}

// ─── User-action trace ─────────────────────────────────────────
// Tag every click on a header button with a log line so when the user
// downloads the log we can see exactly what they clicked last before
// things broke. Negligible overhead (only fires on actual clicks).
document.addEventListener('click', (ev) => {
  try {
    const btn = ev.target.closest('button[id], [data-action]');
    if (!btn) return;
    const id = btn.id || btn.dataset.action || '?';
    const label = (btn.textContent || '').trim().slice(0, 40).replace(/\s+/g, ' ');
    console.log(`[click] #${id} "${label}"`);
  } catch {}
}, true);

// ─── EMERGENCY EARLY-WIRE ──────────────────────────────────────
// Attach the most critical buttons IMMEDIATELY so they work even if
// main() throws halfway through. Order of operations:
//  1. These handlers run the moment this module parses.
//  2. Later, main() attaches the fully-wired versions which simply
//     supersede the early ones (addEventListener is additive — the
//     early listener also fires, but its effect is benign).
//
// Critical buttons guarded here:
//  - 🎯 Practice modal open (so the user can at least SEE the modal
//    even if population failed)
//  - 📄 Log download (so they can send us the log when things break)
//  - 🔒 Engine lock (stops the engine)
//  - ♻ Restart engine
try {
  const earlyWire = (id, handler) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.earlyWired) {
      el.dataset.earlyWired = '1';
      el.addEventListener('click', handler);
    }
  };
  // Fire on DOM-ready — DOMContentLoaded may have already fired if the
  // script is after </body>, in which case we run immediately.
  const runEarlyWire = () => {
    earlyWire('btn-practice', () => {
      const modal = document.getElementById('practice-modal');
      if (modal) modal.hidden = false;
    });
    earlyWire('btn-download-log', () => {
      try {
        const content = buildLogFile();
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stockfish-explain-log-${Date.now()}.txt`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) { alert('Log download failed: ' + err.message); }
    });
    earlyWire('practice-close', () => {
      const modal = document.getElementById('practice-modal');
      if (modal) modal.hidden = true;
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runEarlyWire);
  } else {
    runEarlyWire();
  }
} catch (err) {
  console.warn('[early-wire] skipped:', err.message);
}

// Visible error banner if main() throws — so the user sees a message
// instead of a silently broken page. Hooked into main()'s outer
// promise.
function showFatalBanner(err) {
  try {
    const existing = document.getElementById('fatal-error-banner');
    if (existing) return;
    const banner = document.createElement('div');
    banner.id = 'fatal-error-banner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      padding: 10px 14px; background: #5c1a1a; color: #ffe8e8;
      font-family: system-ui, sans-serif; font-size: 12px;
      border-bottom: 2px solid #dc3545; box-shadow: 0 2px 12px rgba(0,0,0,0.4);
      max-height: 50vh; overflow-y: auto;
    `;
    const msg = (err?.message || err || 'unknown').toString().slice(0, 300);
    // First 6 stack frames — usually enough to pin the file:line that
    // threw, which is the info we most need for remote debugging.
    const stack = (err?.stack || '').toString().split('\n').slice(0, 6).join('\n');
    banner.innerHTML = `
      <strong>⚠ Initialisation error — the app may be partially broken.</strong>
      <span style="float:right;cursor:pointer;font-size:14px;padding:0 6px;" id="fatal-banner-close">×</span><br>
      <span style="font-family: var(--font-mono, monospace); font-size:11px;">${msg.replace(/[<>]/g, '')}</span>
      ${stack ? `<pre style="margin:6px 0 0;padding:6px;background:rgba(0,0,0,0.3);border-radius:3px;font-size:10px;line-height:1.3;overflow-x:auto;white-space:pre-wrap;">${stack.replace(/[<>]/g, '')}</pre>` : ''}
      <span style="font-size:11px;">Click <strong>📄 Log</strong> and send the file — the full trace will be there. The Practice modal, Log download, and Engine controls still work.</span>`;
    (document.body || document.documentElement).prepend(banner);
    const closeBtn = document.getElementById('fatal-banner-close');
    if (closeBtn) closeBtn.addEventListener('click', () => banner.remove());
  } catch {}
}

async function main() {
  // Guards against any fireAnalysis() fired DURING main() initialization
  // (e.g. the one bootEngine kicks off after its await resolves). If
  // fireAnalysis runs before every `let` it references has been declared,
  // it throws a TDZ ReferenceError that kills boot. With these flags,
  // early calls are deferred until main() finishes; one flush at the end.
  let mainInitDone        = false;
  let pendingFireAnalysis = false;

  // ───── Multi-tab lock (BroadcastChannel) ─────
  // Prevent multiple tabs of the app from fighting over CPU + localStorage.
  // Newest tab wins. When a new tab announces itself, any existing tab
  // terminates its engine and shows a 'tab is inactive' banner. User can
  // click 'Reactivate this tab' to take the lock back.
  let __tabIsActive = true;
  try {
    const ch = new BroadcastChannel('stockfish-explain-tab-lock');
    // Announce ourselves as the active tab.
    ch.postMessage({ type: 'tab-hello', ts: Date.now() });
    ch.onmessage = (ev) => {
      if (!ev?.data || ev.data.type !== 'tab-hello') return;
      // Someone else became active. Step down to avoid CPU contention.
      if (__tabIsActive) {
        __tabIsActive = false;
        try { if (window.engine && window.engine.terminate) window.engine.terminate(); } catch {}
        const banner = document.createElement('div');
        banner.id = 'tab-inactive-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:#8a6d3b;color:#fff;padding:10px 16px;font-family:sans-serif;font-size:13px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
        banner.innerHTML = `⚠ Another tab of this app just opened — this tab's engine has been disabled to avoid CPU contention. <button id="tab-reactivate" style="margin-left:10px;padding:4px 12px;font-size:13px;cursor:pointer;">Reactivate this tab</button>`;
        document.body.appendChild(banner);
        document.getElementById('tab-reactivate')?.addEventListener('click', () => {
          location.reload();
        });
      }
    };
    window.__stockfishTabChannel = ch;
  } catch {}

  // Wire the API-key modal FIRST — before anything else that might fail.
  // If init later crashes, the 🔑 Key button still works.
  wireApiKeyModalEarly();

  // In server-proxied deployments, wire the password gate and check the
  // tier cookie. This may show a modal and block until the user enters the
  // site password — by design (friend-only access).
  await wireGateAndCheckTier();

  const ui = collectUI();

  // Modal close
  document.getElementById('modal-close').addEventListener('click', () => ui.whyModal.hidden = true);
  ui.whyModal.addEventListener('click', (e) => { if (e.target === ui.whyModal) ui.whyModal.hidden = true; });

  // Board
  const board = new BoardController(
    document.getElementById('board'),
    document.getElementById('promotion-overlay'),
  ).init();

  // Apply initial board size EARLY (before engine boot) so chessground
  // measures correctly and the default isn't a tiny collapsed box.
  {
    const STORAGE_KEY = 'stockfish-explain.board-size';
    const savedInit = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
    const sz = savedInit || defaultBoardSize();
    const el = document.getElementById('board');
    if (el) { el.style.width = sz + 'px'; el.style.height = sz + 'px'; }
    ui.boardArea.style.maxWidth = sz + 'px';
    ui.boardArea.style.width    = sz + 'px';
  }

  wireTabs();

  // Currently selected value system (user-controlled via settings)
  let valueSystem = 'default2026';

  // Define renderDissection upfront so we can use it before the engine boot.
  function renderDissection(fen) {
    try {
      const strat = Analysis.analyzeStrategy(fen);
      const tac   = Analysis.analyzeTactics(fen);
      const ideas = Analysis.generateIdeas(fen, strat);
      const sRep  = Analysis.renderStrategyReport(strat);
      const tRep  = Analysis.renderTacticsReport(tac);

      // Imbalance analysis using the selected value system
      const board = new Chess(fen).board();
      const imb = Values.computeImbalance(board, valueSystem);
      const avrukhRules = Values.avrukhRules(board);
      // Feed our classical material diff to the explainer so the pearl can flag Rule 7
      // (explainer is defined further down; avoid TDZ by using a try/catch)
      try { if (explainer) explainer.imbalanceCpWhite = imb.diff; } catch (_) {}

      const ideaHTML = (side, items) => {
        if (!items.length) return `<p class="muted">(no specific ideas detected for ${side})</p>`;
        return `<ul class="ideas-list">${items.map(i => `<li class="idea-${i.kind}">${i.text}</li>`).join('')}</ul>`;
      };

      // Imbalance panel — prominent, with breakdown
      const imbDiff = imb.diff;
      const diffStr = imbDiff === 0 ? '0.00'
                     : (imbDiff > 0 ? '+' : '') + (imbDiff / 100).toFixed(2);
      const diffSide = imbDiff === 0 ? 'even'
                      : imbDiff > 0 ? 'White ahead' : 'Black ahead';

      // Transparent arithmetic table for each side
      const arithTable = (side, color) => {
        const data = imb.arith[color];
        if (!data.rows.length) return '';
        const rows = data.rows.map(r => `
          <tr>
            <td class="ac-piece">${r.piece}${r.note ? ' <small>'+r.note+'</small>' : ''}</td>
            <td class="ac-count">${r.count}</td>
            <td class="ac-times">×</td>
            <td class="ac-val">${r.value}</td>
            <td class="ac-eq">=</td>
            <td class="ac-sub">${Math.round(r.sub)}</td>
          </tr>`).join('');
        return `
          <div class="imb-arith">
            <h5>${side}</h5>
            <table class="ac-table">${rows}
              <tr class="ac-total"><td colspan="5">total</td><td>${data.total}</td></tr>
            </table>
          </div>`;
      };

      const valHTML = `
        <div class="imb-header">
          <span class="imb-total">${diffStr}</span>
          <span class="imb-side muted">${diffSide}</span>
        </div>
        <div class="imb-meta muted">
          ${imb.phase.toUpperCase()} · ${imb.openness} position (${imb.pawnCount} pawns) ·
          <span class="imb-system">${imb.system}</span>
        </div>
        <div class="imb-values muted">
          Values this system: P=${imb.values.p} · N=${imb.values.n} · B=${imb.values.b} · R=${imb.values.r} · Q=${imb.values.q} · Pair=+${imb.values.pair}
        </div>
        <details class="imb-calc">
          <summary>Show calculation ▾</summary>
          <div class="imb-arith-grid">
            ${arithTable('White', 'w')}
            ${arithTable('Black', 'b')}
          </div>
          <p class="muted imb-formula">Result: White ${imb.whiteTotal} − Black ${imb.blackTotal} = <strong>${imb.diff > 0 ? '+' : ''}${imb.diff}</strong> cp (${diffStr} pawns)</p>
        </details>
        ${imb.breakdown.length ? `<ul class="imb-breakdown">${imb.breakdown.map(b =>
          `<li><span>${b.label}</span><span class="imb-cp ${b.cp>0?'plus':'minus'}">${b.cp>0?'+':''}${(b.cp/100).toFixed(2)}</span></li>`
        ).join('')}</ul>` : ''}
        ${imb.imbalances.length ? `<div class="imb-notes">${imb.imbalances.map(x => `<p>${x}</p>`).join('')}</div>` : ''}
        ${avrukhRules.length ? `<div class="avrukh-panel">${avrukhRules.map(r => `
          <div class="avrukh-block">
            <h5>${r.title}</h5>
            <div class="avrukh-text">${r.text}</div>
          </div>`).join('')}</div>` : ''}
      `;

      // Positional Coach v2 — synthesized from multiple chess-theory sources
      // (Dorfman lexicographic factors, Silman imbalances, Nimzowitsch
      // overprotection/blockade, Capablanca endgame, Aagaard questions,
      // Dvoretsky prophylaxis, Shereshevsky two-weaknesses, Watson
      // rule-independence). Replaces the smaller Dorfman-only panel.
      let coachHTML = '';
      try {
        // Snapshot latest engine analysis (if any) so the coach can
        // VALIDATE its theoretical advice against concrete engine lines.
        let engineSnapshot = null;
        try {
          if (engine && engine.topMoves && engine.topMoves.size) {
            const tm = Array.from(engine.topMoves.values())
                           .sort((a, b) => (a.multipv || 99) - (b.multipv || 99))
                           .slice(0, 5)
                           .map(info => ({
                             san:       firstSanFromUciPv(fen, info.pv || []),
                             uci:       (info.pv || [])[0],
                             score:     info.score,
                             scoreKind: info.scoreKind,
                             pv:        info.pv || [],
                             depth:     info.depth,
                           }))
                           .filter(m => m.uci);
            if (tm.length) engineSnapshot = { topMoves: tm, depth: tm[0].depth };
          }
          // Feed SAN history so the opening-book detector can identify
          // the variation and emit plans/motifs for both sides.
          if (engineSnapshot) {
            engineSnapshot.sanHistory = board.chess.history();
          } else {
            engineSnapshot = { sanHistory: board.chess.history(), topMoves: [] };
          }
        } catch {}
        const rep = CoachV2.coachReport(fen, engineSnapshot);
        const verdictSide =
          rep.verdict.sign > 0 ? '<span class="dv-white">White</span>'
          : rep.verdict.sign < 0 ? '<span class="dv-black">Black</span>'
          : '<span class="dv-eq">neither side</span>';
        const chip = (side, txt) => `<span class="dorfman-chip dorfman-chip-${side}">${txt}</span>`;
        const factorLine = (label, f) => {
          if (!f) return '';
          const s = f.sign > 0 ? chip('w', 'White') : f.sign < 0 ? chip('b', 'Black') : chip('eq', '=');
          return `<li><strong>${label}:</strong> ${s} — ${f.note || ''}</li>`;
        };
        const validationChip = (v) => {
          if (v === 'ok')          return '<span class="pv-tag pv-tag-ok">✓ engine OK</span>';
          if (v === 'fragile')     return '<span class="pv-tag pv-tag-fragile">⚠ engine fragile</span>';
          if (v === 'speculative') return '<span class="pv-tag pv-tag-spec">? unverified</span>';
          if (v === 'critical')    return '<span class="pv-tag pv-tag-crit">⚡ urgent</span>';
          return '';
        };
        const plansList = (side) => {
          const ps = rep.plans[side];
          if (!ps.length) return '<li class="muted">no specific plan — play principled moves</li>';
          return ps.map(p => {
            const chip = p.validation ? validationChip(p.validation) : '';
            const note = p.note ? `<span class="muted" style="font-size:10px; display:block; margin-top:2px">${p.note}</span>` : '';
            return `<li>${p.text} ${chip}${note}</li>`;
          }).join('');
        };
        const worstLine = (side) => {
          const w = rep.worstPiece[side];
          if (!w) return '(no obvious weak piece)';
          const pieceName = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen' }[w.type] || w.type;
          return `${pieceName} on <strong>${w.square}</strong> — badness score ${w.badness}${w.reroute ? ` · ${w.reroute}` : ''}`;
        };
        const engineBanner = rep.engineOverrides && rep.engineOverrides.concretePriority.length
          ? `<div class="coach-engine-alert">
               ${rep.engineOverrides.concretePriority.map(p => `<div class="coach-engine-alert-row">${p.text}</div>`).join('')}
             </div>`
          : (rep.engineOverrides
              ? `<div class="coach-engine-ok"><strong>✓ Engine agrees.</strong> ${rep.engineOverrides.summary}${rep.engineOverrides.bestMove ? ` (best move: ${rep.engineOverrides.bestMove})` : ''}</div>`
              : `<div class="coach-engine-missing"><em>Engine data not yet available — advice below is theoretical only. Wait a moment for analysis.</em></div>`);

        const trapBanner = (rep.trapWarnings && rep.trapWarnings.length)
          ? rep.trapWarnings.map(w => {
              const cls = w.severity === 'critical' ? 'coach-trap-crit'
                        : w.severity === 'warn'     ? 'coach-trap-warn'
                        :                              'coach-trap-info';
              const icon = w.severity === 'critical' ? '🚨'
                        : w.severity === 'warn'     ? '⚠'
                        :                              'ℹ';
              return `<div class="coach-trap ${cls}">${icon} ${w.message}</div>`;
            }).join('')
          : '';

        coachHTML = `
          <div class="dissect-group dorfman-group coach-group">
            <h4>Positional Coach — ${rep.phase} · ${rep.sideToMove} to move</h4>
            ${trapBanner}
            ${engineBanner}
            <p class="dorfman-verdict"><strong>${verdictSide} is statically better.</strong>
               ${rep.verdict.dominant ? 'Dominant factor: ' + rep.verdict.dominant + '. ' : ''}
               ${rep.verdict.reason}</p>

            <ul class="dorfman-factors">
              ${factorLine('King safety',         rep.factors.kingSafety)}
              ${factorLine('Material',            rep.factors.material)}
              ${factorLine('Phantom queen trade', rep.factors.queensOff)}
              ${factorLine('Piece activity',      rep.factors.activity)}
              ${factorLine('Pawn structure',      rep.factors.pawns)}
              ${factorLine('Space',               rep.factors.space)}
              ${factorLine('Files / diagonals',   rep.factors.files)}
              ${factorLine('Initiative / tempo',  rep.factors.dynamics)}
            </ul>

            ${rep.critical.isCritical
              ? `<p class="dorfman-critical">⚠ <strong>Critical moment.</strong> ${rep.critical.note} — ${rep.critical.triggers.join(' · ')}</p>`
              : `<p class="muted" style="font-size:12px">Play within your plan — ${rep.critical.note}</p>`
            }

            ${rep.prophylaxis.opponentIdea
              ? `<p style="font-size:12px"><strong>🧠 Prophylaxis:</strong> ${rep.prophylaxis.note}</p>`
              : ''
            }

            ${Tablebase.isTablebasePosition(fen)
              ? `<div class="coach-tablebase" id="coach-tb-${Tablebase.pieceCount(fen)}p">
                   <strong>📚 Tablebase position (${Tablebase.pieceCount(fen)} pieces)</strong>
                   <div class="coach-tb-body" data-fen="${fen.replace(/"/g, '&quot;')}">
                     <em class="muted">Querying Lichess Syzygy tablebase…</em>
                   </div>
                 </div>`
              : ''}

            ${rep.phase === 'opening'
              ? `<div class="coach-explorer">
                   <strong>📖 Master-games database</strong>
                   <div class="coach-oe-body" data-fen="${fen.replace(/"/g, '&quot;')}">
                     <em class="muted">Querying Lichess Masters explorer…</em>
                   </div>
                 </div>`
              : ''}

            ${rep.opening ? renderOpeningBlock(rep.opening) : ''}

            ${rep.archetype ? `
              <div class="coach-archetype">
                <h5 class="coach-section-h">📐 Structure: ${rep.archetype.label}</h5>
                ${rep.archetype.signals?.length
                  ? `<ul class="coach-signals">${rep.archetype.signals.map(s => `<li>${s}</li>`).join('')}</ul>`
                  : ''}
                ${rep.archetype.minorityViability
                  ? `<p class="muted" style="font-size:12px">Minority attack verdict: <strong>${rep.archetype.minorityViability.verdict}</strong> (score ${rep.archetype.minorityViability.score})</p>`
                  : ''}
              </div>
            ` : ''}

            ${rep.imbalance && rep.imbalance.length ? `
              <div class="coach-imbalance">
                <h5 class="coach-section-h">⚖ Imbalances (Kaufman / Avrukh style)</h5>
                <ul class="coach-imb-list">
                  ${rep.imbalance.map(i => `<li>${i.text}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            <div class="coach-side-grid">
              <div class="coach-side coach-side-w">
                <h5>♙ STRATEGY — White</h5>
                <p class="coach-strategy">${rep.strategy.white}</p>
                <h5 style="margin-top:8px">📋 PLAN — White</h5>
                <div class="coach-worst"><em>Worst piece:</em> ${worstLine('white')}</div>
                <div class="coach-mode"><em>Mode:</em> ${rep.mode.white}</div>
                <ul class="coach-plans">${plansList('white')}</ul>
              </div>
              <div class="coach-side coach-side-b">
                <h5>♟ STRATEGY — Black</h5>
                <p class="coach-strategy">${rep.strategy.black}</p>
                <h5 style="margin-top:8px">📋 PLAN — Black</h5>
                <div class="coach-worst"><em>Worst piece:</em> ${worstLine('black')}</div>
                <div class="coach-mode"><em>Mode:</em> ${rep.mode.black}</div>
                <ul class="coach-plans">${plansList('black')}</ul>
              </div>
            </div>

            ${rep.contextNotes.length
              ? `<p class="muted" style="font-size:11px;margin-top:6px"><strong>Context:</strong> ${rep.contextNotes.join(' · ')}</p>`
              : ''
            }

            <!-- Deep Analysis trigger — user picks time budget, engine
                 searches that long on the current position, then the
                 coach re-renders with deeper / more trusted validation. -->
            <div class="coach-deep-row">
              <label class="coach-deep-label">🔬 Deep analysis:</label>
              <button class="coach-deep-btn" data-seconds="30">30s</button>
              <button class="coach-deep-btn" data-seconds="60">1 min</button>
              <button class="coach-deep-btn" data-seconds="120">2 min</button>
              <button class="coach-deep-btn" data-seconds="180">3 min</button>
              <button class="coach-deep-btn" data-seconds="300">5 min</button>
              <span id="coach-deep-status" class="muted" style="font-size:11px;margin-left:6px"></span>
            </div>
          </div>
        `;
      } catch (err) {
        coachHTML = `<p class="muted">Coach panel unavailable: ${err.message}</p>`;
      }

      ui.dissectStrategy.innerHTML = `
        ${coachHTML}
        <div class="dissect-group imb-group">
          <h4>Material & imbalance <span class="imb-system-mini">(${imb.system})</span></h4>
          ${valHTML}
        </div>
        <div class="dissect-group">
          <h4>Ideas in the air — White</h4>
          ${ideaHTML('White', ideas.w)}
        </div>
        <div class="dissect-group">
          <h4>Ideas in the air — Black</h4>
          ${ideaHTML('Black', ideas.b)}
        </div>
        ${sRep.structure.length ? `<div class="dissect-group"><h4>Structure</h4><ul>${sRep.structure.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
        <details class="dissect-details">
          <summary>Full positional breakdown ▾</summary>
          ${sectionList('Color complexes',     sRep.colorComplex)}
          ${sectionList('Bishop quality',      sRep.bishops)}
          ${sectionList('Pawn chains',         sRep.chains)}
          ${sectionList('Pawn structure',      sRep.pawns)}
          ${sectionList('King safety',         sRep.king)}
          ${sectionList('Files & rooks',       sRep.files)}
          ${sectionList('Outposts',            sRep.outposts)}
          ${sectionList('Space',               sRep.space)}
          ${sectionList('Mobility',            sRep.mobility)}
          ${sectionList('Development',         sRep.development)}
        </details>
      `;

      // Opening-phase master-DB lookup — fires only when CoachV2 flagged
      // the phase as opening. Uses Lichess's masters explorer API.
      try {
        const coachRep = CoachV2.coachReport(fen);
        if (coachRep.phase === 'opening') {
          (async () => {
            const data = await OpeningExplorer.queryOpeningExplorer(fen);
            const body = ui.dissectStrategy.querySelector('.coach-oe-body');
            if (!body) return;
            if (body.dataset.fen !== fen) return;
            if (!data) {
              body.innerHTML = '<em class="muted">Explorer unreachable or rate-limited.</em>';
              return;
            }
            body.innerHTML = OpeningExplorer.renderExplorerBlock(data);
          })();
        }
      } catch (_) {}

      // Kick off the async tablebase fetch AFTER the innerHTML is
      // committed so the placeholder is in the DOM by the time the
      // Promise resolves. Only fires for ≤7-piece positions.
      if (Tablebase.isTablebasePosition(fen)) {
        const stmNow = new Chess(fen).turn();
        (async () => {
          const tb = await Tablebase.queryTablebase(fen);
          // Bail if the user has navigated to a different position since
          // we fired the request.
          const body = ui.dissectStrategy.querySelector('.coach-tb-body');
          if (!body) return;
          if (body.dataset.fen !== fen) return;
          if (!tb) {
            body.innerHTML = '<em class="muted">Tablebase API unreachable — engine analysis remains authoritative.</em>';
            return;
          }
          const verdict = Tablebase.describeTablebaseResult(tb, stmNow);
          const bestMove = Tablebase.tablebaseBestMoveLabel(tb);
          body.innerHTML = `
            <div class="coach-tb-verdict">${verdict}</div>
            ${bestMove ? `<div class="coach-tb-best">Best move: <strong>${bestMove}</strong></div>` : ''}
            ${tb.moves.length > 1
              ? `<div class="coach-tb-alts muted">Alternatives: ${tb.moves.slice(1, 5).map(m => `${m.san} (${m.category})`).join(' · ')}</div>`
              : ''}
          `;
        })();
      }

      const wList = tRep.w.length ? tRep.w.map(x => `<li>${x}</li>`).join('') : '<li class="muted">(none detected)</li>';
      const bList = tRep.b.length ? tRep.b.map(x => `<li>${x}</li>`).join('') : '<li class="muted">(none detected)</li>';
      ui.dissectTactics.innerHTML =
        `<h4>For White</h4><ul class="tac-list">${wList}</ul>` +
        `<h4>For Black</h4><ul class="tac-list">${bList}</ul>`;
    } catch (e) {
      console.error('dissect failed', e);
      ui.dissectStrategy.innerHTML = '<p class="muted">Dissection failed: ' + (e.message || e) + '</p>';
      ui.dissectTactics.innerHTML  = '<p class="muted">Tactics scan failed.</p>';
    }
  }

  renderDissection(board.fen());

  // Deep-analysis buttons inside the Coach panel. Clicking one tells the
  // engine to spend N seconds searching the CURRENT position with a long
  // movetime limit; when that completes (or is aborted by a new move),
  // the coach panel re-renders with fresher / more-validated engine data.
  // Uses event delegation because the buttons are re-rendered on every
  // move inside the Position tab's HTML.
  if (ui.dissectStrategy && !ui.dissectStrategy._deepWired) {
    ui.dissectStrategy._deepWired = true;
    ui.dissectStrategy.addEventListener('click', async (e) => {
      const btn = e.target.closest('.coach-deep-btn');
      if (!btn) return;
      const secs = +btn.dataset.seconds || 60;
      const statusEl = document.getElementById('coach-deep-status');
      if (!engineReady) {
        if (statusEl) statusEl.textContent = 'Engine not ready yet.';
        return;
      }
      if (locked || paused) {
        if (statusEl) statusEl.textContent = 'Engine is locked/paused — resume first.';
        return;
      }
      console.log('[coach-deep] starting', { seconds: secs, fen: board.fen() });
      // Disable all deep buttons while search runs
      ui.dissectStrategy.querySelectorAll('.coach-deep-btn').forEach(b => b.disabled = true);
      if (statusEl) statusEl.textContent = `Searching ${secs}s…`;
      const startedAt = Date.now();
      // Bump MultiPV to 5 for richer plan validation during deep analysis
      const originalMultiPV = engine.multipv;
      engine.setMultiPV(Math.max(5, originalMultiPV));
      engine.stop();
      explainer.setFen(board.fen());
      const done = new Promise(resolve => {
        const onBest = () => { engine.removeEventListener('bestmove', onBest); resolve(); };
        engine.addEventListener('bestmove', onBest);
      });
      engine.start(board.fen(), { movetime: secs * 1000 });
      // Live countdown
      const tick = setInterval(() => {
        if (!statusEl) return;
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        statusEl.textContent = `Searching ${elapsed}/${secs}s…`;
      }, 500);
      await done;
      clearInterval(tick);
      // Restore MultiPV, re-render coach with the fresh engine data
      engine.setMultiPV(originalMultiPV);
      ui.dissectStrategy.querySelectorAll('.coach-deep-btn').forEach(b => b.disabled = false);
      if (statusEl) statusEl.textContent = `Done (${secs}s) — coach refreshed`;
      console.log('[coach-deep] finished', { seconds: secs });
      // Re-render the Position panel with the deeper engine snapshot
      renderDissection(board.fen());
      // Then resume normal analysis of the real position
      setTimeout(() => fireAnalysis(), 50);
    });
  }

  // Engine — choose flavor based on environment; default to "lite" when threaded,
  // else "lite-single". User can override via settings drawer.
  const threadable = typeof SharedArrayBuffer !== 'undefined' && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  // Detect GitHub Pages (or any static host without full-net WASMs committed).
  // When we're there, full-net 108 MB variants aren't present in the repo and
  // would 404 — so disable them in the dropdown and show the user where to
  // download them.
  const isPagesHost = /\.github\.io$/i.test(location.hostname);

  // Default to the last-used engine flavor (persisted) if it still exists
  // in the dropdown AND is valid in this environment. Otherwise fall back
  // to the strongest engine available in the current environment.
  const FLAVOR_STORAGE = 'stockfish-explain.engine-flavor';
  const savedFlavor = localStorage.getItem(FLAVOR_STORAGE);
  const flavorOptions = [...ui.selectFlavor.querySelectorAll('option')].map(o => o.value);
  const flavorValid = savedFlavor && flavorOptions.includes(savedFlavor);
  // Default: Avrukh 108 MT when threadable (user-confirmed as the
  // smoothest/strongest variant). Falls back to lite on Pages host
  // (no custom binaries there) and avrukh-single if no threads.
  let currentFlavor = flavorValid
    ? savedFlavor
    : (threadable ? (isPagesHost ? 'lite' : 'avrukh') : 'avrukh-single');
  ui.selectFlavor.value = currentFlavor;

  // Disable multi-thread flavors if the page isn't cross-origin-isolated
  if (!threadable) {
    ui.selectFlavor.querySelectorAll('option').forEach(o => {
      if (o.value === 'lite' || o.value === 'full' || o.value === 'avrukhplus-lite') o.disabled = true;
    });
    ui.flavorNote.textContent = 'Multi-thread engines need COOP/COEP headers (Python dev server) — disabled here.';
  }

  // Disable full-net (108 MB) variants when running on GitHub Pages —
  // they're distributed via Releases, not committed to git.
  if (isPagesHost) {
    const fullNetValues = [
      // Single-thread full-net
      'full', 'stock-single', 'kaufman-single', 'classical-single',
      'alphazero-single', 'avrukh-single', 'avrukhplus-single',
      // Multi-thread full-net
      'kaufman', 'classical', 'alphazero', 'avrukh', 'avrukhplus',
    ];
    ui.selectFlavor.querySelectorAll('option').forEach(o => {
      if (fullNetValues.includes(o.value)) {
        o.disabled = true;
        o.textContent += ' — download from Releases';
      }
    });
    const n = ui.flavorNote;
    n.innerHTML = `Running on GitHub Pages. <strong>Full-net (108 MB) variants are disabled here</strong> — download them from the <a href="https://github.com/heartdrmd/stockfish-explain/releases/latest" target="_blank" style="color:var(--c-primary)">release page</a> and run locally to enable them. Multi-thread also requires the Python dev server for COOP/COEP headers.`;
  }

  let engine = new Engine();
  let engineReady = false;

  // Wire the AI buttons NOW, before engine boot, so they respond to clicks
  // from the moment the page is interactive. Each handler internally checks
  // if the engine is ready and shows a helpful message otherwise.
  wireAiButtonsEarly();

  async function bootEngine(flavor) {
    engineReady = false;
    ui.engineMode.textContent = 'booting…';
    ui.engineMode.classList.remove('threaded');
    ui.narrationText.textContent = `Loading ${ENGINE_FLAVORS[flavor].label} (${ENGINE_FLAVORS[flavor].size})…`;

    // Pre-boot hygiene: proactively nuke any lingering service worker
    // + sf-engines-* caches before asking the engine to boot. Prevents
    // a stuck/legacy SW from intercepting the WASM fetch and wedging
    // boot forever. Runs in parallel with engine.boot() below so it
    // doesn't add to the boot wall-clock when everything is clean.
    (async () => {
      try {
        const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
        await Promise.all(regs.map(r => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('sf-engines-')).map(k => caches.delete(k)));
      } catch {}
    })();

    try {
      // Race boot against a size-aware timeout so users see an error
      // instead of an infinite "booting…" when something upstream (stuck
      // SW, corrupt cached WASM, CDN stall) wedges engine.boot().
      // Lite (7 MB) should boot in <15 s on any sane connection; full
      // NNUE (108 MB) may legitimately need up to ~90 s over a slow
      // cold CDN fetch.
      const sizeStr = ENGINE_FLAVORS[flavor]?.size || '';
      const timeoutMs = sizeStr.includes('108') ? 90_000 : 25_000;
      const info = await Promise.race([
        engine.boot({ flavor }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Engine boot timed out after ${Math.round(timeoutMs/1000)} s`)), timeoutMs)
        ),
      ]);
      engineReady = true;
      currentFlavor = info.flavor;
      ui.selectFlavor.value = info.flavor;
      // Friendly label: variant name + thread count
      const spec = ENGINE_FLAVORS[info.flavor];
      const shortName = (spec?.label || info.flavor).split(/[·—(]/)[0].trim();
      const netSuffix = info.activeNet === 'small' ? ' · smallnet' : '';
      ui.engineMode.textContent = info.threaded
        ? `${shortName} · ${info.threads} thread${info.threads === 1 ? '' : 's'}${netSuffix}`
        : `${shortName} · 1 thread${netSuffix}`;
      ui.engineMode.title = spec?.label || info.flavor;
      if (info.threaded) ui.engineMode.classList.add('threaded');
      ui.narrationText.textContent = 'Engine ready. Make a move — I\'ll explain what I see.';
      console.log('[engine] booted', { flavor: info.flavor, threads: info.threads, threaded: info.threaded });
      // Hot-swap notification: when the bignet finishes loading in
      // the background, update the engine-mode pill so the user sees
      // that max strength is now active.
      if (info.activeNet === 'small') {
        const onSwap = (ev) => {
          engine.removeEventListener('nnue-swapped', onSwap);
          const txt = ui.engineMode.textContent.replace(' · smallnet', ' · bignet');
          ui.engineMode.textContent = txt;
        };
        engine.addEventListener('nnue-swapped', onSwap);
      }
      // Kick off an analysis on the current position
      fireAnalysis();
    } catch (err) {
      console.error('[engine] boot failed', err);
      ui.engineMode.textContent = 'engine failed';
      const msg = String(err.message || err);
      const isTimeout  = /timed out/i.test(msg);
      // Broad crash regex — better to auto-fallback once unnecessarily
      // than leave the user stuck on a silent boot failure.
      const isCrash    = /unreachable|runtime error|not valid wasm|crashed|failed to boot|syntaxerror|importscripts|failed to fetch|importing|module/i.test(msg);

      // Auto-fallback chain: on crash/timeout, walk a priority list
      // of safer flavors until one works. Stops as soon as a flavor
      // boots — doesn't loop forever if every flavor is broken.
      // Order: Avrukh (user's preferred default) → lite MT → lite ST.
      const fallbackChain = threadable
        ? ['avrukh', 'lite', 'lite-single']
        : ['avrukh-single', 'lite-single'];
      const nextFlavor = fallbackChain.find(f => f !== flavor);
      if ((isTimeout || isCrash) && nextFlavor) {
        localStorage.removeItem(FLAVOR_STORAGE);
        // Clear the 'engine failed' pill IMMEDIATELY so the user never
        // sees a persistent error label during an auto-fallback that's
        // about to succeed. Replaced by 'booting…' inside the recursive
        // bootEngine call, then by the success name once it finishes.
        ui.engineMode.textContent = 'switching…';
        ui.narrationText.innerHTML = `⏳ Trying <strong>${nextFlavor}</strong>…`;
        ui.selectFlavor.value = nextFlavor;
        try { engine.terminate?.(); } catch {}
        engine = new Engine();
        // Re-wire explainer — without this, the listeners on the
        // terminated old engine stay orphaned and the UI goes silent
        // after a successful fallback. Same class of bug as the
        // auto-ritual and manual flavor-switch paths.
        if (typeof explainer !== 'undefined') {
          explainer.engine = engine;
          explainer.wire();
        }
        return bootEngine(nextFlavor);
      }

      if (isTimeout) {
        try {
          const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
          await Promise.all(regs.map(r => r.unregister()));
          const keys = await caches.keys();
          await Promise.all(keys.filter(k => k.startsWith('sf-engines-')).map(k => caches.delete(k)));
        } catch {}
        ui.narrationText.innerHTML =
          `⚠ Engine boot timed out. I've cleared any stuck service worker + cache — ` +
          `<button class="btn" onclick="location.reload()" style="margin-left:6px;">Reload now</button>`;
      } else if (isCrash) {
        // Default also crashed — likely Chrome HTTP cache is holding a
        // bad copy. Offer a hard-reload CTA that bypasses the cache.
        ui.narrationText.innerHTML =
          `⚠ Engine crashed on boot (${msg}). Try <button class="btn" onclick="location.reload()" style="margin-left:4px;">Hard reload</button> — ` +
          `or press <kbd>⌘⇧R</kbd> to bypass Chrome's cache.`;
      } else {
        ui.narrationText.textContent = msg;
      }
    }
  }

  // Wire the Setup-position editor EARLY — before the (slow) engine boot —
  // so the 🛠 Setup button responds on the very first click rather than
  // silently failing until engine is ready.
  const editor = setupEditor((fen) => {
    try {
      const tmp = new Chess(fen);
      board.chess = tmp;
      board.startingFen = tmp.fen();
      board.viewPly = null;
      // Reset the variation tree to the editor's FEN so scrolling back /
      // undo / PGN save all start from here.
      board.tree = new (board.tree.constructor)(tmp.fen());
      board.cg.set({
        fen: tmp.fen(),
        turnColor: tmp.turn() === 'w' ? 'white' : 'black',
        lastMove: undefined,
        check: tmp.inCheck() ? (tmp.turn() === 'w' ? 'white' : 'black') : false,
        movable: { color: 'both', dests: toDestsFrom(tmp) },
      });
      board.cg.setAutoShapes([]);
      board.dispatchEvent(new CustomEvent('new-game'));
      flashPill(ui.engineMode, 'Position set · new start', 1500);
      ui.narrationText.textContent =
        `🛠 New starting position loaded. ${tmp.turn() === 'w' ? 'White' : 'Black'} to move. Undo / scroll-back stop here.`;
    } catch (e) {
      alert('Could not load editor position: ' + e.message);
    }
  });
  document.getElementById('btn-editor').addEventListener('click', () => {
    editor.open(board.fen());
  });

  // State that fireAnalysis() references must exist BEFORE bootEngine
  // awaits — once the engine boots it fires analysis immediately. Any
  // `let` binding declared later throws a TDZ ReferenceError; any `var`
  // declared later is hoisted but still undefined.
  let practiceColor       = null;
  let practiceSearchToken = 0;
  let paused              = false;
  let locked              = localStorage.getItem('stockfish-explain.engine-locked') === '1';
  window.__engineMuted    = locked;
  var explainer = new Explainer({ engine, board, ui });
  explainer.wire();
  explainer.setFen(board.fen());

  // ───── Auto-ritual boot ─────
  // User-confirmed: directly booting the full 108 MB variant sometimes
  // leaves the engine silent (no info/bestmove events reach the UI even
  // though the worker is searching). The workaround they found: switch
  // to the 7 MB Stock Lite variant and back. Now we do that rite
  // automatically for every non-lite flavor so users never hit the
  // silent-engine state. Costs: ~1 extra second of boot for a Lite
  // WASM handshake the user wasn't otherwise doing.
  const _savedFlavor = currentFlavor;
  const _needsRitual = !['lite', 'lite-single', 'avrukhplus-lite', 'avrukhplus-lite-single',
                         'kaufman-lite-single', 'classical-lite-single',
                         'alphazero-lite-single', 'avrukh-lite-single'].includes(_savedFlavor);
  if (_needsRitual) {
    console.log('[engine] auto-ritual: boot lite first, then switch to', _savedFlavor);
    ui.narrationText.textContent = `Warming up (lite) before switching to ${_savedFlavor}…`;
    try {
      await bootEngine(threadable ? 'lite' : 'lite-single');
      await new Promise(r => setTimeout(r, 400));
      // CRITICAL: match what the manual flavor-switch handler does —
      // terminate + new Engine + RE-WIRE EXPLAINER. Without re-wiring,
      // the explainer's 'thinking'/'bestmove' listeners are still
      // attached to the terminated old engine; the new engine fires
      // events into the void and the UI stays silent (the exact bug
      // the user kept hitting with the 'silent engine' complaint).
      try { engine.terminate(); } catch {}
      engine = new Engine();
      explainer.engine = engine;
      explainer.wire();
      await bootEngine(_savedFlavor);
    } catch (err) {
      console.warn('[engine] auto-ritual failed, falling back to direct boot', err);
      try { engine.terminate?.(); } catch {}
      engine = new Engine();
      explainer.engine = engine;
      explainer.wire();
      await bootEngine(_savedFlavor);
    }
  } else {
    await bootEngine(currentFlavor);
  }

  // ────────── Engine control <-> UI ──────────

  // Hardware concurrency — set max on thread slider. Default: 75% of
  // available cores rounded up, capped at N-1 AND at 32 (Stockfish
  // WASM thread-pool ceiling; beyond that the worker crashes without
  // a useful error).
  const maxThreads = Math.max(1, navigator.hardwareConcurrency || 4);
  const WASM_THREAD_CAP = 32;
  ui.rangeThreads.max = String(Math.min(maxThreads, WASM_THREAD_CAP));
  const defaultThreads = Math.max(1, Math.min(maxThreads - 1, Math.ceil(maxThreads * 0.75), WASM_THREAD_CAP));
  ui.rangeThreads.value = String(defaultThreads);
  ui.threadsVal.textContent = ui.rangeThreads.value;
  ui.threadsHw.textContent = `(${maxThreads} cores detected · default: ${defaultThreads})`;
  // Sync engine to UI default so the two always agree, even if engine
  // was loaded with a different initial thread count before UI init.
  try { engine.setThreads(defaultThreads); } catch (_) { /* engine may still be booting */ }

  ui.rangeSkill.addEventListener('input', () => {
    ui.skillVal.textContent = ui.rangeSkill.value;
    engine.setSkill(+ui.rangeSkill.value);
  });
  ui.rangeMultipv.addEventListener('input', () => {
    ui.multipvVal.textContent = ui.rangeMultipv.value;
    engine.setMultiPV(+ui.rangeMultipv.value);
    fireAnalysis();
  });
  ui.rangeThreads.addEventListener('input', () => {
    ui.threadsVal.textContent = ui.rangeThreads.value;
    engine.setThreads(+ui.rangeThreads.value);
    fireAnalysis();
  });
  ui.limitMode.addEventListener('change', () => {
    const m = ui.limitMode.value;
    if (m === 'depth')    ui.limitValue.value = 18;
    if (m === 'movetime') ui.limitValue.value = 2000;
    ui.limitValue.disabled = (m === 'infinite');
    fireAnalysis();
  });
  ui.limitValue.addEventListener('change', () => fireAnalysis());

  // (Piece-value-system selector removed — it only influenced the Position
  // tab's imbalance panel and was taking up header/drawer space.
  // `valueSystem` remains pinned to the 2026 default for that panel.)

  // ─── Hash (transposition table) size picker + clear button ────────
  // navigator.deviceMemory is a PRIVACY-QUANTIZED API:
  //   - Capped at 8 GB — a 32 GB machine reports 8.
  //   - Only discrete buckets: 0.25 / 0.5 / 1 / 2 / 4 / 8.
  //   - Firefox and Safari return undefined.
  // So trusting it as an accurate RAM gauge is wrong in both directions.
  // Treat it as a FLOOR, not a ceiling: if the browser reports 8 GB, the
  // real machine probably has 8+ GB. If undefined, assume a modern
  // machine (16 GB) rather than being overly conservative.
  const reportedRamGB = navigator.deviceMemory || 16;
  // WASM heap ceiling: Stockfish WASM multi-thread is built with 4 GB
  // maximum memory; the hash table, search stack, and NNUE weights all
  // share that budget. 3 GB hash leaves ~1 GB for the rest — that's the
  // real cap regardless of how much system RAM you have.
  const WASM_HASH_CEILING = 3072;
  const ALL_HASH_SIZES = [32, 64, 128, 256, 512, 1024, 2048, 3072];
  // Offer sizes up to min(WASM ceiling, 2/3 of the FLOOR reported).
  // If reported >= 8 we just offer everything up to the ceiling since the
  // reporting is capped and the machine is almost certainly ample.
  const maxHashMB = reportedRamGB >= 8
    ? WASM_HASH_CEILING
    : Math.min(WASM_HASH_CEILING, Math.floor(reportedRamGB * 1024 * 2 / 3));
  const hashSel  = document.getElementById('select-hash');
  const hashHw   = document.getElementById('hash-hw');
  const hashClr  = document.getElementById('btn-clear-hash');
  const HASH_STORAGE = 'stockfish-explain.hash-mb';
  const savedHash = parseInt(localStorage.getItem(HASH_STORAGE) || '', 10);
  const validSizes = ALL_HASH_SIZES.filter(s => s <= maxHashMB).sort((a, b) => b - a);
  if (hashSel) {
    hashSel.innerHTML = '';
    for (const mb of validSizes) {
      const o = document.createElement('option');
      o.value = String(mb);
      o.textContent = mb >= 1024 ? `${(mb/1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
      hashSel.appendChild(o);
    }
    // Add a "Custom…" option so power users with 32+ GB can punch in a
    // specific number up to the WASM ceiling.
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom…';
    hashSel.appendChild(customOpt);

    const initial = (savedHash && validSizes.includes(savedHash))
      ? savedHash
      : (validSizes.includes(512) ? 512 : validSizes[0]);  // 512 MB as default
    hashSel.value = String(initial);
    engine.setHash(initial);
    hashHw.textContent = navigator.deviceMemory
      ? `(browser reports ≥${reportedRamGB} GB RAM · WASM cap ${WASM_HASH_CEILING} MB)`
      : `(RAM unknown · WASM cap ${WASM_HASH_CEILING} MB)`;
    hashSel.addEventListener('change', () => {
      if (hashSel.value === 'custom') {
        const raw = prompt(`Enter hash size in MB (1 – ${WASM_HASH_CEILING}). Bigger = remembers more lines but uses more RAM.`, String(initial));
        if (!raw) { hashSel.value = String(initial); return; }
        let mb = Math.floor(+raw);
        if (!Number.isFinite(mb) || mb < 1) { hashSel.value = String(initial); return; }
        if (mb > WASM_HASH_CEILING) mb = WASM_HASH_CEILING;
        // Add option if not present
        if (![...hashSel.querySelectorAll('option')].some(o => o.value === String(mb))) {
          const o = document.createElement('option');
          o.value = String(mb);
          o.textContent = mb >= 1024 ? `${(mb/1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB (custom)` : `${mb} MB (custom)`;
          hashSel.insertBefore(o, customOpt);
        }
        hashSel.value = String(mb);
        engine.setHash(mb);
        localStorage.setItem(HASH_STORAGE, String(mb));
      } else {
        const mb = +hashSel.value;
        engine.setHash(mb);
        localStorage.setItem(HASH_STORAGE, String(mb));
      }
    });
  }
  if (hashClr) {
    hashClr.addEventListener('click', () => {
      engine.clearHash();
      flashPill(ui.engineMode, 'Cache cleared', 1000);
    });
  }

  // Arrow overlay setting — persisted. Default: OFF. Read by explain.js via
  // window.__arrowMode; changes take effect on next engine update.
  const ARROW_STORAGE = 'stockfish-explain.arrow-mode';
  const savedArrowMode = localStorage.getItem(ARROW_STORAGE) || 'off';
  window.__arrowMode = savedArrowMode;
  if (ui.selectArrowMode) {
    ui.selectArrowMode.value = savedArrowMode;
    ui.selectArrowMode.addEventListener('change', () => {
      const v = ui.selectArrowMode.value;
      window.__arrowMode = v;
      localStorage.setItem(ARROW_STORAGE, v);
      // Clear any currently-drawn arrows immediately if turned off
      if (v === 'off' && board && board.drawArrows) board.drawArrows([]);
      fireAnalysis();
    });
  }

  ui.selectFlavor.addEventListener('change', async () => {
    const f = ui.selectFlavor.value;
    if (f === currentFlavor) return;
    localStorage.setItem(FLAVOR_STORAGE, f);
    engine.terminate();
    engine = new Engine();
    engine.setSkill(+ui.rangeSkill.value);
    engine.setMultiPV(+ui.rangeMultipv.value);
    explainer.engine = engine;
    explainer.wire();
    await bootEngine(f);
    // Resume analysis of current position automatically
    fireAnalysis();
  });

  // Settings drawer toggle
  ui.btnSettings.addEventListener('click', () => {
    ui.settingsDrawer.hidden = !ui.settingsDrawer.hidden;
  });

  // ────────── Board ↔ engine loop ──────────

  // paused / locked / __engineMuted are declared ABOVE bootEngine so
  // that fireAnalysis (which fires during the bootEngine await) sees
  // them without hitting TDZ.

  // Practice mode state:
  //   practiceColor: which color the user plays ('white' | 'black' | null = off)
  //   When set, engine auto-plays the opposite color as soon as it's their turn.
  // Declared further up (just after collectUI) to avoid a TDZ error
  // where fireAnalysis (called from bootEngine during init) runs
  // BEFORE these `let` bindings are reached. See earlier declaration.
  // Keeping the original line here would be a no-op re-declaration,
  // which JS forbids with `let`, so just remove.
  //   let practiceColor = null;  (moved)
  // Incremented whenever the user makes a move or practice ends —
  // bestmove listeners capture the token value at the time they were
  // registered and bail out if it's stale when they finally fire. Prevents
  // a slow engine search from playing an old bestmove onto a new position.
  //   let practiceSearchToken = 0;  (moved above bootEngine)

  // Defer heavy work until AFTER chessground's slide animation
  // completes. The slide is 120 ms; we delay dissection by 160 ms so
  // the main thread is clear during those 12-ish animation frames.
  // (requestAnimationFrame alone lands on the first frame of the
  // animation, which still causes mid-slide stutter when the
  // heuristic HTML build chews 15-30 ms.)
  let dissectionTimer = 0;
  function scheduleDissection(fen) {
    if (dissectionTimer) clearTimeout(dissectionTimer);
    dissectionTimer = setTimeout(() => {
      dissectionTimer = 0;
      renderDissection(fen);
    }, 160);
  }

  // Piggyback on the engine's thinking events to capture evals for
  // the game archive. Runs regardless of __engineMuted so that even in
  // practice mode the per-move data is recorded silently.
  engine.addEventListener('thinking', () => {
    captureEngineThinkingEval();
    scheduleTimelineRender();
  });
  engine.addEventListener('bestmove', () => {
    captureEngineThinkingEval();
    scheduleTimelineRender();
  });

  // ────────── Chess clock (#19) ─────────────────────────────────────
  const clock = {
    active: false,
    mode: 'down',        // 'down' (timed) | 'up' (untimed — counts time used)
    msWhite: 0,
    msBlack: 0,
    incMs: 0,
    tickingFor: null,    // 'w' | 'b' | null
    lastTickAt: 0,
    timerId: 0,
    initialMs: 0,
    // Persisted style: user can cycle through digital-dark /
    // digital-light / digital-led / analog-garde
    style: localStorage.getItem('stockfish-explain.clock-style') || 'digital-jumbo',
  };
  function formatClockTime(ms) {
    if (ms == null || ms < 0) ms = 0;
    const totalFloor = Math.floor(ms / 1000);
    const h = Math.floor(totalFloor / 3600);
    const m = Math.floor((totalFloor % 3600) / 60);
    const s = totalFloor % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    // Under 30 seconds in count-DOWN mode: show centiseconds (SS.ms)
    // so the user can track the last frantic moments. Above that, whole
    // seconds only — count-up mode never shows ms since it's not
    // conceptually tied to running out of time.
    if (clock.mode === 'down' && ms < 30_000) {
      const cs = Math.floor((ms % 1000) / 10).toString().padStart(2,'0');
      return `${m}:${s.toString().padStart(2,'0')}.${cs}`;
    }
    return `${m}:${s.toString().padStart(2,'0')}`;
  }
  function renderClock() {
    const wEl = document.getElementById('clock-time-w');
    const bEl = document.getElementById('clock-time-b');
    const wSide = document.getElementById('clock-white');
    const bSide = document.getElementById('clock-black');
    const digital = document.getElementById('clock-digital');
    const analog  = document.getElementById('clock-analog');
    if (!wEl || !bEl || !wSide || !bSide) return;
    // Apply style attribute so CSS variants kick in.
    if (digital) digital.dataset.style = clock.style;
    // Toggle digital vs analog visibility.
    const isAnalog = clock.style === 'analog-garde' || clock.style === 'analog-chrome';
    if (digital) digital.hidden = isAnalog;
    if (analog)  analog.hidden  = !isAnalog;

    if (isAnalog) {
      renderAnalogClock();
      return;
    }
    wEl.textContent = formatClockTime(clock.msWhite);
    bEl.textContent = formatClockTime(clock.msBlack);
    [wSide, bSide].forEach(el => el.classList.remove('active', 'low-time', 'critical-time'));
    if (clock.tickingFor === 'w') wSide.classList.add('active');
    if (clock.tickingFor === 'b') bSide.classList.add('active');
    // Low/critical colours only make sense in count-DOWN mode.
    if (clock.mode === 'down') {
      if (clock.msWhite < 30_000 && clock.msWhite > 10_000) wSide.classList.add('low-time');
      if (clock.msBlack < 30_000 && clock.msBlack > 10_000) bSide.classList.add('low-time');
      if (clock.msWhite <= 10_000) wSide.classList.add('critical-time');
      if (clock.msBlack <= 10_000) bSide.classList.add('critical-time');
    }
  }

  // ─── Analog clock renderer (Garde classic + chrome modern) ───────
  // Authentic mechanical-chess-clock behaviour:
  //   - Count-DOWN (timed game): for a 5-minute game, the dial starts
  //     at 11:55 (minute hand 5 ticks BEFORE 12). As the player's time
  //     runs out, the minute hand rotates clockwise toward 12. When it
  //     passes 12 the game is over. A red flag hangs on the minute
  //     hand; it rises as the hand approaches 12 (last ~1 min) and
  //     drops horizontally when time hits 0 ("flag fall").
  //   - Count-UP (untimed): dial starts at 12:00 and the minute hand
  //     sweeps clockwise showing elapsed minutes. No flag.
  //
  // The hour hand sits at 11 o'clock for count-down short games (it
  // wouldn't realistically move in a 5-min game) and at 12 o'clock
  // for count-up. Only the minute hand matters for chess clocks.
  function renderAnalogClock() {
    const svg = document.querySelector('.clock-analog-svg');
    if (!svg) return;
    const isChrome = clock.style === 'analog-chrome';
    const dial = (cx, ms, isActiveDial) => {
      const cy = 80;
      const r  = 68;

      // ── Minute hand position ──
      // Count-down: start at (60 - initialMinutes) — i.e., 55-minute
      // mark for a 5-min game. Hand rotates CW toward 12 as time
      // ticks down.
      // Count-up: hand sweeps from 12 CW as elapsed minutes grow.
      const totalInitialMins = (clock.initialMs || 5 * 60_000) / 60_000;
      const elapsedMins = clock.mode === 'down'
        ? (totalInitialMins - ms / 60_000)       // rises from 0 to totalInitialMins as time runs out
        : (ms / 60_000);                          // rises naturally for count-up
      // Starting offset: for count-down, the hand starts at
      // (60 - totalInitialMins) and rotates toward 60 (= 12).
      const scaleMinutes = 60;                    // full rotation = 60 min
      const startMin = clock.mode === 'down' ? (scaleMinutes - totalInitialMins) : 0;
      const currentMin = (startMin + elapsedMins) % scaleMinutes;
      const minuteAngle = (currentMin / scaleMinutes) * 360;   // 0 = 12, CW positive
      const mRad = (minuteAngle - 90) * Math.PI / 180;
      const mhx = cx + r * 0.82 * Math.cos(mRad);
      const mhy = cy + r * 0.82 * Math.sin(mRad);

      // ── Hour hand ── at 11 o'clock (-30°) for count-down, 12 (0°) for count-up
      const hourAngle = clock.mode === 'down' ? -30 : 0;
      const hRad = (hourAngle - 90) * Math.PI / 180;
      const hhx = cx + r * 0.5 * Math.cos(hRad);
      const hhy = cy + r * 0.5 * Math.sin(hRad);

      // ── Second hand (shows seconds; sweeps each minute) ──
      const secs = (ms / 1000) % 60;
      const sRad = (secs * 6 - 90) * Math.PI / 180;
      const shx = cx + r * 0.88 * Math.cos(sRad);
      const shy = cy + r * 0.88 * Math.sin(sRad);

      // ── Flag (count-down only) ──
      // Flag hangs perpendicular to the minute hand. As the hand gets
      // within the last 60 seconds of total time, the flag rises; at
      // 0 ms the flag is horizontal (fallen).
      let flagSvg = '';
      if (clock.mode === 'down') {
        let flagRise = 0;
        if (ms <= 0) flagRise = 1;
        else if (ms < 60_000) flagRise = 1 - (ms / 60_000);     // 0..1 as ms goes 60_000→0
        // Flag: small red rectangle, base at minute-hand tip, length 10px.
        // Base direction perpendicular to hand (mRad + 90°). As flagRise
        // increases, flag rotates toward hand-direction (mRad).
        const flagLen = 10;
        const flagDirRad = mRad + (Math.PI / 2) * (1 - flagRise);
        const ftx = mhx + flagLen * Math.cos(flagDirRad);
        const fty = mhy + flagLen * Math.sin(flagDirRad);
        flagSvg = `<path d="M ${mhx.toFixed(1)} ${mhy.toFixed(1)} L ${ftx.toFixed(1)} ${fty.toFixed(1)} L ${(ftx - 1).toFixed(1)} ${(fty + 4).toFixed(1)} L ${(mhx - 1).toFixed(1)} ${(mhy + 4).toFixed(1)} Z" fill="#c0392b" stroke="#6a1d13" stroke-width="0.4"/>`;
      }

      // ── Tick marks — every minute; bolder at 5-min (major) marks ──
      let ticks = '';
      for (let i = 0; i < 60; i++) {
        const t = (i * 6 - 90) * Math.PI / 180;
        const isMajor = i % 5 === 0;
        const outR = r - 1;
        const inR  = isMajor ? r - 8 : r - 3.5;
        const x1 = cx + outR * Math.cos(t), y1 = cy + outR * Math.sin(t);
        const x2 = cx + inR  * Math.cos(t), y2 = cy + inR  * Math.sin(t);
        const strokeCol = isChrome ? '#1a1a1a' : '#2a1e14';
        ticks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${strokeCol}" stroke-width="${isMajor ? 2.2 : 0.8}" stroke-linecap="round"/>`;
      }

      // ── Arabic minute numerals every 5 (5..60) plus big Roman at corners ──
      let numerals = '';
      for (let i = 0; i < 12; i++) {
        const label = (i === 0) ? '60' : String(i * 5);
        const ang = (i * 30 - 90) * Math.PI / 180;
        const nx = cx + (r - 14) * Math.cos(ang);
        const ny = cy + (r - 14) * Math.sin(ang) + 3.2;
        const numCol = isChrome ? '#1a1a1a' : '#2a1e14';
        numerals += `<text x="${nx.toFixed(2)}" y="${ny.toFixed(2)}" text-anchor="middle" font-size="9" font-weight="600" font-family="'Helvetica Neue', Arial, sans-serif" fill="${numCol}">${label}</text>`;
      }

      // ── Face + colors ──
      const faceColor = isChrome
        ? (isActiveDial ? '#fafafa' : '#e8e8ea')
        : (isActiveDial ? '#f7e6c1' : '#ebd6a6');
      const rimColor  = isChrome ? '#888' : '#8c6a3a';
      const rimOuter  = isChrome ? '#333' : '#3a2814';
      const handColor = isChrome ? '#0c0c0c' : '#1a0f08';
      const secColor  = '#c83b2f';

      // Sharper rim: a thin bevel + subtle inner ring regardless of theme.
      const bevel = isChrome
        ? `<circle cx="${cx}" cy="${cy}" r="${r - 3}" fill="none" stroke="#bcbcbc" stroke-width="0.6"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${r - 3}" fill="none" stroke="#d5b778" stroke-width="0.6" opacity="0.7"/>`;

      return `
        <g>
          <circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="none" stroke="${rimOuter}" stroke-width="1.4"/>
          <circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="${faceColor}" stroke="${rimColor}" stroke-width="2.6"/>
          ${bevel}
          ${ticks}
          ${numerals}
          <line x1="${cx}" y1="${cy}" x2="${hhx.toFixed(2)}" y2="${hhy.toFixed(2)}" stroke="${handColor}" stroke-width="4.2" stroke-linecap="round"/>
          <line x1="${cx}" y1="${cy}" x2="${mhx.toFixed(2)}" y2="${mhy.toFixed(2)}" stroke="${handColor}" stroke-width="2.8" stroke-linecap="round"/>
          <line x1="${cx}" y1="${cy}" x2="${shx.toFixed(2)}" y2="${shy.toFixed(2)}" stroke="${secColor}" stroke-width="1.2" stroke-linecap="round"/>
          ${flagSvg}
          <circle cx="${cx}" cy="${cy}" r="3.4" fill="${handColor}"/>
          <circle cx="${cx}" cy="${cy}" r="1.3" fill="${secColor}"/>
        </g>`;
    };
    const activeSide = clock.tickingFor;
    // Who is on top vs bottom: in a practice game the user's color
    // goes on the BOTTOM (matches the board orientation: own pieces
    // toward the bottom). Fallback: black on top, white on bottom.
    const userCol = (typeof practiceColor !== 'undefined' && practiceColor) ? practiceColor : 'white';
    const topIsBlack   = (userCol === 'white');
    const leftColor    = topIsBlack ? 'b' : 'w';
    const rightColor   = topIsBlack ? 'w' : 'b';
    const leftMs       = topIsBlack ? clock.msBlack : clock.msWhite;
    const rightMs      = topIsBlack ? clock.msWhite : clock.msBlack;
    // Solid-king label under each dial. Same glyph (♚) for both sides —
    // color distinguishes them: white king = light fill on dark stroke,
    // black king = solid dark fill. No text labels.
    const kingGlyph = (color) => color === 'w'
      ? `<text text-anchor="middle" font-size="22" font-weight="900" font-family="'Segoe UI Symbol','Apple Symbols',serif" fill="#f5f5f5" stroke="#111" stroke-width="0.8" paint-order="stroke">♚</text>`
      : `<text text-anchor="middle" font-size="22" font-weight="900" font-family="'Segoe UI Symbol','Apple Symbols',serif" fill="#111">♚</text>`;
    const glyphAt = (x, color) => kingGlyph(color).replace('<text ', `<text x="${x}" y="158" `);
    svg.innerHTML =
      dial(80,  leftMs,  activeSide === leftColor)  +
      dial(240, rightMs, activeSide === rightColor) +
      glyphAt(80,  leftColor) +
      glyphAt(240, rightColor);
  }
  function startClock(minutes, incrementSec, mode = 'down') {
    clock.active = true;
    clock.mode   = mode;
    clock.initialMs = minutes * 60_000;
    // Count-down starts at initialMs and ticks to zero.
    // Count-up starts at 0 and ticks upward (tracks time used).
    clock.msWhite = mode === 'up' ? 0 : clock.initialMs;
    clock.msBlack = mode === 'up' ? 0 : clock.initialMs;
    clock.incMs   = incrementSec * 1000;
    // Whose clock ticks at start depends on whose actual move it is,
    // NOT a hardcoded 'w'. When the chosen opening ends on White's
    // move (odd half-move count), it's Black to move → Black's clock
    // ticks. Hardcoding 'w' here caused an off-by-one: every subsequent
    // switchClock() just flipped the (wrong) initial side.
    try {
      clock.tickingFor = (board.chess && typeof board.chess.turn === 'function')
        ? board.chess.turn()
        : 'w';
    } catch { clock.tickingFor = 'w'; }
    clock.lastTickAt = Date.now();
    const clockCard = document.getElementById('practice-clock');
    if (clockCard) clockCard.hidden = false;
    const fmt = document.getElementById('clock-format');
    if (fmt) {
      if (mode === 'up') {
        fmt.textContent = incrementSec > 0
          ? `Untimed · ${incrementSec}s increment per move`
          : 'Untimed · tracking time used';
      } else {
        fmt.textContent = `${minutes}+${incrementSec} time control`;
      }
    }
    if (clock.timerId) clearInterval(clock.timerId);
    clock.timerId = setInterval(() => { clockTick(); }, 100);
    renderClock();
  }
  function stopClock() {
    clock.active = false;
    clock.tickingFor = null;
    clock.paused = false;
    if (clock.timerId) { clearInterval(clock.timerId); clock.timerId = 0; }
    renderClock();
    const pauseBtn = document.getElementById('btn-clock-pause');
    if (pauseBtn) { pauseBtn.textContent = '⏸ Pause clock'; pauseBtn.classList.remove('paused'); }
  }
  // Pause: freeze both clocks in place (neither side ticks). Resume
  // continues from the same remaining times. Works in both count-down
  // and count-up modes. While paused, clock.paused = true and the
  // timerId is cleared; switchClock early-exits while paused.
  function togglePauseClock() {
    if (!clock.active) return;
    const btn = document.getElementById('btn-clock-pause');
    if (!clock.paused) {
      clock.paused = true;
      if (clock.timerId) { clearInterval(clock.timerId); clock.timerId = 0; }
      if (btn) { btn.textContent = '▶ Resume clock'; btn.classList.add('paused'); }
    } else {
      clock.paused = false;
      clock.lastTickAt = Date.now();  // don't charge the pause duration
      clock.timerId = setInterval(() => { clockTick(); }, 100);
      if (btn) { btn.textContent = '⏸ Pause clock'; btn.classList.remove('paused'); }
    }
    renderClock();
  }
  function switchClock() {
    if (!clock.active) return;
    if (clock.paused) return;  // paused = neither side advances
    const now = Date.now();
    // Apply increment to the side that JUST moved (current tickingFor
    // before flip). Works in both count-up and count-down modes.
    if (clock.incMs > 0 && clock.tickingFor) {
      if (clock.tickingFor === 'w') clock.msWhite += clock.incMs;
      else                          clock.msBlack += clock.incMs;
    }
    clock.tickingFor = clock.tickingFor === 'w' ? 'b' : 'w';
    clock.lastTickAt = now;
    // Defensive: if the tick interval was cleared somewhere (should
    // not happen but has been reported), restart it so the other
    // side's clock actually ticks.
    if (!clock.timerId) {
      console.warn('[clock] timerId missing — restarting interval');
      // Re-create interval without resetting clocks — easiest path is
      // to call startClock with current state, but that would reset.
      // Inline-restart using the same tick function shape.
      clock.timerId = setInterval(() => { clockTick(); }, 100);
    }
    renderClock();
  }
  // Extracted tick function so it can be restarted if the interval
  // ever gets cleared unexpectedly.
  function clockTick() {
    if (!clock.active || !clock.tickingFor) return;
    if (clock.paused) return;
    const now = Date.now();
    const elapsed = now - clock.lastTickAt;
    clock.lastTickAt = now;
    if (clock.mode === 'down') {
      if (clock.tickingFor === 'w') clock.msWhite = Math.max(0, clock.msWhite - elapsed);
      else                          clock.msBlack = Math.max(0, clock.msBlack - elapsed);
      if (clock.msWhite === 0 || clock.msBlack === 0) {
        const loser = clock.msWhite === 0 ? 'white' : 'black';
        stopClock();
        const resultTag = loser === 'white' ? '0-1' : '1-0';
        const narrative = `${loser === 'white' ? 'White' : 'Black'} ran out of time.`;
        try { finishPracticeGame(resultTag, narrative); } catch {}
      }
    } else {
      if (clock.tickingFor === 'w') clock.msWhite += elapsed;
      else                          clock.msBlack += elapsed;
    }
    renderClock();
  }
  window.__clock         = clock;
  window.__clockStart    = startClock;
  window.__clockStop     = stopClock;
  window.__clockSwitch   = switchClock;
  // Bind the move listener once; it fires for user moves (from
  // board.play), engine moves (from playEngineMove), and bulk fen
  // loads (from playUciMoves). We need to distinguish the last case
  // — bulk fen loads should NOT flip the clock. Use the detail.bulk
  // flag that board.js sets on those events.
  board.addEventListener('move', (ev) => {
    if (!clock.active) return;
    if (ev?.detail?.bulk) return;  // position-replay event, not a real move
    switchClock();
  });

  // Clock style switcher — persists the choice to localStorage and
  // re-renders immediately so the user sees the chosen skin.
  (() => {
    const switcher = document.getElementById('clock-style-switcher');
    if (!switcher) return;
    const applyActive = () => {
      switcher.querySelectorAll('.clock-style-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === clock.style);
      });
      renderClock();
    };
    switcher.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.clock-style-btn');
      if (!btn) return;
      clock.style = btn.dataset.style;
      try { localStorage.setItem('stockfish-explain.clock-style', clock.style); } catch {}
      applyActive();
    });
    applyActive();
  })();

  // Untimed-increment enable toggle — enables the seconds input.
  (() => {
    const toggle = document.getElementById('practice-untimed-increment-on');
    const input  = document.getElementById('practice-untimed-increment');
    if (!toggle || !input) return;
    const apply = () => { input.disabled = !toggle.checked; };
    toggle.addEventListener('change', apply);
    apply();
  })();

  // ─── Opponent-style persona move selector (#18) ─────────────────
  // Given the engine's MultiPV top candidates, score each by how well
  // it matches the chosen persona's taste, then pick the best match.
  // When |score(#1) - score(pickedByStyle)| is small the personas feel
  // distinctive without making the engine visibly weaker.
  function pickMoveByStyle(topMoves, style, chessNow, fallbackUci) {
    if (!topMoves || topMoves.length <= 1 || style === 'default') return fallbackUci;
    // Reject candidates that are dramatically worse than #1 (≥80 cp)
    // so style never turns into blunder-therapy.
    const best = topMoves[0];
    if (!best || best.scoreKind == null) return fallbackUci;
    const bestScore = best.scoreKind === 'cp' ? best.score : (best.score > 0 ? 10000 : -10000);
    const candidates = topMoves.filter(t => {
      if (t === best) return true;
      if (t.scoreKind == null || !t.pv || !t.pv.length) return false;
      const s = t.scoreKind === 'cp' ? t.score : (t.score > 0 ? 10000 : -10000);
      return bestScore - s <= 80; // within ~0.8 pawn of #1
    });
    if (candidates.length === 1) return fallbackUci;
    const scored = candidates.map(c => ({
      move: c,
      score: scoreCandidateForStyle(c, style, chessNow),
    }));
    scored.sort((a, b) => b.score - a.score + (Math.random() - 0.5) * 0.001);
    const winnerUci = scored[0].move.pv ? scored[0].move.pv[0] : fallbackUci;
    return winnerUci || fallbackUci;
  }
  // Return a style-bias score. Higher = better fit for this persona.
  // Uses cheap features: move metadata (chess.js Move object), target
  // square, whether it's a capture / check / promotion / centre move.
  function scoreCandidateForStyle(candidate, style, chessNowBefore) {
    const uci = candidate.pv && candidate.pv[0];
    if (!uci) return -Infinity;
    let moveObj = null;
    try {
      const probe = new Chess(chessNowBefore.fen());
      moveObj = probe.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
    } catch {}
    if (!moveObj) return -Infinity;
    const flags = moveObj.flags || '';
    const isCapture  = flags.includes('c') || flags.includes('e');
    const isCheck    = moveObj.san?.includes('+');
    const isMate     = moveObj.san?.includes('#');
    const isPromo    = flags.includes('p');
    const isCastle   = flags.includes('k') || flags.includes('q');
    const toFile     = moveObj.to.charCodeAt(0) - 97;
    const toRank     = parseInt(moveObj.to[1], 10) - 1;
    const centreDist = Math.max(Math.abs(toFile - 3.5), Math.abs(toRank - 3.5));
    const piece      = moveObj.piece;
    const isPawn     = piece === 'p';
    const isQueen    = piece === 'q';
    // Per-style weights.
    switch (style) {
      case 'karpov':
        // Slow and solid. Prefers quiet developing moves, avoids
        // sacrifices and unnecessary captures.
        return (!isCapture ? 1 : -0.5)
             + (isCastle ? 1.5 : 0)
             + (isCheck && !isMate ? -0.3 : 0)
             + (centreDist < 2 ? 0.4 : 0)
             + (isPawn && toRank < 4 && toRank > 2 ? 0.3 : 0);
      case 'tal':
        // Sacrificial, loves captures and checks especially to enemy
        // king zone. Penalises dull pawn moves.
        return (isCapture ? 1.5 : 0)
             + (isCheck ? 2 : 0)
             + (isMate ? 10 : 0)
             + (isPawn && !isCapture ? -0.5 : 0)
             + (piece === 'n' || piece === 'b' ? 0.3 : 0);
      case 'aronian':
        // Sharp tactical, likes forcing moves but more balanced than
        // Tal — rewards pins, forks, central pressure.
        return (isCapture ? 0.7 : 0)
             + (isCheck ? 0.8 : 0)
             + (isMate ? 10 : 0)
             + (centreDist < 2 ? 0.4 : 0)
             + (piece === 'n' || piece === 'b' ? 0.2 : 0);
      case 'capablanca':
        // Endgame-minded. Rewards trades, avoids complications, likes
        // piece coordination.
        return (isCapture ? 1.2 : 0)
             + (isCastle ? 1 : 0)
             + (isCheck && !isMate ? -0.4 : 0)
             + (isPromo ? 1.5 : 0)
             + (isQueen && !isCapture ? -0.3 : 0);
      case 'kasparov':
        // Aggressive centre + attack. Rewards central pushes, piece
        // activity, castling early, tactical shots.
        return (isCapture ? 0.8 : 0)
             + (isCheck ? 1.2 : 0)
             + (isMate ? 10 : 0)
             + (centreDist < 2 ? 1 : 0)
             + (isCastle ? 0.6 : 0);
      default:
        return 0;
    }
  }

  // ─── Per-ply eval capture (feeds the game archive) ────────────────
  // Whenever Stockfish reports info at the live FEN, cache the latest
  // (deepest) cp/mate evaluation keyed by that FEN. At game-end we
  // collate these into the archive's plies[] array so downstream
  // features (eval timeline, mistake bank) have per-move data to read
  // without needing to re-analyse the whole game.
  const fenEvalCache = new Map(); // FEN → { cpWhite, mate, depth }
  function captureEngineThinkingEval() {
    try {
      const live = engine && engine.history && engine.history.length
        ? engine.history[engine.history.length - 1] : null;
      if (!live) return;
      // CRITICAL: use the FEN the engine is actually searching, NOT the
      // live board FEN. Otherwise when the user moves mid-search, we
      // pair a position-A eval with position-B's FEN and the timeline
      // goes wild. engine.currentFen is set when the search starts.
      const fen = engine.currentFen || board.chess.fen();
      const stm = fen.split(' ')[1] === 'w' ? 1 : -1;
      const cpWhite = live.scoreKind === 'cp' ? stm * live.score : null;
      const mate    = live.scoreKind === 'mate' ? stm * live.score : null;
      const existing = fenEvalCache.get(fen);
      // Only overwrite if this event is from a deeper (or equal) depth.
      // Protects the cache from being clobbered by a shallow probe
      // immediately after a deep analysis.
      if (existing && existing.depth != null && live.depth < existing.depth) return;
      fenEvalCache.set(fen, { cpWhite, mate, depth: live.depth });
      // Bonus: also hydrate cache with evals for the RESULTING positions
      // of each MultiPV candidate move. Stockfish's per-candidate score
      // IS the eval after that move is played (from root STM's POV). This
      // means every engine thinking event fills in evals for up to N
      // neighbouring plies — enough to classify the user's own moves in
      // practice mode without a retrospective sweep. Directly addresses
      // user report: 'why are accuracy pills blank during practice'.
      try {
        const topMoves = Array.from(engine.topMoves?.values?.() || []);
        if (topMoves.length > 0) {
          for (const mv of topMoves) {
            if (!mv.pv || !mv.pv.length) continue;
            const tmp = new Chess(fen);
            const uci = mv.pv[0];
            const played = tmp.move({
              from: uci.slice(0, 2),
              to:   uci.slice(2, 4),
              promotion: uci.slice(4) || undefined,
            });
            if (!played) continue;
            const resultFen = tmp.fen();
            const mvCpWhite = mv.scoreKind === 'cp' ? stm * mv.score : null;
            const mvMate    = mv.scoreKind === 'mate' ? stm * mv.score : null;
            const prev = fenEvalCache.get(resultFen);
            if (!prev || (prev.depth != null && mv.depth >= prev.depth)) {
              fenEvalCache.set(resultFen, { cpWhite: mvCpWhite, mate: mvMate, depth: mv.depth });
            }
          }
        }
      } catch {}
      if (fenEvalCache.size > 500) {
        const first = fenEvalCache.keys().next().value;
        fenEvalCache.delete(first);
      }
    } catch {}
  }

  // ─── Auto-save draft ─────────────────────────────────────────────
  // Persist the current in-progress game (practice OR analysis) on every
  // move so a closed tab / refresh doesn't wipe it out. Throttled to
  // once per 800ms. Saves: FEN + full PGN + starting FEN + practice
  // metadata. Restored with a prompt on next page load if present.
  const DRAFT_KEY = 'stockfish-explain.draft-game';
  let draftSaveTimer = 0;
  function scheduleDraftSave() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = 0;
      try {
        // Only save if there's actual content to save.
        const hist = board.chess.history();
        if (!hist.length) { localStorage.removeItem(DRAFT_KEY); return; }
        const draft = {
          savedAt:      Date.now(),
          pgn:          board.tree.pgn(),
          startingFen:  board.startingFen,
          fen:          board.fen(),
          orientation:  board.orientation,
          practiceColor,
          practiceFinished: document.body.classList.contains('practice-finished'),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch (err) { console.warn('[draft] save failed', err); }
    }, 800);
  }
  function clearDraft() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  }
  function maybeRestoreDraft() {
    let draft;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return; }
    if (!draft || !draft.pgn) return;
    // Drafts older than 24h are stale — discard silently instead of
    // restoring. Fresh drafts auto-restore with no prompt (user found
    // the modal annoying on every reload; "New game" button + 📚 My
    // Games archive both still work for starting fresh).
    const age = Math.max(0, Date.now() - (draft.savedAt || 0));
    const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    if (age > DRAFT_MAX_AGE_MS) { clearDraft(); return; }
    try {
      board.newGame();
      if (draft.startingFen && draft.startingFen !== board.startingFen) {
        board.chess.load(draft.startingFen);
        board.startingFen = draft.startingFen;
      }
      // Replay the moves from the PGN body — tree.pgn() writes SAN moves
      // after the tag block. Parse the move text and play each.
      const pgnBody = (draft.pgn.split('\n\n').slice(-1)[0] || '').replace(/\{[^}]*\}/g, '').replace(/\([^)]*\)/g, '').trim();
      const sanTokens = pgnBody
        .split(/\s+/)
        .filter(t => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
      for (const san of sanTokens) {
        try { board.chess.move(san, { sloppy: true }); } catch {}
      }
      // Hard re-render
      board.cg.set({ fen: board.chess.fen(), turnColor: board.chess.turn() === 'w' ? 'white' : 'black' });
      if (draft.orientation && draft.orientation !== board.orientation) board.flipBoard();
      if (draft.practiceColor) {
        practiceColor = draft.practiceColor;
        document.body.classList.add('practice-mode');
        if (draft.practiceFinished) document.body.classList.add('practice-finished');
        const pActions = document.getElementById('practice-actions');
        if (pActions) pActions.hidden = false;
        const pLive = document.getElementById('practice-live');
        const pOver = document.getElementById('practice-over');
        if (pLive) pLive.hidden = !!draft.practiceFinished;
        if (pOver) pOver.hidden = !draft.practiceFinished;
      }
      board.dispatchEvent(new CustomEvent('move'));
    } catch (err) {
      console.warn('[draft] restore failed', err);
      clearDraft();
    }
  }
  // Restore on first paint, after the main() setup has finished
  // populating board + UI.
  setTimeout(maybeRestoreDraft, 150);

  // ─── Eval timeline (#1) ─────────────────────────────────────────
  // Throttled SVG re-render whenever the game state or cached evals
  // change. Draws one point per ply with click-to-navigate, colours
  // blunders/mistakes/inaccuracies. Compact and always-visible below
  // the board once at least one move has been played.
  let timelineTimer = 0;
  function scheduleTimelineRender() {
    if (timelineTimer) return;
    timelineTimer = setTimeout(() => {
      timelineTimer = 0;
      renderEvalTimeline();
    }, 60);
  }
  function collectTimelinePlies() {
    // Replay the mainline from startingFen, harvesting each ply's FEN
    // and the cached engine eval for that FEN (if any).
    const history = board.chess.history({ verbose: true });
    if (!history.length) return [];
    const replay = new Chess(board.startingFen);
    // Starting position is ply 0 — record it so the line extends from
    // the baseline rather than starting at move 1.
    const plies = [];
    const startEval = fenEvalCache.get(board.startingFen);
    plies.push({
      ply:     0,
      san:     'start',
      fen:     board.startingFen,
      cpWhite: startEval?.cpWhite ?? 0,
      mate:    startEval?.mate ?? null,
    });
    for (let i = 0; i < history.length; i++) {
      const res = replay.move(history[i].san, { sloppy: true });
      if (!res) break;
      const fen = replay.fen();
      const ev = fenEvalCache.get(fen);
      plies.push({
        ply:     i + 1,
        san:     history[i].san,
        fen,
        cpWhite: ev?.cpWhite ?? null,
        mate:    ev?.mate ?? null,
      });
    }
    return plies;
  }
  function classifySeverityForPly(prev, cur) {
    if (!prev || cur.cpWhite == null || prev.cpWhite == null) return null;
    // POV of the side that just moved = opposite of side-to-move AFTER
    // the move. fen.split(' ')[1] gives side to move after. Flip it.
    const stmAfter = cur.fen.split(' ')[1] || 'w';
    const moverSign = stmAfter === 'w' ? -1 : 1; // mover was black if stmAfter=w
    const cpBeforeMover = moverSign * prev.cpWhite;
    const cpAfterMover  = moverSign * cur.cpWhite;
    const drop = cpBeforeMover - cpAfterMover;
    if (drop >= 200) return 'blunder';
    if (drop >= 100) return 'mistake';
    if (drop >=  50) return 'inaccuracy';
    return null;
  }
  // Convert cp (White POV) to a normalised "win-probability" value in
  // (-1..+1). Uses tanh(cp/450) which is Lichess-like: small cp deltas
  // in the ±100 range are already visible (~22%), a decisive ±500 hits
  // ~76%, mate forces to the extreme. Smoother and more readable than
  // sigmoid at extremes.
  function cpToNormal(cpWhite, mate) {
    if (mate != null) return mate > 0 ? 1 : -1;
    if (cpWhite == null) return null;
    return Math.tanh(cpWhite / 450);
  }
  function cpToY(cpWhite, mate) {
    const n = cpToNormal(cpWhite, mate);
    if (n == null) return null;
    return 50 - n * 45;  // y=50 is equal; up = White better
  }
  function renderEvalTimeline() {
    const root = document.getElementById('eval-timeline');
    const svg  = document.getElementById('eval-timeline-svg');
    const stats = document.getElementById('eval-timeline-stats');
    if (!root || !svg) return;
    // Default: eval timeline stays hidden unless user has explicitly
    // opted in (userHidden === 'shown'). Accuracy pills carry the
    // timeline signal in a denser/cleaner form; the line chart was
    // cluttering the view for most users. Toggle via the Panels menu.
    const userSetting = root.dataset.userHidden;
    if (userSetting !== 'shown') { root.hidden = true; return; }
    const plies = collectTimelinePlies();
    if (plies.length < 2) { root.hidden = true; return; }
    root.hidden = false;

    const W = 600, H = 100;
    const leftPad = 0, rightPad = 0;
    const span = W - leftPad - rightPad;
    const stepX = plies.length > 1 ? span / (plies.length - 1) : span;

    const pts = plies.map((p, i) => {
      const y = cpToY(p.cpWhite, p.mate);
      return { x: leftPad + i * stepX, y, p, i };
    });

    // Split into null/non-null segments so gaps in data don't connect.
    const segments = [];
    let cur = [];
    for (const pt of pts) {
      if (pt.y == null) { if (cur.length) { segments.push(cur); cur = []; } continue; }
      cur.push(pt);
    }
    if (cur.length) segments.push(cur);

    // BIDIRECTIONAL FILL (Lichess-style).
    // We build two polygons per segment:
    //   • White fill: the polygon bounded by (line clamped to y<=50)
    //     on top and the zero-line at y=50 on the bottom.
    //   • Black fill: the polygon bounded by the zero-line on top and
    //     (line clamped to y>=50) on the bottom.
    // Each segment's path clamps the opposite half so the fills never
    // overlap. Result: white territory below zero is shaded pale, black
    // territory above zero is shaded dark. The line crosses zero where
    // the eval flips.
    const buildFills = (seg) => {
      if (seg.length < 2) return '';
      const first = seg[0], last = seg[seg.length - 1];
      // WHITE FILL — clamp y>50 to 50 (so white's area only extends up
      // to the zero baseline when black is better).
      const whiteLine = seg.map(p => `${p.x.toFixed(1)},${Math.min(50, p.y).toFixed(1)}`).join(' ');
      const whitePoly = `<polygon class="eval-area-white" points="${first.x.toFixed(1)},50 ${whiteLine} ${last.x.toFixed(1)},50"/>`;
      // BLACK FILL — clamp y<50 to 50.
      const blackLine = seg.map(p => `${p.x.toFixed(1)},${Math.max(50, p.y).toFixed(1)}`).join(' ');
      const blackPoly = `<polygon class="eval-area-black" points="${first.x.toFixed(1)},50 ${blackLine} ${last.x.toFixed(1)},50"/>`;
      return whitePoly + blackPoly;
    };
    const fillPaths = segments.map(buildFills).join('');
    const linePaths = segments.map(seg =>
      `<polyline class="eval-line" points="${seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>`
    ).join('');

    // MISTAKE DOTS — placed ABOVE the line for white's mistakes and
    // BELOW for black's mistakes so both are always visible against
    // the fill colours, Lichess-style.
    let dotsSvg = '';
    let countB = 0, countM = 0, countI = 0;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1].p, cur2 = pts[i].p;
      const sev = classifySeverityForPly(prev, cur2);
      if (!sev) continue;
      if (sev === 'blunder') countB++; else if (sev === 'mistake') countM++; else countI++;
      const pt = pts[i];
      if (pt.y == null) continue;
      // Which colour moved? stm AFTER = opposite of mover. If mover=w,
      // put dot above (y-6); if mover=b, put dot below (y+6).
      const stmAfter = cur2.fen.split(' ')[1] || 'w';
      const moverIsWhite = stmAfter === 'b';
      const dy = moverIsWhite ? -6 : 6;
      dotsSvg += `<circle class="eval-dot ${sev}" cx="${pt.x.toFixed(1)}" cy="${(pt.y + dy).toFixed(1)}" r="3" data-ply="${pt.p.ply}"><title>Ply ${pt.p.ply} (${pt.p.san}): ${sev} — eval ${((prev.cpWhite ?? 0) / 100).toFixed(2)} → ${((cur2.cpWhite ?? 0) / 100).toFixed(2)} (White POV)</title></circle>`;
    }

    // Current-ply cursor.
    let cursorSvg = '';
    const curIdx = board.viewPly == null ? pts.length - 1 : Math.min(pts.length - 1, board.viewPly + 1);
    const cx = pts[curIdx]?.x;
    if (cx != null) {
      cursorSvg = `<line class="eval-cursor" x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="0" y2="${H}"/>`;
    }

    svg.innerHTML =
      `<line class="eval-zero" x1="0" x2="${W}" y1="50" y2="50"/>` +
      fillPaths + linePaths + dotsSvg + cursorSvg;

    stats.textContent = plies.length > 1
      ? `${plies.length - 1} moves · ${countB ? countB + ' blunders · ' : ''}${countM ? countM + ' mistakes · ' : ''}${countI ? countI + ' inaccuracies · ' : ''}click to jump`
      : '';

    // Click handler — jump to the clicked ply.
    svg.onclick = (ev) => {
      const rect = svg.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width * W;
      // Find closest point.
      let bestI = 0, bestDist = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.abs(pts[i].x - x);
        if (d < bestDist) { bestDist = d; bestI = i; }
      }
      const targetPly = pts[bestI].p.ply;
      // Navigate to that ply in the mainline. board.goToPly(null) = live.
      if (board.goToPly) board.goToPly(targetPly === 0 ? 0 : targetPly);
    };
  }
  // Also re-render on nav (arrow keys / move-list clicks) so the cursor
  // line tracks the currently-viewed ply.
  board.addEventListener('nav', scheduleTimelineRender);

  // ─── Pawn-structure evolution strip (#5) ────────────────────────
  // Samples the mainline every N plies, extracts the pawn skeleton,
  // and highlights archetype transitions (IQP / Carlsbad / Hanging /
  // Maroczy detected via archetype.js). Click a cell to jump there.
  function renderPawnStrip() {
    const root  = document.getElementById('pawn-strip');
    const rowEl = document.getElementById('pawn-strip-row');
    const stats = document.getElementById('pawn-strip-stats');
    if (!root || !rowEl) return;
    // Default hidden — opt in via Panels menu (same pattern as eval
    // timeline). Many games don't need this view and it crowds the
    // side column.
    const userSetting = root.dataset.userHidden;
    if (userSetting !== 'shown') { root.hidden = true; return; }
    const plies = collectTimelinePlies();
    if (plies.length < 4) { root.hidden = true; return; }
    root.hidden = false;

    // Sample every 4 plies (so a 40-ply game gets 10 cells) and always
    // include start + end for bookends.
    const STEP = 4;
    const sampleIndices = [];
    for (let i = 0; i < plies.length; i += STEP) sampleIndices.push(i);
    if (sampleIndices[sampleIndices.length - 1] !== plies.length - 1) {
      sampleIndices.push(plies.length - 1);
    }

    // For each sampled ply: extract pawn-only grid + run archetype detector.
    let lastArch = null;
    let archTransitions = 0;
    const cellsHtml = sampleIndices.map((idx) => {
      const p = plies[idx];
      const grid = pawnGridFromFen(p.fen);
      let archLabel = '';
      let archChanged = false;
      try {
        // Lazy-import via already-imported archetype.js would be nicer,
        // but we already pull detectArchetype from coach_v2 context.
        // Keep it simple: re-compute here with a local cache keyed by fen.
        const a = detectArchetypeCached(p.fen);
        if (a && a.label) archLabel = a.label;
        if (archLabel !== lastArch) {
          if (lastArch != null) archChanged = true;
          archTransitions += lastArch != null ? 1 : 0;
          lastArch = archLabel;
        }
      } catch {}
      const currentPly = board.viewPly == null
        ? plies.length - 1
        : Math.min(plies.length - 1, board.viewPly);
      const isCurrent = idx === currentPly;
      const classes = ['pawn-strip-cell'];
      if (archChanged)  classes.push('archetype-change');
      if (isCurrent)    classes.push('current-ply');
      return `<div class="${classes.join(' ')}" data-ply="${p.ply}" title="Ply ${p.ply}${archLabel ? ' — ' + archLabel : ''}">
        <div class="pawn-grid">${grid}</div>
        <div class="pawn-label">${p.ply === 0 ? 'start' : 'm' + Math.ceil(p.ply / 2)}</div>
        <div class="pawn-arch">${archLabel || ''}</div>
      </div>`;
    }).join('');
    rowEl.innerHTML = cellsHtml;
    stats.textContent = archTransitions
      ? `${sampleIndices.length} snapshots · ${archTransitions} archetype shift${archTransitions === 1 ? '' : 's'}`
      : `${sampleIndices.length} snapshots`;
    // Click → jump to that ply.
    rowEl.onclick = (ev) => {
      const cell = ev.target.closest('.pawn-strip-cell');
      if (!cell) return;
      const ply = +cell.dataset.ply;
      if (board.goToPly) board.goToPly(ply === 0 ? 0 : ply);
    };
  }

  // Helper — build an 8×8 HTML grid of pawn-only squares from a FEN.
  function pawnGridFromFen(fen) {
    const board64 = fen.split(' ')[0];
    const rows = board64.split('/');
    const cells = [];
    for (const row of rows) {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++) cells.push('<div></div>'); file += +ch; continue; }
        if (ch === 'P')       cells.push('<div class="pw"></div>');
        else if (ch === 'p')  cells.push('<div class="pb"></div>');
        else                  cells.push('<div></div>');
        file++;
      }
    }
    return cells.join('');
  }

  // Archetype cache — re-running detection per FEN on every move event
  // is wasteful. Memoise here (bounded to 200 entries).
  const archetypeCache = new Map();
  function detectArchetypeCached(fen) {
    if (archetypeCache.has(fen)) return archetypeCache.get(fen);
    let a = null;
    try {
      // Use the positional-coach module which re-exports archetype.
      const ar = CoachV2.coachReport(fen, { topMoves: [] });
      a = ar && ar.archetype ? ar.archetype : null;
    } catch {}
    if (archetypeCache.size > 200) {
      archetypeCache.delete(archetypeCache.keys().next().value);
    }
    archetypeCache.set(fen, a);
    return a;
  }

  // Re-render pawn strip alongside the eval timeline on every move /
  // nav / engine event. Using its own listeners avoids touching the
  // function declaration of scheduleTimelineRender.
  let pawnStripTimer = 0;
  function schedulePawnStripRender() {
    if (pawnStripTimer) return;
    pawnStripTimer = setTimeout(() => { pawnStripTimer = 0; renderPawnStrip(); }, 150);
  }
  board.addEventListener('move',     schedulePawnStripRender);
  board.addEventListener('new-game', schedulePawnStripRender);
  board.addEventListener('nav',      schedulePawnStripRender);
  setTimeout(renderPawnStrip, 250);

  // ─── Per-ply accuracy pills (replaces the old king-safety chart) ───
  // One tiny coloured square per move, graded by how much the mover
  // dropped in eval (from their own POV). Six bins:
  //   blunder  — drop ≥ 200 cp       (red)
  //   mistake  — drop 100-199        (rose)
  //   inacc    — drop 50-99          (orange)
  //   ok       — drop 20-49          (yellow)
  //   good     — drop 0-19           (lime)
  //   best     — drop ≤ 0 (SF agrees or improved)  (green)
  // More compact and actionable than the king-safety SVG — matches
  // Lichess's move-classification vocabulary.
  function classifyAccuracy(prev, cur) {
    if (!prev || prev.cpWhite == null || cur.cpWhite == null) return 'unknown';
    // POV of the side that moved = opposite of side-to-move AFTER.
    const stmAfter = cur.fen.split(' ')[1] || 'w';
    const moverSign = stmAfter === 'w' ? -1 : 1;
    const cpBeforeMover = moverSign * prev.cpWhite;
    const cpAfterMover  = moverSign * cur.cpWhite;
    const drop = cpBeforeMover - cpAfterMover;
    if (drop >= 200) return 'blunder';
    if (drop >= 100) return 'mistake';
    if (drop >=  50) return 'inaccuracy';
    if (drop >=  20) return 'ok';
    if (drop >=   0) return 'good';
    return 'best';
  }
  function renderAccuracyStrip() {
    const root = document.getElementById('accuracy-strip');
    const container = document.getElementById('accuracy-pills');
    const stats = document.getElementById('accuracy-stats');
    if (!root || !container) return;
    if (root.dataset.userHidden) { root.hidden = true; return; }
    const plies = collectTimelinePlies();
    if (plies.length < 3) { root.hidden = true; return; }
    root.hidden = false;

    const pills = [];
    const counts = { best: 0, good: 0, ok: 0, inaccuracy: 0, mistake: 0, blunder: 0, unknown: 0 };
    const curViewPly = board.viewPly == null ? plies.length - 1 : Math.min(plies.length - 1, board.viewPly);
    for (let i = 1; i < plies.length; i++) {
      const prev = plies[i - 1], cur = plies[i];
      const q = classifyAccuracy(prev, cur);
      counts[q] = (counts[q] || 0) + 1;
      const stmAfter = cur.fen.split(' ')[1] || 'w';
      const moverIsWhite = stmAfter === 'b';
      const isCurrent = i === curViewPly;
      const move = `${Math.ceil(cur.ply/2)}${cur.ply%2===1?'.':'...'} ${cur.san}`;
      const evalStr = prev.cpWhite != null && cur.cpWhite != null
        ? `${((prev.cpWhite ?? 0) / 100).toFixed(2)} → ${((cur.cpWhite ?? 0) / 100).toFixed(2)}`
        : 'eval unavailable';
      pills.push(
        `<div class="acc-pill acc-${q}${isCurrent ? ' current' : ''}" data-ply="${cur.ply}"` +
        ` title="${move} · ${moverIsWhite ? 'White' : 'Black'} · ${q} · ${evalStr} (White POV)"></div>`
      );
    }
    container.innerHTML = pills.join('');
    const decisiveCount = counts.blunder + counts.mistake;
    stats.textContent =
      `${plies.length - 1} moves · ${counts.best + counts.good} best/good · ` +
      `${counts.inaccuracy} inaccuracies · ${counts.mistake} mistakes · ${counts.blunder} blunders` +
      (counts.unknown ? ` · ${counts.unknown} unanalysed` : '');

    // Click a pill → jump to that ply.
    container.onclick = (ev) => {
      const pill = ev.target.closest('.acc-pill');
      if (!pill) return;
      const ply = +pill.dataset.ply;
      if (board.goToPly) board.goToPly(ply);
    };
  }
  let accuracyTimer = 0;
  function scheduleAccuracyRender() {
    if (accuracyTimer) return;
    accuracyTimer = setTimeout(() => { accuracyTimer = 0; renderAccuracyStrip(); }, 120);
  }
  board.addEventListener('move',     scheduleAccuracyRender);
  board.addEventListener('new-game', scheduleAccuracyRender);
  board.addEventListener('nav',      scheduleAccuracyRender);
  setTimeout(renderAccuracyStrip, 300);

  // Back-compat stub so the panel-toggle code that references the old
  // king-safety scheduler doesn't crash. Renamed callers will still
  // fire this alongside the accuracy renderer.
  function scheduleKingSafetyRender() { scheduleAccuracyRender(); }

  // ─── Panel hide/show (per-panel ✕ + header 👁 Panels menu) ─────────
  const PANEL_HIDE_KEY = 'stockfish-explain.panel-hidden';
  const loadHiddenPanels = () => {
    try { return JSON.parse(localStorage.getItem(PANEL_HIDE_KEY) || '{}'); }
    catch { return {}; }
  };
  const saveHiddenPanels = (obj) => {
    try { localStorage.setItem(PANEL_HIDE_KEY, JSON.stringify(obj)); } catch {}
  };
  const applyHiddenPanels = () => {
    const hidden = loadHiddenPanels();
    for (const id of ['eval-timeline', 'accuracy-strip', 'pawn-strip']) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (hidden[id]) { el.dataset.userHidden = '1'; el.hidden = true; }
      else            { delete el.dataset.userHidden; /* let renderer control .hidden */ }
    }
  };
  applyHiddenPanels();

  // Per-panel ✕ button
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.panel-hide-btn');
    if (!btn) return;
    const id = btn.dataset.panel;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    const hidden = loadHiddenPanels();
    hidden[id] = true;
    saveHiddenPanels(hidden);
    el.dataset.userHidden = '1';
    el.hidden = true;
  });

  // Header 👁 Panels button — toggle menu of hidden panels to unhide
  const panelsBtn = document.getElementById('btn-panels');
  if (panelsBtn) panelsBtn.addEventListener('click', () => {
    const hidden = loadHiddenPanels();
    const hiddenIds = Object.keys(hidden).filter(k => hidden[k]);
    const all = [
      { id: 'eval-timeline',     label: '📈 Eval timeline' },
      { id: 'accuracy-strip',    label: '🎯 Move accuracy' },
      { id: 'pawn-strip',        label: '♟ Pawn structure' },
    ];
    const popup = document.createElement('div');
    popup.className = 'modal';
    popup.style.zIndex = '99999';
    popup.innerHTML = `<div class="modal-card" style="max-width:380px;">
      <button class="modal-close" id="panels-popup-close">×</button>
      <h3>👁 Panels</h3>
      <p class="muted" style="font-size:12px;">Toggle which analysis panels appear below the board.</p>
      ${all.map(a => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:13px;">
        <input type="checkbox" data-panel-toggle="${a.id}" ${hidden[a.id] ? '' : 'checked'}>
        <span>${a.label}</span>
      </label>`).join('')}
      <p class="muted" style="font-size:11px;margin-top:10px;">Each panel also has a <strong>✕</strong> button in its own header for quick hiding.</p>
    </div>`;
    document.body.appendChild(popup);
    popup.hidden = false;
    const close = () => popup.remove();
    popup.addEventListener('click', (e) => { if (e.target === popup) close(); });
    popup.querySelector('#panels-popup-close').addEventListener('click', close);
    popup.querySelectorAll('input[data-panel-toggle]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.panelToggle;
        const h = loadHiddenPanels();
        if (cb.checked) {
          delete h[id];
          const el = document.getElementById(id);
          if (el) { delete el.dataset.userHidden; }
          // Trigger a re-render so it shows if the game has enough data.
          scheduleTimelineRender();
          schedulePawnStripRender();
          scheduleKingSafetyRender();
        } else {
          h[id] = true;
          const el = document.getElementById(id);
          if (el) { el.dataset.userHidden = '1'; el.hidden = true; }
        }
        saveHiddenPanels(h);
      });
    });
  });

  // ─── Piece-activity heat map (#7) — REMOVED (not useful) ───────
  // Heat map intentionally removed — it ended up being noisy rather
  // than informative, because attack-count per square is dominated by
  // pieces that sit still, not by meaningful control swings.
  // Initial render in case a draft was restored.
  setTimeout(scheduleTimelineRender, 200);

  // ─── Retrospective sweep ─────────────────────────────────────────
  // Walks the mainline and probes any ply whose fenEvalCache entry
  // is missing OR shallower than `minDepth`. Populates the cache so
  // deriveMistakes() can classify swings on every move — the key fix
  // for the empty-mistake-bank bug: user moves in practice were
  // never evaluated before, so every other ply had cpWhite: null.
  let sweepRunning = false;
  async function retrospectiveSweep({ minDepth = 12, onProgress } = {}) {
    if (sweepRunning) return false;
    sweepRunning = true;
    // Snapshot the live engine state + mute flag so we can restore.
    const wasMuted = window.__engineMuted === true;
    window.__engineMuted = true;          // silence UI during sweep
    try { engine.stop(); } catch {}
    try {
      const history = board.chess.history({ verbose: true });
      if (!history.length) return false;
      const replay = new Chess(board.startingFen);
      const targets = [];
      // Starting position + every post-move FEN
      targets.push({ fen: board.startingFen, label: 'start' });
      for (const mv of history) {
        const res = replay.move(mv.san, { sloppy: true });
        if (!res) break;
        targets.push({ fen: replay.fen(), label: mv.san });
      }
      let done = 0;
      for (const t of targets) {
        const existing = fenEvalCache.get(t.fen);
        if (existing && existing.depth != null && existing.depth >= minDepth) {
          done++;
          if (onProgress) onProgress(done, targets.length);
          continue;
        }
        // Quick probe at minDepth. AICoach.probeEngine returns { lines },
        // and our piggybacked 'thinking' listener will populate the cache.
        try { await AICoach.probeEngine(engine, t.fen, minDepth, 1); }
        catch (err) { console.warn('[sweep] probe failed', t.fen, err); }
        done++;
        if (onProgress) onProgress(done, targets.length);
      }
      return true;
    } finally {
      sweepRunning = false;
      window.__engineMuted = wasMuted;
      // Resume live analysis (user is looking at the current position).
      try { fireAnalysis(); } catch {}
    }
  }

  // ─── Archive a completed game ─────────────────────────────────────
  // Replays the game tree to harvest each ply's FEN + cached engine
  // eval from fenEvalCache. Tolerates missing cache entries (stores
  // cpWhite: null for those plies).
  function archiveCurrentGame({ result, ending, mode }) {
    const history = board.chess.history({ verbose: true });
    if (!history.length) return false;
    // Walk the starting FEN forward, applying each SAN, collecting per-
    // ply records. We prefer FENs from fenEvalCache — if a position was
    // never evaluated, cpWhite stays null.
    const replay = new Chess(board.startingFen);
    const plies = [];
    for (let i = 0; i < history.length; i++) {
      const mv = history[i];
      const san = mv.san;
      const res = replay.move(san, { sloppy: true });
      if (!res) break;
      const fen = replay.fen();
      const ev = fenEvalCache.get(fen) || {};
      plies.push({
        ply:     i + 1,
        san,
        fen,
        cpWhite: ev.cpWhite ?? null,
        mate:    ev.mate    ?? null,
        depth:   ev.depth   ?? null,
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const userColor = mode === 'practice' ? practiceColor : null;
    const sanHistory = history.map(m => m.san);
    let opening = null;
    try {
      const o = detectOpening(sanHistory, board.fen());
      if (o) opening = { name: o.name, eco: o.eco || null, matched: o._matched || 'exact' };
    } catch {}
    const userInfo = (typeof window !== 'undefined' && window.__user)
      ? { name: window.__user.name, id: window.__user.id }
      : { name: 'Guest', id: 'guest' };
    const game = {
      id:          Date.now(),
      date:        today,
      result:      result || '*',
      ending:      ending || '',
      mode:        mode || 'analysis',
      userColor,
      userName:    userInfo.name,
      userDeviceId: userInfo.id,
      opponent:    mode === 'practice'
                      ? `Stockfish (skill ${ui.rangeSkill?.value || '?'})`
                      : 'n/a',
      opening,
      startingFen: board.startingFen,
      pgn:         board.tree.pgn({ tags: {
                      Event: mode === 'practice' ? 'Practice vs Stockfish' : 'Analysis session',
                      Date:  today.replace(/-/g, '.'),
                      Result: result || '*',
                    }}),
      plies,
    };
    const ok = Archive.archiveGame(game);
    if (ok && ui.narrationText) {
      // Append a short note to the existing narration.
      const suffix = ` · 💾 Archived to My Games (${plies.length} plies).`;
      if (!ui.narrationText.innerHTML.includes('Archived to My Games')) {
        ui.narrationText.innerHTML += suffix;
      }
    }
    return ok;
  }

  // Public fireAnalysis: rAF-coalesced wrapper. Multiple triggers in
  // the same animation frame (e.g. scrubbing history with the mouse
  // wheel, or setup editor placing pieces rapidly) collapse into ONE
  // actual search restart at frame end. Prevents engine churn where
  // stop+start is called faster than the worker can finish anything.
  // NOTE: `_fireAnalysisScheduled` lives on `window.__fireScheduled`
  // instead of a `let` binding, because fireAnalysis() is called from
  // bootEngine()'s post-await path (before main() reaches this line),
  // and a `let` here throws TDZ. Hoisted global avoids the dance.
  function fireAnalysis() {
    if (window.__fireScheduled) return;
    window.__fireScheduled = requestAnimationFrame(() => {
      window.__fireScheduled = 0;
      _fireAnalysisNow();
    });
  }
  function _fireAnalysisNow() {
    // If main() hasn't finished declaring all its state yet, defer.
    // Flushed once at the end of main(). Prevents TDZ crashes when
    // bootEngine's post-await fireAnalysis() races the rest of main().
    if (!mainInitDone) { pendingFireAnalysis = true; return; }

    // Invalidate any practice-mode bestmove listener that's still waiting
    // on the previous position — when engine.stop() below triggers, the
    // worker will emit a final bestmove for the OLD search, and without
    // this guard it could be played onto the NEW position.
    practiceSearchToken++;

    const fen = board.isAtLive()
      ? board.fen()
      : rebuildFenAtPly(board.chess, board.viewPly);

    // Kick the engine FIRST — the worker starts computing in parallel
    // while the rest of this function does its synchronous UI work.
    if (engineReady) {
      explainer.setFen(fen);
      const chessNow = new Chess(fen);
      if (chessNow.isGameOver()) {
        ui.narrationText.innerHTML = gameOverMessage(chessNow);
        engine.stop();
        // Build a standard result tag / narrative from chess.js state.
        let resultTag = '*';
        let narrative = 'Game over';
        if (chessNow.isCheckmate()) {
          const loser = chessNow.turn();
          resultTag  = loser === 'w' ? '0-1' : '1-0';
          narrative  = loser === 'w' ? 'Black wins by checkmate' : 'White wins by checkmate';
        } else if (chessNow.isStalemate()) {
          resultTag = '1/2-1/2'; narrative = 'Draw by stalemate';
        } else if (chessNow.isDraw()) {
          resultTag = '1/2-1/2'; narrative = 'Draw (50-move / threefold / insufficient material)';
        }
        // If this was a practice game, flip into practice-finished
        // analysis mode (which also archives).
        if (practiceColor && !document.body.classList.contains('practice-finished')) {
          finishPracticeGame(resultTag, narrative);
        } else if (!practiceColor && !document.body.classList.contains('analysis-archived')) {
          // Analysis-mode game that ended naturally — sweep + archive.
          document.body.classList.add('analysis-archived');
          (async () => {
            try {
              await retrospectiveSweep({ minDepth: 12 });
              archiveCurrentGame({ result: resultTag, ending: narrative, mode: 'analysis' });
            } catch {}
          })();
          clearDraft();
        }
      } else {
        engine.stop();
        if (!paused && !locked) {
          // Practice mode: engine search is ONLY used to find its own
          // move. On the user's turn we leave the engine idle so no
          // analysis leaks to the user. The `practice-thinking` class
          // on <body> drives the CSS that hides PV lines + score and
          // shows the "engine thinking…" indicator.
          // NOTE: once practice-finished is set (resign / accepted draw /
          // natural game over) the engine switches to free-analysis
          // mode — no auto-moves regardless of whose "turn" it would be.
          const practiceOver = document.body.classList.contains('practice-finished');
          if (practiceColor && board.isAtLive() && !practiceOver) {
            const playerChar = practiceColor[0];
            const engineTurn = chessNow.turn() !== playerChar;
            if (engineTurn) {
              // Forced-move short-circuit: if there's exactly one legal
              // move, play it instantly without invoking the engine at
              // all. Stockfish itself caps forced-reply searches at
              // ~500 ms (search.cpp), but skipping the round-trip is
              // strictly faster. Per Stockfish research recommendations.
              const legal = chessNow.moves({ verbose: true });
              if (legal.length === 1) {
                const only = legal[0];
                const uci = only.from + only.to + (only.promotion || '');
                console.log('[practice] single legal move — playing instantly', uci);
                // 150ms delay so the user visually registers "opponent
                // thought about it and moved" rather than a jarring
                // instant-reply. Tune if it feels too fast/slow.
                setTimeout(() => board.playEngineMove(uci), 150);
                return;
              }
              console.log('[practice] engine turn — searching', { fen, limits: searchLimits() });
              document.body.classList.add('practice-thinking');
              ui.narrationText.innerHTML = '⏳ <strong>Engine is thinking…</strong> <span id="practice-calc-live" style="opacity:0.85;"></span>';
              // Live-calculation ticker: update on each 'thinking' info
              // event so the user can SEE that the engine is actively
              // searching (not frozen). Shows depth + nodes, but never
              // the evaluation or the move — those stay hidden by CSS
              // until the game ends (anti-cheat).
              const liveEl = () => document.getElementById('practice-calc-live');
              const onThinking = (ev) => {
                const el = liveEl();
                if (!el) return;
                const d = ev.detail?.info?.depth;
                const nodes = ev.detail?.info?.nodes;
                const nps = ev.detail?.info?.nps;
                const nodesFmt = nodes > 1e6 ? `${(nodes/1e6).toFixed(1)}M` : nodes > 1000 ? `${Math.round(nodes/1000)}k` : String(nodes || 0);
                const npsFmt   = nps   > 1e6 ? `${(nps/1e6).toFixed(1)}M/s` : nps > 1000 ? `${Math.round(nps/1000)}k/s` : '';
                el.textContent = `· depth ${d || '—'} · ${nodesFmt} nodes${npsFmt ? ' · ' + npsFmt : ''}`;
              };
              engine.addEventListener('thinking', onThinking);
              // Detach ticker when search completes or is cancelled.
              const detachTicker = () => engine.removeEventListener('thinking', onThinking);
              // Token to guard against stale listeners — if the user
              // makes a move before bestmove arrives, the token
              // increments and the old listener bails out.
              const myToken = ++practiceSearchToken;
              const onBest = (ev) => {
                engine.removeEventListener('bestmove', onBest);
                detachTicker();
                // Critical-position detector for the NEXT move's time
                // budget. Look at the search's history (one entry per
                // info ply): (1) how many times the #1 move changed;
                // (2) how far the cp score moved between mid-search and
                // end. Either signal = tactically unstable position.
                try {
                  const hist = ev.detail.history || [];
                  if (hist.length >= 3) {
                    const midIdx = Math.max(0, hist.length - 5);
                    const midCp = hist[midIdx]?.score ?? 0;
                    const endCp = hist[hist.length - 1]?.score ?? 0;
                    const cpSwing = Math.abs(endCp - midCp);
                    let moveChanges = 0;
                    for (let i = 1; i < hist.length; i++) {
                      if (hist[i].best !== hist[i-1].best) moveChanges++;
                    }
                    window.__lastSearchInstable = (cpSwing > 100) || (moveChanges >= 3);
                  } else {
                    window.__lastSearchInstable = false;
                  }
                } catch { window.__lastSearchInstable = false; }
                if (myToken !== practiceSearchToken) {
                  console.log('[practice] stale bestmove ignored', { myToken, current: practiceSearchToken });
                  return;
                }
                // Extra guard: if the game ended (resign / draw) between
                // go and bestmove, do not play the move even if the
                // token somehow still matches.
                if (document.body.classList.contains('practice-finished')) {
                  console.log('[practice] bestmove ignored — game over');
                  return;
                }
                document.body.classList.remove('practice-thinking');
                if (ev.detail.best && ev.detail.best !== '(none)') {
                  // Style-bias: pick from the engine's top candidates
                  // using a persona weighting function. Falls back to
                  // the engine's #1 when style is default or only one
                  // candidate is available.
                  const style = window.__practiceStyle || 'default';
                  const pickedUci = pickMoveByStyle(ev.detail.topMoves, style, chessNow, ev.detail.best);
                  console.log('[practice] engine plays', pickedUci, '(style:', style, ')');
                  board.playEngineMove(pickedUci);
                } else {
                  console.log('[practice] engine returned (none) — probably game over');
                  ui.narrationText.innerHTML = 'Engine has no legal moves — game over.';
                }
              };
              engine.addEventListener('bestmove', onBest);
              engine.start(fen, searchLimits());
            } else {
              // User's turn — engine stays idle. Don't show analysis.
              console.log('[practice] your turn — engine idle');
              document.body.classList.remove('practice-thinking');
              ui.narrationText.innerHTML =
                `♟ <strong>Your turn</strong> (${practiceColor}). Make a move.`;
            }
          } else {
            engine.start(fen, searchLimits());
          }
        }
      }
    }

    // Heavy dissection work runs on the NEXT animation frame so the
    // browser paints the moved piece before doing heuristic analysis.
    scheduleDissection(fen);
  }

  function searchLimits() {
    const mode = ui.limitMode.value;
    if (mode === 'infinite') return { infinite: true };
    // Clock mode — engine uses ~1/30th of its remaining time per move,
    // with a 300ms floor so it doesn't move instantly in the endgame.
    // Clamped so it never exceeds 12s (keeps practice games flowing).
    if (clock.active && practiceColor) {
      const engineMs = practiceColor === 'white' ? clock.msBlack : clock.msWhite;
      let budget = Math.max(300, Math.min(12_000, Math.floor(engineMs / 30)));
      // Critical-position boost: if the engine's PREVIOUS search showed
      // bestmove instability (the #1 PV kept changing late in the search,
      // or the score swung >100 cp between depth 10 and final), the
      // current position is tactically sharp — spend 2x budget, capped
      // at 18 s so clock still flows.
      if (window.__lastSearchInstable) {
        budget = Math.min(18_000, budget * 2);
      }
      return { movetime: budget };
    }
    const v = +ui.limitValue.value || (mode === 'depth' ? 18 : 2000);
    return mode === 'depth' ? { depth: v } : { movetime: v };
  }

  // Auto-exit threat mode whenever the user interacts with the board —
  // threat was meant for "what would they do RIGHT NOW", so any move /
  // undo / new-game invalidates it.
  board.addEventListener('move',     () => {
    if (window.__threatMode) window.__exitThreatMode({ silent: true });
    renderMoveList(); fireAnalysis();
    scheduleDraftSave();
    scheduleTimelineRender();
  });
  // Non-move tree mutations (adding a Stockfish PV as a variation via
  // right-click, promoting, deleting) still need the move list to
  // re-render. They don't change the live board so we skip fireAnalysis.
  board.addEventListener('tree-changed', () => {
    renderMoveList();
  });
  board.addEventListener('new-game', () => {
    if (window.__threatMode) window.__exitThreatMode({ silent: true });
    // Exiting any active / finished practice game when a fresh board
    // starts. The practice card hides via CSS once the class is gone.
    practiceColor = null;
    document.body.classList.remove('practice-mode', 'practice-thinking', 'practice-finished', 'analysis-archived');
    const pActions = document.getElementById('practice-actions');
    if (pActions) pActions.hidden = true;
    clearDraft();
    renderMoveList(); fireAnalysis();
    scheduleTimelineRender();
  });
  board.addEventListener('undo',     () => {
    if (window.__threatMode) window.__exitThreatMode({ silent: true });
    renderMoveList(); fireAnalysis();
  });
  board.addEventListener('nav',      () => {
    if (window.__threatMode) window.__exitThreatMode({ silent: true });
    renderMoveList();
    // When returning to live, run the normal game loop (which lets the engine
    // auto-play if it's its turn). When reviewing history, just analyse.
    if (board.isAtLive()) {
      fireAnalysis();
    } else {
      const fen = rebuildFenAtPly(board.chess, board.viewPly);
      explainer.setFen(fen);
      engine.stop();
      // Respect the locked/paused state — scrolling through history
      // must not revive a manually-stopped engine.
      if (engineReady && !locked && !paused) engine.start(fen, searchLimits());
    }
  });

  // Render the variation tree as an inline, lichess-style move list.
  // Mainline flows left-to-right in rows of two plies (white + black);
  // sidelines are rendered inline as "(…)" blocks after the ply they
  // branched from. Left-click a move navigates to it; right-click
  // opens a context menu (Promote / Delete / Copy PGN).
  // lichess-style move list: mainline in a 3-column grid
  //   [ N. ]  [ White move ]  [ Black move ]
  // Variations render as full-width rows between ply rows, recursively.
  function renderMoveList() {
    const tree = board.tree;
    const currentPath = tree.currentPath;

    // Collect mainline nodes and remember each ply's siblings
    const mainline = [];      // array of { node, path }
    {
      let cur = tree.root;
      let path = '';
      while (cur.children.length) {
        const main = cur.children[0];
        path += main.id;
        mainline.push({ node: main, parentNode: cur, path, siblings: cur.children.slice(1) });
        cur = main;
      }
    }

    // Render a single move cell
    function mvCell(node, path, cls = '') {
      const isCurrent = path === currentPath ? ' current' : '';
      return `<span class="mg-move ${cls}${isCurrent}" data-path="${path}">${node.san}</span>`;
    }

    // Render a single variation (sibling + its continuation) inline.
    // Walks the sibling's children[0] chain until it stops (no prefix
    // numbering for follow-ups except after branch points).
    function renderVariation(sibNode, sibParentNode, sibParentPath) {
      const sibPath = sibParentPath + sibNode.id;
      const parts = [];
      // First move — always gets ply number (white "N." or black "N...")
      {
        const white = sibParentNode.ply % 2 === 0;
        const full  = Math.floor(sibParentNode.ply / 2) + 1;
        const num   = white ? `${full}. ` : `${full}... `;
        const curCls = sibPath === currentPath ? ' current' : '';
        parts.push(`<span class="mg-var-num">${num}</span>` +
                   `<span class="mg-move mg-var-move${curCls}" data-path="${sibPath}">${sibNode.san}</span>`);
      }
      // Continue down this branch's mainline (children[0] chain), re-stating
      // ply when a nested sub-variation exists or at every new full-move.
      let node = sibNode;
      let path = sibPath;
      let pendingRestate = false;
      while (node.children.length) {
        const next = node.children[0];
        const npath = path + next.id;
        const white = node.ply % 2 === 0;
        const full  = Math.floor(node.ply / 2) + 1;
        let num = '';
        if (white)                      num = `${full}. `;
        else if (pendingRestate)        num = `${full}... `;
        const curCls = npath === currentPath ? ' current' : '';
        if (num) parts.push(`<span class="mg-var-num">${num}</span>`);
        parts.push(`<span class="mg-move mg-var-move${curCls}" data-path="${npath}">${next.san}</span>`);
        // Render nested sub-variations of `next` inline (rare — we cap at 2 deep)
        if (node.children.length > 1) {
          for (const nested of node.children.slice(1)) {
            parts.push(`<span class="mg-var-nested">(${renderVariation(nested, node, path)})</span>`);
          }
        }
        pendingRestate = node.children.length > 1;
        node = next;
        path = npath;
      }
      return parts.join(' ');
    }

    // Build the grid
    const rows = [];
    for (let i = 0; i < mainline.length; i += 2) {
      const whiteEntry = mainline[i];
      const blackEntry = mainline[i + 1];
      const fullmove = Math.floor(whiteEntry.node.ply / 2) + 1;   // whiteEntry is a white move since i is even

      // The row itself
      let row = `<div class="mg-num">${fullmove}.</div>`;
      row += mvCell(whiteEntry.node, whiteEntry.path, 'mg-main');
      if (blackEntry) row += mvCell(blackEntry.node, blackEntry.path, 'mg-main');
      else            row += `<div class="mg-move mg-empty"></div>`;
      rows.push(`<div class="mg-row">${row}</div>`);

      // Variations — any siblings from white's or black's parent node
      // (sibling = "if that ply had been played differently").
      const varsHtml = [];
      if (whiteEntry.siblings.length) {
        for (const sib of whiteEntry.siblings) {
          varsHtml.push(`<span class="mg-var">(${renderVariation(sib, whiteEntry.parentNode, whiteEntry.path.slice(0, -2))})</span>`);
        }
      }
      if (blackEntry && blackEntry.siblings.length) {
        for (const sib of blackEntry.siblings) {
          varsHtml.push(`<span class="mg-var">(${renderVariation(sib, blackEntry.parentNode, blackEntry.path.slice(0, -2))})</span>`);
        }
      }
      if (varsHtml.length) {
        rows.push(`<div class="mg-variations">${varsHtml.join(' ')}</div>`);
      }
    }

    ui.moveList.innerHTML = rows.length
      ? rows.join('')
      : '<div class="muted" style="padding: 8px 10px">No moves yet.</div>';

    // Click / right-click handlers on every move cell
    ui.moveList.querySelectorAll('.mg-move').forEach(el => {
      if (!el.dataset.path && el.dataset.path !== '') return;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateToTreePath(el.dataset.path);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMoveContextMenu(e, el.dataset.path);
      });
    });
  }

  // Replay chess.js up to `path` and update UI. Treats the tree path's
  // nodes as authoritative; chess.js is rebuilt from startingFen + path.
  function navigateToTreePath(path) {
    const tree = board.tree;
    const nodes = tree.nodesAlong(path);
    const replay = new Chess(board.startingFen);
    for (const n of nodes) {
      const uci = n.uci;
      try {
        replay.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci.length>4 ? uci[4] : undefined });
      } catch { break; }
    }
    board.chess = replay;
    tree.currentPath = path;
    // If we're on the mainline, keep viewPly behavior; otherwise just
    // render the position directly.
    board.viewPly = null;
    board.cg.set({
      fen: replay.fen(),
      turnColor: replay.turn() === 'w' ? 'white' : 'black',
      lastMove: nodes.length ? [nodes[nodes.length-1].uci.slice(0,2), nodes[nodes.length-1].uci.slice(2,4)] : undefined,
      check: replay.inCheck() ? (replay.turn() === 'w' ? 'white' : 'black') : false,
      movable: { color: 'both', dests: toDestsFrom(replay) },
    });
    board.dispatchEvent(new CustomEvent('nav', { detail: { path, live: true } }));
  }

  // Right-click context menu on a move node
  function openMoveContextMenu(e, path) {
    // Remove any existing menu
    document.querySelectorAll('.move-context-menu').forEach(el => el.remove());
    if (!path) return;
    const tree = board.tree;
    const parentPath = tree.parentPath(path);
    const parent = parentPath == null ? null : tree.nodeAtPath(parentPath);
    const id = path.slice(-2);
    const isMainline = parent && parent.children.length > 0 && parent.children[0].id === id && tree.isMainlinePath(parentPath);

    const menu = document.createElement('div');
    menu.className = 'move-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';
    const items = [
      { label: '⬆ Promote to mainline', disabled: isMainline, action: () => {
        tree.promoteVariation(path);
        renderMoveList();
      }},
      { label: '🗑 Delete from here', action: () => {
        tree.deleteAt(path);
        // If we deleted the current branch, navigate to the new current path
        navigateToTreePath(tree.currentPath);
        renderMoveList();
      }},
      { label: '📋 Copy PGN (with variations)', action: () => {
        navigator.clipboard.writeText(tree.pgn()).catch(() => {});
      }},
    ];
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'mc-item';
      btn.textContent = item.label;
      if (item.disabled) btn.disabled = true;
      btn.addEventListener('click', () => {
        item.action();
        menu.remove();
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    // Dismiss on outside click
    setTimeout(() => {
      const off = (ev) => {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', off); }
      };
      document.addEventListener('click', off);
    }, 0);
  }

  // ────────── Navigation controls ──────────

  // Two sets of nav buttons — one in the Moves panel, one below the board.
  for (const prefix of ['nav', 'board-nav']) {
    document.getElementById(`${prefix}-start`).addEventListener('click', () => board.toStart());
    document.getElementById(`${prefix}-prev`).addEventListener('click',  () => board.backward());
    document.getElementById(`${prefix}-next`).addEventListener('click',  () => board.forward());
    document.getElementById(`${prefix}-end`).addEventListener('click',   () => board.toEnd());
  }

  // Mouse-wheel on board → navigate history
  const boardEl = document.getElementById('board');
  let wheelCooldown = 0;
  boardEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - wheelCooldown < 80) return;   // throttle
    wheelCooldown = now;
    if (e.deltaY > 0) board.forward();
    else if (e.deltaY < 0) board.backward();
  }, { passive: false });

  // Keep the board-nav ply indicator live
  const updatePly = () => {
    const total = board.totalPlies();
    const current = board.viewPly == null ? total : board.viewPly;
    const el = document.getElementById('board-nav-ply');
    if (!el) return;
    if (total === 0) { el.textContent = '—'; return; }
    el.textContent = `ply ${current}/${total}${board.isAtLive() ? ' (live)' : ''}`;
  };
  board.addEventListener('nav',      updatePly);
  board.addEventListener('move',     updatePly);
  board.addEventListener('new-game', updatePly);
  board.addEventListener('undo',     updatePly);
  updatePly();

  // Keyboard navigation — active unless the user is typing in an input
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    switch (e.key) {
      case 'ArrowLeft':  board.backward(); e.preventDefault(); break;
      case 'ArrowRight': board.forward();  e.preventDefault(); break;
      case 'Home':       board.toStart();  e.preventDefault(); break;
      case 'End':        board.toEnd();    e.preventDefault(); break;
      case 'f': case 'F': board.flipBoard(); break;
      case 'x': case 'X':
        // Threat toggle — same as clicking the 🎯 THREAT button.
        // (Matches lichess keyboard shortcut.)
        document.getElementById('btn-threat')?.click();
        e.preventDefault();
        break;
    }
  });

  // ────────── Practice mode (vs engine from opening) ──────────
  setupPractice();

  function setupPractice() {
    const pModal = document.getElementById('practice-modal');
    const pOpen  = document.getElementById('btn-practice');
    const pClose = document.getElementById('practice-close');
    const pSel   = document.getElementById('practice-opening');
    const pMoves = document.getElementById('practice-opening-moves');
    const pColor = document.getElementById('practice-color');
    const pStren = document.getElementById('practice-strength');
    const pStrenV= document.getElementById('practice-strength-val');
    const pMode  = document.getElementById('practice-limit-mode');
    const pVal   = document.getElementById('practice-limit-value');
    const pStart = document.getElementById('practice-start');

    // ─── Custom (user-saved) practice openings ────────────────────
    // Stored in localStorage as an array of { group, name, moves[] }.
    // Merged into the OPENINGS list every time the modal is rebuilt so
    // any saves from this session show up immediately next time.
    const CUSTOM_STORAGE_KEY = 'stockfish-explain.practice-custom-openings';
    const loadCustomOpenings = () => {
      try {
        const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch { return []; }
    };
    const saveCustomOpenings = (arr) => {
      try { localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(arr)); } catch {}
    };
    const mergedOpenings = () => {
      // Start with a deep-copy of OPENINGS so we don't mutate imports,
      // then fold in custom entries under their declared group. If the
      // group doesn't exist yet, append it at the end.
      const byGroup = new Map();
      for (const g of OPENINGS) byGroup.set(g.group, { group: g.group, items: [...g.items] });
      for (const co of loadCustomOpenings()) {
        if (!byGroup.has(co.group)) byGroup.set(co.group, { group: co.group, items: [] });
        byGroup.get(co.group).items.push({
          name: co.name, moves: co.moves, _custom: true,
        });
      }
      return Array.from(byGroup.values());
    };

    const pSearch      = document.getElementById('practice-opening-search');
    const pSearchCount = document.getElementById('practice-opening-search-count');
    const pFavsOnly    = document.getElementById('practice-opening-favs-only');
    const pToggleFav   = document.getElementById('practice-toggle-fav');
    const pPickRandom  = document.getElementById('practice-pick-random');

    // ─── Favourite openings store ──────────────────────────────────
    // Keyed by "Group//index" (same format as pSel.value). Value is
    // the side the user prefers to play when drilling this opening.
    //   { "Sicilian//3": "black", "Italian Game//0": "white", ... }
    const FAVS_KEY = 'stockfish-explain.practice-favourites';
    const loadFavs = () => {
      try { const v = JSON.parse(localStorage.getItem(FAVS_KEY) || '{}'); return typeof v === 'object' && v ? v : {}; }
      catch { return {}; }
    };
    const saveFavs = (obj) => { try { localStorage.setItem(FAVS_KEY, JSON.stringify(obj)); } catch {} };
    const isFav  = (key) => !!loadFavs()[key];
    const favSide = (key) => loadFavs()[key] || null;

    const refreshToggleFavButton = () => {
      if (!pToggleFav) return;
      const key = pSel.value;
      const starred = isFav(key);
      pToggleFav.textContent = starred ? '★ Starred' : '⭐ Star';
      pToggleFav.style.background = starred
        ? 'rgba(255,193,7,0.25)' : '';
      pToggleFav.style.borderColor = starred ? '#ffc107' : '';
      pToggleFav.title = starred
        ? 'Unstar this opening. (Tip: star applies to the side currently selected in "Play as".)'
        : 'Star this opening as a favourite for the side selected in "Play as".';
    };

    const pTree = document.getElementById('practice-opening-tree');

    // Tree design (per user feedback):
    //   1. Preserve the ORIGINAL curated groups from src/openings.js as
    //      the primary flat list — each group becomes a <details> with
    //      its items as direct leaves. No deep nesting here — quick to
    //      scan and pick from.
    //   2. A separate "⚗ More variations (Lichess DB)" branch sits at
    //      the bottom, collapsed by default, containing the 3,690
    //      Lichess sub-variations grouped by family name (parsed from
    //      "Family Name: Variation" format). Only visible when the user
    //      wants obscure sub-lines — doesn't clutter the main list.
    //   3. Custom user-saved openings show up in their own group as
    //      they did before.
    //
    // Keys preserve the "Group//index" format; Lichess entries are
    // stored under a synthetic group "⚗ Lichess · <Family>" so the
    // pSel value + pickedPracticeOpening resolution still work.

    // Parse "Sicilian Defense: Najdorf Variation" → "Sicilian Defense"
    const lichessFamily = (name) => {
      const colon = name.indexOf(':');
      return (colon > 0 ? name.slice(0, colon) : name).trim();
    };

    // Merged list: curated groups + synthetic Lichess-family groups.
    const allGroupsForTree = () => {
      const groups = [...mergedOpenings()];
      // Synthetic Lichess groups — one per family, sorted by family
      // name for predictable layout.
      const byFamily = new Map();
      for (const o of LICHESS_OPENINGS) {
        const fam = lichessFamily(o.name);
        if (!byFamily.has(fam)) byFamily.set(fam, []);
        byFamily.get(fam).push(o);
      }
      const lichessGroups = [];
      for (const [fam, items] of byFamily) {
        lichessGroups.push({
          group: `⚗ Lichess · ${fam}`,
          items: items.map(i => ({ ...i, _source: 'lichess' })),
          _isLichess: true,
          _family: fam,
        });
      }
      lichessGroups.sort((a, b) => a._family.localeCompare(b._family));
      return { curated: groups, lichess: lichessGroups };
    };

    // Simple fuzzy match — tolerant of typos and partial words.
    // Returns a score 0-100; 0 = no match. Order of tests:
    //   1. Exact case-insensitive substring  → 100
    //   2. "Starts with"                      → 85
    //   3. Levenshtein-bounded approximate
    //      (distance ≤ 2 on the best matching word of the target
    //       when query length ≥ 4)            → 70 - distance*10
    //   4. Subsequence match (all query chars
    //      appear in order, gaps allowed)     → 50
    // Cheap enough to run across thousands of entries per keystroke.
    function levenshtein(a, b) {
      const n = a.length, m = b.length;
      if (!n) return m; if (!m) return n;
      const prev = new Array(m + 1).fill(0);
      for (let j = 0; j <= m; j++) prev[j] = j;
      for (let i = 1; i <= n; i++) {
        let last = prev[0]; prev[0] = i;
        for (let j = 1; j <= m; j++) {
          const temp = prev[j];
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + cost);
          last = temp;
        }
      }
      return prev[m];
    }
    function fuzzyScore(query, target) {
      if (!query) return 100;
      const q = query.toLowerCase();
      const t = target.toLowerCase();
      if (t.includes(q)) return t.startsWith(q) ? 95 : 100; // substring wins
      if (q.length >= 4) {
        // Try Levenshtein against each whitespace-or-punctuation token.
        const tokens = t.split(/[\s,.:;()-]+/);
        let best = Infinity;
        for (const tok of tokens) {
          if (!tok) continue;
          const d = levenshtein(q, tok);
          if (d < best) best = d;
        }
        if (best <= 2) return 70 - best * 10;  // tight typo tolerance
      }
      // Subsequence check (all query chars appear in order in target)
      let i = 0;
      for (const ch of t) {
        if (ch === q[i]) i++;
        if (i >= q.length) return 50;
      }
      return 0;
    }

    const renderTree = () => {
      if (!pTree) return;
      const f = (pSearch?.value || '').trim().toLowerCase();
      const favsOnly = pFavsOnly && pFavsOnly.checked;
      const favs = loadFavs();
      const selected = pSel.value;

      // Populate the hidden <select> with EVERY entry (curated +
      // Lichess) so pickedPracticeOpening + last-settings restore
      // still work. It's hidden so visual size doesn't matter.
      const { curated, lichess } = allGroupsForTree();
      pSel.innerHTML = '';
      const mkOptgroup = (grp) => {
        const og = document.createElement('optgroup');
        og.label = grp.group;
        grp.items.forEach((o, i) => {
          const opt = document.createElement('option');
          opt.value = `${grp.group}//${i}`;
          opt.textContent = o.name;
          og.appendChild(opt);
        });
        return og;
      };
      for (const grp of curated)  pSel.appendChild(mkOptgroup(grp));
      for (const grp of lichess)  pSel.appendChild(mkOptgroup(grp));
      if (selected) pSel.value = selected;

      const container = document.createDocumentFragment();
      // Filter matcher now uses the fuzzy scorer instead of plain
      // substring, so "najdrf" still finds Najdorf etc.
      const matchesFilter = (name, groupName, eco) => {
        if (!f) return true;
        const nameScore = fuzzyScore(f, name);
        if (nameScore > 0) return true;
        if (groupName && fuzzyScore(f, groupName) > 0) return true;
        if (eco && (eco || '').toLowerCase().includes(f)) return true;
        return false;
      };

      // ── ⭐ Favourites pinned group at the top ──
      const favEntries = [];
      for (const grp of [...curated, ...lichess]) {
        grp.items.forEach((o, i) => {
          const key = `${grp.group}//${i}`;
          if (favs[key] && matchesFilter(o.name, grp.group, o.eco)) {
            favEntries.push({ key, o, group: grp.group });
          }
        });
      }
      if (favEntries.length) {
        const favDetails = document.createElement('details');
        favDetails.open = true;
        favDetails.innerHTML = `<summary>⭐ Favourites <span class="tree-family-count">${favEntries.length}</span></summary>`;
        for (const e of favEntries) favDetails.appendChild(renderLeaf(e, favs, selected));
        container.appendChild(favDetails);
      }

      if (favsOnly) {
        if (!favEntries.length) {
          const empty = document.createElement('div');
          empty.className = 'tree-empty';
          empty.textContent = 'No favourites yet — browse the tree and click ☆ to star one.';
          container.appendChild(empty);
        }
        pTree.innerHTML = '';
        pTree.appendChild(container);
        if (pSearchCount) pSearchCount.textContent = `${favEntries.length} favourites`;
        refreshToggleFavButton();
        return;
      }

      // ── Curated groups (flat, each group collapsible) ──
      let curatedShown = 0;
      for (const grp of curated) {
        const matching = grp.items
          .map((o, i) => ({ key: `${grp.group}//${i}`, o, group: grp.group }))
          .filter(e => matchesFilter(e.o.name, e.group, e.o.eco));
        if (!matching.length) continue;
        curatedShown += matching.length;
        const details = document.createElement('details');
        if (f) details.open = true;   // auto-expand when filtering
        details.innerHTML = `<summary>${escapeHtml(grp.group)} <span class="tree-family-count">${matching.length}/${grp.items.length}</span></summary>`;
        for (const e of matching) details.appendChild(renderLeaf(e, favs, selected));
        container.appendChild(details);
      }

      // ── ⚗ Lichess DB (3,690 more lines) — collapsed by default ──
      const lichessMatches = [];
      for (const grp of lichess) {
        const items = grp.items
          .map((o, i) => ({ key: `${grp.group}//${i}`, o, group: grp.group }))
          .filter(e => matchesFilter(e.o.name, e.group, e.o.eco));
        if (items.length) lichessMatches.push({ grp, items });
      }
      const lichessCount = lichessMatches.reduce((s, x) => s + x.items.length, 0);
      if (lichessCount) {
        const outer = document.createElement('details');
        if (f) outer.open = true;     // auto-expand on search
        outer.innerHTML = `<summary>⚗ More variations (Lichess DB) <span class="tree-family-count">${lichessCount}</span></summary>`;
        for (const { grp, items } of lichessMatches) {
          const inner = document.createElement('details');
          if (f) inner.open = true;
          inner.innerHTML = `<summary>${escapeHtml(grp._family)} <span class="tree-family-count">${items.length}</span></summary>`;
          for (const e of items) inner.appendChild(renderLeaf(e, favs, selected));
          outer.appendChild(inner);
        }
        container.appendChild(outer);
      }

      pTree.innerHTML = '';
      pTree.appendChild(container);

      const totalCount = curated.reduce((s, g) => s + g.items.length, 0)
                       + lichess.reduce((s, g) => s + g.items.length, 0);
      const shownCount = curatedShown + lichessCount;
      if (pSearchCount) {
        pSearchCount.textContent = f
          ? `${shownCount} of ${totalCount} match`
          : `${totalCount} openings · ${Object.keys(favs).length} starred`;
      }
      refreshToggleFavButton();
    };

    // Queue-subset state: which starred openings the user has chosen
    // to INCLUDE in rotation. Empty set = use all favourites.
    const QUEUE_SET_KEY = 'stockfish-explain.practice-queue-set';
    const loadQueueSet = () => {
      try { return new Set(JSON.parse(localStorage.getItem(QUEUE_SET_KEY) || '[]')); }
      catch { return new Set(); }
    };
    const saveQueueSet = (set) => {
      try { localStorage.setItem(QUEUE_SET_KEY, JSON.stringify([...set])); } catch {}
    };

    const renderLeaf = (entry, favs, selected) => {
      const leaf = document.createElement('div');
      leaf.className = 'tree-leaf' + (entry.key === selected ? ' selected' : '');
      leaf.dataset.key = entry.key;
      const starred = !!favs[entry.key];
      const side    = favs[entry.key] || null; // 'white' | 'black' | 'both' | null
      const queueSet = loadQueueSet();
      const badge = entry.o._source === 'lichess' ? '<span class="tree-lichess-badge">DB</span>' : '';
      const custom = entry.o._custom ? '<span class="tree-lichess-badge">custom</span>' : '';
      const leafName = entry.o.name;
      // Queue checkbox — only visible for starred entries.
      const inQueue = !starred || queueSet.size === 0 || queueSet.has(entry.key);
      const queueCb = starred
        ? `<input type="checkbox" class="tree-leaf-queue" data-queue="${entry.key}" ${inQueue ? 'checked' : ''} title="Include in queue rotation" onclick="event.stopPropagation()">`
        : '';
      // Side chooser — only shown for starred entries. Three mini
      // buttons (W / B / Both). Clicking one sets which colour the
      // user wants to practice this opening as. 'Both' = board side
      // is randomised each time the random-queue picks this opening.
      const sideChooser = starred
        ? `<span class="tree-leaf-side" data-side-key="${entry.key}" onclick="event.stopPropagation()">` +
            `<button type="button" class="side-pick ${side === 'white' ? 'active' : ''}" data-side-pick="white" title="Practice as White">W</button>` +
            `<button type="button" class="side-pick ${side === 'black' ? 'active' : ''}" data-side-pick="black" title="Practice as Black">B</button>` +
            `<button type="button" class="side-pick ${side === 'both'  ? 'active' : ''}" data-side-pick="both"  title="Practice as either — random each time the queue picks this">↔</button>` +
          `</span>`
        : '';
      leaf.innerHTML =
        `<span class="tree-leaf-fav${starred ? ' starred' : ''}" data-fav="${entry.key}" title="${starred ? 'Unstar' : 'Star as favourite'}">${starred ? '★' : '☆'}</span>` +
        queueCb +
        sideChooser +
        `<span class="tree-leaf-name">${escapeHtml(leafName)}</span>` +
        `<span class="tree-leaf-eco">${escapeHtml(entry.o.eco || '')}</span>` +
        badge + custom;
      return leaf;
    };

    // Click handlers on the tree.
    if (pTree) {
      pTree.addEventListener('click', (ev) => {
        // Side pick (W / B / Both) — highest priority so clicks don't
        // fall through to the leaf-select handler.
        const sideBtn = ev.target.closest('[data-side-pick]');
        if (sideBtn) {
          const wrap = sideBtn.closest('[data-side-key]');
          const key  = wrap?.dataset.sideKey;
          if (key) {
            const favs = loadFavs();
            favs[key] = sideBtn.dataset.sidePick; // 'white' | 'black' | 'both'
            saveFavs(favs);
            renderTree();
          }
          ev.stopPropagation();
          return;
        }
        const favBtn = ev.target.closest('.tree-leaf-fav');
        if (favBtn) {
          const key = favBtn.dataset.fav;
          const favs = loadFavs();
          if (favs[key]) delete favs[key];
          else favs[key] = pColor.value || 'white';
          saveFavs(favs);
          renderTree();
          ev.stopPropagation();
          return;
        }
        const leaf = ev.target.closest('.tree-leaf');
        if (!leaf) return;
        pSel.value = leaf.dataset.key;
        updatePMoves();
        refreshToggleFavButton();
        // Mark selected visually.
        pTree.querySelectorAll('.tree-leaf.selected').forEach(el => el.classList.remove('selected'));
        leaf.classList.add('selected');
      });
    }

    // Legacy adapter — keep the flat-select populator as a no-op so
    // existing calls compile. Everything now flows through renderTree.
    const populateOpeningSelect = () => { renderTree(); };
    populateOpeningSelect();

    if (pSearch) {
      pSearch.addEventListener('input', () => {
        populateOpeningSelect(pSearch.value);
        updatePMoves();
      });
    }
    if (pFavsOnly) {
      pFavsOnly.addEventListener('change', () => {
        populateOpeningSelect(pSearch ? pSearch.value : '');
        updatePMoves();
      });
    }
    if (pToggleFav) {
      pToggleFav.addEventListener('click', () => {
        const key = pSel.value;
        if (!key) return;
        const favs = loadFavs();
        if (favs[key]) {
          delete favs[key];
        } else {
          // Star with the currently selected colour so "pick-random"
          // replays it with the right side.
          favs[key] = pColor.value || 'white';
        }
        saveFavs(favs);
        populateOpeningSelect(pSearch ? pSearch.value : '');
      });
    }
    // Helper: effective queue pool — either the user's subset (if
    // any checkboxes are ticked) or all favourites. Returns an array
    // of keys. Exposed on window so the post-game "Next random"
    // button can reach it without duplicating logic.
    const effectiveQueuePool = () => {
      const favs = loadFavs();
      const favKeys = Object.keys(favs);
      const set = loadQueueSet();
      if (set.size === 0) return favKeys;              // no subset → all favs
      const subset = favKeys.filter(k => set.has(k));
      return subset.length ? subset : favKeys;         // if subset becomes empty, fall back
    };
    window.__practiceQueuePool = effectiveQueuePool;

    if (pPickRandom) {
      pPickRandom.addEventListener('click', () => {
        const pool = effectiveQueuePool();
        if (!pool.length) {
          alert('No starred openings yet. Click ☆ on an opening first.');
          return;
        }
        const pickedKey = pool[Math.floor(Math.random() * pool.length)];
        const favs = loadFavs();
        if (pSearch) pSearch.value = '';
        if (pFavsOnly) pFavsOnly.checked = false;
        renderTree();
        pSel.value = pickedKey;
        pColor.value = favs[pickedKey] || 'white';
        updatePMoves();
        refreshToggleFavButton();
      });
    }

    // Queue mode = "pick random + enable auto-advance in post-game".
    // Stores a flag window.__practiceQueueActive so finishPracticeGame
    // can surface the "Next random favourite" button automatically.
    const pStartQueue = document.getElementById('practice-start-queue');
    if (pStartQueue) pStartQueue.addEventListener('click', () => {
      const pool = effectiveQueuePool();
      if (pool.length < 2) {
        alert('Queue mode needs at least 2 starred openings. Star a few first, then try again.');
        return;
      }
      const pickedKey = pool[Math.floor(Math.random() * pool.length)];
      const favs = loadFavs();
      pSel.value = pickedKey;
      pColor.value = favs[pickedKey] || 'white';
      updatePMoves();
      window.__practiceQueueActive = true;
      // Press Start programmatically so the user doesn't have to.
      const startBtn = document.getElementById('practice-start');
      if (startBtn) startBtn.click();
    });

    // Queue checkbox listener — tick/untick a favourite's "included
    // in queue rotation" state. Persists to localStorage.
    if (pTree) {
      pTree.addEventListener('change', (ev) => {
        const cb = ev.target.closest('.tree-leaf-queue');
        if (!cb) return;
        const key = cb.dataset.queue;
        const set = loadQueueSet();
        if (cb.checked) set.add(key); else set.delete(key);
        saveQueueSet(set);
      });
    }

    const pickedPracticeOpening = () => {
      const [gn, idxStr] = (pSel.value || '//0').split('//');
      // Look in curated groups first, then Lichess synthetic groups.
      const { curated, lichess } = allGroupsForTree();
      const grp = curated.find(g => g.group === gn) || lichess.find(g => g.group === gn);
      return grp ? grp.items[+idxStr] : OPENINGS[0].items[0];
    };
    const updatePMoves = () => {
      const op = pickedPracticeOpening();
      pMoves.textContent = op.moves.length
        ? op.moves.map((m, i) => (i % 2 === 0 ? `${Math.floor(i/2)+1}.${m}` : m)).join(' ')
        : '(start from move 1)';
    };
    pSel.addEventListener('change', () => { updatePMoves(); refreshToggleFavButton(); });
    updatePMoves();

    // ─── Last-settings persistence + Replay button ────────────────
    const LAST_SETTINGS_KEY = 'stockfish-explain.practice-last-settings';
    const loadLastSettings = () => {
      try {
        const raw = localStorage.getItem(LAST_SETTINGS_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    };
    const saveLastSettings = (obj) => {
      try { localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(obj)); } catch {}
    };
    const applyLastSettingsToModal = () => {
      const last = loadLastSettings();
      if (!last) return;
      // Restore dropdown selection if the opening is still in the list.
      if (last.openingValue && pSel.querySelector(`option[value="${CSS.escape(last.openingValue)}"]`)) {
        pSel.value = last.openingValue;
        updatePMoves();
      }
      if (last.color)     pColor.value   = last.color;
      if (last.skill)     { pStren.value = String(last.skill); pStrenV.textContent = String(last.skill); }
      if (last.limitMode === 'clock') {
        if (pUseClock) pUseClock.checked = true;
      } else if (last.limitMode) {
        if (pUseClock) pUseClock.checked = false;
        pMode.value = last.limitMode;
      }
      applyClockToggle();
      if (last.limitVal)  pVal.value     = String(last.limitVal);
      if (last.style) {
        const styleSel = document.getElementById('practice-style');
        if (styleSel) styleSel.value = last.style;
      }
    };
    // Update the replay button label so the user sees what they'll replay.
    const pReplayBtn  = document.getElementById('practice-replay');
    const pReplayName = document.getElementById('practice-replay-name');
    const refreshReplayButton = () => {
      const last = loadLastSettings();
      if (!last || !pReplayBtn) { if (pReplayBtn) pReplayBtn.hidden = true; return; }
      pReplayBtn.hidden = false;
      if (pReplayName) pReplayName.textContent = `${last.openingName || '?'} · ${last.color || '?'} · Skill ${last.skill ?? '?'}`;
    };
    refreshReplayButton();

    pStren.addEventListener('input', () => { pStrenV.textContent = pStren.value; });
    pMode.addEventListener('change', () => {
      if (pMode.value === 'depth')    pVal.value = 14;
      if (pMode.value === 'movetime') pVal.value = 1500;
    });
    // Clock-mode 3-way dropdown: 'none' | 'untimed' | 'timed'
    const pUseClock   = document.getElementById('practice-use-clock');  // legacy hidden
    const pClockMode  = document.getElementById('practice-clock-mode');
    const pLimitRow   = document.getElementById('practice-limit-row');
    const pClockRow   = document.getElementById('practice-clock-row');
    const pClockHint  = document.getElementById('practice-clock-mode-hint');
    const pUntimedInc = document.getElementById('practice-untimed-inc-wrap');
    const applyClockToggle = () => {
      const mode = pClockMode?.value || 'none';
      const isTimed   = mode === 'timed';
      const isUntimed = mode === 'untimed';
      // Preset row only for timed; limit-by-depth/movetime row always visible.
      if (pClockRow)   pClockRow.style.display   = isTimed ? 'block' : 'none';
      if (pLimitRow)   pLimitRow.style.display   = 'block';
      if (pUntimedInc) pUntimedInc.hidden        = !isUntimed;
      if (pClockHint) {
        pClockHint.textContent = isTimed
          ? 'Real chess clock — ticks down from your preset, flag falls at 0, loses on time.'
          : isUntimed
            ? 'Untimed — clock counts up showing time used per move + total. Increment optional.'
            : 'No clock will be shown during this game. Switch to Timed to enable a real chess clock.';
      }
      // Keep legacy checkbox in sync for any caller still reading it.
      if (pUseClock) pUseClock.checked = isTimed;
    };
    if (pClockMode) pClockMode.addEventListener('change', applyClockToggle);
    if (pUseClock)  pUseClock.addEventListener('change', applyClockToggle);
    applyClockToggle();
    const pClockPreset = document.getElementById('practice-clock-preset');
    const pClockCustom = document.getElementById('practice-clock-custom');
    if (pClockPreset) pClockPreset.addEventListener('change', () => {
      if (pClockCustom) pClockCustom.style.display = pClockPreset.value === 'custom' ? 'flex' : 'none';
    });

    // Custom starting position: "use current board position" checkbox.
    // When ticked, practice starts from whatever's on the board right now
    // (including FEN loads, positions from the editor, or mid-game in the
    // tree). We also try to auto-detect which opening the position falls
    // into by comparing the played SAN moves against each opening's
    // prefix — if the current position IS a prefix extension of some
    // known opening, we name it.
    const pUseCurrent     = document.getElementById('practice-use-current');
    const pUseCurrentInfo = document.getElementById('practice-use-current-info');
    const pOpeningRow     = document.getElementById('practice-opening-row');
    function refreshUseCurrent() {
      if (!pUseCurrent.checked) {
        pUseCurrentInfo.textContent = '';
        if (pOpeningRow) pOpeningRow.style.display = '';
        return;
      }
      if (pOpeningRow) pOpeningRow.style.display = 'none';
      const mains = board.tree.mainlineNodes();
      const fen   = board.fen();
      const sanPath = mains.map(n => n.san);
      const matched = detectOpeningFromSanPath(sanPath);
      pUseCurrentInfo.innerHTML = matched
        ? `Detected opening: <strong>${matched.name}</strong> (${matched.group}) — ${sanPath.length ? 'plus ' + (sanPath.length - matched.matchLength) + ' more move(s)' : 'exact match'}`
        : sanPath.length
          ? `Custom position (${sanPath.length} moves played) — no matching opening in our book`
          : `Current position is the standard starting setup`;
      // Stash FEN + SAN path so the Start handler can use them
      pUseCurrent._fen     = fen;
      pUseCurrent._sanPath = sanPath;
      pUseCurrent._match   = matched;
    }
    pUseCurrent.addEventListener('change', refreshUseCurrent);
    // Refresh when modal opens (so the detected opening reflects the
    // current state at open time, not at page load time).
    pOpen.addEventListener('click', () => { refreshUseCurrent(); });

    pOpen.addEventListener('click',  () => {
      // Each open: repopulate the list (may include new custom saves),
      // restore last-used settings, refresh the replay button label.
      populateOpeningSelect(pSearch ? pSearch.value : '');
      applyLastSettingsToModal();
      refreshReplayButton();
      pModal.hidden = false;
    });
    pClose.addEventListener('click', () => pModal.hidden = true);
    pModal.addEventListener('click', (e) => { if (e.target === pModal) pModal.hidden = true; });

    // Replay — apply last settings + start immediately, skipping the rest
    // of the modal UI. User can still cancel via ✕.
    if (pReplayBtn) pReplayBtn.addEventListener('click', () => {
      applyLastSettingsToModal();
      pStart.click();
    });

    pStart.addEventListener('click', () => {
      const useCurrent = pUseCurrent.checked;
      const op = pickedPracticeOpening();
      const color = pColor.value;       // 'white' | 'black'
      const skill = +pStren.value;
      // Derive useClock / limitMode from the new 3-way dropdown. Legacy
      // checkbox kept in sync for any other code still reading it.
      const clockModeEarly = document.getElementById('practice-clock-mode')?.value || 'none';
      const useClock  = clockModeEarly === 'timed';
      if (pUseClock) pUseClock.checked = useClock;
      const limitMode = useClock ? 'clock' : pMode.value;
      const limitVal  = +pVal.value;
      const style     = document.getElementById('practice-style')?.value || 'default';

      // Remember these settings so we can replay / pre-fill next time.
      saveLastSettings({
        openingValue: pSel.value,
        openingName:  op.name,
        color, skill, limitMode, limitVal, style,
      });
      // Expose the chosen style globally so the bestmove handler in
      // fireAnalysis can bias selection.
      window.__practiceStyle = style;
      refreshReplayButton();

      if (useCurrent) {
        // Keep the current board position as-is — don't newGame / reset.
        // The tree, FEN, and move history all remain. Practice just kicks
        // in on the NEXT move from here.
        console.log('[practice] starting from current position', {
          fen: board.fen(),
          detectedOpening: pUseCurrent._match ? pUseCurrent._match.name : '(custom)',
        });
      } else {
        // Load the opening position
        board.newGame();
        if (op.moves.length) {
          const played = playOpening(op.moves);
          if (played) board.playUciMoves(played.uciMoves, { animate: false });
        }
      }

      // Set practice state
      practiceColor = color;
      board.playerColor = color;
      practiceSearchToken++;   // invalidate any in-flight bestmove listener
      document.body.classList.add('practice-mode');
      document.body.classList.remove('practice-finished');
      // Reveal the in-progress practice-actions card and reset the
      // post-game panel in case a previous game had flipped to
      // finished state.
      const pActions = document.getElementById('practice-actions');
      if (pActions) pActions.hidden = false;
      const pLive = document.getElementById('practice-live');
      const pOver = document.getElementById('practice-over');
      if (pLive) pLive.hidden = false;
      if (pOver) pOver.hidden = true;
      const drawRespEl = document.getElementById('practice-draw-response');
      if (drawRespEl) drawRespEl.textContent = '';
      console.log('[practice] started', { color, skill, limitMode, limitVal });

      // Configure engine
      engine.setSkill(skill);
      ui.rangeSkill.value = String(skill);
      ui.skillVal.textContent = String(skill);
      ui.limitMode.value = limitMode;
      ui.limitValue.value = String(limitVal);

      // Unlock + unpause if needed
      if (locked) document.getElementById('btn-lock').click();
      paused = false;

      // Flip the board to the user's color (user plays from the bottom)
      if (color !== board.orientation) board.flipBoard();

      // Match clock orientation to the board: user's color on the bottom.
      const clockDisplay = document.getElementById('clock-digital');
      if (clockDisplay) clockDisplay.dataset.userColor = color;

      // Auto-collapse the toolbar for a clean playing view. Restored on
      // game end. prevNavCollapsed was captured earlier (persisted state).
      document.body.classList.add('nav-collapsed');

      pModal.hidden = true;
      ui.narrationText.innerHTML =
        `🎯 Practice started: <strong>${op.name}</strong>. You play <strong>${color}</strong>. ` +
        `Engine skill ${skill}/20. ${limitMode === 'depth' ? `Depth ${limitVal}` : `${limitVal}ms/move`}.`;

      // Initialise clock:
      //   - useClock = true  → count-DOWN chess clock with preset
      //   - useClock = false + untimed-increment on → count-UP clock
      //                                              tracking time per
      //                                              move with increment
      //   - useClock = false + no increment → count-UP clock just
      //                                       showing time used
      // Clock mode is driven by the 3-way dropdown:
      //   'none'    — no clock card at all (hide it)
      //   'untimed' — clock counts UP tracking time used (+ optional inc)
      //   'timed'   — real chess clock counting DOWN (preset or custom)
      const clockModeEl = document.getElementById('practice-clock-mode');
      const clockMode = clockModeEl?.value || 'none';
      const clockCard = document.getElementById('practice-clock');
      if (clockMode === 'none') {
        // Plain .hidden attribute is overridden by
        // `body.practice-mode .practice-card { display: block }` — use
        // inline style so the card is truly gone in 'none' mode.
        if (clockCard) { clockCard.hidden = true; clockCard.style.display = 'none'; }
        try { stopClock(); } catch {}
      } else if (clockMode === 'timed') {
        if (clockCard) { clockCard.hidden = false; clockCard.style.display = ''; }
        let minutes = 5, inc = 3;
        const preset = document.getElementById('practice-clock-preset')?.value;
        if (preset === 'custom') {
          minutes = +document.getElementById('practice-clock-minutes')?.value || 5;
          inc     = +document.getElementById('practice-clock-increment')?.value || 0;
        } else if (preset) {
          const m = preset.match(/^(\d+)\+(\d+)$/);
          if (m) { minutes = +m[1]; inc = +m[2]; }
        }
        startClock(minutes, inc, 'down');
      } else {
        // Untimed — count UP to show time used. Increment optional.
        if (clockCard) { clockCard.hidden = false; clockCard.style.display = ''; }
        const useUntimedInc = document.getElementById('practice-untimed-increment-on')?.checked;
        const incSec = useUntimedInc
          ? (+document.getElementById('practice-untimed-increment')?.value || 0)
          : 0;
        startClock(0, incSec, 'up');
      }

      // Kick the loop — if it's engine's turn first, it plays immediately
      fireAnalysis();
    });
  }

  // ────────── Practice game-end helpers ──────────
  // finishPracticeGame centralises the transition from "in-progress"
  // to "analysis mode". Called by natural game-over (in fireAnalysis),
  // by Resign, and by accepted Offer-Draw. Safe to call multiple times;
  // the practice-finished class is the idempotent guard.
  function finishPracticeGame(resultTag, narrative) {
    if (document.body.classList.contains('practice-finished')) return;
    document.body.classList.add('practice-finished');
    document.body.classList.remove('practice-thinking');
    if (!prevNavCollapsed) document.body.classList.remove('nav-collapsed');
    // Stop any in-flight engine search AND invalidate its token so if
    // a bestmove fires after `stop` (as Stockfish does — it emits the
    // best move found so far) the listener bails rather than playing
    // a move onto a game that just ended.
    engine.stop();
    practiceSearchToken++;
    practiceResultTag = resultTag;
    practiceResultText = narrative;
    // Stop the chess clock if it was running.
    try { stopClock(); } catch {}
    // Draft is no longer needed.
    clearDraft();
    // Run a retrospective sweep — fills in per-move evals for all
    // plies the engine didn't evaluate live (critical for practice
    // where the user's turns were never searched). THEN archive, so
    // mistake-bank classification has the full data.
    (async () => {
      ui.narrationText.innerHTML =
        `🏁 Game over — <strong>${resultTag}</strong> — ${narrative}. ⏳ Analysing each move for the mistake bank…`;
      try {
        await retrospectiveSweep({
          minDepth: 12,
          onProgress: (d, t) => {
            if (ui.narrationText) {
              ui.narrationText.innerHTML =
                `🏁 <strong>Game over: ${resultTag}</strong> — analysing move ${d}/${t} for mistake bank…`;
            }
          },
        });
      } catch (err) { console.warn('[sweep] failed', err); }
      try {
        archiveCurrentGame({ result: resultTag, ending: narrative, mode: 'practice' });
        ui.narrationText.innerHTML =
          `🏁 <strong>Game over: ${resultTag}</strong> — ${narrative}. Archived to 📚 My Games. ` +
          `Mistakes added to 🎓 Mistake Bank. Use ⏮◀▶⏭ to review.`;
      } catch (err) {
        console.warn('[archive] failed to archive practice game', err);
      }
    })();
    // Swap the card UI into post-game state
    const pLive = document.getElementById('practice-live');
    const pOver = document.getElementById('practice-over');
    if (pLive) pLive.hidden = true;
    if (pOver) pOver.hidden = false;
    // Show "Next random favourite" when:
    //   - queue mode is active (user clicked 🔀 Queue mode earlier), OR
    //   - the pool has at least 2 favourites (so the button is meaningful).
    const nextFavBtn = document.getElementById('btn-practice-next-fav');
    if (nextFavBtn) {
      const pool = window.__practiceQueuePool ? window.__practiceQueuePool() : [];
      const show = !!window.__practiceQueueActive || pool.length >= 2;
      nextFavBtn.hidden = !show;
    }
    const banner = document.getElementById('practice-result-banner');
    if (banner) banner.textContent = `Result: ${resultTag} — ${narrative}`;
    ui.narrationText.innerHTML =
      `🏁 <strong>Game over: ${resultTag}</strong> — ${narrative}. ` +
      `Engine eval is now visible on every position. Use the arrows / move list to review.`;
    // Kick fireAnalysis so the engine starts evaluating the current
    // position for post-game review (even if we were on the user's
    // turn, we now want the engine running freely).
    fireAnalysis();
  }

  let practiceResultTag = null;
  let practiceResultText = null;

  // Resign button — user concedes. Result is flipped: user's colour loses.
  const btnResign = document.getElementById('btn-resign');
  if (btnResign) btnResign.addEventListener('click', () => {
    if (!practiceColor) return;
    if (!confirm('Resign this game?')) return;
    const userLoses = practiceColor; // 'white' or 'black'
    const resultTag = userLoses === 'white' ? '0-1' : '1-0';
    const narrative = `You resigned. ${userLoses === 'white' ? 'Black' : 'White'} wins.`;
    finishPracticeGame(resultTag, narrative);
  });

  // Offer-Draw button — the engine "decides" based on the current eval.
  // Engine accepts when |eval from its side| is < 50 cp (near equal) or
  // when it's losing. Declines when it's clearly winning (why would it
  // accept?). We use the engine's most recent top evaluation; if none
  // is available yet we default to accept so the user isn't stuck.
  const btnDraw = document.getElementById('btn-offer-draw');
  if (btnDraw) btnDraw.addEventListener('click', async () => {
    if (!practiceColor) return;
    const drawResp = document.getElementById('practice-draw-response');
    btnDraw.disabled = true;
    if (drawResp) drawResp.textContent = '⏳ Engine is deciding…';
    try {
      // Probe the engine on the current position at a modest depth so
      // we have a concrete eval to judge against. This respects the
      // engine-mute flag for the duration of the probe, same as askAI.
      const fen = board.isAtLive() ? board.fen() : rebuildFenAtPly(board.chess, board.viewPly);
      const wasEngineMuted = window.__engineMuted === true;
      window.__engineMuted = false;
      engine.stop();
      let evalCpWhite = 0;
      try {
        const probe = await AICoach.probeEngine(engine, fen, 14, 1);
        if (probe.lines.length) {
          const stm = fen.split(' ')[1] || 'w';
          const raw = probe.lines[0];
          const cpStm = raw.scoreKind === 'mate'
            ? (raw.score > 0 ? 10000 : -10000)
            : raw.score;
          evalCpWhite = stm === 'w' ? cpStm : -cpStm;
        }
      } finally {
        window.__engineMuted = wasEngineMuted;
      }
      // Engine's perspective: positive means engine is winning.
      const engineColour = practiceColor === 'white' ? 'b' : 'w';
      const evalCpEngine = engineColour === 'w' ? evalCpWhite : -evalCpWhite;
      // Accept when engine is not clearly winning. Threshold 80cp =
      // about a pawn and a half of committed advantage — below that
      // a draw is reasonable.
      const engineAccepts = evalCpEngine < 80;
      if (engineAccepts) {
        if (drawResp) drawResp.textContent = '✅ Engine accepted. Draw agreed.';
        finishPracticeGame('1/2-1/2', 'Draw agreed');
      } else {
        if (drawResp) drawResp.textContent = `❌ Engine declined (its eval ≈ ${(evalCpEngine/100).toFixed(2)} pawns in its favour). Play on.`;
      }
    } catch (err) {
      console.warn('[practice] draw-offer probe failed', err);
      if (drawResp) drawResp.textContent = `Engine couldn't decide — try again.`;
    } finally {
      btnDraw.disabled = false;
    }
  });

  // Save PGN — download the current game with the recorded result
  // tag. Reuses the existing tree.pgn() machinery.
  const btnPracticeSave = document.getElementById('btn-practice-save');
  if (btnPracticeSave) btnPracticeSave.addEventListener('click', () => {
    const tags = {
      Event: 'Practice vs Stockfish',
      Site:  'stockfish-explain',
      Date:  new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      White: practiceColor === 'white' ? 'Human' : `Stockfish (skill ${ui.rangeSkill.value || '?'})`,
      Black: practiceColor === 'black' ? 'Human' : `Stockfish (skill ${ui.rangeSkill.value || '?'})`,
      Result: practiceResultTag || '*',
    };
    try {
      let pgn = board.tree.pgn({ tags });
      // Inject NAG annotations + eval comments at every meaningful
      // swing using the timeline data we already have cached.
      try { pgn = Archive.annotatePgn(pgn, collectTimelinePlies()); } catch {}
      const filename = `practice-${tags.Date.replace(/\./g, '')}-${practiceColor}-vs-stockfish.pgn`;
      downloadBlob(pgn, filename, 'application/x-chess-pgn');
    } catch (err) {
      alert('Could not generate PGN: ' + err.message);
    }
  });

  // "New game" from the post-game card — re-opens the practice modal.
  const btnPracticeAgain = document.getElementById('btn-practice-again');
  if (btnPracticeAgain) btnPracticeAgain.addEventListener('click', () => {
    const practiceBtn = document.getElementById('btn-practice');
    if (practiceBtn) practiceBtn.click();
  });

  // "⏭ Next random favourite" — rotates to a new random favourite
  // opening without opening the practice modal. Uses the last
  // practice settings (skill, clock, style, side) except the colour
  // is overridden to whatever the user starred that opening with.
  const btnPracticeNextFav = document.getElementById('btn-practice-next-fav');
  if (btnPracticeNextFav) btnPracticeNextFav.addEventListener('click', () => {
    // Reach into the practice-modal's queue-pool helper — expose via
    // window so we don't have to duplicate the logic here.
    const pool = window.__practiceQueuePool ? window.__practiceQueuePool() : [];
    if (pool.length < 1) { alert('No starred openings.'); return; }
    const favs = JSON.parse(localStorage.getItem('stockfish-explain.practice-favourites') || '{}');
    const pickedKey = pool[Math.floor(Math.random() * pool.length)];
    const pSel   = document.getElementById('practice-opening');
    const pColor = document.getElementById('practice-color');
    // Resolve side: 'white' | 'black' | 'both' — 'both' picks
    // randomly on each rotation so the user practices both sides.
    const savedSide = favs[pickedKey] || 'white';
    const resolvedSide = savedSide === 'both'
      ? (Math.random() < 0.5 ? 'white' : 'black')
      : savedSide;
    if (pSel)   pSel.value   = pickedKey;
    if (pColor) pColor.value = resolvedSide;
    // Programmatically click Start — reuses the full start handler
    // including settings save, clock start, and analysis-kick.
    const startBtn = document.getElementById('practice-start');
    if (startBtn) {
      window.__practiceQueueActive = true;
      startBtn.click();
    }
  });

  // ────────── My Games archive browser ──────────
  (() => {
    const btnOpen   = document.getElementById('btn-my-games');
    const modal     = document.getElementById('my-games-modal');
    const closeBtn  = document.getElementById('my-games-close');
    const statsEl   = document.getElementById('my-games-stats');
    const filterEl  = document.getElementById('my-games-filter');
    const listEl    = document.getElementById('my-games-list');
    const clearBtn  = document.getElementById('my-games-clear');
    if (!btnOpen || !modal) return;

    const fmtCp = (cp, mate) => {
      if (mate != null) return mate > 0 ? `#${mate}` : `#-${Math.abs(mate)}`;
      if (cp == null) return '—';
      const v = cp / 100;
      return (v >= 0 ? '+' : '') + v.toFixed(2);
    };
    const render = () => {
      const games = Archive.loadGames();
      const stats = Archive.archiveStats();
      statsEl.innerHTML = games.length
        ? `<strong>${stats.total}</strong> games archived · W ${stats.byResult['1-0']||0} / D ${stats.byResult['1/2-1/2']||0} / L ${stats.byResult['0-1']||0} · ${Math.round(stats.bytesUsed/1024)} KB of ~4.5 MB cap used`
        : 'No games archived yet. Play a practice game — it will auto-archive on completion.';
      const f = (filterEl.value || '').trim().toLowerCase();
      const shown = f
        ? games.filter(g =>
            (g.opening?.name || '').toLowerCase().includes(f) ||
            (g.opponent  || '').toLowerCase().includes(f) ||
            (g.result    || '').toLowerCase().includes(f) ||
            (g.date      || '').toLowerCase().includes(f) ||
            (g.ending    || '').toLowerCase().includes(f))
        : games;
      listEl.innerHTML = shown.length
        ? shown.map(g => {
            const finalCp = g.plies.length ? g.plies[g.plies.length - 1] : null;
            const finalEval = finalCp ? fmtCp(finalCp.cpWhite, finalCp.mate) : '—';
            const resTag = g.result === '1-0' ? 'W'
                        : g.result === '0-1' ? 'L'
                        : g.result === '1/2-1/2' ? 'D' : '·';
            const resColor = resTag === 'W' ? '#52c41a' : resTag === 'L' ? '#dc3545' : resTag === 'D' ? '#ffc107' : 'var(--c-font-dim)';
            return `<div class="my-game-row" data-id="${g.id}" style="display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid var(--c-border);cursor:pointer;">
              <span style="width:22px;height:22px;border-radius:50%;background:${resColor};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;">${resTag}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;">${escHtml(g.opening?.name || '(unknown opening)')}</div>
                <div class="muted" style="font-size:11px;">${g.date} · ${g.plies.length} plies · ${g.userColor ? 'as ' + g.userColor : 'analysis'} · ${escHtml(g.opponent)} · ${escHtml(g.ending)}</div>
              </div>
              <span class="muted" style="font-family:var(--font-mono);font-size:11px;width:60px;text-align:right;">${finalEval}</span>
              <button class="my-game-load btn" data-id="${g.id}" title="Load this game into the board" style="font-size:11px;padding:4px 8px;">Load</button>
              <button class="my-game-delete btn" data-id="${g.id}" title="Delete this game" style="font-size:11px;padding:4px 8px;background:rgba(220,53,69,0.1);border-color:#dc3545;">✕</button>
            </div>`;
          }).join('')
        : `<p class="muted" style="padding:20px;text-align:center;">No games match your filter.</p>`;
    };
    const loadGame = (id) => {
      const g = Archive.getGame(id);
      if (!g) return;
      modal.hidden = true;
      board.newGame();
      try {
        if (g.startingFen && g.startingFen !== board.startingFen) {
          board.chess.load(g.startingFen);
          board.startingFen = g.startingFen;
        }
        for (const p of g.plies) {
          try { board.chess.move(p.san, { sloppy: true }); } catch { break; }
        }
        board.cg.set({ fen: board.chess.fen(), turnColor: board.chess.turn() === 'w' ? 'white' : 'black' });
        board.dispatchEvent(new CustomEvent('move'));
        ui.narrationText.innerHTML = `📚 Loaded archived game: <strong>${escHtml(g.opening?.name || 'game')}</strong> (${g.date}). Walk through with ← → to review with full engine eval.`;
      } catch (err) {
        console.warn('[archive] load failed', err);
        alert('Could not load that game.');
      }
    };
    btnOpen.addEventListener('click', () => { render(); modal.hidden = false; });
    closeBtn.addEventListener('click', () => modal.hidden = true);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    filterEl.addEventListener('input', render);
    listEl.addEventListener('click', (e) => {
      const loadBtn = e.target.closest('.my-game-load');
      const delBtn  = e.target.closest('.my-game-delete');
      const row     = e.target.closest('.my-game-row');
      if (loadBtn) { loadGame(+loadBtn.dataset.id); return; }
      if (delBtn)  { if (confirm('Delete this archived game?')) { Archive.deleteGame(+delBtn.dataset.id); render(); } return; }
      if (row)     { loadGame(+row.dataset.id); }
    });
    clearBtn.addEventListener('click', () => {
      if (!Archive.loadGames().length) return;
      if (!confirm('Delete ALL archived games? This cannot be undone.')) return;
      Archive.clearArchive();
      render();
    });
  })();

  // ────────── Mistake Bank ──────────
  (() => {
    const btnOpen   = document.getElementById('btn-mistake-bank');
    const modal     = document.getElementById('mistake-bank-modal');
    const closeBtn  = document.getElementById('mistake-bank-close');
    const statsEl   = document.getElementById('mistake-bank-stats');
    const listEl    = document.getElementById('mistake-bank-list');
    const fBlunder  = document.getElementById('mb-filter-blunder');
    const fMistake  = document.getElementById('mb-filter-mistake');
    const fInacc    = document.getElementById('mb-filter-inaccuracy');
    const fByUser   = document.getElementById('mb-filter-by-user');
    if (!btnOpen || !modal) return;

    const SEVERITY_STYLE = {
      blunder:    { label: '??', bg: '#dc3545', pillText: 'Blunder' },
      mistake:    { label: '?',  bg: '#fd7e14', pillText: 'Mistake' },
      inaccuracy: { label: '?!', bg: '#ffc107', pillText: 'Inaccuracy' },
    };

    const fmtCp = (cp) => {
      if (cp == null) return '—';
      const v = cp / 100;
      return (v >= 0 ? '+' : '') + v.toFixed(2);
    };

    const render = () => {
      const all = Archive.deriveMistakes();
      const allowed = new Set();
      if (fBlunder.checked) allowed.add('blunder');
      if (fMistake.checked) allowed.add('mistake');
      if (fInacc.checked)   allowed.add('inaccuracy');
      const byUser = fByUser.checked;
      const shown = all.filter(m =>
        allowed.has(m.severity) && (!byUser || m.byUser === true));
      statsEl.innerHTML = all.length
        ? `<strong>${all.length}</strong> mistakes across your games (${shown.length} shown). ` +
          `Blunders: ${all.filter(m => m.severity === 'blunder').length} · ` +
          `Mistakes: ${all.filter(m => m.severity === 'mistake').length} · ` +
          `Inaccuracies: ${all.filter(m => m.severity === 'inaccuracy').length}.`
        : 'No mistakes logged yet. Play some games — this list builds automatically.';
      listEl.innerHTML = shown.length
        ? shown.map(m => {
            const sty = SEVERITY_STYLE[m.severity];
            return `<div class="mb-row" data-fen="${escHtml(m.fenBefore)}" data-fen-after="${escHtml(m.fenAfter)}" data-game="${m.gameId}" data-ply="${m.ply}" style="display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid var(--c-border);cursor:pointer;">
              <span style="min-width:32px;height:22px;border-radius:3px;background:${sty.bg};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;padding:0 6px;">${sty.label}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;">Move ${Math.ceil(m.ply/2)}${m.ply%2===1?'.':'...'} ${escHtml(m.san)}
                  <span class="muted" style="font-weight:400;font-size:11px;">· ${sty.pillText} · eval ${fmtCp(m.cpBefore)} → ${fmtCp(m.cpAfter)} (−${(m.swing/100).toFixed(2)})</span>
                </div>
                <div class="muted" style="font-size:11px;">${m.date} · ${escHtml(m.opening?.name || 'unknown opening')} · ${m.byUser === true ? 'your move' : m.byUser === false ? 'opponent move' : ''}</div>
              </div>
              <button class="mb-load btn" title="Load this position — try to find the better move" style="font-size:11px;padding:4px 8px;">Review</button>
            </div>`;
          }).join('')
        : `<p class="muted" style="padding:20px;text-align:center;">No mistakes match your filters.</p>`;
    };

    const loadMistake = (fenBefore) => {
      modal.hidden = true;
      try {
        board.newGame();
        board.chess.load(fenBefore);
        board.startingFen = fenBefore;
        board.cg.set({ fen: fenBefore, turnColor: board.chess.turn() === 'w' ? 'white' : 'black' });
        board.dispatchEvent(new CustomEvent('new-game'));
        ui.narrationText.innerHTML =
          `🎓 <strong>Mistake drill.</strong> The position is loaded — find the move that should have been played. Click 🧠 "Run both" on the Coach panel for an analysis of what went wrong.`;
      } catch (err) {
        console.warn('[mistake-bank] load failed', err);
      }
    };

    btnOpen.addEventListener('click', () => { render(); modal.hidden = false; });
    closeBtn.addEventListener('click', () => modal.hidden = true);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    for (const cb of [fBlunder, fMistake, fInacc, fByUser]) {
      cb.addEventListener('change', render);
    }
    listEl.addEventListener('click', (e) => {
      const row = e.target.closest('.mb-row');
      if (!row) return;
      loadMistake(row.dataset.fen);
    });
  })();

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ────────── Drill (SRS) — spaced-repetition review queue ──────────
  (() => {
    const btnOpen   = document.getElementById('btn-drill');
    const modal     = document.getElementById('drill-modal');
    const closeBtn  = document.getElementById('drill-close');
    const badge     = document.getElementById('drill-badge');
    const emptyEl   = document.getElementById('drill-empty');
    const activeEl  = document.getElementById('drill-active');
    const posEl     = document.getElementById('drill-position');
    const totalEl   = document.getElementById('drill-total');
    const statusEl  = document.getElementById('drill-status');
    const severityEl= document.getElementById('drill-severity');
    const contextEl = document.getElementById('drill-context');
    const revealEl  = document.getElementById('drill-reveal');
    const revealBody= document.getElementById('drill-reveal-body');
    const statsEl   = document.getElementById('drill-stats');
    const btnAgain  = document.getElementById('drill-again');
    const btnHard   = document.getElementById('drill-hard');
    const btnGood   = document.getElementById('drill-good');
    const btnEasy   = document.getElementById('drill-easy');
    if (!btnOpen || !modal) return;

    let queue = [];
    let idx = 0;

    const fmtCp = (cp) => {
      if (cp == null) return '—';
      const v = cp / 100;
      return (v >= 0 ? '+' : '') + v.toFixed(2);
    };

    const updateBadge = () => {
      const due = Archive.dueMistakeCards(999).length;
      if (due > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = String(due);
      } else {
        badge.style.display = 'none';
      }
    };
    updateBadge();
    setInterval(updateBadge, 30000);

    const renderActive = () => {
      const item = queue[idx];
      if (!item) { showEmpty(); return; }
      emptyEl.hidden = true; activeEl.style.display = 'block';
      posEl.textContent = String(idx + 1);
      totalEl.textContent = String(queue.length);
      statusEl.textContent = item.status;
      severityEl.textContent = item.mistake.severity;
      const m = item.mistake;
      contextEl.innerHTML =
        `<strong>${escHtml(m.opening?.name || 'unknown opening')}</strong> · ` +
        `move ${Math.ceil(m.ply/2)}${m.ply%2===1?'.':'...'} · ` +
        `eval was <strong>${fmtCp(m.cpBefore)}</strong> (from mover's view) · ` +
        `${m.date}`;
      revealEl.open = false;
      revealBody.innerHTML =
        `<p>You actually played <strong>${escHtml(m.san)}</strong>, eval dropped to <strong>${fmtCp(m.cpAfter)}</strong> (−${(m.swing/100).toFixed(2)}).</p>` +
        `<p class="muted" style="font-size:11px;">Click <em>Review</em> below to load the position into the board. Then click 🧠 "Run both" in the Coach panel to see what you should have played instead.</p>` +
        `<button id="drill-load-position" class="btn" style="font-size:11px;padding:4px 8px;">📂 Load position into board</button>`;
      const loadBtn = revealBody.querySelector('#drill-load-position');
      if (loadBtn) loadBtn.addEventListener('click', () => {
        try {
          board.newGame();
          board.chess.load(m.fenBefore);
          board.startingFen = m.fenBefore;
          board.cg.set({ fen: m.fenBefore, turnColor: board.chess.turn() === 'w' ? 'white' : 'black' });
          board.dispatchEvent(new CustomEvent('new-game'));
          modal.hidden = true;
          ui.narrationText.innerHTML = `🃏 Drill position loaded. You're on ply ${m.ply}. Try to find the move the engine prefers. Use 🧠 "Run both" for analysis.`;
        } catch (err) { alert('Could not load position: ' + err.message); }
      });
      const srsStats = Archive.srsStats();
      statsEl.textContent = `SRS: ${srsStats.total} cards total · ${srsStats.learning} learning · ${srsStats.mature} mature (≥21 days)`;
    };

    const showEmpty = () => {
      emptyEl.hidden = false;
      activeEl.style.display = 'none';
      updateBadge();
    };

    const startDrill = () => {
      queue = Archive.dueMistakeCards(15);
      idx = 0;
      if (!queue.length) { showEmpty(); return; }
      renderActive();
    };

    const grade = (g) => {
      const item = queue[idx];
      if (!item) return;
      const updated = Archive.gradeCard(item.card, g);
      Archive.upsertCard(updated);
      idx++;
      if (idx >= queue.length) showEmpty();
      else renderActive();
      updateBadge();
    };

    btnOpen.addEventListener('click', () => { startDrill(); modal.hidden = false; });
    closeBtn.addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    btnAgain.addEventListener('click', () => grade('again'));
    btnHard.addEventListener('click',  () => grade('hard'));
    btnGood.addEventListener('click',  () => grade('good'));
    btnEasy.addEventListener('click',  () => grade('easy'));
  })();

  // ────────── User identity (name + persistent device ID) ──────────
  // Captured on first load so every archived game / mistake / drill
  // session can be stamped with the user. The ID stays stable across
  // sessions on the same device even if the user later changes their
  // display name — making it safe to key a future DB sync on.
  (() => {
    const NAME_KEY = 'stockfish-explain.user-name';
    const ID_KEY   = 'stockfish-explain.user-id';
    const genId = () => {
      // Short stable device ID — 12 chars of base36 random + a 2-char
      // clock fingerprint for uniqueness.
      const rand = Math.random().toString(36).slice(2, 12);
      const clk  = Date.now().toString(36).slice(-2);
      return 'dev-' + rand + clk;
    };
    let userId   = localStorage.getItem(ID_KEY);
    let userName = localStorage.getItem(NAME_KEY);
    if (!userId) {
      userId = genId();
      try { localStorage.setItem(ID_KEY, userId); } catch {}
    }
    if (!userName) {
      // First-load prompt. Non-blocking: default to the ID when user
      // cancels / leaves blank.
      setTimeout(() => {
        const entered = window.prompt(
          "What should we call you?\n\n(Used to stamp your saved games and future cloud sync. Leave blank to use your device ID.)",
          ''
        );
        const clean = (entered || '').trim().slice(0, 40);
        userName = clean || userId;
        try { localStorage.setItem(NAME_KEY, userName); } catch {}
        refreshUserPill();
      }, 500);
    }

    window.__user = { id: userId, get name() { return userName; }, set name(n) { userName = n; } };

    const pill = document.getElementById('user-pill');
    const refreshUserPill = () => {
      if (!pill) return;
      const label = (userName && userName !== userId) ? userName : userId;
      pill.textContent = '👤 ' + label;
      pill.title = `Name: ${userName || '(not set)'} · Device ID: ${userId}\n(click to rename)`;
    };
    refreshUserPill();
    if (pill) pill.addEventListener('click', () => {
      const next = window.prompt('Change your display name:', userName || '');
      if (next == null) return;
      const clean = next.trim().slice(0, 40);
      userName = clean || userId;
      try { localStorage.setItem(NAME_KEY, userName); } catch {}
      refreshUserPill();
    });
  })();

  // ────────── Mobile-first layout (#24) ──────────
  // Detects narrow viewports and opts into a bottom-sheet drawer mode
  // where the tools panel docks to the bottom with a peek strip. The
  // user taps the peek strip to expand/collapse; drawer starts
  // collapsed on first load to maximise board real estate.
  (() => {
    const MOBILE_MAX = 640;
    const applyMobile = () => {
      const isMobile = window.innerWidth <= MOBILE_MAX;
      document.body.classList.toggle('mobile-mode', isMobile);
      if (!isMobile) document.body.classList.remove('mobile-drawer-collapsed');
    };
    applyMobile();
    window.addEventListener('resize', applyMobile);
    // Drawer toggle via the ::before peek handle — we watch click at
    // the top of .tools.
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('mobile-mode')) return;
      const tools = document.querySelector('.tools');
      if (!tools) return;
      const rect = tools.getBoundingClientRect();
      const y = e.clientY;
      if (e.target === tools || tools.contains(e.target)) {
        // Only treat clicks in the top 36px as toggle — avoid hijacking
        // real content taps.
        if (y <= rect.top + 36) {
          document.body.classList.toggle('mobile-drawer-collapsed');
          e.preventDefault();
        }
      }
    });
    // Collapse by default on first mobile load so the board gets the
    // full height.
    if (window.innerWidth <= MOBILE_MAX) {
      document.body.classList.add('mobile-drawer-collapsed');
    }
  })();

  // ────────── Animated GIF / WebM export (#28) ──────────
  // Renders each ply of the mainline to an off-screen canvas, captures
  // the stream via MediaRecorder, and downloads a .webm file. We use
  // WebM rather than GIF because browsers can produce it natively with
  // zero dependencies (GIF would require gif.js or similar library).
  // The output plays in any modern browser, VLC, embed in slides etc.
  (() => {
    const btn = document.getElementById('btn-export-gif');
    if (!btn) return;

    const PIECE_CHAR = {
      P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔',
      p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
    };

    const drawBoardFrame = (ctx, fen, cpWhite, ply, sanMove) => {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const BOARD = Math.min(W, H - 80);
      const SQ = BOARD / 8;
      const OX = (W - BOARD) / 2;
      const OY = 10;

      // Background
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, W, H);

      // Board squares
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#e9e1cf' : '#8b7a5c';
          ctx.fillRect(OX + c * SQ, OY + r * SQ, SQ, SQ);
        }
      }
      // Pieces
      const rows = (fen.split(' ')[0] || '').split('/');
      ctx.font = `${SQ * 0.8}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < 8; r++) {
        let file = 0;
        for (const ch of rows[r] || '') {
          if (/\d/.test(ch)) { file += +ch; continue; }
          ctx.fillStyle = ch === ch.toUpperCase() ? '#ffffff' : '#111111';
          ctx.strokeStyle = ch === ch.toUpperCase() ? '#000000' : '#ffffff';
          ctx.lineWidth = 1.5;
          const x = OX + file * SQ + SQ / 2;
          const y = OY + r * SQ + SQ / 2;
          ctx.strokeText(PIECE_CHAR[ch] || ch, x, y);
          ctx.fillText(PIECE_CHAR[ch] || ch, x, y);
          file++;
        }
      }
      // Eval bar along the bottom
      const barY = OY + BOARD + 16;
      const barH = 18;
      const barW = BOARD;
      const barX = OX;
      // normalise cpWhite to [-1, +1]
      const normal = cpWhite == null
        ? 0
        : 2 / (1 + Math.exp(-cpWhite / 400)) - 1;
      const whiteW = Math.max(0, Math.min(1, (normal + 1) / 2)) * barW;
      ctx.fillStyle = '#333';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#eee';
      ctx.fillRect(barX, barY, whiteW, barH);
      // Eval number
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      const evalStr = cpWhite == null
        ? 'eval —'
        : `eval ${cpWhite >= 0 ? '+' : ''}${(cpWhite / 100).toFixed(2)}`;
      ctx.fillText(`Ply ${ply}${sanMove ? ' · ' + sanMove : ''}  ·  ${evalStr}`, barX + 4, barY + barH + 18);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    };

    const renderAndExport = async () => {
      const plies = collectTimelinePlies();
      if (plies.length < 2) { alert('Need at least one move to export.'); return; }

      const W = 420, H = 500;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      // Paint an initial frame so the stream has something before
      // recording starts.
      drawBoardFrame(ctx, plies[0].fen, plies[0].cpWhite, 0, 'start');

      if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
        alert('Your browser does not support canvas.captureStream + MediaRecorder. Try Chrome or Firefox.');
        return;
      }

      const fps = 2;
      const stream = canvas.captureStream(fps);
      const mime = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ].find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise(resolve => { rec.onstop = resolve; });

      ui.narrationText.innerHTML = `🎞 <strong>Recording…</strong> ${plies.length} frames at ${fps} fps. Please don't switch tabs.`;

      rec.start();
      const frameDelay = 1000 / fps;
      for (let i = 0; i < plies.length; i++) {
        const p = plies[i];
        drawBoardFrame(ctx, p.fen, p.cpWhite, p.ply, i === 0 ? 'start' : p.san);
        await new Promise(r => setTimeout(r, frameDelay));
      }
      // Hold the final frame for an extra second.
      await new Promise(r => setTimeout(r, 1000));
      rec.stop();
      stream.getTracks().forEach(t => t.stop());
      await done;

      const blob = new Blob(chunks, { type: mime });
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `game-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      ui.narrationText.innerHTML = `✅ Exported ${plies.length}-frame WebM video (${Math.round(blob.size / 1024)} KB). Plays in Chrome / Firefox / VLC / most slide apps. For a true GIF, drop the .webm into cloudconvert.com or ffmpeg.`;
    };

    btn.addEventListener('click', () => {
      if (!confirm('Export the current game as a short animated video?\n\nThis will record ~' + (collectTimelinePlies().length * 0.5).toFixed(0) + ' seconds. Please don\'t switch tabs during recording.')) return;
      renderAndExport().catch(err => {
        console.error('[gif] export failed', err);
        alert('Export failed: ' + err.message);
      });
    });
  })();

  // ────────── Manual "Analyse & archive" (fix for analysis-mode never ends) ──
  // Lets the user deliberately push the current game into the archive
  // whenever they want, regardless of whether chess.js considers the
  // game "over". Runs the retrospective sweep first so every ply has
  // a solid cpWhite eval → mistake bank gets real data.
  (() => {
    const btn = document.getElementById('btn-archive-now');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const history = board.chess.history();
      if (!history.length) {
        flashPill(ui.engineMode, 'No moves to archive', 1500);
        return;
      }
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = '⏳ Analysing…';
      try {
        await retrospectiveSweep({
          minDepth: 12,
          onProgress: (d, t) => { btn.textContent = `⏳ Move ${d}/${t}…`; },
        });
        // Use whatever result tag the board currently shows (if mate),
        // else '*' for an incomplete game.
        let resultTag = '*', ending = 'Archived mid-game';
        if (board.chess.isCheckmate()) {
          const loser = board.chess.turn();
          resultTag = loser === 'w' ? '0-1' : '1-0';
          ending = loser === 'w' ? 'Black wins by checkmate' : 'White wins by checkmate';
        } else if (board.chess.isStalemate()) { resultTag = '1/2-1/2'; ending = 'Stalemate'; }
        else if (board.chess.isDraw())        { resultTag = '1/2-1/2'; ending = 'Draw'; }
        archiveCurrentGame({ result: resultTag, ending, mode: practiceColor ? 'practice' : 'analysis' });
        ui.narrationText.innerHTML =
          `✅ Archived. ${history.length}-ply game saved to 📚 My Games · any mistakes added to 🎓 Mistake Bank.`;
      } catch (err) {
        console.error('[archive-now]', err);
        alert('Archive failed: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  })();

  // ────────── Share position URL (#27) ──────────
  // Builds a URL of the form:
  //   https://.../#share=<base64url-json>
  // where the JSON has { fen, moves: sanHistory }. Short enough to
  // paste anywhere (~200-400 chars for typical positions). The
  // receiving page detects the hash on load and restores the position.
  (() => {
    const btnShare = document.getElementById('btn-share');
    if (!btnShare) return;
    const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const b64urlDecode = (s) => {
      s = s.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      return atob(s);
    };

    const buildShareUrl = () => {
      const fen = board.fen();
      const moves = board.chess.history();
      const payload = { fen, moves, startingFen: board.startingFen };
      const encoded = b64url(JSON.stringify(payload));
      const baseUrl = location.origin + location.pathname;
      return `${baseUrl}#share=${encoded}`;
    };

    btnShare.addEventListener('click', async () => {
      const url = buildShareUrl();
      let ok = false;
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch {}
      // Modal with the URL so user can copy manually if clipboard denied.
      const w = Math.min(600, window.innerWidth - 40);
      const existing = document.getElementById('share-url-popup');
      if (existing) existing.remove();
      const popup = document.createElement('div');
      popup.id = 'share-url-popup';
      popup.className = 'modal';
      popup.style.zIndex = '99999';
      popup.innerHTML = `
        <div class="modal-card" style="max-width:${w}px;">
          <button class="modal-close" id="share-url-close">×</button>
          <h3>🔗 Share this position</h3>
          <p class="muted" style="font-size:12px;">${ok ? '✅ Copied to clipboard!' : 'Select and copy this link:'}</p>
          <textarea readonly style="width:100%;height:80px;font-family:var(--font-mono);font-size:11px;padding:8px;">${url}</textarea>
          <p class="muted" style="font-size:11px;margin-top:8px;">Anyone who opens this link will see the same position with the move history replayed. Nothing is uploaded — the position is encoded in the URL itself.</p>
        </div>`;
      document.body.appendChild(popup);
      popup.hidden = false;
      popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });
      document.getElementById('share-url-close').addEventListener('click', () => popup.remove());
      const ta = popup.querySelector('textarea');
      if (ta) { ta.focus(); ta.select(); }
    });

    // ── Restore from URL hash on page load ──
    (function tryRestoreShare() {
      const h = location.hash;
      if (!h || !h.startsWith('#share=')) return;
      try {
        const encoded = h.slice('#share='.length);
        const json = b64urlDecode(encoded);
        const payload = JSON.parse(json);
        if (!payload || !payload.fen) return;
        // Defer until after board initialisation is stable.
        setTimeout(() => {
          try {
            board.newGame();
            if (payload.startingFen && payload.startingFen !== board.startingFen) {
              board.chess.load(payload.startingFen);
              board.startingFen = payload.startingFen;
            }
            for (const san of payload.moves || []) {
              try { board.chess.move(san, { sloppy: true }); } catch { break; }
            }
            board.cg.set({
              fen: board.chess.fen(),
              turnColor: board.chess.turn() === 'w' ? 'white' : 'black',
            });
            board.dispatchEvent(new CustomEvent('move'));
            if (ui.narrationText) {
              ui.narrationText.innerHTML =
                `🔗 <strong>Loaded a shared position</strong> — ${payload.moves?.length || 0} moves replayed. ` +
                `This position is fresh in your analysis board; clear the URL hash to stop auto-loading.`;
            }
            // Clear the hash so a page refresh doesn't re-restore.
            history.replaceState(null, '', location.pathname);
          } catch (err) { console.warn('[share] restore failed', err); }
        }, 400);
      } catch (err) {
        console.warn('[share] bad hash payload', err);
      }
    })();
  })();

  // ────────── Save current position as a custom practice opening ──────
  (() => {
    const btnSave    = document.getElementById('btn-save-as-opening');
    const sModal     = document.getElementById('save-opening-modal');
    const sClose     = document.getElementById('save-opening-close');
    const sName      = document.getElementById('save-opening-name');
    const sGroup     = document.getElementById('save-opening-group');
    const sNewGroup  = document.getElementById('save-opening-new-group');
    const sPreview   = document.getElementById('save-opening-preview');
    const sSubmit    = document.getElementById('save-opening-submit');
    if (!btnSave || !sModal) return;

    const CUSTOM_STORAGE_KEY = 'stockfish-explain.practice-custom-openings';
    const loadCustoms = () => {
      try { return JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) || '[]'); } catch { return []; }
    };
    const saveCustoms = (arr) => {
      try { localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(arr)); } catch {}
    };

    const openSaveModal = () => {
      const history = board.chess.history();
      if (!history.length) {
        alert('Play at least one move before saving — there is nothing to capture.');
        return;
      }
      // Populate the Group dropdown from existing OPENINGS groups and
      // any custom groups the user has already created.
      const groupNames = new Set(OPENINGS.map(g => g.group));
      for (const co of loadCustoms()) groupNames.add(co.group);
      sGroup.innerHTML = '';
      for (const g of groupNames) {
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        sGroup.appendChild(opt);
      }
      // Default name: last opening detected or "Custom line @ move N"
      sName.value = `My line @ move ${Math.ceil(history.length / 2)}`;
      sNewGroup.value = '';
      sPreview.textContent = history.map((m, i) =>
        i % 2 === 0 ? `${Math.floor(i/2)+1}.${m}` : m
      ).join(' ');
      sModal.hidden = false;
      setTimeout(() => sName.focus(), 50);
    };
    btnSave.addEventListener('click', openSaveModal);
    sClose.addEventListener('click', () => sModal.hidden = true);
    sModal.addEventListener('click', (e) => { if (e.target === sModal) sModal.hidden = true; });

    sSubmit.addEventListener('click', () => {
      const name = (sName.value || '').trim();
      if (!name) { alert('Please name this opening.'); return; }
      const group = (sNewGroup.value.trim() || sGroup.value).trim();
      if (!group) { alert('Please pick or enter a group.'); return; }
      const moves = board.chess.history();
      if (!moves.length) { alert('No moves on the board to save.'); return; }
      const customs = loadCustoms();
      customs.push({ group, name, moves, savedAt: Date.now() });
      saveCustoms(customs);
      sModal.hidden = true;
      // Visual confirmation in the narration line.
      if (ui.narrationText) {
        ui.narrationText.innerHTML =
          `✅ Saved <strong>${name}</strong> to group <strong>${group}</strong>. ` +
          `Open Practice to pick it from the list.`;
      }
    });
  })();

  // ────────── Tournament (engine vs engine) ──────────
  // The main analysis engine MUST be paused while a tournament runs —
  // otherwise it competes for CPU with the tournament workers.
  setupTournament(board, fireAnalysis, {
    pause: () => {
      if (!paused) {
        paused = true;
        engine.stop();
        const btn = document.getElementById('btn-pause');
        btn.textContent = '▶ Resume';
        btn.classList.add('paused');
      }
    },
    resume: () => {
      if (paused) {
        paused = false;
        const btn = document.getElementById('btn-pause');
        btn.textContent = '⏸ Pause';
        btn.classList.remove('paused');
        fireAnalysis();
      }
    },
  });

  // Top-row buttons
  document.getElementById('btn-new').addEventListener('click',  () => board.newGame());
  document.getElementById('btn-flip').addEventListener('click', () => board.flipBoard());
  // Second flip button in the below-board nav strip, for quick reach
  const boardNavFlip = document.getElementById('board-nav-flip');
  if (boardNavFlip) boardNavFlip.addEventListener('click', () => board.flipBoard());

  // Sync eval-gauge orientation with the chessboard. When the user
  // flips to play Black from the bottom, the gauge also flips so the
  // "side at the bottom" corresponds on both the board and the bar.
  const evalGauge = document.getElementById('eval-gauge');
  const applyGaugeOrientation = (orientation) => {
    if (!evalGauge) return;
    evalGauge.classList.toggle('flipped', orientation === 'black');
  };
  applyGaugeOrientation(board.orientation);
  board.addEventListener('orientation-change', (ev) => {
    applyGaugeOrientation(ev.detail.orientation);
  });

  // 📄 Log — download the captured console output so the user can send
  // it to me without having to open devtools.
  const btnDownloadLog = document.getElementById('btn-download-log');
  if (btnDownloadLog) {
    btnDownloadLog.addEventListener('click', () => {
      const content = buildLogFile();
      downloadBlob(content, `stockfish-explain-log-${Date.now()}.txt`, 'text/plain');
      flashPill(ui.engineMode, `Log downloaded (${LOG_BUFFER.length} lines)`, 1400);
    });
  }
  document.getElementById('btn-undo').addEventListener('click', () => board.undo());

  // Copy FEN
  document.getElementById('btn-copy-fen').addEventListener('click', async () => {
    const fen = board.fen();
    try {
      await navigator.clipboard.writeText(fen);
      flashPill(ui.engineMode, 'FEN copied', 1200);
    } catch (e) {
      prompt('Copy this FEN:', fen);
    }
  });

  // Paste FEN → load position as a FRESH game starting point.
  // History is reset so undo/back can't go past this new position.
  // (Board editor is wired EARLY, before bootEngine, above.)

  document.getElementById('btn-paste-fen').addEventListener('click', async () => {
    let fen;
    try { fen = await navigator.clipboard.readText(); }
    catch { fen = prompt('Paste FEN here:'); }
    if (!fen) return;
    fen = fen.trim();
    let tmp;
    try { tmp = new Chess(fen); }
    catch (e) {
      alert('Invalid FEN:\n' + fen.slice(0, 100) + '\n\n' + e.message);
      return;
    }

    // Replace board.chess with a FRESH instance at the pasted FEN.
    // This clears history entirely — undo now stops here. We also update
    // the board's startingFen so that scrolling back to ply 0 shows the
    // pasted position (not the standard chess starting array).
    board.chess = tmp;
    board.startingFen = tmp.fen();
    board.viewPly = null;
    board.tree = new (board.tree.constructor)(tmp.fen());
    board.cg.set({
      fen: board.chess.fen(),
      turnColor: board.chess.turn() === 'w' ? 'white' : 'black',
      lastMove: undefined,
      check: board.chess.inCheck() ? (board.chess.turn() === 'w' ? 'white' : 'black') : false,
      movable: { color: 'both', dests: toDestsFrom(board.chess) },
    });
    board.cg.setAutoShapes([]);
    board.dispatchEvent(new CustomEvent('new-game'));

    flashPill(ui.engineMode, 'FEN loaded · new start', 1500);
    // Narration update
    ui.narrationText.textContent = `New starting position loaded. Side to move: ${board.chess.turn() === 'w' ? 'White' : 'Black'}. Undo now goes back to this position.`;
  });

  // Save PGN — downloads the current variation tree as a standards-
  // compliant PGN, with all sidelines preserved as parenthetical
  // variations (lichess-compatible output).
  document.getElementById('btn-save-pgn').addEventListener('click', () => {
    const tree = board.tree;
    if (!tree.root.children.length) {
      flashPill(ui.engineMode, 'No moves yet', 1200);
      return;
    }
    let pgn = tree.pgn({
      tags: {
        Event: 'Stockfish.explain analysis',
        White: 'User',
        Black: 'User',
        Result: '*',
      },
    });
    // Auto-annotate with NAGs ($2 = ?, $4 = ??, $6 = ?!) + short
    // eval-swing comments whenever per-move evals are cached.
    try { pgn = Archive.annotatePgn(pgn, collectTimelinePlies()); } catch {}
    downloadBlob(pgn, `game-${Date.now()}.pgn`, 'application/x-chess-pgn');
  });

  // Restart engine button — force-reboots the current flavor
  document.getElementById('btn-restart').addEventListener('click', async () => {
    ui.narrationText.textContent = 'Restarting engine…';
    engine.terminate();
    engine = new Engine();
    engine.setSkill(+ui.rangeSkill.value);
    engine.setMultiPV(+ui.rangeMultipv.value);
    explainer.engine = engine;
    explainer.wire();
    await bootEngine(currentFlavor);
  });

  // ───── Preload engines (HTTP-cache warming) ─────
  // Previous version used a Service Worker to cache engine assets
  // permanently in CacheStorage. That design crashed Chrome's renderer
  // ("Can't open this page / Error 5") on two real users when it served
  // partially-downloaded WASM. The SW at /sw.js now just self-
  // unregisters on activate, and preload is simple fetch() calls that
  // let Chrome's normal HTTP cache retain the bytes. Less persistent
  // but far safer.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations?.().then(regs => {
      for (const r of regs) r.unregister().catch(() => {});
    }).catch(() => {});
    // Register the cleanup SW so any legacy installation gets replaced
    // (the new one self-unregisters after wiping sf-engines-* caches).
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const btnPreload = document.getElementById('btn-preload-engines');
  if (btnPreload) {
    const ALL_ENGINE_URLS = (() => {
      const urls = [];
      const nnueSeen = new Set();
      for (const spec of Object.values(ENGINE_FLAVORS)) {
        urls.push('/' + spec.js);
        urls.push('/' + spec.js.replace(/\.js$/, '.wasm'));
        if (spec.externalNnue) {
          for (const path of Object.values(spec.externalNnue)) {
            if (nnueSeen.has(path)) continue;
            nnueSeen.add(path);
            urls.push('/' + path);
          }
        }
      }
      return urls;
    })();
    btnPreload.addEventListener('click', async () => {
      const orig = btnPreload.textContent;
      btnPreload.disabled = true;
      const total = ALL_ENGINE_URLS.length;
      let done = 0, failed = 0;
      btnPreload.textContent = `⬇ 0 / ${total}`;
      // 2 parallel — safe on memory, plenty fast enough.
      const queue = ALL_ENGINE_URLS.slice();
      const worker = async () => {
        while (queue.length) {
          const url = queue.shift();
          if (!url) break;
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort('timeout'), 4 * 60 * 1000);
            const resp = await fetch(url, { signal: ctrl.signal });
            clearTimeout(timer);
            if (!resp.ok) failed++;
            // Drain the body so Chrome actually commits it to HTTP cache.
            await resp.arrayBuffer().catch(() => {});
          } catch { failed++; }
          done++;
          const failPart = failed ? ` (${failed} skipped)` : '';
          btnPreload.textContent = `⬇ ${done} / ${total}${failPart}`;
        }
      };
      await Promise.all([worker(), worker()]);
      btnPreload.textContent = failed
        ? `✓ Warmed (${total - failed}/${total})`
        : '✓ Engines warmed';
      btnPreload.title = failed
        ? `${failed} files unavailable on the server — those variants fall back to lite`
        : 'All engines fetched into Chrome\'s HTTP cache';
      btnPreload.disabled = false;
      setTimeout(() => { btnPreload.textContent = orig; }, 6000);
    });
  }

  // ───── Toolbar show/hide toggle ─────
  // Large prominent button (lives OUTSIDE .site-nav so it's reachable
  // even when the nav is collapsed). Also auto-collapses during a
  // practice game so the player sees a clean board + clock + minimal
  // chrome, then restores the prior state when the game ends.
  const BODY_NAV_COLLAPSED = 'nav-collapsed';
  let prevNavCollapsed = document.body.classList.contains(BODY_NAV_COLLAPSED);
  const btnToggleToolbar = document.getElementById('btn-toggle-toolbar');
  if (btnToggleToolbar) {
    btnToggleToolbar.addEventListener('click', () => {
      document.body.classList.toggle(BODY_NAV_COLLAPSED);
      prevNavCollapsed = document.body.classList.contains(BODY_NAV_COLLAPSED);
      try { localStorage.setItem('stockfish-explain.nav-collapsed', prevNavCollapsed ? '1' : '0'); } catch {}
    });
  }
  // Wire the always-visible quick-action buttons to the existing
  // in-nav handlers so user gets one-click New game / Practice
  // regardless of whether the toolbar is collapsed.
  const btnQuickNew = document.getElementById('btn-quick-new');
  if (btnQuickNew) btnQuickNew.addEventListener('click', () => {
    document.getElementById('btn-new')?.click();
  });
  const btnQuickPractice = document.getElementById('btn-quick-practice');
  if (btnQuickPractice) btnQuickPractice.addEventListener('click', () => {
    document.getElementById('btn-practice')?.click();
  });
  if (btnToggleToolbar) {
    // Restore persisted state.
    try {
      if (localStorage.getItem('stockfish-explain.nav-collapsed') === '1') {
        document.body.classList.add(BODY_NAV_COLLAPSED);
        prevNavCollapsed = true;
      }
    } catch {}
  }

  // Graceful shutdown on page unload — send UCI 'quit' so the engine
  // process exits cleanly instead of being force-killed by the browser
  // when the tab closes. Matches the ChessScan on_closing pattern.
  window.addEventListener('beforeunload', () => {
    try {
      if (engine && engine.worker) {
        engine.worker.postMessage('quit');
        // Terminate worker explicitly — without this, emscripten's
        // pthread shim sometimes leaves SharedArrayBuffer workers
        // hanging when the page closes quickly.
        try { engine.worker.terminate(); } catch {}
      }
    } catch {}
  });

  // Clear engine cache — escape hatch if a bad preload left corrupt
  // WASM in the SW cache (symptoms: "Aw Snap! Error 5" on boot).
  // One click wipes the cache + unregisters the SW, then reloads.
  const btnClearCache = document.getElementById('btn-clear-engine-cache');
  if (btnClearCache) {
    btnClearCache.addEventListener('click', async () => {
      if (!confirm('Wipe cached engine files and reload? Any preloaded engines will need to be re-downloaded.')) return;
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('sf-engines-')).map(k => caches.delete(k)));
      } catch {}
      try {
        const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
        await Promise.all(regs.map(r => r.unregister()));
      } catch {}
      location.reload();
    });
  }

  // Lock button: hard-disable the engine until user explicitly unlocks.
  // While locked: no engine.start() is ever issued.
  const btnLock = document.getElementById('btn-lock');
  function updateLockButton() {
    if (locked) {
      btnLock.textContent = '🔒 Engine locked';
      btnLock.classList.add('locked');
      btnLock.title = 'Engine is LOCKED OFF. Click to unlock and resume analysis.';
    } else {
      btnLock.textContent = '🔓 Engine';
      btnLock.classList.remove('locked');
      btnLock.title = 'Engine is active. Click to lock OFF.';
    }
  }
  // Unified lock toggle — used by both the small header button and the big
  // ENGINE power button next to the eval panel. Keeps both in sync.
  function toggleEngineLocked() {
    locked = !locked;
    localStorage.setItem('stockfish-explain.engine-locked', locked ? '1' : '0');
    updateLockButton();
    updatePowerButton();
    if (locked) {
      // Mute FIRST so any in-flight info/bestmove events already in the
      // worker's send queue get dropped by the explainer's gate — the UI
      // freezes instantly even if the worker takes a moment to process
      // the `stop` command.
      window.__engineMuted = true;
      engine.stop();
      // Also silence threat mode if it was active
      if (window.__threatMode && window.__exitThreatMode) window.__exitThreatMode({ silent: true });
      ui.narrationText.textContent = '🔒 Engine stopped. Click the big ENGINE button to resume.';
      console.log('[engine] LOCKED — muted + stopped');
    } else {
      window.__engineMuted = false;
      console.log('[engine] UNLOCKED — resuming analysis');
      fireAnalysis();
    }
  }
  btnLock.addEventListener('click', toggleEngineLocked);

  // Clock pause/resume button — freezes both sides' time when the user
  // needs to step away. Works in count-up and count-down modes.
  const btnClockPause = document.getElementById('btn-clock-pause');
  if (btnClockPause) btnClockPause.addEventListener('click', togglePauseClock);

  // Big ENGINE power button in the eval panel — same state as lock.
  const powerBtn = document.getElementById('engine-power');
  function updatePowerButton() {
    if (!powerBtn) return;
    const label = powerBtn.querySelector('.engine-power-label');
    const sub   = powerBtn.querySelector('.engine-power-sub');
    if (locked) {
      powerBtn.classList.add('off');
      if (label) label.textContent = 'ENGINE: OFF';
      if (sub)   sub.textContent   = 'click to start analysis';
    } else {
      powerBtn.classList.remove('off');
      if (label) label.textContent = 'ENGINE: ON · analyzing';
      if (sub)   sub.textContent   = 'click to stop';
    }
  }
  if (powerBtn) powerBtn.addEventListener('click', toggleEngineLocked);
  updatePowerButton();
  updateLockButton();

  // ─── Threat button ─────────────────────────────────────────────
  // Passes the move to the opponent (null move) and asks Stockfish:
  // "what's their biggest threat right now?" Very common analysis aid.
  const threatBtn = document.getElementById('btn-threat');
  const threatOut = document.getElementById('threat-output');
  // Toggle mode: while ON, the engine runs INFINITELY on the flipped
  // side-to-move FEN — normal depth/score/PV lines all show the
  // opponent's best ideas continuously. Stays that way until user
  // toggles off OR makes a move / navigates the board.
  window.__threatMode = false;

  // Track the engine info listener so we can remove it on exit.
  let threatInfoListener = null;
  let threatFlippedFen   = null;

  function enterThreatMode() {
    if (!engineReady) return;
    const fen  = board.isAtLive() ? board.fen() : rebuildFenAtPly(board.chess, board.viewPly);
    const parts = fen.split(' ');
    if (parts.length < 4) return;
    const originalSide = parts[1];               // 'w' or 'b'
    parts[1] = originalSide === 'w' ? 'b' : 'w'; // flip side-to-move
    parts[3] = '-';                              // reset en-passant
    const flippedSide = parts[1];
    // Move-number convention:
    //   original White-to-move  → Black gets the move at SAME fullmove,
    //                             notated "N... <move>"
    //   original Black-to-move  → White gets the move at fullmove+1,
    //                             notated "(N+1). <move>"
    const origFullmove  = parseInt(parts[5] || '1', 10) || 1;
    const threatFullmove = flippedSide === 'w' ? origFullmove + 1 : origFullmove;
    // When we bumped fullmove for White, also bump the FEN counter so
    // the engine/explainer agree.
    if (flippedSide === 'w') parts[5] = String(threatFullmove);
    const flipped = parts.join(' ');
    threatFlippedFen = flipped;

    // Legality check
    let flippedChess;
    try { flippedChess = new Chess(flipped); }
    catch { threatOut.hidden = false; threatOut.innerHTML = `<em>Can't pass — illegal position.</em>`; return; }
    if (flippedChess.isGameOver()) {
      threatOut.hidden = false;
      threatOut.innerHTML = `<em>Nothing to threaten — opponent has no legal moves.</em>`;
      return;
    }

    window.__threatMode = true;
    threatBtn.classList.add('active');
    const label = threatBtn.querySelector('.threat-label');
    const sub   = threatBtn.querySelector('.threat-sub');
    if (label) label.textContent = '🎯 THREAT · ON';
    const side = flippedSide === 'w' ? 'White' : 'Black';
    if (sub)   sub.textContent   = `click to turn off · analyzing ${side}`;

    threatOut.hidden = false;
    threatOut.innerHTML = `<strong>🎯 Threat mode — analyzing ${side} at move ${threatFullmove}${flippedSide === 'b' ? '…' : '.'}</strong>
      <div class="threat-live muted"><em>Waiting for first search results…</em></div>`;

    ui.narrationText.innerHTML =
      `🎯 <strong>Threat mode</strong> — engine is calculating as if it were <strong>${side}'s turn</strong>. Toggle off or move to resume normal analysis.`;

    // Subscribe to live engine info so the threat panel keeps updating
    // with the current best move + eval as depth climbs.
    threatInfoListener = (ev) => {
      if (!window.__threatMode) return;
      const info = ev.detail;
      // Pick multipv=1 (best line)
      if (!info || info.multipv !== 1 || !info.pv || !info.pv.length) return;
      try {
        const chess = new Chess(flipped);
        const sans = [];
        for (const uci of info.pv.slice(0, 8)) {
          const mv = chess.move({
            from: uci.slice(0,2),
            to:   uci.slice(2,4),
            promotion: uci.length > 4 ? uci[4] : undefined,
          });
          if (!mv) break;
          sans.push(mv.san);
        }
        if (!sans.length) return;
        // Build a properly-numbered SAN line:
        //   if threat side is Black: "N... move, N+1. move, N+1... move"
        //   if threat side is White: "M. move, M... move, M+1. move"
        let side = flippedSide;     // whose move is NEXT in the PV (starts with threat side)
        let fm   = threatFullmove;
        const numbered = [];
        for (const san of sans) {
          if (side === 'w') numbered.push(`${fm}. ${san}`);
          else              numbered.push(`${fm}... ${san}`);
          // Advance
          if (side === 'w') side = 'b';
          else              { side = 'w'; fm++; }
        }
        const score = info.scoreKind === 'mate'
          ? `#${info.score}`
          : `${info.score >= 0 ? '+' : ''}${(info.score / 100).toFixed(2)}`;
        const liveEl = threatOut.querySelector('.threat-live');
        if (liveEl) {
          liveEl.innerHTML = `
            <span class="threat-move">${numbered[0]}</span>
            <span class="threat-score">(${score} from ${side === 'w' ? 'Black' : 'White'}'s view · depth ${info.depth})</span>
            <br>
            <span class="muted" style="font-family:var(--font-san);font-size:12px">${numbered.join('  ')}</span>`;
        }
      } catch {}
    };
    engine.addEventListener('info', threatInfoListener);

    // Kick engine onto the flipped FEN with INFINITE search — same as
    // a normal analysis, just on the flipped position. engine.stop()
    // first in case a normal search was already running.
    engine.stop();
    explainer.setFen(flipped);
    engine.start(flipped, { infinite: true });
  }

  function exitThreatMode({ silent = false } = {}) {
    if (!window.__threatMode) return;
    window.__threatMode = false;
    if (threatInfoListener) {
      engine.removeEventListener('info', threatInfoListener);
      threatInfoListener = null;
    }
    threatFlippedFen = null;
    threatBtn.classList.remove('active');
    const label = threatBtn.querySelector('.threat-label');
    const sub   = threatBtn.querySelector('.threat-sub');
    if (label) label.textContent = '🎯 THREAT';
    if (sub)   sub.textContent   = `what's their best move?`;
    threatOut.hidden = true;
    if (!silent) {
      ui.narrationText.textContent = 'Threat mode off — back to normal analysis.';
      fireAnalysis();  // restart on the real position
    }
  }
  // Expose so other handlers (move, nav, new-game) can cancel threat mode.
  window.__exitThreatMode = exitThreatMode;

  if (threatBtn && threatOut) {
    threatBtn.addEventListener('click', () => {
      if (window.__threatMode) exitThreatMode();
      else                     enterThreatMode();
    });
  }
  if (locked) ui.narrationText.textContent = '🔒 Engine stopped. Click the big ENGINE button (next to the eval) to start analysis.';

  const btnPause = document.getElementById('btn-pause');
  btnPause.addEventListener('click', () => {
    paused = !paused;
    if (paused) {
      window.__engineMuted = true;
      engine.stop();
      btnPause.textContent = '▶ Resume';
      btnPause.classList.add('paused');
      console.log('[engine] PAUSED — muted + stopped');
    } else {
      window.__engineMuted = false;
      btnPause.textContent = '⏸ Pause';
      btnPause.classList.remove('paused');
      console.log('[engine] RESUMED');
      fireAnalysis();
    }
  });

  // Keyboard move input — accept SAN (Nf3, e4, O-O, etc.)
  ui.kbdMove.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const txt = ui.kbdMove.value.trim();
    if (!txt) return;
    try {
      const mv = board.chess.move(txt, { strict: false });
      if (mv) {
        // chess.js accepted it — sync chessground and fire our normal pipeline
        board.cg.move(mv.from, mv.to);
        board._syncToChessground([mv.from, mv.to]);
        board.dispatchEvent(new CustomEvent('move', { detail: { move: mv, fen: board.fen() } }));
        ui.kbdMove.value = '';
      } else {
        flashInput(ui.kbdMove, 'illegal');
      }
    } catch { flashInput(ui.kbdMove, 'illegal'); }
  });

  // Gauge matches the BOARD's height exactly (from rank 8 top to rank 1 bottom),
  // not board-area (which includes the nav row below).
  const boardInner = document.getElementById('board');
  const ro = new ResizeObserver(() => {
    const rect = boardInner.getBoundingClientRect();
    if (rect.height > 0) {
      ui.evalGauge.style.height = rect.height + 'px';
      ui.evalGauge.style.minHeight = '0';
    }
  });
  ro.observe(boardInner);

  // Resizable board — lichess-style drag handle. Keeps the board SQUARE
  // by setting explicit equal width + height on the board element.
  const resizeHandle = document.getElementById('board-resize');
  const boardElForResize = document.getElementById('board');
  if (resizeHandle) {
    let resizing = false;
    let startX = 0, startY = 0, startW = 0;
    const STORAGE_KEY = 'stockfish-explain.board-size';

    const applySize = (size) => {
      const sz = Math.max(300, Math.min(1100, Math.round(size)));
      ui.boardArea.style.maxWidth = sz + 'px';
      ui.boardArea.style.width    = sz + 'px';
      boardElForResize.style.width  = sz + 'px';
      boardElForResize.style.height = sz + 'px';
      // During an active drag, only fire the lightweight chessground
      // re-measure event — the full window.resize event triggers every
      // layout-observing listener in the app (eval timeline, accuracy
      // strip, explainer, etc.) and causes jank. Full re-measure on
      // pointerup instead.
      if (!resizing) window.dispatchEvent(new Event('resize'));
      document.dispatchEvent(new Event('chessgroundResize'));
    };

    // Apply saved size OR a sensible default. Without this, the board column
    // (which is `auto` in the grid) collapses to the content's intrinsic size
    // and the board ends up tiny.
    const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
    applySize(saved || defaultBoardSize());

    // Also re-fit on window resize if the user hasn't set a preference
    window.addEventListener('resize', () => {
      if (!localStorage.getItem(STORAGE_KEY)) applySize(defaultBoardSize());
    });

    // rAF-coalesced resize (lichess-style smooth drag). We batch all
    // pointermove events into at most one applySize per animation
    // frame (~16 ms) so DOM writes + chessground relayout don't happen
    // 120+ times per second on a high-Hz pointer.
    let pendingSize = 0;
    let rafId = 0;
    const scheduleSize = (size) => {
      pendingSize = size;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        applySize(pendingSize);
      });
    };

    resizeHandle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      startW = boardElForResize.getBoundingClientRect().width;
      // Lock the user preference IMMEDIATELY on drag start so the
      // window.resize → applySize(default) listener can't fight us.
      // Previously it would reset the board to default every frame
      // during a drag that hadn't yet hit pointerup — classic jitter.
      localStorage.setItem(STORAGE_KEY, String(Math.round(startW)));
      resizeHandle.setPointerCapture(e.pointerId);
    });
    resizeHandle.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const delta = (dx + dy) / 2;
      scheduleSize(startW + delta);
    });
    resizeHandle.addEventListener('pointerup', (e) => {
      if (!resizing) return;
      resizing = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      resizeHandle.releasePointerCapture(e.pointerId);
      const finalW = Math.round(boardElForResize.getBoundingClientRect().width);
      localStorage.setItem(STORAGE_KEY, String(finalW));
    });
  }

  // ────────── Coach tab (heuristic rendering — needs engine's history) ──────────
  setupCoach();

  function wireAiButtonsEarly() {
    const coachBtn = document.getElementById('coach-ai-btn');
    const posBtn   = document.getElementById('position-ai-btn');
    const tacBtn   = document.getElementById('tactics-ai-btn');
    const coachOut = document.getElementById('coach-ai-output');
    const posOut   = document.getElementById('position-ai-output');
    const tacOut   = document.getElementById('tactics-ai-output');

    if (coachBtn) coachBtn.addEventListener('click', () => askAI('general',  coachOut, coachBtn));
    if (posBtn)   posBtn.addEventListener  ('click', () => askAI('position', posOut,   posBtn));
    if (tacBtn)   tacBtn.addEventListener  ('click', () => askAI('tactics',  tacOut,   tacBtn));
    // Combined trigger — fires Position + Coach in parallel so one click
    // produces both analyses. Each response lands in its own output
    // section; the combined button is disabled until both resolve.
    const combinedBtn = document.getElementById('combined-ai-btn');
    if (combinedBtn) {
      combinedBtn.addEventListener('click', async () => {
        combinedBtn.disabled = true;
        try {
          await Promise.all([
            askAI('position', posOut,   posBtn),
            askAI('general',  coachOut, coachBtn),
          ]);
        } finally {
          combinedBtn.disabled = false;
        }
      });
    }
    console.log('[ai] tab buttons wired — coach:', !!coachBtn, 'position:', !!posBtn, 'tactics:', !!tacBtn, 'combined:', !!combinedBtn);
  }

  // Shared AI-probe flow — used by all three tab CTA buttons.
  // Lives at main() scope so it has closure over board + engine + ui.
  async function askAI(mode, outputEl, btnEl) {
    console.log('[ai]', mode, 'button clicked');
    if (!AICoach.hasApiKey()) {
      outputEl.hidden = false;
      outputEl.innerHTML = `<div class="ai-status-msg warn">
        ⚠ <strong>No Anthropic API key set.</strong><br>
        Click <strong>🔑 Key</strong> in the top bar to enter one.
      </div>`;
      if (window.__openApiKeyModal) window.__openApiKeyModal();
      return;
    }
    if (!engineReady) {
      outputEl.hidden = false;
      outputEl.innerHTML = `<div class="ai-status-msg warn">
        ⏳ <strong>Engine is still booting.</strong><br>
        Wait a few seconds and try again, or click <strong>♻ Restart</strong> if stuck.
      </div>`;
      return;
    }
    // Budget → cycles mapping (from the radio picker)
    const budgetMap = { fast: 1, balanced: 2, deep: 3, research: 5 };
    const budget = document.querySelector('input[name="ai-budget"]:checked')?.value || 'fast';
    const maxCycles = budgetMap[budget] || 1;
    // Thinking-depth tier (extended thinking budget per cycle)
    const thinkingTier = document.querySelector('input[name="ai-thinking"]:checked')?.value || 'off';

    outputEl.hidden = false;
    outputEl.innerHTML = `<div class="ai-status-msg">
      ⏳ <strong>Working…</strong><br>
      Cycle 1/${maxCycles} — Stockfish searching for <em>${mode}</em> analysis.
    </div>`;
    btnEl.disabled = true;
    // Remember the user's pause/lock state and also the engine-mute
    // flag so we can restore them afterwards. The probe needs the
    // engine responding normally, so we clear the mute for the duration
    // of the analysis — this makes the coach work whether Stockfish was
    // running, paused, or fully locked when the user clicked.
    const wasLocked = locked, wasPaused = paused;
    const wasEngineMuted = window.__engineMuted === true;
    window.__engineMuted = false;
    engine.stop();
    try {
      const fenStart = board.isAtLive() ? board.fen() : rebuildFenAtPly(board.chess, board.viewPly);
      const recent = board.chess.history().slice(-8);

      // ─── Multi-cycle loop (LOOKAHEAD mode) ────────────────────────
      // Cycle 1 = probe current position (P0).
      // Cycle N>1 = probe a FUTURE position reached by walking 2 plies
      //             along the previous cycle's top PV. This lets the
      //             AI verify its plan against "where does this line
      //             actually go?" rather than just re-analysing P0 at
      //             deeper depth.
      //
      // Depth also ramps a little (18 → 20 → 22 → 24 → 26) so future
      // positions still get a solid search.
      //
      // Early stop if the AI reports "no change" or the top move hasn't
      // shifted between cycles.
      const cycleHistory = [];
      let priorTopMove = null;
      let result = null;
      // The CURRENT position stays the AI's primary analysis target
      // across all cycles. Cycle 1 establishes canonical engine lines
      // for it. Cycles 2+ probe a FUTURE position along SF's PV and
      // attach those lines as supporting evidence — the AI is always
      // told "analyze the current position; use the lookahead only to
      // verify whether the plan survives."
      let canonicalLines = [];
      let canonicalDepth = 0;
      // FEN we probe this cycle. Starts at fenStart and walks forward.
      let probeFen = fenStart;
      // Moves played to reach probeFen from fenStart.
      let lookaheadPath = [];
      // Most recent lookahead probe's lines + depth (for the AI block).
      let lookaheadLines = null;
      let lookaheadDepth = 0;

      const extractFirstBoldMove = (text) => {
        const m = /\*\*([A-Za-z][^*]{0,8})\*\*/.exec(text || '');
        return m ? m[1].trim() : null;
      };

      // Walk N plies forward from `fromFen` along `pvSanArray` SAN moves,
      // returning { fen, played } or null if any move is illegal.
      const walkForward = (fromFen, pvSanArray, plies) => {
        try {
          const Chess = board.chess.constructor;
          const c = new Chess(fromFen);
          const played = [];
          for (let i = 0; i < plies && i < pvSanArray.length; i++) {
            const mv = c.move(pvSanArray[i], { sloppy: true });
            if (!mv) return null;
            played.push(pvSanArray[i]);
          }
          return { fen: c.fen(), played };
        } catch (_) { return null; }
      };

      // Track last-cycle failure so we can surface a warning banner
      // without aborting the partial output.
      let failureWarning = null;
      for (let cycle = 1; cycle <= maxCycles; cycle++) {
        const cycleDepth = 18 + (cycle - 1) * 2;         // 18, 20, 22, 24, 26
        const cycleMultiPV = cycle === 1 ? 5 : 3;
        const probeLabel = cycle === 1
          ? 'current position'
          : `lookahead probe — ${lookaheadPath.length} plies along the principal variation`;
        outputEl.innerHTML = `<div class="ai-status-msg">
          ⏳ <strong>Cycle ${cycle}/${maxCycles}</strong><br>
          Stockfish depth ${cycleDepth} · MultiPV ${cycleMultiPV} · ${probeLabel}.
        </div>`;
        // Per-cycle try/catch — if any cycle fails, we keep the
        // prior cycles' results and render what we have. Only cycle 1
        // failure is fatal (nothing to salvage).
        let probe;
        try {
          probe = await AICoach.probeEngine(engine, probeFen, cycleDepth, cycleMultiPV);
        } catch (err) {
          if (cycle === 1) throw err; // let outer catch render the error
          failureWarning = `Stockfish failed on cycle ${cycle} (${err.message}). Showing the last successful cycle's analysis.`;
          console.warn('[askAI] probeEngine failed on cycle', cycle, err);
          break;
        }
        if (!probe.lines.length) {
          if (cycle === 1) {
            outputEl.innerHTML = '<p style="color:var(--c-bad)">Stockfish returned no candidates. Try ♻ Restart.</p>';
            return;
          }
          failureWarning = `Stockfish returned no candidates on cycle ${cycle}. Showing the last successful cycle's analysis.`;
          break;
        }
        // Cycle 1 establishes the canonical engine lines — these are
        // the ONLY lines the AI uses to ground move suggestions for
        // the current position. Subsequent cycles do NOT overwrite
        // them; they only produce supplementary "lookahead" evidence.
        if (cycle === 1) {
          canonicalLines = probe.lines;
          canonicalDepth = probe.depth;
        } else {
          lookaheadLines = probe.lines;
          lookaheadDepth = probe.depth;
        }
        outputEl.innerHTML = `<div class="ai-status-msg">
          ⏳ <strong>Cycle ${cycle}/${maxCycles}</strong><br>
          ${cycle === 1 ? 'Asking' : 'Refining with'} <strong>${AICoach.getModel()}</strong> (${mode} mode)…
        </div>`;
        const engineTop = {
          scoreKind: canonicalLines[0].scoreKind,
          score: canonicalLines[0].score,
          pv: canonicalLines[0].pvSan?.split(' ') || [],
        };
        const rpt = coachReport(fenStart, { engineTop });

        // coach_v2 is built ONCE around the current position and the
        // canonical engine top — research (archetype / levers / king
        // attack / opening match) describes the current board, not a
        // lookahead position.
        let coachV2Report = null;
        try {
          const engineSnap = {
            topMoves: canonicalLines.map(l => ({
              san: l.san, uci: l.uci, score: l.score, scoreKind: l.scoreKind,
              pv: l.pvSan?.split(' ') || [],
            })).filter(mv => mv.uci),
            sanHistory: board.chess.history(),
          };
          coachV2Report = CoachV2.coachReport(fenStart, engineSnap);
        } catch (err) { console.warn('[ai-coach] CoachV2 unavailable', err.message); }

        // Tablebase + explorer fetched once on cycle 1 only.
        let tablebase = null, openingExplorer = null;
        if (cycle === 1) {
          try { if (Tablebase.isTablebasePosition(fenStart)) tablebase = await Tablebase.queryTablebase(fenStart); } catch {}
          try { openingExplorer = await OpeningExplorer.queryOpeningExplorer(fenStart); } catch {}
        }

        // Refinement context: cycle 2+ provides the lookahead probe
        // data as SUPPORTING EVIDENCE. Primary fen + engineLines still
        // describe the CURRENT position — the AI's moves are grounded
        // there, not in the future FEN.
        const refinementContext = cycle > 1 && lookaheadLines
          ? {
              cycle,
              lookahead: {
                fen: probeFen,
                lines: lookaheadLines,
                depth: lookaheadDepth,
                pliesAhead: lookaheadPath.length,
                pathMoves: lookaheadPath,
              },
            }
          : null;
        // askCoach has its own retry on transient API errors (5xx,
        // 429, 529, network). If it still fails after retries and
        // we've already completed at least one cycle, preserve that
        // partial result and stop. Cycle 1 failure is fatal.
        let thisCycleResult;
        try {
          thisCycleResult = await AICoach.askCoach({
            fen: fenStart, coachReport: rpt, engineLines: canonicalLines,
            recentMoves: recent, mode,
            coachV2Report, tablebase, openingExplorer, refinementContext,
            thinkingTier,
          });
        } catch (err) {
          // Hard gate errors (premium / site-lock) always bubble up —
          // caller unwraps them to user-friendly handlers.
          if (err.message === 'PREMIUM_REQUIRED' || err.message === 'SITE_LOCKED') throw err;
          if (cycle === 1) throw err; // nothing to salvage — bubble
          failureWarning = `AI call failed on cycle ${cycle} (${err.message}). Showing cycles 1–${cycle - 1}.`;
          console.warn('[askAI] askCoach failed on cycle', cycle, err);
          break;
        }
        result = thisCycleResult;
        cycleHistory.push({
          cycle,
          depth: cycle === 1 ? canonicalDepth : lookaheadDepth,
          text: result.text,
          thisCallCost: result.cost?.thisCall || 0,
          tokensIn: result.usage?.input_tokens || 0,
          tokensOut: result.usage?.output_tokens || 0,
        });

        const thisTopMove = extractFirstBoldMove(result.text);
        // Convergence: top bolded move unchanged between consecutive
        // cycles = the AI's recommendation is stable; stop spending
        // budget. We no longer look for "no change" phrases in the text
        // because the AI no longer sees the prior answer and can't
        // introspect about change.
        if (cycle >= 2 && thisTopMove && thisTopMove === priorTopMove) {
          break;
        }
        priorTopMove = thisTopMove;

        // Advance probeFen along the most-recent top-PV by 2 plies for
        // the NEXT cycle. Source PV is the latest probe's (cycle 1 =
        // canonical, cycle 2+ = lookahead). If the walk fails at any
        // edge, we reuse the current probeFen (loop will re-probe
        // deeper at the same spot).
        if (cycle < maxCycles) {
          const srcLines = (cycle === 1) ? canonicalLines : (lookaheadLines || canonicalLines);
          const topPvSan = (srcLines[0].pvSan || '').split(/\s+/).filter(Boolean);
          const step = walkForward(probeFen, topPvSan, 2);
          if (step) {
            probeFen = step.fen;
            lookaheadPath = [...lookaheadPath, ...step.played];
          }
        }
      }

      const lookaheadLabel = lookaheadPath.length
        ? ` <span class="muted" style="font-weight:normal;font-size:10px;">· verified with ${lookaheadPath.length}-ply lookahead (${lookaheadPath.join(' ')})</span>`
        : '';
      // Engine panel always shows the CURRENT position's canonical
      // lines (cycle 1 data). POV flip uses the current FEN's
      // side-to-move so the sign matches the main eval gauge.
      const displayLines = canonicalLines;
      const displayDepth = canonicalDepth;
      const enginePanel = `
        <div class="engine-ground-truth">
          <h4>🎯 Stockfish · depth ${displayDepth} · top ${displayLines.length} <span class="muted" style="font-weight:normal;font-size:10px;">(White's POV — current position)</span>${lookaheadLabel}</h4>
          <table class="sf-lines">
            ${displayLines.map((l, i) => {
              const stm = fenStart.split(' ')[1] || 'w';
              const sWhite = stm === 'w' ? l.score : -l.score;
              const disp = l.scoreKind === 'mate'
                ? (sWhite > 0 ? '#' + sWhite : '#-' + Math.abs(sWhite))
                : (sWhite >= 0 ? '+' : '') + (sWhite / 100).toFixed(2);
              return `<tr>
                <td class="sf-rank">#${i+1}</td>
                <td class="sf-san">${l.san || l.uci}</td>
                <td class="sf-score">${disp}</td>
                <td class="sf-pv muted">${l.pvSan}</td>
              </tr>`;
            }).join('')}
          </table>
        </div>`;
      // Prominent cost badge — total for THIS analysis (sum of all cycles)
      // plus session running total. Shown at the top of the response so
      // the user sees spend before reading the output.
      const totalThisAnalysis = cycleHistory.reduce((a, c) => a + (c.thisCallCost || 0), 0);
      const totalTokensIn = cycleHistory.reduce((a, c) => a + (c.tokensIn || 0), 0);
      const totalTokensOut = cycleHistory.reduce((a, c) => a + (c.tokensOut || 0), 0);
      const sessionTotal = result.cost?.sessionTotal || 0;
      const sessionCalls = result.cost?.callsThisSession || 0;
      // Thinking-tier label for the badge (only meaningful when the
      // model actually supports extended thinking).
      const thinkingLabel = result.thinkingBudget && result.thinkingBudget > 0
        ? ` · thinking ${thinkingTier} (${result.thinkingBudget.toLocaleString()} tkn)`
        : '';
      const costBadge = `
        <div class="cost-badge">
          <div class="cost-badge-main">
            <span class="cost-icon">💰</span>
            <span class="cost-amount">$${totalThisAnalysis.toFixed(4)}</span>
            <span class="cost-label">this analysis</span>
          </div>
          <div class="cost-badge-detail">
            ${cycleHistory.length} cycle${cycleHistory.length !== 1 ? 's' : ''} · ${totalTokensIn.toLocaleString()}→${totalTokensOut.toLocaleString()} tokens · ${result.model || ''}${thinkingLabel}
            <br>
            Session total: <strong>$${sessionTotal.toFixed(4)}</strong> across ${sessionCalls} call${sessionCalls !== 1 ? 's' : ''}
          </div>
        </div>`;

      const warnBanner = failureWarning
        ? `<div class="ai-status-msg warn" style="margin-bottom:10px;">⚠ ${failureWarning}</div>`
        : '';
      outputEl.innerHTML = `
        ${warnBanner}
        ${costBadge}
        ${enginePanel}
        <div class="ai-response">${renderMarkdown(result.text)}</div>`;
      window.dispatchEvent(new Event('ai-call-complete'));
    } catch (err) {
      // Gate errors get a friendly handler that re-opens the password modal
      // instead of a scary red error.
      if (err.message === 'PREMIUM_REQUIRED' && window.__requestPremiumUnlock) {
        outputEl.innerHTML = `<p class="muted">⭐ This model needs premium unlock. Opening the password modal…</p>`;
        const res = await window.__requestPremiumUnlock();
        if (res && res.tier === 'premium') {
          // Retry the call automatically
          outputEl.innerHTML = `<p class="muted">Retrying…</p>`;
          btnEl.click();
        } else {
          outputEl.innerHTML = `<p class="muted">Cancelled. Pick a Haiku model to use without the premium password.</p>`;
        }
      } else if (err.message === 'SITE_LOCKED') {
        outputEl.innerHTML = `<p style="color:var(--c-bad)">Site session expired. Reload the page to re-enter the password.</p>`;
      } else {
        outputEl.innerHTML = `<p style="color:var(--c-bad)"><strong>Error:</strong> ${err.message}</p>`;
      }
    } finally {
      btnEl.disabled = false;
      // Restore the engine-mute flag to what the user had before we
      // started the probe. If they had the engine locked, we respect
      // that and leave it muted again (no fireAnalysis). If they had it
      // running, we resume normal live analysis.
      window.__engineMuted = wasEngineMuted;
      if (!wasLocked && !wasPaused) fireAnalysis();
    }
  }

  function setupCoach() {
    const coachHeuristic = document.getElementById('coach-heuristic');
    const coachAiOutput  = document.getElementById('coach-ai-output');
    const aiBtn       = document.getElementById('coach-ai-btn');

    // Global AI controls — model + cost indicator. Model list + key modal
    // are already wired by wireApiKeyModalEarly() at the top of main().
    const globalCost = document.getElementById('global-ai-cost');
    const keyBtn     = document.getElementById('global-ai-key');   // for references below

    function renderHeuristic() {
      if (!coachHeuristic) return;  // element removed in unified-panel refactor
      const fen = board.isAtLive() ? board.fen() : rebuildFenAtPly(board.chess, board.viewPly);
      const engineTop = engine && engine.history && engine.history.length
        ? engine.history[engine.history.length - 1]
        : null;
      const rpt = coachReport(fen, { engineTop });
      coachHeuristic.innerHTML = renderCoachReportHtml(rpt);
    }
    // Re-render on every board change
    board.addEventListener('move',     renderHeuristic);
    board.addEventListener('new-game', renderHeuristic);
    board.addEventListener('nav',      renderHeuristic);
    board.addEventListener('undo',     renderHeuristic);
    renderHeuristic();

    // API-key modal is wired at the top of main() via wireApiKeyModalEarly().
    // Expose a local `openApiKeyModal` that calls the globally-registered one
    // so askTabAI can prompt for key when missing.
    const openApiKeyModal = window.__openApiKeyModal || (() => {});

    // Update the global AI status indicator
    function updateGlobalAiStatus() {
      const hasKey = AICoach.hasApiKey();
      const model = AICoach.getModel();
      const cost = AICoach.getSessionCost();
      if (!hasKey) {
        globalCost.textContent = '⚠ no key';
        globalCost.style.color = 'var(--c-bad)';
      } else {
        globalCost.textContent = `$${cost.sessionTotal.toFixed(4)} · ${cost.callsThisSession} call${cost.callsThisSession === 1 ? '' : 's'}`;
        globalCost.style.color = 'var(--c-font-dim)';
      }
    }
    updateGlobalAiStatus();
    // Refresh after each AI call
    window.addEventListener('ai-call-complete', updateGlobalAiStatus);

    // Shared AI-probe helper used by Coach / Position / Tactics tabs.
    // Mode selects which system prompt Claude uses.
    async function askTabAI(mode, outputEl, btnEl, costEl) {
      // Pre-flight checks with VERY VISIBLE feedback — not just alerts, because
      // user may not even see them
      if (!AICoach.hasApiKey()) {
        outputEl.hidden = false;
        outputEl.innerHTML = `<div class="ai-status-msg warn">
          ⚠ <strong>No Anthropic API key set.</strong><br>
          Click the <strong>🔑 Key</strong> button in the AI bar (top of page) to enter your key.
        </div>`;
        openApiKeyModal();
        return;
      }
      if (!engineReady) {
        outputEl.hidden = false;
        outputEl.innerHTML = `<div class="ai-status-msg warn">
          ⏳ <strong>Engine is still booting.</strong><br>
          Wait a few seconds and try again, or click <strong>♻ Restart</strong> if it's stuck.
        </div>`;
        return;
      }

      // Feedback immediately so user knows the button actually did something
      outputEl.hidden = false;
      outputEl.innerHTML = `<div class="ai-status-msg">
        ⏳ <strong>Working (~10 seconds)…</strong><br>
        Step 1/2 — Stockfish searching depth 18, MultiPV 5 for <em>${mode}</em> analysis.
      </div>`;
      btnEl.disabled = true;
      const wasLocked = locked, wasPaused = paused;
      engine.stop();
      try {
        const fen = board.isAtLive() ? board.fen() : rebuildFenAtPly(board.chess, board.viewPly);
        const { lines, depth } = await AICoach.probeEngine(engine, fen, 18, 5);
        if (!lines.length) {
          outputEl.innerHTML = '<p style="color:var(--c-bad)">Stockfish returned no candidates. Try ♻ Restart.</p>';
          return;
        }
        outputEl.innerHTML = `<div class="ai-status-msg">
          ⏳ <strong>Working…</strong><br>
          Step 2/2 — Sending engine data to <strong>${AICoach.getModel()}</strong> (${mode} mode).
        </div>`;
        const engineTop = { scoreKind: lines[0].scoreKind, score: lines[0].score, pv: lines[0].pvSan?.split(' ') || [] };
        const rpt = coachReport(fen, { engineTop });
        const recent = board.chess.history().slice(-8);

        // Enrich with full research context — same as the setupCoach path.
        let coachV2Report = null;
        try {
          const engineSnap = {
            topMoves: lines.map(l => ({
              san: l.san, uci: l.uci, score: l.score, scoreKind: l.scoreKind,
              pv: l.pvSan?.split(' ') || [],
            })).filter(m => m.uci),
          };
          coachV2Report = CoachV2.coachReport(fen, engineSnap);
        } catch {}
        let tablebase = null;
        try { if (Tablebase.isTablebasePosition(fen)) tablebase = await Tablebase.queryTablebase(fen); } catch {}
        // Explorer tried on all phases — Lichess masters DB covers
        // middlegame + endgame positions too, not just openings.
        let openingExplorer = null;
        try { openingExplorer = await OpeningExplorer.queryOpeningExplorer(fen); } catch {}

        const result = await AICoach.askCoach({
          fen, coachReport: rpt, engineLines: lines, recentMoves: recent, mode,
          coachV2Report, tablebase, openingExplorer,
        });
        const checks = AICoach.verifyCoachSuggestions(result.text, lines);

        const enginePanel = `
          <div class="engine-ground-truth">
            <h4>🎯 Stockfish · depth ${depth} · top 5</h4>
            <table class="sf-lines">
              ${lines.map((l, i) => `<tr>
                <td class="sf-rank">#${i+1}</td>
                <td class="sf-san">${l.san || l.uci}</td>
                <td class="sf-score">${l.scoreKind === 'mate' ? '#'+l.score : ((l.score>=0?'+':'')+(l.score/100).toFixed(2))}</td>
                <td class="sf-pv muted">${l.pvSan}</td>
              </tr>`).join('')}
            </table>
          </div>`;
        const verifyPanel = checks.length ? `
          <div class="ai-verification">
            <h4>🔎 Verification — moves mentioned, checked against Stockfish</h4>
            <ul>${checks.map(c => `<li class="${c.verified ? 'ok' : 'fail'}">
              ${c.verified ? '✓' : '✗'} <strong>${c.san}</strong> — ${c.note}</li>`).join('')}</ul>
          </div>` : '';
        outputEl.innerHTML = `
          ${enginePanel}
          <div class="ai-response">${renderMarkdown(result.text)}</div>
          ${verifyPanel}
          <div class="ai-meta muted">
            ${result.model || ''} · ${result.usage ? `${result.usage.input_tokens||0}→${result.usage.output_tokens||0} tokens` : ''}
            · this call: $${(result.cost?.thisCall||0).toFixed(4)}
            · session: $${(result.cost?.sessionTotal||0).toFixed(4)} (${result.cost?.callsThisSession||0} calls)
          </div>`;
        if (costEl) costEl.textContent = `session: $${(result.cost?.sessionTotal||0).toFixed(4)} · ${result.cost?.callsThisSession||0} calls`;
        window.dispatchEvent(new Event('ai-call-complete'));
      } catch (err) {
        outputEl.innerHTML = `<p style="color:var(--c-bad)"><strong>Error:</strong> ${err.message}</p>`;
      } finally {
        btnEl.disabled = false;
        if (!wasLocked && !wasPaused) fireAnalysis();
      }
    }

    // AI buttons are wired in wireAiButtonsEarly() at main() startup.

    // Coach tab CTA button was wired in wireAiButtonsEarly()
  }

  // Initial render
  renderMoveList();
  renderDissection(board.fen());
  wireTabs();

  // All main() state is now declared — safe to run fireAnalysis.
  mainInitDone = true;
  if (pendingFireAnalysis) {
    pendingFireAnalysis = false;
    fireAnalysis();
  }
}

function flashInput(el, cls) {
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 600);
}

function section(title, body) {
  if (!body || !body.length || !body[0]) return '';
  return `<div class="dissect-group"><h4>${title}</h4><p>${body.join(' ')}</p></div>`;
}
function sectionList(title, items) {
  if (!items || !items.length) return '';
  return `<div class="dissect-group"><h4>${title}</h4><ul>${items.map(s => `<li>${s}</li>`).join('')}</ul></div>`;
}

// Tab switching — plain DOM, idiomatic
function wireTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels  = document.querySelectorAll('.tab-panel');
  buttons.forEach(b => b.addEventListener('click', () => {
    const target = b.dataset.tab;
    buttons.forEach(x => x.classList.toggle('active', x.dataset.tab === target));
    panels.forEach(p => p.hidden = p.dataset.tabPanel !== target);
  }));
}

function collectUI() {
  return {
    pearl:          document.getElementById('score-pearl'),
    depthLabel:     document.getElementById('depth-label'),
    npsLabel:       document.getElementById('nps-label'),
    pvLines:        document.getElementById('pv-lines'),
    barFill:        document.getElementById('ceval-bar-fill'),
    gaugeBlack:     document.getElementById('gauge-black'),
    narrationText:  document.getElementById('narration-text'),
    confBadge:      document.querySelector('#confidence-display .confidence-badge'),
    confReason:     document.querySelector('#confidence-display .confidence-reason'),
    moveList:       document.getElementById('move-list'),
    depthInput:     document.getElementById('depth-input'),
    engineMode:     document.getElementById('engine-mode'),

    btnSettings:     document.getElementById('btn-settings'),
    settingsDrawer:  document.getElementById('settings-drawer'),
    selectFlavor:    document.getElementById('select-flavor'),
    flavorNote:      document.getElementById('flavor-note'),
    rangeSkill:      document.getElementById('range-skill'),
    skillVal:        document.getElementById('skill-val'),
    rangeMultipv:    document.getElementById('range-multipv'),
    multipvVal:      document.getElementById('multipv-val'),
    rangeThreads:    document.getElementById('range-threads'),
    threadsVal:      document.getElementById('threads-val'),
    threadsHw:       document.getElementById('threads-hw'),
    limitMode:       document.getElementById('limit-mode'),
    limitValue:      document.getElementById('limit-value'),
    kbdMove:         document.getElementById('kbd-move'),
    boardArea:       document.querySelector('.board-area'),
    evalGauge:       document.getElementById('eval-gauge'),
    selectArrowMode: document.getElementById('select-arrow-mode'),

    whyModal:       document.getElementById('why-modal'),
    whyMove:        document.getElementById('why-move'),
    whySummary:     document.getElementById('why-summary'),
    whyNarration:   document.getElementById('why-narration'),
    whyLine:        document.getElementById('why-line'),

    dissectStrategy: document.getElementById('dissect-strategy'),
    dissectTactics:  document.getElementById('dissect-tactics'),
  };
}

function rebuildFenAtPly(chess, ply) {
  const verbose = chess.history({ verbose: true });
  const n = Math.min(ply, verbose.length);
  const replay = new Chess();
  for (let i = 0; i < n; i++) {
    const m = verbose[i];
    replay.move({ from: m.from, to: m.to, promotion: m.promotion });
  }
  return replay.fen();
}

// Compute a reasonable default board size based on the viewport.
// Leaves room for the side card + tools panel + gauge + padding.
function defaultBoardSize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Deduct rough horizontal space used by the other columns.
  // col3 (≥ 1260): side 280 + gauge 28 + tools 400 + gaps ~60 → ~768 reserved
  // col2 (800-1260): gauge 24 + tools 400 + gaps ~50 → ~474 reserved
  // col1: full width
  let budget = w;
  if (w >= 1260) budget = w - 780;
  else if (w >= 800) budget = w - 500;
  else budget = w - 40;
  const vertBudget = h - 180;    // header + nav row + padding
  return Math.max(320, Math.min(900, budget, vertBudget));
}

function setupTournament(board, fireAnalysis, pauseControl) {
  // Loader: replays a finished tournament game onto the main board.
  function loadGameOntoBoard(game) {
    board.newGame();
    if (game.uciMoves && game.uciMoves.length) {
      board.playUciMoves(game.uciMoves, { animate: false });
      setTimeout(() => board.toStart(), 50);
    }
  }

  const modal    = document.getElementById('tournament-modal');
  const btnOpen  = document.getElementById('btn-tournament');
  const btnClose = document.getElementById('tournament-close');
  const btnStart = document.getElementById('tourn-start');
  const btnAbort = document.getElementById('tourn-abort');
  const selA     = document.getElementById('tourn-a');
  const selB     = document.getElementById('tourn-b');
  const games    = document.getElementById('tourn-games');
  const limitM   = document.getElementById('tourn-limit-mode');
  const limitV   = document.getElementById('tourn-limit-value');
  const standings= document.getElementById('tourn-standings');
  const live     = document.getElementById('tourn-live');
  const logEl    = document.getElementById('tourn-log');

  // Populate variant dropdowns from ENGINE_FLAVORS
  const addOpts = (sel, defaultKey) => {
    sel.innerHTML = '';
    for (const [k, v] of Object.entries(ENGINE_FLAVORS)) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = `${v.label} (${v.size})`;
      if (k === defaultKey) o.selected = true;
      sel.appendChild(o);
    }
  };
  addOpts(selA, 'lite-single');
  addOpts(selB, 'kaufman-lite-single');

  // Populate openings dropdown (grouped)
  const selOpening = document.getElementById('tourn-opening');
  const openMovesLabel = document.getElementById('tourn-opening-moves');
  const boardFenCheck = document.getElementById('tourn-use-board-fen');
  const boardFenPreview = document.getElementById('tourn-board-fen-preview');

  // Update preview when the modal opens (since user may have moved)
  btnOpen.addEventListener('click', () => {
    boardFenPreview.textContent = 'Current: ' + board.fen();
  });
  boardFenCheck.addEventListener('change', () => {
    boardFenPreview.textContent = boardFenCheck.checked
      ? '→ ' + board.fen()
      : 'Current: ' + board.fen();
  });
  selOpening.innerHTML = '';
  for (const group of OPENINGS) {
    const og = document.createElement('optgroup');
    og.label = group.group;
    for (let i = 0; i < group.items.length; i++) {
      const o = document.createElement('option');
      // Encode group + item index so we can look it up later
      o.value = `${group.group}//${i}`;
      o.textContent = group.items[i].name;
      og.appendChild(o);
    }
    selOpening.appendChild(og);
  }
  const pickedOpening = () => {
    const [groupName, idxStr] = selOpening.value.split('//');
    const grp = OPENINGS.find(g => g.group === groupName);
    return grp ? grp.items[+idxStr] : OPENINGS[0].items[0];
  };
  const updateOpeningMoves = () => {
    const op = pickedOpening();
    openMovesLabel.textContent = op.moves.length
      ? op.moves.map((m, i) => (i % 2 === 0 ? `${Math.floor(i/2)+1}.${m}` : m)).join(' ')
      : '(no forced moves)';
  };
  selOpening.addEventListener('change', updateOpeningMoves);
  updateOpeningMoves();

  btnOpen.addEventListener('click',  () => modal.hidden = false);
  // Closing the modal must also abort any running tournament and resume the
  // main analysis engine — otherwise `paused` stays true forever and the user
  // sees "engine paused" with no obvious way to un-pause.
  function closeTournamentModal() {
    if (tournament && tournament.running) tournament.abort();
    if (pauseControl) pauseControl.resume();
    modal.hidden = true;
  }
  btnClose.addEventListener('click', closeTournamentModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeTournamentModal(); });

  limitM.addEventListener('change', () => {
    if (limitM.value === 'depth')    { limitV.value = 10;   limitV.min = 1;   }
    if (limitM.value === 'movetime') { limitV.value = 1000; limitV.min = 100; }
    if (limitM.value === 'nodes')    { limitV.value = 100000; limitV.min = 1000; }
  });

  let tournament = null;
  let allGames = [];     // accumulated games for PGN export
  const btnExport = document.getElementById('tourn-export');

  btnExport.addEventListener('click', () => {
    if (!allGames.length) return;
    const pgns = allGames.map((g, i) => formatTournamentPgn(g, i + 1,
      ENGINE_FLAVORS[selA.value]?.label || selA.value,
      ENGINE_FLAVORS[selB.value]?.label || selB.value,
    )).join('\n\n');
    downloadBlob(pgns, `tournament-${Date.now()}.pgn`, 'application/x-chess-pgn');
  });

  btnStart.addEventListener('click', async () => {
    if (tournament && tournament.running) return;
    logEl.innerHTML = '';
    allGames = [];
    btnExport.disabled = true;
    live.textContent = 'Booting engines…';
    btnStart.disabled = true;
    btnAbort.disabled = false;

    const limit =
      limitM.value === 'depth'    ? { depth:    +limitV.value || 10   } :
      limitM.value === 'movetime' ? { movetime: +limitV.value || 1000 } :
                                    { nodes:    +limitV.value || 100000 };

    // Starting position: if "use current board FEN" is checked, prefer that.
    // Otherwise use the forced opening (which may be the "no opening" default).
    const useBoardFen = document.getElementById('tourn-use-board-fen').checked;
    const opening = pickedOpening();
    const playedOpening = opening.moves.length ? playOpening(opening.moves) : null;

    let startFen   = playedOpening ? playedOpening.fen      : undefined;
    let openingUci = playedOpening ? playedOpening.uciMoves : [];
    let openingName = opening.name;
    if (useBoardFen) {
      startFen   = board.fen();
      openingUci = [];  // no prefix — FEN is the literal starting point
      openingName = 'Current board position';
    }

    tournament = new Tournament({
      flavorA: selA.value,
      flavorB: selB.value,
      games:   +games.value || 10,
      limit,
      startFen, openingUci, openingName,
    });

    tournament.addEventListener('started', () => {
      live.textContent = `Booting ${selA.selectedOptions[0].textContent} vs ${selB.selectedOptions[0].textContent}…`;
    });
    tournament.addEventListener('engines-ready', (e) => {
      const { a, b } = e.detail;
      // Visible PROOF two distinct engines loaded — UCI id + WASM path + flavor key
      const proof = document.createElement('div');
      proof.className = 'tourn-proof';
      proof.innerHTML = `
        <h4>Engines loaded — proof of distinct binaries</h4>
        <div class="proof-row"><span class="proof-l">A</span>
          <span class="proof-id">${escapeHtml(a.id || '(no UCI id)')}</span>
          <span class="proof-script muted">${escapeHtml(a.script)}</span></div>
        <div class="proof-row"><span class="proof-l">B</span>
          <span class="proof-id">${escapeHtml(b.id || '(no UCI id)')}</span>
          <span class="proof-script muted">${escapeHtml(b.script)}</span></div>
        ${a.flavor === b.flavor ? '<p class="proof-warn">⚠ Same flavor selected on both sides — games will likely all draw.</p>' : ''}
      `;
      logEl.prepend(proof);
      live.textContent = `Playing ${games.value} games at ${limitM.value} ${limitV.value}…`;
    });
    tournament.addEventListener('move', (e) => {
      const d = e.detail;
      live.textContent = `Game ${d.gameNum} · ply ${d.ply} · ${d.playedBy}: ${d.san}`;
    });
    tournament.addEventListener('game-done', (e) => {
      const { gameNum, result, standings: st } = e.detail;
      const r = result.result;
      const row = document.createElement('div');
      row.className = 'tourn-game-row';
      row.innerHTML = `
        <span class="g-num">#${gameNum}</span>
        <span class="g-result">${r}</span>
        <span class="g-ply muted">${result.plyCount} ply</span>
        <span class="g-pgn muted">${result.pgn.slice(0, 120)}${result.pgn.length > 120 ? '…' : ''}</span>
        <span class="g-load" title="Click to load this game onto the main board">↗</span>`;
      // Click the row → open the game in a NEW WINDOW with engine locked off.
      // Tournament keeps running in the main window undisturbed.
      row.addEventListener('click', () => {
        const payload = {
          gameNum,
          result: r,
          plyCount: result.plyCount,
          uciMoves: result.uciMoves,
          moves: result.moves,
          whiteFlavor: result.whiteFlavor,
          openingName: result.openingName || '(none)',
          flavorA: ENGINE_FLAVORS[selA.value]?.label || selA.value,
          flavorB: ENGINE_FLAVORS[selB.value]?.label || selB.value,
          timeControl: `${limitM.value} = ${limitV.value}`,
        };
        const k = 'replay-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        try { sessionStorage.setItem(k, JSON.stringify(payload)); }
        catch (e) { live.textContent = 'Session storage full — cannot open replay.'; return; }
        const win = window.open(`replay.html?k=${encodeURIComponent(k)}`,
                                'replay-' + k,
                                'width=1100,height=820,menubar=no,toolbar=no');
        if (!win) {
          live.textContent = '⚠ Popup blocked — allow popups for localhost to enable game replay.';
          sessionStorage.removeItem(k);
        }
      });
      logEl.prepend(row);
      allGames.push({ ...result, gameNum });
      btnExport.disabled = false;
      renderStandings(st);
    });
    tournament.addEventListener('finished', (e) => {
      live.textContent = `Done. Main engine resumed.`;
      btnStart.disabled = false;
      btnAbort.disabled = true;
      if (pauseControl) pauseControl.resume();
      renderStandings(e.detail.standings);
    });
    tournament.addEventListener('error', (e) => {
      live.textContent = 'Error: ' + e.detail.error;
      btnStart.disabled = false;
      btnAbort.disabled = true;
      if (pauseControl) pauseControl.resume();
    });

    function renderStandings(st) {
      standings.innerHTML = `
        <div class="standings-row">
          <div class="s-cell"><span class="s-k">A wins</span><span class="s-v">${st.aWins}</span></div>
          <div class="s-cell"><span class="s-k">Draws</span><span class="s-v">${st.draws}</span></div>
          <div class="s-cell"><span class="s-k">B wins</span><span class="s-v">${st.bWins}</span></div>
          <div class="s-cell"><span class="s-k">A %</span><span class="s-v">${st.aScorePct}%</span></div>
          <div class="s-cell"><span class="s-k">Elo Δ (A–B)</span><span class="s-v ${st.eloDiff > 0 ? 'plus' : st.eloDiff < 0 ? 'minus' : ''}">${st.eloDiff > 0 ? '+' : ''}${st.eloDiff}</span></div>
          <div class="s-cell"><span class="s-k">Played</span><span class="s-v">${st.gamesPlayed}</span></div>
        </div>`;
    }

    // Pause the main analysis engine so the tournament doesn't fight it for CPU.
    if (pauseControl) pauseControl.pause();

    try { await tournament.run(); }
    catch (err) {
      live.textContent = 'Crashed: ' + err.message;
      btnStart.disabled = false; btnAbort.disabled = true;
      if (pauseControl) pauseControl.resume();
    }
  });

  btnAbort.addEventListener('click', () => {
    if (tournament) tournament.abort();
    live.textContent = 'Aborting after current game…';
    // Safety net — if the tournament's cleanup events don't fire for some
    // reason, make sure the main engine isn't stuck paused.
    if (pauseControl) pauseControl.resume();
  });
}

function formatTournamentPgn(game, gameNum, labelA, labelB) {
  const whiteName = game.whiteFlavor === 'A' ? labelA : labelB;
  const blackName = game.whiteFlavor === 'A' ? labelB : labelA;
  const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'.');
  let pgn = '';
  pgn += `[Event "Stockfish.explain tournament"]\n`;
  pgn += `[Site "local"]\n`;
  pgn += `[Date "${dateStr}"]\n`;
  pgn += `[Round "${gameNum}"]\n`;
  pgn += `[White "${(whiteName||'').replace(/"/g, "'")}"]\n`;
  pgn += `[Black "${(blackName||'').replace(/"/g, "'")}"]\n`;
  pgn += `[Result "${(game.result || '*').replace(/\s.*/, '')}"]\n`;
  if (game.openingName) pgn += `[Opening "${game.openingName.replace(/"/g, "'")}"]\n`;
  pgn += `\n`;
  // Rebuild SAN from uciMoves to include opening prefix
  const tmp = new Chess();
  const sanList = [];
  for (const uci of game.uciMoves || []) {
    try {
      const mv = tmp.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci.length>4?uci[4]:undefined });
      if (mv) sanList.push(mv.san);
    } catch {}
  }
  for (let i = 0; i < sanList.length; i++) {
    if (i % 2 === 0) pgn += `${Math.floor(i/2)+1}. `;
    pgn += sanList[i] + ' ';
  }
  pgn += (game.result || '*').replace(/\s.*/, '') + '\n';
  return pgn;
}

function renderCoachReportHtml(rpt) {
  const section = (title, items, emptyMsg = '(none)') => {
    if (!items || !items.length) return `<div class="coach-section"><h4>${title}</h4><p class="muted">${emptyMsg}</p></div>`;
    const list = items.map(i => `<li>${typeof i === 'string' ? i : i.text}</li>`).join('');
    return `<div class="coach-section"><h4>${title}</h4><ul>${list}</ul></div>`;
  };
  const single = (title, item) => {
    if (!item) return '';
    return `<div class="coach-section"><h4>${title}</h4><p>${item.text}</p></div>`;
  };
  return `
    <div class="coach-opener">
      <strong>Side to move:</strong> ${rpt.sideName}.
    </div>
    ${section('1. What is the opponent threatening?', rpt.threats, 'No immediate threats.')}
    ${section('2. Where are your weaknesses?',         rpt.weaknesses, 'No obvious weaknesses.')}
    ${single ('3. Worst-placed piece',                  rpt.worstPiece)}
    ${single ('4. Best-placed piece (keep it)',         rpt.bestPiece)}
    ${section('5. Pawn structure story',                rpt.structureStory)}
    <div class="coach-section"><h4>6. Initiative</h4><p>${rpt.initiative.text}</p></div>
    ${section('7. Candidate plans',                     rpt.plans, 'No concrete plans derived yet.')}
  `;
}

function renderMarkdown(s) {
  // Minimal: bold **x**, paragraphs, line breaks
  let html = String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.split(/\n\s*\n/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  return html;
}

// Wire the API-key modal up FIRST so that even if later init fails, the
// user can still set their key. Also populate the model-suggestion datalist.
// Call this at the top of main().
function wireApiKeyModalEarly() {
  // Populate the model <select> RIGHT AWAY — grouped by capability tier.
  const modelInput = document.getElementById('global-ai-model');
  if (modelInput) {
    const groups = [
      { label: 'Opus — highest capability ($15 / $75 per M tokens)',
        models: ['claude-opus-4-7', 'claude-opus-4-5', 'claude-opus-4-1', 'claude-opus-4-1-20250805', 'claude-opus-4', 'claude-opus-4-20250514', 'claude-3-opus-20240229'] },
      { label: 'Sonnet — balanced ($3 / $15)',
        models: ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4', 'claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-latest', 'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620', 'claude-3-sonnet-20240229'] },
      { label: 'Haiku — cheapest / fastest ($0.25-$1 / $1.25-$5)',
        models: ['claude-haiku-4-5', 'claude-3-5-haiku-latest', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'] },
    ];
    modelInput.innerHTML = '';
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const m of g.models) {
        const o = document.createElement('option');
        o.value = m; o.textContent = m;
        og.appendChild(o);
      }
      modelInput.appendChild(og);
    }
    // Set current selection — and if the stored model isn't in the list,
    // prepend it as a one-off so the user sees their custom choice.
    const current = AICoach.getModel();
    if (![...modelInput.querySelectorAll('option')].some(o => o.value === current)) {
      const ogCustom = document.createElement('optgroup');
      ogCustom.label = 'Custom (set via ✎)';
      const o = document.createElement('option');
      o.value = current; o.textContent = current;
      ogCustom.appendChild(o);
      modelInput.insertBefore(ogCustom, modelInput.firstChild);
    }
    modelInput.value = current;
    modelInput.addEventListener('change', () => {
      AICoach.setModel(modelInput.value);
    });
    console.log('[models] select populated with', groups.reduce((n, g) => n + g.models.length, 0), 'models');
  }

  // Custom model button — prompt for arbitrary name
  const customModelBtn = document.getElementById('global-ai-custom');
  if (customModelBtn) customModelBtn.addEventListener('click', () => {
    const v = prompt('Enter custom Claude model name:', AICoach.getModel());
    if (!v) return;
    const trimmed = v.trim();
    AICoach.setModel(trimmed);
    // Re-add option if not present
    if (modelInput && ![...modelInput.querySelectorAll('option')].some(o => o.value === trimmed)) {
      let og = modelInput.querySelector('optgroup[label^="Custom"]');
      if (!og) {
        og = document.createElement('optgroup');
        og.label = 'Custom (set via ✎)';
        modelInput.insertBefore(og, modelInput.firstChild);
      }
      const o = document.createElement('option');
      o.value = trimmed; o.textContent = trimmed;
      og.appendChild(o);
    }
    if (modelInput) modelInput.value = trimmed;
  });

  const keyBtn       = document.getElementById('global-ai-key');
  const apikeyModal  = document.getElementById('apikey-modal');
  const apikeyInput  = document.getElementById('apikey-input');
  const apikeyStatus = document.getElementById('apikey-status');
  const apikeySave   = document.getElementById('apikey-save');
  const apikeyClear  = document.getElementById('apikey-clear');
  const apikeyClose  = document.getElementById('apikey-close');
  if (!keyBtn || !apikeyModal) {
    console.error('[key] modal elements missing from DOM');
    return;
  }

  const open = () => {
    apikeyInput.value = '';
    apikeyStatus.textContent = AICoach.hasApiKey()
      ? '✓ Key currently set (enter a new one to replace, or Clear to remove)'
      : '✗ No key yet';
    apikeyModal.hidden = false;
    setTimeout(() => apikeyInput.focus(), 50);
  };
  const close = () => { apikeyModal.hidden = true; };

  // Expose for later use in setupCoach (so we don't wire twice)
  window.__openApiKeyModal = open;

  keyBtn.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('[key] 🔑 Key clicked — opening modal');
    open();
  });
  apikeyClose.addEventListener('click', close);
  apikeyModal.addEventListener('click', (e) => { if (e.target === apikeyModal) close(); });
  apikeySave.addEventListener('click', () => {
    const k = apikeyInput.value.trim();
    if (!k) { apikeyStatus.textContent = '⚠ Enter a key first'; return; }
    AICoach.setApiKey(k);
    apikeyStatus.textContent = '✓ Saved — try clicking 🧠 Coach / ♟ Position / ⚔ Tactics now';
    window.dispatchEvent(new Event('ai-call-complete'));  // refresh status badges
    setTimeout(close, 900);
  });
  apikeyClear.addEventListener('click', () => {
    AICoach.clearApiKey();
    apikeyStatus.textContent = '✗ Key cleared';
    window.dispatchEvent(new Event('ai-call-complete'));
  });
  apikeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') apikeySave.click(); });
  console.log('[key] modal wired successfully — click 🔑 Key to open');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function flashPill(el, msg, ms = 1000) {
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => { el.textContent = prev; }, ms);
}

function downloadBlob(text, filename, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Given the SAN moves played from the standard start, find the longest
// opening from our OPENINGS book whose moves are a prefix of (or equal
// to) the played sequence. Returns { name, group, matchLength } or null.
// Convert the first UCI move of a PV into SAN from a given FEN so
// the Coach's plan-validator can match engine moves by SAN.
function firstSanFromUciPv(fen, pv) {
  if (!pv || !pv.length) return null;
  try {
    const c = new Chess(fen);
    const uci = pv[0];
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4),
                        promotion: uci.length > 4 ? uci[4] : undefined });
    return mv ? mv.san : null;
  } catch { return null; }
}

function detectOpeningFromSanPath(sanPath) {
  if (!sanPath || !sanPath.length) return null;
  let best = null;
  for (const group of OPENINGS) {
    for (const item of group.items) {
      if (!item.moves || !item.moves.length) continue;
      if (item.moves.length > sanPath.length) continue;
      let ok = true;
      for (let i = 0; i < item.moves.length; i++) {
        if (item.moves[i] !== sanPath[i]) { ok = false; break; }
      }
      if (ok && (!best || item.moves.length > best.matchLength)) {
        best = { name: item.name, group: group.group, matchLength: item.moves.length };
      }
    }
  }
  return best;
}

function gameOverMessage(chess) {
  if (chess.isCheckmate())          { const winner = chess.turn() === 'w' ? 'Black' : 'White'; return `<strong>Checkmate.</strong> ${winner} wins.`; }
  if (chess.isStalemate())          return '<strong>Stalemate.</strong> Draw.';
  if (chess.isThreefoldRepetition())return '<strong>Draw</strong> by threefold repetition.';
  if (chess.isInsufficientMaterial())return '<strong>Draw</strong> by insufficient material.';
  if (chess.isDraw())               return '<strong>Draw</strong>.';
  return 'Game over.';
}

// ────────────────────────────────────────────────────────────────────────
// Password gate (server-proxied mode only)
// ────────────────────────────────────────────────────────────────────────
//
// When the site is served by our Node server (server.js), Anthropic API
// calls flow through /api/ai and are gated by cookies set via /api/gate.
// This function checks the user's current tier on page load, shows the
// password modal if they're locked out, and intercepts model picks that
// require the premium unlock.
async function wireGateAndCheckTier() {
  const isProxied = location.protocol === 'http:' || location.protocol === 'https:';
  if (!isProxied) return;   // file:// — use legacy key entry instead

  const modal    = document.getElementById('gate-modal');
  const title    = document.getElementById('gate-title');
  const sub      = document.getElementById('gate-sub');
  const input    = document.getElementById('gate-input');
  const status   = document.getElementById('gate-status');
  const submit   = document.getElementById('gate-submit');
  const cancelBtn= document.getElementById('gate-cancel');
  if (!modal || !submit) { console.warn('[gate] modal not in DOM'); return; }

  // Hide the legacy 🔑 Key button — no longer needed.
  const keyBtn = document.getElementById('global-ai-key');
  if (keyBtn) keyBtn.hidden = true;

  let pendingResolve = null;

  function openGate({ premium = false, cancellable = false } = {}) {
    if (premium) {
      title.textContent = '⭐ Premium unlock — Sonnet/Opus';
      sub.textContent   = 'Enter the premium password to use Sonnet or Opus models. (Haiku stays available at the basic tier.)';
      input.placeholder = 'password';
    } else {
      title.textContent = '🔒 Enter site password';
      sub.textContent   = 'Ask the site owner for today\'s password.';
      input.placeholder = 'password';
    }
    cancelBtn.hidden = !cancellable;
    status.textContent = '';
    input.value = '';
    modal.hidden = false;
    setTimeout(() => input.focus(), 50);
    return new Promise((resolve) => { pendingResolve = resolve; });
  }
  function closeGate(result) {
    modal.hidden = true;
    if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(result); }
  }

  submit.addEventListener('click', async () => {
    const pw = input.value.trim();
    if (!pw) { status.textContent = '⚠ type the password'; return; }
    submit.disabled = true;
    status.textContent = 'Checking…';
    try {
      const res = await AICoach.submitGatePassword(pw);
      if (res.ok) {
        status.textContent = `✓ Unlocked: ${res.tier}`;
        setTimeout(() => closeGate(res), 400);
      } else {
        status.textContent = '✗ Wrong password. Try again.';
      }
    } catch (err) {
      status.textContent = `✗ ${err.message}`;
    } finally {
      submit.disabled = false;
    }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });
  cancelBtn.addEventListener('click', () => closeGate({ ok: false, tier: AICoach.getTier() }));

  // Expose so other code (e.g. model picker) can request premium unlock
  window.__requestPremiumUnlock = () => openGate({ premium: true, cancellable: true });

  // Initial check — what tier does the user have right now?
  const tier = await AICoach.refreshTier();
  if (tier === 'none') {
    // Block boot until they enter a valid password.
    await openGate({ premium: false, cancellable: false });
  }

  // Intercept model-picker changes: if they switch to a non-Haiku model but
  // only have basic tier, prompt for premium. If they cancel, revert the
  // select to the cheapest available (Haiku) so subsequent /api/ai calls
  // won't 402.
  const modelSelect = document.getElementById('global-ai-model');
  if (modelSelect) {
    modelSelect.addEventListener('change', async () => {
      const m = modelSelect.value;
      if (!AICoach.isPremiumModel(m)) return;       // Haiku — always fine
      if (AICoach.getTier() === 'premium') return;  // already unlocked
      const res = await openGate({ premium: true, cancellable: true });
      if (!res || res.tier !== 'premium') {
        // Revert to Haiku 4.5
        modelSelect.value = 'claude-haiku-4-5';
        AICoach.setModel('claude-haiku-4-5');
      }
    });
  }
}

main().catch(err => {
  console.error('[fatal]', err);
  const n = document.getElementById('narration-text');
  if (n) n.textContent = `Fatal error: ${err.message}`;
  showFatalBanner(err);
});
