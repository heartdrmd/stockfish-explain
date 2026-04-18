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
      try { return JSON.stringify(a); } catch { return String(a); }
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
});
window.addEventListener('unhandledrejection', (e) => {
  captureLog('error', [`unhandled-promise: ${(e.reason && e.reason.message) || e.reason}`]);
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

async function main() {
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

        coachHTML = `
          <div class="dissect-group dorfman-group coach-group">
            <h4>Positional Coach — ${rep.phase} · ${rep.sideToMove} to move</h4>
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
  let currentFlavor = flavorValid
    ? savedFlavor
    : (threadable ? (isPagesHost ? 'lite' : 'full') : 'lite-single');
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
    try {
      const info = await engine.boot({ flavor });
      engineReady = true;
      currentFlavor = info.flavor;
      ui.selectFlavor.value = info.flavor;
      // Friendly label: variant name + thread count
      const spec = ENGINE_FLAVORS[info.flavor];
      const shortName = (spec?.label || info.flavor).split(/[·—(]/)[0].trim();
      ui.engineMode.textContent = info.threaded
        ? `${shortName} · ${info.threads} thread${info.threads === 1 ? '' : 's'}`
        : `${shortName} · 1 thread`;
      ui.engineMode.title = spec?.label || info.flavor;
      if (info.threaded) ui.engineMode.classList.add('threaded');
      ui.narrationText.textContent = 'Engine ready. Make a move — I\'ll explain what I see.';
      // Kick off an analysis on the current position
      fireAnalysis();
    } catch (err) {
      console.error('[engine] boot failed', err);
      ui.engineMode.textContent = 'engine failed';
      ui.narrationText.textContent = String(err.message || err);
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

  await bootEngine(currentFlavor);

  // Explainer
  // `explainer` is referenced from inside renderDissection earlier, but we
  // actually construct it here. Use `var` so the name is hoisted (and `try`
  // catches the TDZ during initial render before this line runs).
  var explainer = new Explainer({ engine, board, ui });
  explainer.wire();
  explainer.setFen(board.fen());

  // ────────── Engine control <-> UI ──────────

  // Hardware concurrency — set max on thread slider. Default to HALF of
  // available cores so the browser stays snappy and other apps aren't
  // starved. User can crank it up to maxThreads - 1 if they want.
  const maxThreads = Math.max(1, navigator.hardwareConcurrency || 4);
  ui.rangeThreads.max = String(maxThreads);
  const defaultThreads = Math.max(1, Math.floor(maxThreads / 2));
  ui.rangeThreads.value = String(defaultThreads);
  ui.threadsVal.textContent = ui.rangeThreads.value;
  ui.threadsHw.textContent = `(${maxThreads} cores detected · default: half)`;

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

  // Pause state — when true, engine.start() is suppressed.
  // "locked" is a harder state: engine is pinned off until user explicitly
  // unlocks.
  let paused = false;
  let locked = localStorage.getItem('stockfish-explain.engine-locked') === '1';
  // Sync the instant-mute flag with persisted lock state so that if the
  // engine was locked on a previous session, the UI gate is already
  // closed before the first info event arrives.
  window.__engineMuted = locked;

  // Practice mode state:
  //   practiceColor: which color the user plays ('white' | 'black' | null = off)
  //   When set, engine auto-plays the opposite color as soon as it's their turn.
  let practiceColor = null;
  // Incremented whenever the user makes a move or practice ends —
  // bestmove listeners capture the token value at the time they were
  // registered and bail out if it's stale when they finally fire. Prevents
  // a slow engine search from playing an old bestmove onto a new position.
  let practiceSearchToken = 0;

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

  function fireAnalysis() {
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
      } else {
        engine.stop();
        if (!paused && !locked) {
          // Practice mode: engine search is ONLY used to find its own
          // move. On the user's turn we leave the engine idle so no
          // analysis leaks to the user. The `practice-thinking` class
          // on <body> drives the CSS that hides PV lines + score and
          // shows the "engine thinking…" indicator.
          if (practiceColor && board.isAtLive()) {
            const playerChar = practiceColor[0];
            const engineTurn = chessNow.turn() !== playerChar;
            if (engineTurn) {
              console.log('[practice] engine turn — searching', { fen, limits: searchLimits() });
              document.body.classList.add('practice-thinking');
              ui.narrationText.innerHTML = '⏳ <strong>Engine is thinking…</strong>';
              // Token to guard against stale listeners — if the user
              // makes a move before bestmove arrives, the token
              // increments and the old listener bails out.
              const myToken = ++practiceSearchToken;
              const onBest = (ev) => {
                engine.removeEventListener('bestmove', onBest);
                if (myToken !== practiceSearchToken) {
                  console.log('[practice] stale bestmove ignored', { myToken, current: practiceSearchToken });
                  return;
                }
                document.body.classList.remove('practice-thinking');
                if (ev.detail.best && ev.detail.best !== '(none)') {
                  console.log('[practice] engine plays', ev.detail.best);
                  board.playEngineMove(ev.detail.best);
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
    const v = +ui.limitValue.value || (mode === 'depth' ? 18 : 2000);
    return mode === 'depth' ? { depth: v } : { movetime: v };
  }

  // Auto-exit threat mode whenever the user interacts with the board —
  // threat was meant for "what would they do RIGHT NOW", so any move /
  // undo / new-game invalidates it.
  board.addEventListener('move',     () => {
    if (window.__threatMode) window.__exitThreatMode({ silent: true });
    renderMoveList(); fireAnalysis();
  });
  // Non-move tree mutations (adding a Stockfish PV as a variation via
  // right-click, promoting, deleting) still need the move list to
  // re-render. They don't change the live board so we skip fireAnalysis.
  board.addEventListener('tree-changed', () => {
    renderMoveList();
  });
  board.addEventListener('new-game', () => {
    if (window.__threatMode) window.__exitThreatMode({ silent: true });
    renderMoveList(); fireAnalysis();
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

    // Populate opening dropdown identically to tournament
    for (const group of OPENINGS) {
      const og = document.createElement('optgroup');
      og.label = group.group;
      for (let i = 0; i < group.items.length; i++) {
        const o = document.createElement('option');
        o.value = `${group.group}//${i}`;
        o.textContent = group.items[i].name;
        og.appendChild(o);
      }
      pSel.appendChild(og);
    }
    const pickedPracticeOpening = () => {
      const [gn, idxStr] = pSel.value.split('//');
      const grp = OPENINGS.find(g => g.group === gn);
      return grp ? grp.items[+idxStr] : OPENINGS[0].items[0];
    };
    const updatePMoves = () => {
      const op = pickedPracticeOpening();
      pMoves.textContent = op.moves.length
        ? op.moves.map((m, i) => (i % 2 === 0 ? `${Math.floor(i/2)+1}.${m}` : m)).join(' ')
        : '(start from move 1)';
    };
    pSel.addEventListener('change', updatePMoves);
    updatePMoves();

    pStren.addEventListener('input', () => { pStrenV.textContent = pStren.value; });
    pMode.addEventListener('change', () => {
      if (pMode.value === 'depth')    pVal.value = 14;
      if (pMode.value === 'movetime') pVal.value = 1500;
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

    pOpen.addEventListener('click',  () => pModal.hidden = false);
    pClose.addEventListener('click', () => pModal.hidden = true);
    pModal.addEventListener('click', (e) => { if (e.target === pModal) pModal.hidden = true; });

    pStart.addEventListener('click', () => {
      const useCurrent = pUseCurrent.checked;
      const op = pickedPracticeOpening();
      const color = pColor.value;       // 'white' | 'black'
      const skill = +pStren.value;
      const limitMode = pMode.value;
      const limitVal  = +pVal.value;

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

      pModal.hidden = true;
      ui.narrationText.innerHTML =
        `🎯 Practice started: <strong>${op.name}</strong>. You play <strong>${color}</strong>. ` +
        `Engine skill ${skill}/20. ${limitMode === 'depth' ? `Depth ${limitVal}` : `${limitVal}ms/move`}.`;

      // Kick the loop — if it's engine's turn first, it plays immediately
      fireAnalysis();
    });
  }

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
    const pgn = tree.pgn({
      tags: {
        Event: 'Stockfish.explain analysis',
        White: 'User',
        Black: 'User',
        Result: '*',
      },
    });
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
      // Nudge chessground to re-measure (it listens on window resize +
      // custom `chessgroundResize`)
      window.dispatchEvent(new Event('resize'));
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

    resizeHandle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      startW = boardElForResize.getBoundingClientRect().width;
      resizeHandle.setPointerCapture(e.pointerId);
    });
    resizeHandle.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Use the average of dx and dy so diagonal dragging behaves naturally
      // and both axes contribute
      const delta = (dx + dy) / 2;
      applySize(startW + delta);
    });
    resizeHandle.addEventListener('pointerup', (e) => {
      if (!resizing) return;
      resizing = false;
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
    console.log('[ai] tab buttons wired — coach:', !!coachBtn, 'position:', !!posBtn, 'tactics:', !!tacBtn);
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
      const result = await AICoach.askCoach({ fen, coachReport: rpt, engineLines: lines, recentMoves: recent, mode });
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
          <h4>🔎 Moves mentioned — checked against Stockfish</h4>
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
      const fen = board.isAtLive() ? board.fen() : rebuildFenAtPly(board.chess, board.viewPly);
      // Use the latest engine top if we have it
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
        const result = await AICoach.askCoach({ fen, coachReport: rpt, engineLines: lines, recentMoves: recent, mode });
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
});
