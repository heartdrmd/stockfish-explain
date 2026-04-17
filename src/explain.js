// explain.js — orchestrates UI updates from engine events. All scores
// displayed from WHITE's POV (engine gives us side-to-move POV).

import { Chess } from '../vendor/chess.js/chess.js';
import * as Narr from './narrate.js';

export class Explainer {
  constructor({ engine, board, ui }) {
    this.engine = engine;
    this.board  = board;
    this.ui     = ui;
    this.currentFen = null;

    // Rule-7 hook: classical material diff (White POV, cp). Set from outside.
    this.imbalanceCpWhite = null;

    // Store last two evals (from white POV) for the delta-based narration.
    this.lastCpByFen = new Map();
  }

  wire() {
    this.engine.addEventListener('thinking', (e) => this._onThinking(e.detail));
    this.engine.addEventListener('bestmove', (e) => this._onBestmove(e.detail));
    this.board.addEventListener('why-not-region', (e) => this._onWhyNot(e.detail));
  }

  setFen(fen) { this.currentFen = fen; }

  _sideToMove() {
    return this.currentFen ? this.currentFen.split(' ')[1] : 'w';
  }

  _onThinking({ info, topMoves, history }) {
    const stm = this._sideToMove();

    // ALWAYS read the pearl + gauge from the best line (multipv 1), not the
    // whichever info line happened to arrive last.
    const best = topMoves.find(t => t.multipv === 1) || topMoves[0] || info;
    const wp = Narr.toWhitePOV(best.scoreKind, best.score, stm);

    this.ui.pearl.textContent = Narr.formatScore(wp.scoreKind, wp.score);
    this.ui.pearl.className   = 'pearl ' + scoreClass(wp.scoreKind, wp.score);

    // Depth + NPS always reflect the latest info (these aren't per-multipv)
    this.ui.depthLabel.textContent = `depth ${info.depth}/${info.seldepth}`;
    this.ui.npsLabel.textContent   =
      `${Math.round(info.nps / 1000)} kN/s · ${formatNodes(info.nodes)} nodes`;

    // Gauge fill from the best line
    const pct = gaugePercent(wp.scoreKind, wp.score);
    this.ui.gaugeBlack.style.height = `${100 - pct}%`;

    // Rule 7 indicator: if NNUE disagrees sharply with the imbalance number,
    // highlight the pearl.
    if (this.imbalanceCpWhite != null && wp.scoreKind === 'cp') {
      const disagreement = Math.abs(wp.score - this.imbalanceCpWhite);
      if (disagreement >= 150) {
        this.ui.pearl.classList.add('rule7');
        this.ui.pearl.title = `Rule 7: NNUE (${(wp.score/100).toFixed(2)}) disagrees with classical material (${(this.imbalanceCpWhite/100).toFixed(2)}) by ${(disagreement/100).toFixed(2)} pawns — activity & coordination dominate here.`;
      } else {
        this.ui.pearl.classList.remove('rule7');
        this.ui.pearl.title = '';
      }
    }

    // Depth progress bar
    const depthTarget = +this.ui.depthInput.value || 18;
    const pctDepth = Math.min(100, (info.depth / depthTarget) * 100);
    this.ui.barFill.style.width = `${pctDepth}%`;

    this._renderPVs(topMoves, stm);

    // Engine-arrow overlay for top 2 lines.
    // Best move: GREEN, extra-thick so it's obvious at a glance.
    // Second-best: PALE BLUE, normal thickness.
    if (best && best.pv && best.pv[0]) {
      const shapes = [{
        orig: best.pv[0].slice(0, 2),
        dest: best.pv[0].slice(2, 4),
        brush: 'green',          // fully opaque green, not pale
        modifiers: { lineWidth: 22 }, // much thicker than default 10
      }];
      if (topMoves[1] && topMoves[1].pv && topMoves[1].pv[0]) {
        shapes.push({
          orig: topMoves[1].pv[0].slice(0, 2),
          dest: topMoves[1].pv[0].slice(2, 4),
          brush: 'paleBlue',
          modifiers: { lineWidth: 12 },
        });
      }
      if (topMoves[2] && topMoves[2].pv && topMoves[2].pv[0]) {
        shapes.push({
          orig: topMoves[2].pv[0].slice(0, 2),
          dest: topMoves[2].pv[0].slice(2, 4),
          brush: 'paleGrey',
          modifiers: { lineWidth: 8 },
        });
      }
      this.board.drawArrows(shapes);
    }
  }

  _onBestmove({ best, topMoves, history }) {
    this.ui.barFill.style.width = `100%`;

    const stm = this._sideToMove();
    const top = topMoves[0];
    if (!top || !top.pv || !top.pv.length || !this.currentFen) return;

    const wp = Narr.toWhitePOV(top.scoreKind, top.score, stm);
    this.lastCpByFen.set(this.currentFen, wp.scoreKind === 'cp' ? wp.score : (wp.score > 0 ? 10000 : -10000));

    const chess = new Chess(this.currentFen);
    // For PV narration we feed in the top-moves array so "only move" detection works.
    const sentences = Narr.narratePV(chess, top.pv, { maxMoves: 5, topMoves });
    const word = Narr.scoreWord(wp.scoreKind, wp.score);
    const headline = `The engine sees the position as ${word} (${Narr.formatScore(wp.scoreKind, wp.score)} from White's view).`;
    this.ui.narrationText.innerHTML =
      boldify(headline) + '<br><br>' + sentences.map(boldify).join(' ');

    // Confidence badge
    const conf = Narr.confidenceFromHistory(history, topMoves);
    this.ui.confBadge.dataset.level = conf.level;
    this.ui.confBadge.textContent = conf.level.toUpperCase();
    this.ui.confReason.textContent = conf.reason;
  }

