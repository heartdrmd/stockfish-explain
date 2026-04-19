// board.js — chessground + chess.js + move-history navigation.

import { Chessground } from '../vendor/chessground/chessground.js';
import { Chess }       from '../vendor/chess.js/chess.js';
import { showPromotion } from './promotion.js';
import { GameTree }     from './tree.js';

export class BoardController extends EventTarget {
  constructor(rootEl, overlayEl) {
    super();
    this.rootEl    = rootEl;
    this.overlayEl = overlayEl;

    // ** Truth: `chess` holds the latest *live* position.
    // `viewPly` is which ply the user is looking at; null = live/end.
    this.chess = new Chess();
    this.startingFen = this.chess.fen();
    this.viewPly = null;
    this.cg = null;
    this.orientation = 'white';
    this.playerColor = 'both';
    // Variation tree — mirrors every move played into a branching
    // structure so the user can explore sidelines without losing the
    // mainline. `tree.currentPath` is the path of the currently-viewed
    // node. Mainline = children[0] at every level.
    this.tree = new GameTree(this.startingFen);
  }

  init() {
    const self = this;
    this.cg = Chessground(this.rootEl, {
      fen: this.chess.fen(),
      orientation: this.orientation,
      turnColor: 'white',
      highlight: { lastMove: true, check: true },
      // Shorter slide — 120 ms feels snappy while still visible. Long
      // animations exaggerate main-thread hiccups during the slide.
      animation: { enabled: true, duration: 120 },
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

      // FIRST: if the user previously clicked a target and we highlighted
      // candidates, this click might be them picking the source.
      if (this._pendingTargetSources && this._pendingTargetSources.includes(target)) {
        const prevTarget = this._pendingTarget;
        this._clearTargetFirst();
        self._onUserMove(target, prevTarget, {});
        return;
      }

      // IMPORTANT: when the user has scrolled back to a past ply, `this.chess`
      // still holds the LIVE position — NOT the past one the user is looking
      // at. All legality + piece-color lookups in this handler must use the
      // position actually displayed on the board. `_historicalChess` is set
      // by goToPly() whenever viewPly < total; otherwise we use this.chess.
      const effectiveChess = (!this.isAtLive() && this._historicalChess)
        ? this._historicalChess
        : this.chess;

      const p = effectiveChess.get(target);
      // If our piece is on this square, chessground handles its own drag.
      if (p && p.color === effectiveChess.turn()) return;

      // Collect legal sources that can reach this target.
      let legalSources = [];
      try {
        legalSources = effectiveChess.moves({ verbose: true })
                                     .filter(m => m.to === target)
                                     .map(m => m.from);
      } catch { return; }
      if (!legalSources.length) return;

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

  /** Sync tree.currentPath to match the first `n` plies of chess.history
   *  along the tree's mainline. Called during navigation. */
  _syncTreePathToPly(n) {
    // Walk down children[0] at each level to ply n (or as far as tree allows).
    let path = '';
    let node = this.tree.root;
    const target = n == null ? this.chess.history().length : n;
    for (let i = 0; i < target; i++) {
      if (!node.children.length) break;
      const child = node.children[0];
      path += child.id;
      node = child;
    }
    this.tree.currentPath = path;
  }

  goToPly(n /* int or null for live */) {
    const total = this.totalPlies();
    if (n == null || n >= total) {
      this.viewPly = null;
      this._historicalChess = null;    // guard against stale reads
      this._syncTreePathToPly(total);
      this._renderPosition(this.chess.fen(), lastMoveFromHistory(this.chess));
      this._allowUserToMoveIfTheirTurn();
    } else {
      n = Math.max(0, n);
      this.viewPly = n;
      this._syncTreePathToPly(n);
      // Replay from the GAME's starting FEN, not the standard chess array —
      // otherwise a pasted position flashes the default start when the user
      // scrolls back.
      const replay = new Chess(this.startingFen);
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

  // TREE-AWARE navigation. forward / backward / toStart / toEnd walk
  // the tree from tree.currentPath instead of using chess.history —
  // so when the user is on a variation, Forward doesn't jump back
  // to the mainline but stays on the branch. Click a different
  // branch in the move list to switch branches.
  _navigateTo(newPath) {
    const nodes = this.tree.nodesAlong(newPath);
    const replay = new Chess(this.startingFen);
    for (const n of nodes) {
      const u = n.uci;
      try {
        replay.move({ from: u.slice(0,2), to: u.slice(2,4), promotion: u.length > 4 ? u[4] : undefined });
      } catch { break; }
    }
    this.chess = replay;
    this.tree.currentPath = newPath;
    this.viewPly = null;
    this._historicalChess = null;
    const lastMove = nodes.length
      ? [nodes[nodes.length-1].uci.slice(0,2), nodes[nodes.length-1].uci.slice(2,4)]
      : undefined;
    const turn = replay.turn() === 'w' ? 'white' : 'black';
    this.cg.set({
      fen: replay.fen(),
      turnColor: turn,
      lastMove,
      check: replay.inCheck() ? turn : false,
      movable: { color: this.playerColor || 'both', dests: toDests(replay) },
    });
    this.dispatchEvent(new CustomEvent('nav', { detail: { path: newPath, live: true } }));
  }
  forward()   {
    const node = this.tree.nodeAtPath(this.tree.currentPath);
    if (!node || !node.children.length) return;
    this._navigateTo(this.tree.currentPath + node.children[0].id);
  }
  backward()  {
    if (!this.tree.currentPath) return;
    this._navigateTo(this.tree.parentPath(this.tree.currentPath) || '');
  }
  toStart()   { this._navigateTo(''); }
  toEnd()     {
    let path = this.tree.currentPath;
    let node = this.tree.nodeAtPath(path);
    while (node && node.children.length) {
      const c = node.children[0];
      path += c.id;
      node = c;
    }
    this._navigateTo(path);
  }

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
      // User moved from an old ply — truncate chess.js to the view ply
      // and branch from here. The variation tree keeps the old line as a
      // sibling; chess.js is rebuilt for legality of the new move.
      const verbose = this.chess.history({ verbose: true });
      const keep = this.viewPly || 0;
      this.chess = new Chess(this.startingFen);
      for (let i = 0; i < keep; i++) {
        const m = verbose[i];
        this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      }
      this.viewPly = null;
      this._historicalChess = null;    // no longer needed
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

    // Mirror the move into the variation tree. If the move matches an
    // existing child of the current node, we navigate to it; otherwise a
    // new branch is added (which will render as a sideline in the move
    // list and be preserved in PGN export).
    const uci = orig + dest + (promotion || '');
    const addRes = this.tree.addNode(
      { uci, san: move.san, fen: this.chess.fen() },
      this.tree.currentPath,
    );
    if (addRes) this.tree.currentPath = addRes.path;

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
    // Mirror into variation tree
    const fullUci = from + to + (promotion || '');
    const addRes = this.tree.addNode(
      { uci: fullUci, san: move.san, fen: this.chess.fen() },
      this.tree.currentPath,
    );
    if (addRes) this.tree.currentPath = addRes.path;
    this._syncToChessground([from, to]);
    this.dispatchEvent(new CustomEvent('move', { detail: { move, fen: this.chess.fen(), byEngine: true } }));
  }

  flipBoard() {
    this.orientation = this.orientation === 'white' ? 'black' : 'white';
    this.cg.set({ orientation: this.orientation });
    // Let listeners (eval gauge, any orientation-aware UI) know so
    // they can flip along with the board. Without this the eval bar
    // shows white-at-bottom regardless of which side the user is
    // playing — confusing when playing Black from the bottom.
    this.dispatchEvent(new CustomEvent('orientation-change', {
      detail: { orientation: this.orientation },
    }));
  }

  newGame() {
    this.chess.reset();
    this.startingFen = this.chess.fen();   // back to standard start
    this.viewPly = null;
    this.tree = new GameTree(this.startingFen);
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
    // Move tree cursor back one node on the current path. (Keeps the
    // undone move in the tree — user can re-enter that branch later if
    // they want.)
    if (this.tree.currentPath) {
      this.tree.currentPath = this.tree.parentPath(this.tree.currentPath) || '';
    }
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
      for (const uci of uciList) {
        const from = uci.slice(0, 2), to = uci.slice(2, 4);
        const promotion = uci.length > 4 ? uci[4] : undefined;
        let move;
        try { move = this.chess.move({ from, to, promotion }); } catch { return false; }
        if (!move) return false;
        const full = from + to + (promotion || '');
        const addRes = this.tree.addNode({ uci: full, san: move.san, fen: this.chess.fen() }, this.tree.currentPath);
        if (addRes) this.tree.currentPath = addRes.path;
      }
      const last = uciList[uciList.length - 1];
      this._syncToChessground([last.slice(0,2), last.slice(2,4)]);
      this.dispatchEvent(new CustomEvent('move', { detail: { fen: this.fen(), bulk: true } }));
      return true;
    }

    // Animated path (for PV extrapolations, etc.)
    for (const uci of uciList) {
      const from = uci.slice(0, 2), to = uci.slice(2, 4);
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
      const full = from + to + (promotion || '');
      const addRes = this.tree.addNode({ uci: full, san: move.san, fen: this.chess.fen() }, this.tree.currentPath);
      if (addRes) this.tree.currentPath = addRes.path;
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
