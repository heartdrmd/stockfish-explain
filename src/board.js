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
        events: { after: (orig, dest, meta) => self._onUserMove(orig, dest, { ...meta, via: 'chessground-after' }) },
      },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      drawable: { enabled: true, defaultSnapToValidMove: true, eraseOnClick: false },
      premovable: { enabled: false },
      // Any chessground-native select or move invalidates our
      // target-first pending state — otherwise leftover highlights /
      // _pendingTargetSources can trigger a spurious 'which piece?'
      // on the user's next click.
      events: {
        move:   (orig, dest, meta) => {
          console.log('[cg] move fired', { orig, dest, capture: meta?.captured || null });
          self._clearTargetFirst();
        },
        select: (key) => {
          console.log('[cg] select fired', { key, cgSelectedAfter: self.cg?.state?.selected });
          self._clearTargetFirst();
        },
      },
    });

    this.rootEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const key = this._coordsToKey(e.clientX, e.clientY);
      if (!key) return;
      self._onRightClickSquare(key, e);
    });

    // Keep chessground's cached bounds fresh when the board element
    // itself resizes — chessground only listens for window resize +
    // document scroll, so CSS-driven reflows (panel show/hide, flex
    // reorder, board-resize handle) can leave stale bounds. Observing
    // rootEl covers all those cases.
    try {
      if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => {
          try { self.cg?.state?.dom?.bounds?.clear?.(); } catch {}
        });
        ro.observe(this.rootEl);
        this._boundsObserver = ro;
      }
    } catch {}

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
      // Chessground caches its board bounds via util.memo and only
      // invalidates on scroll/resize events. Any layout shift that
      // moves the board without either (panel show/hide, flex reorder,
      // toolbar toggle, etc.) leaves chessground with STALE bounds —
      // clicks map to squares 1-2 ranks off from where the user
      // actually clicked. Invalidate the cache every pointerdown so
      // the next bounds() call reads fresh. Cheap — one rect lookup.
      try { this.cg?.state?.dom?.bounds?.clear?.(); } catch {}
      const target = this._coordsToKey(e.clientX, e.clientY);
      if (!target) {
        console.log('[move-input] pointerdown off-board', { x: e.clientX, y: e.clientY });
        return;
      }
      const snapshot = {
        target,
        pieceAtTarget: this.chess.get(target) || null,
        turn: this.chess.turn(),
        cgSelected: this.cg?.state?.selected || null,
        viewPly: this.viewPly,
        pendingTarget: this._pendingTarget,
        pendingCount: this._pendingTargetSources?.length || 0,
      };
      console.log('[move-input] pointerdown', snapshot);

      // DEFER TO CHESSGROUND when a piece is already selected. If the
      // user clicked one of their own pieces first, cg.state.selected
      // holds that square — chessground will handle the next click as
      // the destination natively. Our target-first logic used to cut in
      // and show a "which piece?" candidates prompt when more than one
      // of the user's pieces could reach the target, overriding the
      // selection they'd already made.
      if (this.cg && this.cg.state && this.cg.state.selected) {
        console.log('[move-input] → bail: already-selected (chessground will handle)', { selected: this.cg.state.selected, target });
        this._logInputPath('bail:already-selected', target);
        return;
      }

      const effectiveChess = (!this.isAtLive() && this._historicalChess)
        ? this._historicalChess
        : this.chess;

      // PENDING-SOURCE RESOLUTION must run BEFORE any ownership-based
      // bail (near-miss / own-piece). Otherwise a user clicking an
      // own-piece that's ALSO a legal source for the armed target-
      // first gets swallowed by the ownership check — which the log
      // showed on Nf6 / b7 clicks.
      if (this._pendingTargetSources && this._pendingTargetSources.includes(target)) {
        const prevTarget = this._pendingTarget;
        console.log('[move-input] → resolve pending target-first', { source: target, target: prevTarget });
        this._clearTargetFirst();
        self._onUserMove(target, prevTarget, { via: 'pending-source' });
        this._logInputPath('resolve:pending-source', `${target}→${prevTarget}`);
        return;
      }

      // NEAR-MISS GUARD: if the click landed within one-third of a
      // square of a movable piece CENTRE but NOT on that square itself,
      // treat it as a piece-click intent and skip target-first. Covers
      // the "tapped king, finger on adjacent empty square" case.
      if (this._nearMissOwnPiece(e.clientX, e.clientY, effectiveChess, target)) {
        console.log('[move-input] → bail: near-miss-own-piece (treating as click on nearby piece)', { target });
        this._logInputPath('bail:near-miss-own-piece', target);
        return;
      }

      // If stale pending state exists (armed from a prior interaction
      // but the user has clicked somewhere unrelated now) — clear it.
      if (this._pendingTargetSources) {
        console.log('[move-input] clearing stale pending target-first state');
        this._clearTargetFirst();
      }

      const p = effectiveChess.get(target);
      // If our piece is on this square, chessground handles its own drag.
      if (p && p.color === effectiveChess.turn()) {
        console.log('[move-input] → bail: own-piece on target (chessground will select it)', { piece: p, target });
        this._logInputPath('bail:own-piece', target);
        return;
      }

      // Collect legal sources that can reach this target.
      let legalSources = [];
      try {
        legalSources = effectiveChess.moves({ verbose: true })
                                     .filter(m => m.to === target)
                                     .map(m => m.from);
      } catch (err) {
        console.warn('[move-input] chess.moves threw', err);
        return;
      }
      if (!legalSources.length) {
        console.log('[move-input] no legal moves to target → target-first aborted', { target });
        return;
      }
      // Multi-source policy:
      //   - CLICK (no drag)   → bail silently; the 'which piece?'
      //                         prompt was confusing. User picks the
      //                         piece first (chessground flow).
      //   - DRAG from target  → still supported: dragging TO a legal
      //                         source disambiguates, so we let it
      //                         through via the onUp handler below.
      // Single-source path keeps the candidate highlight so the user
      // sees which piece will move.
      const isSingleSource = legalSources.length === 1;
      if (isSingleSource) {
        console.log('[move-input] target-first: lighting up candidate', { target, sources: legalSources });
        this._highlightCandidates(legalSources);
      } else {
        console.log('[move-input] target-first: multi-source, drag enabled but no click prompt', { target, candidateCount: legalSources.length });
        // Highlights kept off — would have looked like the old
        // confusing "which piece?" prompt. Drag still tracks below.
      }

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
        const releasedOn = this._coordsToKey(ue.clientX, ue.clientY);
        console.log('[move-input] pointerup', { target, releasedOn, dragged });

        if (dragged) {
          // Target-drag path — did we release on a legal source?
          const src = this._coordsToKey(ue.clientX, ue.clientY);
          this._clearTargetFirst();
          if (src && legalSources.includes(src)) {
            console.log('[move-input] target-drag → playing', { src, target });
            self._onUserMove(src, target, { via: 'target-drag' });
          } else {
            console.log('[move-input] target-drag released on non-source, cancelled', { releasedOn: src, target });
          }
          return;
        }

        // Click path — target-first click resolution.
        if (legalSources.length === 1) {
          console.log('[move-input] target-first: single source → playing', { source: legalSources[0], target });
          this._clearTargetFirst();
          self._onUserMove(legalSources[0], target, { via: 'target-first-single' });
        } else {
          // Multi-source CLICK (no drag): arm pending state so the
          // user's NEXT click on a legal source resolves the move.
          // Highlights are intentionally left off to avoid the old
          // "which piece?" visual — but the pending-source pathway
          // in pointerdown will still pick up the next click silently.
          console.log('[move-input] target-first: multi-source click, arming pending', { target, sources: legalSources });
          self._pendingTarget = target;
          self._pendingTargetSources = legalSources;
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
    // Rebuild from the TREE mainline, not chess.history. If the user
    // had made a non-mainline exploratory move earlier, chess.history
    // contains that branch instead of the original game's moves — so
    // replaying from chess.history would desync the board position
    // from the mainline tree.currentPath and, over time, effectively
    // erase the original PGN from the user's perspective.
    //
    // CRITICAL: `total` must come from the MAINLINE length, NOT from
    // this.chess.history(). After the user plays a side-variation
    // move, chess.history is on that branch (shorter than mainline)
    // — callers like learn-mode asking to navigate to mainline ply 16
    // would previously get CLAMPED to chess.history.length (e.g. 15),
    // silently landing one ply earlier than requested.
    let mainlineLen = 0;
    {
      let c = this.tree.root;
      while (c.children.length) { c = c.children[0]; mainlineLen++; }
    }
    const total = mainlineLen;
    const targetN = (n == null || n >= total)
      ? total
      : Math.max(0, n);
    // Walk mainline (children[0] chain) to collect nodes up to targetN.
    const pathNodes = [];
    let path = '';
    let cur = this.tree.root;
    for (let i = 0; i < targetN; i++) {
      if (!cur.children.length) break;
      const child = cur.children[0];
      path += child.id;
      pathNodes.push(child);
      cur = child;
    }
    // Rebuild chess from the starting FEN applying only mainline moves.
    const replay = new Chess(this.startingFen);
    for (const node of pathNodes) {
      const u = node.uci;
      try { replay.move({ from: u.slice(0,2), to: u.slice(2,4), promotion: u.length > 4 ? u[4] : undefined }); } catch { break; }
    }
    this.chess = replay;
    this.tree.currentPath = path;
    if (n == null || n >= total) {
      this.viewPly = null;
      this._historicalChess = null;
    } else {
      this.viewPly = targetN;
    }
    const lastMove = pathNodes.length
      ? [pathNodes[pathNodes.length - 1].uci.slice(0, 2), pathNodes[pathNodes.length - 1].uci.slice(2, 4)]
      : null;
    this._renderPosition(replay.fen(), lastMove);
    if (n == null || n >= total) {
      this._allowUserToMoveIfTheirTurn();
    } else {
      // Let user play from this historical mainline ply — legal moves
      // from the rebuilt replay board.
      this._historicalChess = replay;
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
    // Measure against the actual <cg-board> element — not rootEl.
    // Why: rootEl is the cg-wrap mount point, which may contain
    // coord labels / SVG overlays that make its bounding rect bigger
    // than the real playing surface. Using rootEl gives results that
    // diverge from chessground's own key mapping by whole squares
    // (observed 2-rank offset → user clicking bishop, chessground
    // selecting empty square 2 rows away).
    // Always re-query cg-board (don't cache) — if a cached reference
    // became detached or the element was replaced, getBoundingClientRect
    // would return (0,0,0,0) and every click would read as off-board.
    // One querySelector per click is microseconds; worth the safety.
    const boardEl = this.rootEl.querySelector('cg-board');
    const bounds = (boardEl || this.rootEl).getBoundingClientRect();
    const relX = x - bounds.left;
    const relY = y - bounds.top;
    if (relX < 0 || relY < 0 || relX >= bounds.width || relY >= bounds.height) return null;
    const file = Math.floor(relX / (bounds.width / 8));
    const rank = 7 - Math.floor(relY / (bounds.height / 8));
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    const fileCh = this.orientation === 'white'
      ? String.fromCharCode(97 + file)
      : String.fromCharCode(97 + 7 - file);
    const rankCh = this.orientation === 'white' ? (rank + 1) : (8 - rank);
    return `${fileCh}${rankCh}`;
  }

  // Returns true if the click coords are within ~33% of a square from
  // the CENTRE of a square that holds a movable piece of the current
  // side-to-move. Used by the pointerdown handler to treat a slightly-
  // missed click on the king as a piece-click intention and keep
  // chessground in charge, rather than triggering our target-first
  // 'which piece?' flow.
  _nearMissOwnPiece(x, y, effectiveChess, clickedKey) {
    // Only returns true when an OWN piece sits on a NEIGHBOURING
    // square whose centre is within NEAR of the click — i.e. the
    // click missed its intended target slightly. Direct hits (click
    // is squarely on an own piece) are NOT handled here; they fall
    // through to the later own-piece check, which is semantically
    // clearer. The earlier version also returned true for direct
    // hits, which made the log hard to read and (worse) swallowed
    // pending-source source-pick clicks on own-piece legal sources.
    try {
      const boardEl = this.rootEl.querySelector('cg-board');
      const bounds = (boardEl || this.rootEl).getBoundingClientRect();
      const sqW = bounds.width / 8;
      const sqH = bounds.height / 8;
      const NEAR = sqW * 0.33;
      const turn = effectiveChess.turn();
      const clickFx = Math.floor((x - bounds.left) / sqW);
      const clickRy = Math.floor((y - bounds.top)  / sqH);
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          const fx = clickFx + df;
          const ry = clickRy + dr;
          if (fx < 0 || fx > 7 || ry < 0 || ry > 7) continue;
          // Skip the clicked square itself — direct hits aren't 'near
          // misses' and shouldn't fire this guard.
          if (df === 0 && dr === 0) continue;
          const cx = bounds.left + (fx + 0.5) * sqW;
          const cy = bounds.top  + (ry + 0.5) * sqH;
          if (Math.abs(x - cx) > NEAR || Math.abs(y - cy) > NEAR) continue;
          const rank = 7 - ry;
          const fileCh = this.orientation === 'white'
            ? String.fromCharCode(97 + fx)
            : String.fromCharCode(97 + 7 - fx);
          const rankCh = this.orientation === 'white' ? (rank + 1) : (8 - rank);
          const key = `${fileCh}${rankCh}`;
          if (key === clickedKey) continue;   // belt-and-braces guard
          const p = effectiveChess.get(key);
          if (p && p.color === turn) return true;
        }
      }
    } catch {}
    return false;
  }

  // Narration-area diagnostic — toggled by window.__boardInputDebug = true.
  // Prints which input path the last pointerdown fired so we can see in
  // the UI without opening DevTools.
  _logInputPath(path, detail) {
    if (!window.__boardInputDebug) return;
    const msg = `[input] ${path} ${detail || ''}`;
    console.log(msg);
    try {
      const el = document.getElementById('narration-text');
      if (el) {
        const tag = document.createElement('div');
        tag.style.cssText = 'font-family:var(--font-mono);font-size:10px;opacity:0.7;';
        tag.textContent = msg;
        el.appendChild(tag);
      }
    } catch {}
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
    console.log('[move] _onUserMove called', {
      orig, dest,
      via: _meta?.via || 'unknown',         // 'chessground-after' | 'pending-source' | 'target-first-click' | 'target-drag' | ...
      meta: _meta || {},
      chessTurn: this.chess.turn(),
      isAtLive: this.isAtLive(),
      viewPly: this.viewPly,
      fenBefore: this.chess.fen(),
    });
    if (!this.isAtLive()) {
      // User moved from an old ply — truncate chess.js to the view ply
      // and branch from here. The variation tree keeps the old line as a
      // sibling; chess.js is rebuilt for legality of the new move.
      console.log('[move] branching from historical ply', { viewPly: this.viewPly });
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
    if (!piece) {
      console.warn('[move] no piece at orig square — bailing', { orig });
      return;
    }

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
      console.warn('[move] chess.move threw (illegal)', { orig, dest, promotion, err: String(e) });
      this._renderPosition(this.chess.fen(), lastMoveFromHistory(this.chess));
      this._resetInputState();
      return;
    }
    if (!move) {
      console.warn('[move] chess.move returned null (illegal move rejected)', { orig, dest, promotion });
      this._renderPosition(this.chess.fen(), lastMoveFromHistory(this.chess));
      this._resetInputState();
      return;
    }
    console.log('[move] chess.move OK', { san: move.san, from: move.from, to: move.to, captured: move.captured || null, flags: move.flags });

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
    console.log('[move] tree updated', {
      uci, created: addRes?.created, path: this.tree.currentPath,
      newFen: this.chess.fen(),
    });

    // Chessground state sync — this kicks off the visual slide
    // animation. Run it synchronously so the animation frame renders
    // with zero competition.
    this._syncToChessground([orig, dest]);
    // Non-visual paperwork (move-list re-render, eval strip, engine
    // stop+start, graph update) runs in the NEXT animation frame
    // (Option B). The heavy sync work doesn't compete with the first
    // animation frame, so the piece-slide feels noticeably snappier
    // on slower devices. requestAnimationFrame gives us ~16 ms of
    // headroom before listeners run — invisible to the human eye.
    const moveFen = this.chess.fen();
    requestAnimationFrame(() => {
      this.dispatchEvent(new CustomEvent('move', { detail: { move, fen: moveFen } }));
    });
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