  _renderPVs(topMoves, stm) {
    const startFen = this.currentFen;
    const lines = topMoves.map((t, idx) => {
      const wp = Narr.toWhitePOV(t.scoreKind, t.score, stm);
      const scoreStr = Narr.formatScore(wp.scoreKind, wp.score);
      const clickable = uciLineToClickableSan(new Chess(startFen), t.pv, 10, idx);
      return `
        <div class="pv-line ${idx === 0 ? 'best' : ''}">
          <span class="pv-rank">${t.multipv}.</span>
          <span class="pv-score">${scoreStr}</span>
          <span class="pv-moves">${clickable}</span>
        </div>`;
    });
    this.ui.pvLines.innerHTML = lines.join('');

    // Wire clicks — each PV move plays every move from index 0 through the
    // clicked one onto the board.
    this.ui.pvLines.querySelectorAll('.pv-move').forEach(span => {
      span.addEventListener('click', () => {
        const pvIdx = +span.dataset.pv;
        const mvIdx = +span.dataset.move;
        const pv = topMoves[pvIdx]?.pv;
        if (!pv) return;
        const slice = pv.slice(0, mvIdx + 1);
        this.board.playUciMoves(slice);
      });
    });
  }

  async _onWhyNot({ square }) {
    if (!this.currentFen) return;
    const chess = new Chess(this.currentFen);
    const legal = chess.moves({ verbose: true });
    if (!legal.length) return;

    let candidate = legal.find(m => m.from === square) ?? legal.find(m => m.to === square);
    if (!candidate) return;

    this._showWhyModal(candidate.san, `Analysing ${candidate.san}…`, '', candidate.san);

    const uci = candidate.from + candidate.to + (candidate.promotion || '');
    const result = await this.engine.analyseMove(this.currentFen, uci, 14);
    if (!result) return;

    const top = result.topMoves && result.topMoves[0];
    if (!top || !top.pv) {
      this._showWhyModal(candidate.san, 'No refutation found.', '', candidate.san);
      return;
    }

    const stm = this._sideToMove();
    const wp = Narr.toWhitePOV(top.scoreKind, top.score, stm);
    const word = Narr.scoreWord(wp.scoreKind, wp.score);

    const chess2 = new Chess(this.currentFen);
    const moveObj = chess2.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });

    // Narrate the candidate (first sentence), then the opponent's best reply chain.
    const afterCandidate = new Chess(chess2.fen());
    const first = Narr.describeMove(moveObj, new Chess(this.currentFen), afterCandidate);
    const refutationPV = top.pv.slice(1);
    const refSentences = Narr.narratePV(chess2, refutationPV, { maxMoves: 4 });

    const verdict = `After ${candidate.san}, the engine evaluates the position as ${word} for White (${Narr.formatScore(wp.scoreKind, wp.score)}).`;
    const sanLine = uciLineToSan(new Chess(this.currentFen), top.pv, 8);

    this._showWhyModal(
      candidate.san,
      verdict,
      boldify(first) + ' ' + refSentences.map(boldify).join(' '),
      sanLine,
    );
  }

  _showWhyModal(moveSan, summary, narration, line) {
    this.ui.whyMove.textContent = moveSan;
    this.ui.whySummary.textContent = summary;
    this.ui.whyNarration.innerHTML = narration;
    this.ui.whyLine.innerHTML = line;
    this.ui.whyModal.hidden = false;
  }
}

function scoreClass(kind, score) {
  if (kind === 'mate') return 'mate';
  if (score >=  300) return 'winning';
  if (score <= -300) return 'losing';
  return '';
}

function gaugePercent(kind, score) {
  if (kind === 'mate') return score > 0 ? 98 : 2;
  const clipped = Math.max(-1000, Math.min(1000, score));
  const sigmoid = 1 / (1 + Math.exp(-clipped / 200));
  return Math.max(2, Math.min(98, sigmoid * 100));
}

function formatNodes(n) {
  if (n >= 1e9) return (n/1e9).toFixed(2) + ' G';
  if (n >= 1e6) return (n/1e6).toFixed(2) + ' M';
  if (n >= 1e3) return (n/1e3).toFixed(0) + ' k';
  return String(n);
}

function uciLineToSan(chess, uciMoves, max = 10) {
  const parts = [];
  for (let i = 0; i < Math.min(uciMoves.length, max); i++) {
    const uci = uciMoves[i];
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { break; }
    if (!mv) break;
    const ply = chess.history().length;
    if (ply % 2 === 1) {
      const moveNum = Math.ceil(ply / 2);
      parts.push(`${moveNum}.${mv.san}`);
    } else {
      parts.push(mv.san);
    }
  }
  return parts.join(' ');
}

/** Same as uciLineToSan but wraps each move in <span class="pv-move"> so it can
 *  be clicked to play it on the real board. */
function uciLineToClickableSan(chess, uciMoves, max, pvIdx) {
  const parts = [];
  for (let i = 0; i < Math.min(uciMoves.length, max); i++) {
    const uci = uciMoves[i];
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { break; }
    if (!mv) break;
    const ply = chess.history().length;
    const prefix = (ply % 2 === 1) ? `${Math.ceil(ply / 2)}.` : '';
    parts.push(
      `${prefix}<span class="pv-move" data-pv="${pvIdx}" data-move="${i}" title="Click to play up to here">${mv.san}</span>`
    );
  }
  return parts.join(' ');
}

function boldify(s) { return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
