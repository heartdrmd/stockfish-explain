// promotion.js — custom promotion picker (chessground doesn't ship one).
// Vertical piece column along the promotion file, from the promoting
// side's perspective, with circular bubbles and an orange hover glow
// in the lichess style.

export function showPromotion(overlayEl, destKey, color, orientation) {
  return new Promise((resolve) => {
    const file = destKey[0];          // 'a'..'h'
    const rank = destKey[1];          // '1' or '8'
    const fileIdx = file.charCodeAt(0) - 'a'.charCodeAt(0);   // 0..7

    // Board file column position as % from left, respecting orientation
    const colPct = orientation === 'white' ? fileIdx * 12.5 : (7 - fileIdx) * 12.5;

    // Row progression from the promotion edge inward.
    // For a white promotion (rank 8), the bubble goes: Q at top, R, B, N
    // For a black promotion (rank 1), Q at bottom, R, B, N
    const pieces = ['queen', 'rook', 'bishop', 'knight'];
    const promotingOnTop =
      (color === 'white' && orientation === 'white') ||
      (color === 'black' && orientation === 'black');

    overlayEl.innerHTML = '';
    overlayEl.hidden = false;

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const rowPct = promotingOnTop ? i * 12.5 : (7 - i) * 12.5;

      const btn = document.createElement('div');
      btn.className = 'promotion-piece';
      btn.dataset.piece = piece;
      btn.style.left = `${colPct}%`;
      btn.style.top  = `${rowPct}%`;
      // Piece SVG
      const code = piece === 'knight' ? 'N'
                 : piece === 'queen'  ? 'Q'
                 : piece === 'rook'   ? 'R'
                 : 'B';
      const c = color === 'white' ? 'w' : 'b';
      btn.style.backgroundImage = `url('assets/pieces/cburnett/${c}${code}.svg')`;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        close(piece);
      });
      overlayEl.appendChild(btn);
    }

    // Cancel on right-click or overlay background click → auto-queen
    const cancel = (e) => {
      e.preventDefault();
      close('queen');
    };
    overlayEl.addEventListener('click', cancel, { once: true });
    overlayEl.addEventListener('contextmenu', cancel, { once: true });

    function close(choice) {
      overlayEl.hidden = true;
      overlayEl.innerHTML = '';
      resolve(choice);
    }
  });
}
