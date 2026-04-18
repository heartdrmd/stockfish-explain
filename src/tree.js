// tree.js — variation tree, lichess-style.
//
// Node shape:
//   { id, ply, uci, san, fen, children: [] }
// where `children[0]` is always the mainline continuation and
// `children[1..N]` are variations.
//
// `currentPath` is a concatenation of 2-char node ids — e.g. "a7b3c1".
// Navigation is just string manipulation. `nodeAtPath("")` = root.
//
// This module does NOT touch chess.js — it just holds the move-tree
// structure. Callers supply the FEN after each move (computed via
// chess.js) and the tree stores it for later lookup / replay.

import { Chess } from '../vendor/chess.js/chess.js';

const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class GameTree {
  constructor(startingFen = DEFAULT_FEN) {
    this.root = {
      id: '',
      ply: 0,
      uci: null,
      san: null,
      fen: startingFen,
      children: [],
    };
    this.currentPath = '';
  }

  // ─── path ops ───
  nodeAtPath(path) {
    if (!path) return this.root;
    let node = this.root;
    for (let i = 0; i < path.length; i += 2) {
      const id = path.slice(i, i + 2);
      const child = node.children.find(c => c.id === id);
      if (!child) return null;
      node = child;
    }
    return node;
  }
  parentPath(path) { return path ? path.slice(0, -2) : null; }
  pathAppend(path, id) { return path + id; }
  pathsEqual(a, b) { return a === b; }
  /** true if `path` traverses only children[0] from root — i.e. mainline */
  isMainlinePath(path) {
    if (!path) return true;
    let node = this.root;
    for (let i = 0; i < path.length; i += 2) {
      const id = path.slice(i, i + 2);
      const idx = node.children.findIndex(c => c.id === id);
      if (idx === -1) return false;
      if (idx !== 0) return false;
      node = node.children[idx];
    }
    return true;
  }

  // Deterministic 2-char id from UCI — collisions possible but extremely
  // rare within a single parent's children list. If we ever hit a
  // conflict within siblings, fall back to "zz" + retry counter.
  idFromUci(uci, siblings = []) {
    let h = 0;
    for (let i = 0; i < uci.length; i++) h = (h * 31 + uci.charCodeAt(i)) & 0xffff;
    let id = h.toString(36).padStart(2, '0').slice(0, 2);
    if (siblings.some(s => s.id === id)) {
      for (let k = 0; k < 36 * 36; k++) {
        id = k.toString(36).padStart(2, '0').slice(0, 2);
        if (!siblings.some(s => s.id === id)) break;
      }
    }
    return id;
  }

  // ─── add / navigate ───

  /** Try to add a move at `path`. If a child with the same UCI already
   *  exists, return it (idempotent). Otherwise create a new child. */
  addNode({ uci, san, fen }, path = this.currentPath) {
    const parent = this.nodeAtPath(path);
    if (!parent) {
      console.warn('[tree] addNode: no parent at path', path);
      return null;
    }
    const existing = parent.children.find(c => c.uci === uci);
    if (existing) {
      console.log('[tree] addNode: merged into existing child', {
        path, uci, existingId: existing.id, siblingCount: parent.children.length,
      });
      return { node: existing, path: path + existing.id, created: false };
    }
    const id = this.idFromUci(uci, parent.children);
    const child = {
      id,
      ply: parent.ply + 1,
      uci, san, fen,
      children: [],
    };
    parent.children.push(child);
    console.log('[tree] addNode: NEW branch', {
      path, uci, san, newId: id,
      siblingCountNow: parent.children.length,
      isFirstChild: parent.children.length === 1,
    });
    return { node: child, path: path + id, created: true };
  }

  /** Play a series of UCIs starting from `path`. Returns the path of the
   *  last node added. Used when clicking a Stockfish PV. */
  addUciLine(uciList, startPath = this.currentPath) {
    let path = startPath;
    let startNode = this.nodeAtPath(path);
    if (!startNode) return path;
    const chess = new Chess(startNode.fen);
    for (const uci of uciList) {
      const from = uci.slice(0, 2), to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      let mv;
      try { mv = chess.move({ from, to, promotion }); } catch { break; }
      if (!mv) break;
      const res = this.addNode({ uci, san: mv.san, fen: chess.fen() }, path);
      if (!res) break;
      path = res.path;
    }
    return path;
  }

  // ─── mutations ───

  /** Move the child at `path` to position 0 in its parent's children array
   *  (i.e. make it the mainline). No-op if already mainline. */
  promoteVariation(path) {
    if (!path) return;
    const parent = this.nodeAtPath(this.parentPath(path));
    if (!parent) return;
    const id = path.slice(-2);
    const idx = parent.children.findIndex(c => c.id === id);
    if (idx <= 0) return;           // already mainline or not found
    const [child] = parent.children.splice(idx, 1);
    parent.children.unshift(child);
  }

  /** Remove the subtree at `path`. */
  deleteAt(path) {
    if (!path) return;
    const parent = this.nodeAtPath(this.parentPath(path));
    if (!parent) return;
    const id = path.slice(-2);
    parent.children = parent.children.filter(c => c.id !== id);
    if (this.currentPath.startsWith(path)) {
      this.currentPath = this.parentPath(path);
    }
  }

  // ─── traversal helpers ───

  /** Gather the mainline chain from root as a flat array of nodes (excluding root). */
  mainlineNodes() {
    const out = [];
    let n = this.root;
    while (n.children.length > 0) {
      n = n.children[0];
      out.push(n);
    }
    return out;
  }

  /** The ply-path from root to `path` as an array of nodes (root excluded). */
  nodesAlong(path) {
    const out = [];
    if (!path) return out;
    let node = this.root;
    for (let i = 0; i < path.length; i += 2) {
      const id = path.slice(i, i + 2);
      const child = node.children.find(c => c.id === id);
      if (!child) break;
      out.push(child);
      node = child;
    }
    return out;
  }

  // ─── PGN with variations ───

  /** Serialize tree to standard PGN. Mainline inline, variations in parens.
   *  Follows lichess' `renderNodesTxt` pattern. */
  pgn({ tags = {} } = {}) {
    const defaultTags = {
      Event:    'Analysis',
      Site:     'Stockfish.explain',
      Date:     new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      Round:    '-',
      White:    '?',
      Black:    '?',
      Result:   '*',
      ...tags,
    };
    // FEN tag if non-standard start
    const startFen = this.root.fen;
    const nonDefaultStart = startFen !== DEFAULT_FEN;
    const tagLines = Object.entries(defaultTags).map(([k, v]) => `[${k} "${v}"]`);
    if (nonDefaultStart) {
      tagLines.push(`[SetUp "1"]`);
      tagLines.push(`[FEN "${startFen}"]`);
    }

    const body = this._renderChildren(this.root, /* forcePly */ nonDefaultStart);
    return tagLines.join('\n') + '\n\n' + body.trim() + ' ' + defaultTags.Result + '\n';
  }

  _renderChildren(node, forcePly) {
    if (!node.children.length) return '';
    const mainline = node.children[0];
    const siblings = node.children.slice(1);

    let out = this._moveText(node, mainline, forcePly);

    // Siblings are variations — each wrapped in parens
    for (const sib of siblings) {
      out += ' (' + this._moveText(node, sib, /* force */ true) +
             this._renderChildren(sib, /* force */ true).replace(/^/, ' ').trimEnd() + ')';
    }

    // Recurse into mainline. If there WERE siblings, the next mainline move
    // needs a ply prefix restated (PGN convention: "1... d5" even though
    // mainline normally wouldn't re-emit).
    const next = this._renderChildren(mainline, siblings.length > 0);
    if (next) out += ' ' + next;
    return out;
  }

  _moveText(parent, child, forcePly) {
    // Parent's ply tells us whose move `child` is. White moves = even parent
    // ply → emit "N. san"; black moves = odd parent ply → emit just "san"
    // unless forcePly true (start of variation or post-branch mainline).
    const fullmove = Math.floor(parent.ply / 2) + 1;
    const isWhite = parent.ply % 2 === 0;
    if (isWhite)          return `${fullmove}. ${child.san}`;
    if (forcePly)         return `${fullmove}... ${child.san}`;
    return child.san;
  }
}
