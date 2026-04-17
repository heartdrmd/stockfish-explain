// editor.js — lichess-style board editor using the same cburnett SVG
// piece set as the main board (assets/pieces/cburnett/). No ugly unicode
// glyphs.
//
// Opens a modal with:
//   • piece palette (K Q R B N P for each color + trash) — real SVGs
//   • clickable 8x8 board with lichess-ish brown squares
//   • side-to-move toggle
//   • buttons: Clear / Standard start / Cancel / Apply
//
// On Apply: builds a FEN from the editor state and calls a callback.
// The caller loads that FEN onto the main board as a fresh starting
// position.

import { Chess } from '../vendor/chess.js/chess.js';

// Maps FEN letter → piece asset filename stem
const PIECE_ASSET = {
  K: 'wK', Q: 'wQ', R: 'wR', B: 'wB', N: 'wN', P: 'wP',
  k: 'bK', q: 'bQ', r: 'bR', b: 'bB', n: 'bN', p: 'bP',
};
const ASSET_BASE = 'assets/pieces/cburnett/';
const pieceUrl = (letter) => `${ASSET_BASE}${PIECE_ASSET[letter]}.svg`;

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/**
 * Mount the position editor. Returns a `{ open }` controller.
 * @param {(fen: string) => void} onApply  Called with the new FEN
 */
