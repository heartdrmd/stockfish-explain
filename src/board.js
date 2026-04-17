// board.js — chessground + chess.js + move-history navigation.

import { Chessground } from '../vendor/chessground/chessground.js';
import { Chess }       from '../vendor/chess.js/chess.js';
import { showPromotion } from './promotion.js';

export class BoardController extends EventTarget {
  constructor(rootEl, overlayEl) {
    super();
    this.rootEl    = rootEl;
    this.overlayEl = overlayEl;

    // ** Truth: `chess` holds the latest *live* position.
    // `viewPly` is which ply the user is looking at; null = live/end.
    this.chess = new Chess();
    this.viewPly = null;   // int: show position AFTER this many plies; null = live
    this.cg = null;
    this.orientation = 'white';
    // Analysis mode: both sides controlled by the user, engine just observes.
    this.playerColor = 'both';
  }

  init() {
    const self = this;
    this.cg = Chessground(this.rootEl, {
      fen: this.chess.fen(),
      orientation: this.orientation,
      turnColor: 'white',
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 200 },
      movable: {
        free: false,
        color: 'both',                       // either side can move
        dests: toDests(this.chess),
        showDests: true,
        events: { after: (orig, dest, meta) => self._onUserMove(orig, dest, meta) },
      },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      drawable: { enabled: true, defaultSnapToValidMove: true, eraseOnClick: false },
      premovable: { enabled: false },
    });

