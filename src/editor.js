// editor.js — lichess-style board editor.
//
// Opens a modal with:
//   • piece palette (K Q R B N P for each color + trash)
//   • 8x8 clickable board
//   • side-to-move toggle
//   • buttons: Clear / Standard start / Cancel / Apply
//
// On Apply: builds a FEN from the editor state and calls a callback.
// The caller can then load that FEN onto the main board as a fresh
// starting position (BoardController knows to reset startingFen so
// scrolling back / undo won't leak the prior position).

import { Chess } from '../vendor/chess.js/chess.js';

const PIECE_GLYPHS = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/**
 * Mount the position editor. Returns a `{ open }` controller.
 * @param {(fen: string) => void} onApply  Called with the new FEN
 */
export function setupEditor(onApply) {
  // ─── DOM ───
  const modal = document.getElementById('editor-modal');
  if (!modal) { console.warn('[editor] #editor-modal not found'); return { open() {} }; }
  const boardEl    = modal.querySelector('#editor-board');
  const paletteEl  = modal.querySelector('.editor-palette');
  const closeBtn   = modal.querySelector('.editor-close');
  const cancelBtn  = modal.querySelector('#editor-cancel');
  const clearBtn   = modal.querySelector('#editor-clear');
  const standardBtn= modal.querySelector('#editor-standard');
  const applyBtn   = modal.querySelector('#editor-apply');
  const statusEl   = modal.querySelector('#editor-status');

  // ─── state ───
  // pieces: map 'e1' → 'K' (uppercase = white, lowercase = black)
  let pieces = {};
  let selectedPiece = 'K';   // current palette pick; empty string = trash
  let turnToMove = 'w';

  // ─── build board squares ───
  boardEl.innerHTML = '';
  for (let r = 8; r >= 1; r--) {
    for (let f = 0; f < 8; f++) {
      const sq = FILES[f] + r;
      const isDark = (f + r) % 2 === 0;
      const cell = document.createElement('div');
      cell.className = 'editor-sq ' + (isDark ? 'dark' : 'light');
      cell.dataset.sq = sq;
      cell.innerHTML = `<span class="editor-glyph" data-sq="${sq}"></span>`;
      boardEl.appendChild(cell);
    }
  }

  // ─── palette build ───
  function buildPalette() {
    paletteEl.innerHTML = '';
    const rowW = document.createElement('div'); rowW.className = 'editor-palette-row';
    const rowB = document.createElement('div'); rowB.className = 'editor-palette-row';
    for (const p of ['K', 'Q', 'R', 'B', 'N', 'P']) rowW.appendChild(paletteBtn(p));
    for (const p of ['k', 'q', 'r', 'b', 'n', 'p']) rowB.appendChild(paletteBtn(p));
    const trash = document.createElement('button');
    trash.className = 'editor-piece editor-trash';
    trash.dataset.piece = '';
    trash.textContent = '🗑 trash';
    trash.title = 'Pick, then click a square to remove its piece';
    trash.addEventListener('click', () => selectPiece(''));
    rowB.appendChild(trash);
    paletteEl.appendChild(rowW);
    paletteEl.appendChild(rowB);
  }
  function paletteBtn(letter) {
    const b = document.createElement('button');
    b.className = 'editor-piece';
    b.dataset.piece = letter;
    b.title = letter + ' — click then click the board to place';
    b.textContent = PIECE_GLYPHS[letter];
    if (letter === letter.toLowerCase()) b.classList.add('black');
    b.addEventListener('click', () => selectPiece(letter));
    return b;
  }
  function selectPiece(p) {
    selectedPiece = p;
    paletteEl.querySelectorAll('.editor-piece').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.piece === p);
    });
  }
  buildPalette();
  selectPiece('K');

  // ─── board click → place / remove ───
  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.editor-sq');
    if (!cell) return;
    const sq = cell.dataset.sq;
    if (selectedPiece === '') {
      delete pieces[sq];
    } else {
      pieces[sq] = selectedPiece;
    }
    renderBoard();
    validateAndSetStatus();
  });

  function renderBoard() {
    boardEl.querySelectorAll('.editor-glyph').forEach(g => {
      const sq = g.dataset.sq;
      const p = pieces[sq];
      g.textContent = p ? PIECE_GLYPHS[p] : '';
      g.classList.toggle('black', !!p && p === p.toLowerCase());
    });
  }

  // ─── turn toggle ───
  modal.querySelectorAll('input[name="editor-turn"]').forEach(inp => {
    inp.addEventListener('change', () => {
      turnToMove = modal.querySelector('input[name="editor-turn"]:checked').value;
      validateAndSetStatus();
    });
  });

  // ─── buttons ───
  clearBtn.addEventListener('click', () => { pieces = {}; renderBoard(); validateAndSetStatus(); });
  standardBtn.addEventListener('click', () => {
    pieces = {};
    // Standard starting array
    const back = ['R','N','B','Q','K','B','N','R'];
    for (let f = 0; f < 8; f++) {
      pieces[FILES[f] + 1] = back[f];
      pieces[FILES[f] + 8] = back[f].toLowerCase();
      pieces[FILES[f] + 2] = 'P';
      pieces[FILES[f] + 7] = 'p';
    }
    renderBoard();
    turnToMove = 'w';
    modal.querySelector('input[name="editor-turn"][value="w"]').checked = true;
    validateAndSetStatus();
  });

  function close() { modal.hidden = true; }
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  applyBtn.addEventListener('click', () => {
    const res = buildAndValidateFen();
    if (!res.ok) return;   // status msg already set
    close();
    onApply(res.fen);
  });

  // ─── FEN builder + validation ───
  function buildFen() {
    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const sq = FILES[f] + r;
        const p = pieces[sq];
        if (p) {
          if (empty) { row += empty; empty = 0; }
          row += p;
        } else {
          empty++;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    // castling — infer from king/rook positions on home squares
    let castling = '';
    if (pieces.e1 === 'K' && pieces.h1 === 'R') castling += 'K';
    if (pieces.e1 === 'K' && pieces.a1 === 'R') castling += 'Q';
    if (pieces.e8 === 'k' && pieces.h8 === 'r') castling += 'k';
    if (pieces.e8 === 'k' && pieces.a8 === 'r') castling += 'q';
    if (!castling) castling = '-';
    return `${rows.join('/')} ${turnToMove} ${castling} - 0 1`;
  }
  function buildAndValidateFen() {
    const wk = Object.entries(pieces).filter(([_, p]) => p === 'K');
    const bk = Object.entries(pieces).filter(([_, p]) => p === 'k');
    if (wk.length !== 1) { statusEl.textContent = '⚠ Need exactly 1 white king.'; return { ok: false }; }
    if (bk.length !== 1) { statusEl.textContent = '⚠ Need exactly 1 black king.'; return { ok: false }; }
    const fen = buildFen();
    try {
      const c = new Chess(fen);
      // Reject positions where the side NOT to move is in check (they'd be
      // the side that just moved — checking own king is illegal).
      const otherColor = turnToMove === 'w' ? 'b' : 'w';
      const tester = new Chess(fen.replace(' ' + turnToMove + ' ', ' ' + otherColor + ' '));
      if (tester.inCheck()) {
        statusEl.textContent = '⚠ Position is illegal: the side that just moved is left in check. Flip whose turn it is, or fix the position.';
        return { ok: false };
      }
      return { ok: true, fen };
    } catch (e) {
      statusEl.textContent = '⚠ chess.js rejected the FEN: ' + e.message;
      return { ok: false };
    }
  }
  function validateAndSetStatus() {
    const r = buildAndValidateFen();
    if (r.ok) statusEl.textContent = `✓ Legal. FEN: ${r.fen}`;
  }

  // ─── controller ───
  function open(currentFen) {
    // Seed from current board FEN
    pieces = {};
    try {
      const c = new Chess(currentFen);
      const fen = c.fen();
      const boardPart = fen.split(' ')[0];
      const ranks = boardPart.split('/');
      for (let i = 0; i < 8; i++) {
        const rank = 8 - i;
        let file = 0;
        for (const ch of ranks[i]) {
          if (/\d/.test(ch)) { file += +ch; continue; }
          pieces[FILES[file] + rank] = ch;
          file++;
        }
      }
      turnToMove = fen.split(' ')[1] || 'w';
    } catch {}
    modal.querySelector(`input[name="editor-turn"][value="${turnToMove}"]`).checked = true;
    renderBoard();
    validateAndSetStatus();
    modal.hidden = false;
  }

  return { open };
}