export function setupEditor(onApply) {
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
  let pieces = {};              // 'e1' → 'K'
  let selectedPiece = 'K';      // '' = trash mode
  let turnToMove = 'w';

  // ─── build the 8×8 board ───
  boardEl.innerHTML = '';
  for (let r = 8; r >= 1; r--) {
    for (let f = 0; f < 8; f++) {
      const sq = FILES[f] + r;
      const isDark = (f + r) % 2 === 0;
      const cell = document.createElement('div');
      cell.className = 'editor-sq ' + (isDark ? 'dark' : 'light');
      cell.dataset.sq = sq;
      // Piece image rendered as <div> with background-image.
      const pieceDiv = document.createElement('div');
      pieceDiv.className = 'editor-piece-img';
      pieceDiv.dataset.sq = sq;
      cell.appendChild(pieceDiv);
      boardEl.appendChild(cell);
    }
  }

  // ─── piece palette ───
  function buildPalette() {
    paletteEl.innerHTML = '';
    const rowW = document.createElement('div'); rowW.className = 'editor-palette-row';
    const rowB = document.createElement('div'); rowB.className = 'editor-palette-row';
    for (const p of ['K','Q','R','B','N','P']) rowW.appendChild(paletteBtn(p));
    for (const p of ['k','q','r','b','n','p']) rowB.appendChild(paletteBtn(p));
    const trash = document.createElement('button');
    trash.type = 'button';
    trash.className = 'editor-piece-btn editor-trash';
    trash.dataset.piece = '';
    trash.innerHTML = '<span class="trash-glyph">🗑</span><span class="trash-label">Erase</span>';
    trash.title = 'Click a square to remove its piece';
    trash.addEventListener('click', () => selectPiece(''));
    rowB.appendChild(trash);
    paletteEl.appendChild(rowW);
    paletteEl.appendChild(rowB);
  }
  function paletteBtn(letter) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'editor-piece-btn';
    b.dataset.piece = letter;
    b.title = letter.toUpperCase() + (letter === letter.toUpperCase() ? ' (white)' : ' (black)') +
              ' — click then click the board to place';
    const img = document.createElement('div');
    img.className = 'editor-piece-img palette';
    img.style.backgroundImage = `url("${pieceUrl(letter)}")`;
    b.appendChild(img);
    b.addEventListener('click', () => selectPiece(letter));
    return b;
  }
  function selectPiece(p) {
    selectedPiece = p;
    paletteEl.querySelectorAll('.editor-piece-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.piece === p);
    });
  }
  buildPalette();
  selectPiece('K');

  // ─── clicking board squares ───
  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.editor-sq');
    if (!cell) return;
    const sq = cell.dataset.sq;
    if (selectedPiece === '') delete pieces[sq];
    else                      pieces[sq] = selectedPiece;
    renderBoard();
    validateAndSetStatus();
  });
  // Right-click a square to erase without needing to pick trash
  boardEl.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.editor-sq');
    if (!cell) return;
    e.preventDefault();
    delete pieces[cell.dataset.sq];
    renderBoard();
    validateAndSetStatus();
  });

  function renderBoard() {
    boardEl.querySelectorAll('.editor-piece-img').forEach(g => {
      const sq = g.dataset.sq;
      const p = pieces[sq];
      g.style.backgroundImage = p ? `url("${pieceUrl(p)}")` : '';
    });
  }

  // ─── turn radios ───
  modal.querySelectorAll('input[name="editor-turn"]').forEach(inp => {
    inp.addEventListener('change', () => {
      turnToMove = modal.querySelector('input[name="editor-turn"]:checked').value;
      validateAndSetStatus();
    });
  });

  // ─── action buttons ───
  clearBtn.addEventListener('click', () => { pieces = {}; renderBoard(); validateAndSetStatus(); });
  standardBtn.addEventListener('click', () => {
    pieces = {};
    const back = ['R','N','B','Q','K','B','N','R'];
    for (let f = 0; f < 8; f++) {
      pieces[FILES[f] + 1] = back[f];
      pieces[FILES[f] + 8] = back[f].toLowerCase();
      pieces[FILES[f] + 2] = 'P';
      pieces[FILES[f] + 7] = 'p';
    }
    turnToMove = 'w';
    modal.querySelector('input[name="editor-turn"][value="w"]').checked = true;
    renderBoard();
    validateAndSetStatus();
  });
  function close() { modal.hidden = true; }
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  applyBtn.addEventListener('click', () => {
    const res = buildAndValidateFen();
    if (!res.ok) return;
    close();
    onApply(res.fen);
  });

  // ─── FEN builder + validation ───
  function buildFen() {
    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '', empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = pieces[FILES[f] + r];
        if (p) { if (empty) { row += empty; empty = 0; } row += p; }
        else   { empty++; }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    let castling = '';
    if (pieces.e1 === 'K' && pieces.h1 === 'R') castling += 'K';
    if (pieces.e1 === 'K' && pieces.a1 === 'R') castling += 'Q';
    if (pieces.e8 === 'k' && pieces.h8 === 'r') castling += 'k';
    if (pieces.e8 === 'k' && pieces.a8 === 'r') castling += 'q';
    if (!castling) castling = '-';
    return `${rows.join('/')} ${turnToMove} ${castling} - 0 1`;
  }
  function buildAndValidateFen() {
    const wk = Object.values(pieces).filter(p => p === 'K').length;
    const bk = Object.values(pieces).filter(p => p === 'k').length;
    if (wk !== 1) { statusEl.textContent = '⚠ Need exactly 1 white king.'; return { ok: false }; }
    if (bk !== 1) { statusEl.textContent = '⚠ Need exactly 1 black king.'; return { ok: false }; }
    const fen = buildFen();
    try {
      new Chess(fen);
      const otherColor = turnToMove === 'w' ? 'b' : 'w';
      const tester = new Chess(fen.replace(' ' + turnToMove + ' ', ' ' + otherColor + ' '));
      if (tester.inCheck()) {
        statusEl.textContent = '⚠ Illegal: the side that would have just moved is in check. Flip turn or fix.';
        return { ok: false };
      }
      return { ok: true, fen };
    } catch (e) {
      statusEl.textContent = '⚠ chess.js rejected FEN: ' + e.message;
      return { ok: false };
    }
  }
  function validateAndSetStatus() {
    const r = buildAndValidateFen();
    if (r.ok) statusEl.textContent = `✓ Legal. FEN: ${r.fen}`;
  }

  // ─── open controller ───
  function open(currentFen) {
    pieces = {};
    try {
      const fen = new Chess(currentFen).fen();
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