    this.rootEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const key = this._coordsToKey(e.clientX, e.clientY);
      if (!key) return;
      self._onRightClickSquare(key, e);
    });

    // Target-first input. Two modes:
    //  (a) pointerdown on empty/enemy square → start tracking. On pointerup,
    //      if released on a legal source square (i.e. user "dragged back"
    //      from target to a piece), execute that move. This is the
    //      "target-drag" input method.
    //  (b) If pointer didn't move much (still a click), fall through to
    //      click-target-first: if one legal source exists, play; otherwise
    //      highlight candidates, next click picks source.
    this.rootEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const target = this._coordsToKey(e.clientX, e.clientY);
      if (!target) return;
      const p = this.chess.get(target);
      // If our piece is on this square, chessground handles its own drag.
      if (p && p.color === this.chess.turn()) return;

      // Collect legal sources that can reach this target.
      let legalSources = [];
      try {
        legalSources = this.chess.moves({ verbose: true })
                                 .filter(m => m.to === target)
                                 .map(m => m.from);
      } catch { return; }
      if (!legalSources.length) return;

      // If user had previously armed candidates, this click might be a source pick.
      if (this._pendingTargetSources && this._pendingTargetSources.includes(target)) {
        const prevTarget = this._pendingTarget;
        this._clearTargetFirst();
        self._onUserMove(target, prevTarget, {});
        return;
      }

      // Light up the candidate sources (same chessground auto-shapes).
      this._highlightCandidates(legalSources);

      const startX = e.clientX, startY = e.clientY;
      let dragged = false;
      const MOVE_THRESHOLD = 5;  // px

      const onMove = (mv) => {
        if (!dragged) {
          const dx = mv.clientX - startX, dy = mv.clientY - startY;
          if (dx*dx + dy*dy > MOVE_THRESHOLD * MOVE_THRESHOLD) dragged = true;
        }
      };
      const onUp = (ue) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);

        if (dragged) {
          // Target-drag path — did we release on a legal source?
          const src = this._coordsToKey(ue.clientX, ue.clientY);
          this._clearTargetFirst();
          if (src && legalSources.includes(src)) {
            self._onUserMove(src, target, {});
          }
          // else: illegal release, silently cancel
          return;
        }

        // Click path — target-first click resolution.
        if (legalSources.length === 1) {
          this._clearTargetFirst();
          self._onUserMove(legalSources[0], target, {});
        } else {
          // Multiple candidates — leave highlights armed for the next click
          this._pendingTarget = target;
          this._pendingTargetSources = legalSources;
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    });

    return this;
  }

  _legalMove(from, to) {
    try {
      return this.chess.moves({ verbose: true }).some(m => m.from === from && m.to === to);
    } catch { return false; }
  }

  _highlightCandidates(squares) {
    // Use chessground auto-shapes as circles on candidate sources
    this.cg.setAutoShapes(squares.map(sq => ({ orig: sq, brush: 'yellow' })));
  }

  _clearTargetFirst() {
    this._pendingTarget = null;
    this._pendingTargetSources = null;
    // Restore auto-shapes (engine arrows come back on next `thinking` event)
  }

  // ──────── navigation ────────

  isAtLive()   { return this.viewPly === null || this.viewPly >= this.chess.history().length; }
  totalPlies() { return this.chess.history().length; }

  goToPly(n /* int or null for live */) {
    const total = this.totalPlies();
    if (n == null || n >= total) {
      this.viewPly = null;
      this._renderPosition(this.chess.fen(), lastMoveFromHistory(this.chess));
      this._allowUserToMoveIfTheirTurn();
    } else {
      n = Math.max(0, n);
      this.viewPly = n;
      const replay = new Chess();
      const verbose = this.chess.history({ verbose: true });
      let lastMove = null;
      for (let i = 0; i < n; i++) {
        const m = verbose[i];
        lastMove = [m.from, m.to];
        replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      }
      this._renderPosition(replay.fen(), lastMove);
      // KEEP movable enabled — user can play a new move from this historical
      // position. When they do, _onUserMove branches: truncates future moves,
      // plays the new move on top. Legal moves come from the historical chess.
      this._historicalChess = replay;   // used by _onUserMove for piece lookups
      this.cg.set({
        movable: {
          color: this.playerColor || 'both',
          dests: toDests(replay),
        },
      });
    }
    this.dispatchEvent(new CustomEvent('nav', { detail: { ply: this.viewPly, live: this.isAtLive() } }));
  }

  forward()   { this.goToPly((this.viewPly ?? this.totalPlies()) + 1); }
  backward()  { this.goToPly((this.viewPly ?? this.totalPlies()) - 1); }
  toStart()   { this.goToPly(0); }
  toEnd()     { this.goToPly(null); }

  _renderPosition(fen, lastMove) {
    const parts = fen.split(' ');
    const turnColor = parts[1] === 'w' ? 'white' : 'black';
    const check = (new Chess(fen)).inCheck() ? turnColor : false;
    this.cg.set({ fen, turnColor, lastMove, check });
  }

  _allowUserToMoveIfTheirTurn() {
    // Analysis mode: always let the side-to-move act.
    this.cg.set({ movable: { color: 'both', dests: toDests(this.chess) } });
  }

  // ──────── user move handling ────────

  _coordsToKey(x, y) {
    const bounds = this.rootEl.getBoundingClientRect();
    const file = Math.floor((x - bounds.left) / (bounds.width / 8));
    const rank = 7 - Math.floor((y - bounds.top) / (bounds.height / 8));
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    const fileCh = this.orientation === 'white'
      ? String.fromCharCode(97 + file)
      : String.fromCharCode(97 + 7 - file);
    const rankCh = this.orientation === 'white' ? (rank + 1) : (8 - rank);
    return `${fileCh}${rankCh}`;
  }

  _onRightClickSquare(key, _evt) {
    // Right-click also cancels any armed target-first state
    this._clearTargetFirst();
    this.cg.setAutoShapes([]);
    if (!this.isAtLive()) return;
    const piece = this.chess.get(key);
    this.dispatchEvent(new CustomEvent('why-not-region', {
      detail: { square: key, piece }
    }));
  }

  /** Cancel any pending target-first state and clear highlights — called
   *  after a user gesture completes so the next move attempt is clean. */
  _resetInputState() {
    this._clearTargetFirst();
    // Ask chessground to drop any current selection
    if (this.cg && typeof this.cg.selectSquare === 'function') {
      this.cg.selectSquare(null);
    }
    if (this.cg && typeof this.cg.cancelMove === 'function') {
      this.cg.cancelMove();
    }
  }

  async _onUserMove(orig, dest, _meta) {
    if (!this.isAtLive()) {
      // User moved from an old ply — branch? For now, truncate history and branch.
      const verbose = this.chess.history({ verbose: true });
      const keep = this.viewPly || 0;
      this.chess.reset();
      for (let i = 0; i < keep; i++) {
        const m = verbose[i];
        this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      }
      this.viewPly = null;
    }

    const piece = this.chess.get(orig);
    if (!piece) return;

    let promotion = null;
    if (piece.type === 'p'
        && ((piece.color === 'w' && dest[1] === '8')
         || (piece.color === 'b' && dest[1] === '1'))) {
      promotion = await showPromotion(
        this.overlayEl, dest, piece.color === 'w' ? 'white' : 'black', this.orientation,
      );
    }

    let move;
    try {
      move = this.chess.move({ from: orig, to: dest, promotion: promotion ? promotion[0] : undefined });
    } catch (e) {
      // Illegal — reset board to current truth and clear input state so
      // the user can try a different move immediately.
      this._renderPosition(this.chess.fen(), lastMoveFromHistory(this.chess));
      this._resetInputState();
      return;
    }
    if (!move) {
      this._renderPosition(this.chess.fen(), lastMoveFromHistory(this.chess));
      this._resetInputState();
      return;
    }

    if (promotion) {
      const color = piece.color === 'w' ? 'white' : 'black';
      const pieces = new Map();
      pieces.set(dest, { role: promotion, color, promoted: true });
      this.cg.setPieces(pieces);
    }

    this._syncToChessground([orig, dest]);
    this.dispatchEvent(new CustomEvent('move', { detail: { move, fen: this.chess.fen() } }));
  }

  _syncToChessground(lastMove) {
    const turn = this.chess.turn() === 'w' ? 'white' : 'black';
    this.cg.set({
      fen: this.chess.fen(),
      turnColor: turn,
      lastMove,
      check: this.chess.inCheck() ? turn : false,
      movable: {
        color: this.playerColor || 'both',
        dests: toDests(this.chess),
      },
    });
  }

  playEngineMove(uci) {
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;

    let move;
    try { move = this.chess.move({ from, to, promotion }); } catch (e) { return; }
    if (!move) return;

    this.cg.move(from, to);
    if (promotion) {
      const role = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[promotion];
      const color = move.color === 'w' ? 'white' : 'black';
      const p = new Map();
      p.set(to, { role, color, promoted: true });
      this.cg.setPieces(p);
    }
    this._syncToChessground([from, to]);
    this.dispatchEvent(new CustomEvent('move', { detail: { move, fen: this.chess.fen(), byEngine: true } }));
  }

  flipBoard() {
    this.orientation = this.orientation === 'white' ? 'black' : 'white';
    this.cg.set({ orientation: this.orientation });
  }

  newGame() {
    this.chess.reset();
    this.viewPly = null;
    this.cg.set({
      fen: this.chess.fen(),
      turnColor: 'white',
      lastMove: undefined,
      check: false,
      movable: { color: 'both', dests: toDests(this.chess) },
    });
    this.cg.setAutoShapes([]);
    this.dispatchEvent(new CustomEvent('new-game'));
  }

  undo() {
    // Analysis mode: undo one ply at a time.
    const undone = this.chess.undo();
    if (!undone) return null;
    this.viewPly = null;
    this._syncToChessground(lastMoveFromHistory(this.chess));
    this.dispatchEvent(new CustomEvent('undo'));
    return true;
  }

  fen()  { return this.chess.fen(); }
  turn() { return this.chess.turn(); }

  /**
   * Play a sequence of UCI moves from the current position.
   *
   * `animate` (default true): animates each move individually via
   * chessground. Good for short PV extrapolations (a few moves).
   *
   * When `animate` is false: applies all moves to chess.js internally,
   * then sets the final FEN on chessground in a single shot. Use this
   * when loading a whole game (60+ plies) — avoids the "animation storm"
   * of playing 70 moves in sequence.
   */
  playUciMoves(uciList, { animate = true } = {}) {
    if (!this.isAtLive()) this.toEnd();
    if (!uciList || !uciList.length) return false;

    if (!animate) {
      // Fast path: no per-move animation. Apply to chess.js, render final.
      for (const uci of uciList) {
        const from = uci.slice(0, 2);
        const to   = uci.slice(2, 4);
        const promotion = uci.length > 4 ? uci[4] : undefined;
        let move;
        try { move = this.chess.move({ from, to, promotion }); } catch { return false; }
        if (!move) return false;
      }
      const last = uciList[uciList.length - 1];
      this._syncToChessground([last.slice(0,2), last.slice(2,4)]);
      this.dispatchEvent(new CustomEvent('move', { detail: { fen: this.fen(), bulk: true } }));
      return true;
    }

    // Animated path (for PV extrapolations, etc.)
    for (const uci of uciList) {
      const from = uci.slice(0, 2);
      const to   = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      let move;
      try { move = this.chess.move({ from, to, promotion }); } catch { return false; }
      if (!move) return false;
      this.cg.move(from, to);
      if (promotion) {
        const role = { q:'queen', r:'rook', b:'bishop', n:'knight' }[promotion];
        const color = move.color === 'w' ? 'white' : 'black';
        const p = new Map();
        p.set(to, { role, color, promoted: true });
        this.cg.setPieces(p);
      }
    }
    const last = uciList[uciList.length - 1];
    this._syncToChessground([last.slice(0,2), last.slice(2,4)]);
    this.dispatchEvent(new CustomEvent('move', { detail: { fen: this.fen(), bulk: true } }));
    return true;
  }

  drawArrow(orig, dest, brush = 'paleGreen') {
    this.cg.setAutoShapes([{ orig, dest, brush }]);
  }

  drawArrows(shapes) {
    this.cg.setAutoShapes(shapes || []);
  }
}

export function toDests(chess) {
  const dests = new Map();
  const SQUARES = [];
  for (let r = 1; r <= 8; r++)
    for (let f = 0; f < 8; f++)
      SQUARES.push(String.fromCharCode(97 + f) + r);
  for (const sq of SQUARES) {
    try {
      const moves = chess.moves({ square: sq, verbose: true });
      if (moves.length) dests.set(sq, moves.map(m => m.to));
    } catch (e) {/* empty square */}
  }
  return dests;
}

function lastMoveFromHistory(chess) {
  const h = chess.history({ verbose: true });
  if (!h.length) return undefined;
  const last = h[h.length - 1];
  return [last.from, last.to];
}
