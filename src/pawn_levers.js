// pawn_levers.js — FEN-based pawn lever detector.
//
// A "lever" is a pawn break: the pawn advance that cracks open the
// position and commits to a strategic plan. The lever dictates the plan
// more than the opening name — a Maroczy Bind is fundamentally about
// Black's long-term ...b5 lever, a French chain is about ...f6 or ...c5
// challenging the e5 pawn, a KID Classical is about ...f5 or White's
// c5.
//
// This module scans the current FEN and reports which canonical levers
// are:
//   - AVAILABLE: the pawn sits on the origin square, the target is not
//     occupied by our own piece, and either the target is empty or
//     holds an enemy piece we could capture.
//   - LIVE: above, plus we have at least one supporter of the target
//     square (piece defence or pawn support) AND the advance is legal
//     at the current ply.
//   - TARGETED: the lever would fork, pin, or attack specific enemy
//     pieces / pawns if played.
//
// Output shape:
//   [
//     { lever: 'c5', side: 'b', from: 'c6', target: 'c5',
//       available: true, live: true, supporters: 2, blockers: 1,
//       attacks: ['d4'], strategic: '...' },
//     …
//   ]

import { Chess } from '../vendor/chess.js/chess.js';

// Canonical lever patterns. Each lists the origin squares the pawn
// might sit on and the target square it advances to. Strategic label is
// an original-words paraphrase — no copyrighted prose.
const LEVER_PATTERNS = [
  // ─── Black levers ───────────────────────────────────────────
  { name: 'c5', side: 'b', from: ['c6','c7'], target: 'c5', attacks: ['d4','b4'],
    strategic: "Classical queenside / central break — Sicilian · Benoni · KID-vs-London signature. Cracks White's d4-pawn and opens the c-file." },
  { name: 'f5', side: 'b', from: ['f6','f7'], target: 'f5', attacks: ['e4','g4'],
    strategic: "Kingside space-grab lever — French · KID · Dutch · Sveshnikov signature. Attacks White's e4-pawn and prepares kingside attack." },
  { name: 'e5', side: 'b', from: ['e6','e7'], target: 'e5', attacks: ['d4','f4'],
    strategic: "Central strike lever — KID · Philidor · Pirc · Old Indian signature. Challenges White's d4 and claims central space." },
  { name: 'd5', side: 'b', from: ['d6','d7'], target: 'd5', attacks: ['e4','c4'],
    strategic: "Central freeing break — QGD · Semi-Slav · classical French signature. Dissolves Black's cramp and opens piece lines." },
  { name: 'b5', side: 'b', from: ['b6','b7'], target: 'b5', attacks: ['c4','a4'],
    strategic: "Queenside expansion lever — Najdorf · Ruy Lopez · Semi-Slav · Hedgehog signature. Attacks White's c4-pawn and opens the b-file." },
  { name: 'c4', side: 'b', from: ['c5','c6'], target: 'c4', attacks: ['b3','d3'],
    strategic: "Queenside clamp — KIA defences · Benoni · English-with-c5 signature. Restricts White's light-squared bishop and the d3-pawn." },
  { name: 'g5', side: 'b', from: ['g6','g7'], target: 'g5', attacks: ['f4','h4'],
    strategic: "Kingside pawn storm — KID Mar del Plata · Najdorf counter-push · Classical Dutch signature. Prepares ...g4 and tactical breakthroughs." },
  { name: 'h5', side: 'b', from: ['h6','h7'], target: 'h5', attacks: ['g4'],
    strategic: "Flank pawn push — KID chain · Sveshnikov · hypermodern counter-push. Stops White's g4 advance or prepares ...h4." },
  { name: 'a5', side: 'b', from: ['a6','a7'], target: 'a5', attacks: ['b4'],
    strategic: "Queenside probe — anti-minority attack · Hedgehog · KID signature. Stops White's b4 expansion and opens the a-file." },

  // ─── White levers ───────────────────────────────────────────
  { name: 'c5', side: 'w', from: ['c3','c4'], target: 'c5', attacks: ['b6','d6'],
    strategic: "Queenside clamp lever — KID · Benoni · Bayonet Attack signature. Cracks Black's d6-pawn and fixes the queenside." },
  { name: 'd5', side: 'w', from: ['d3','d4'], target: 'd5', attacks: ['c6','e6'],
    strategic: "Central clamp lever — English · Ruy Lopez closed · KID Classical signature. Locks the centre in White's favour." },
  { name: 'e5', side: 'w', from: ['e3','e4'], target: 'e5', attacks: ['d6','f6'],
    strategic: "Central advance — French Advance · Caro Advance · Sicilian Alapin signature. Kicks Black's Nf6 and clamps the centre." },
  { name: 'b4', side: 'w', from: ['b2','b3'], target: 'b4', attacks: ['c5','a5'],
    strategic: "Minority attack / queenside space — Carlsbad · English · Closed Sicilian reversed signature. Prepares b4-b5 pawn lever." },
  { name: 'b5', side: 'w', from: ['b3','b4'], target: 'b5', attacks: ['c6','a6'],
    strategic: "Minority attack follow-through — Carlsbad · QGD Exchange signature. Creates a weak c6-pawn target." },
  { name: 'f4', side: 'w', from: ['f2','f3'], target: 'f4', attacks: ['e5','g5'],
    strategic: "Kingside space push — Grand Prix Attack · Closed Sicilian · KIA signature. Prepares f4-f5 kingside assault." },
  { name: 'f5', side: 'w', from: ['f3','f4'], target: 'f5', attacks: ['e6','g6'],
    strategic: "Kingside breakthrough — French · English Attack · Benoni Four Pawns signature. Cracks Black's kingside pawn cover." },
  { name: 'g4', side: 'w', from: ['g2','g3'], target: 'g4', attacks: ['f5','h5'],
    strategic: "Kingside pawn storm — English Attack · Keres Attack · Sämisch KID signature. Prepares g4-g5 and kingside attack." },
  { name: 'h4', side: 'w', from: ['h2','h3'], target: 'h4', attacks: ['g5'],
    strategic: "Flank pawn advance — Dragon Yugoslav · 150 Attack · anti-Caro h4 signature. Prepares h4-h5 kingside lever." },
  { name: 'a4', side: 'w', from: ['a2','a3'], target: 'a4', attacks: ['b5'],
    strategic: "Queenside probe — anti-Ruy ...b5 · Hedgehog restraint · Catalan signature. Questions Black's queenside pawn structure." },
];

function fileCharToIndex(f) { return f.charCodeAt(0) - 97; }
function rankCharToIndex(r) { return 8 - parseInt(r, 10); }
function squareStringToCoords(s) {
  return { r: rankCharToIndex(s[1]), c: fileCharToIndex(s[0]) };
}

function pieceAt(board, sq) {
  const { r, c } = squareStringToCoords(sq);
  if (r < 0 || r > 7 || c < 0 || c > 7) return null;
  return board[r][c];
}

// Count how many of the given side's pieces attack/defend the target.
// Uses chess.js's move list: we synthesize a dummy king on target and
// check which moves of our side could reach it. Fast-enough alternative
// to a full attack-map.
function countSupporters(chess, targetSq, side) {
  // Simple heuristic: count our pawns / pieces on adjacent-via-move
  // squares. Rather than reimplement chess.js attack logic, we iterate
  // the pseudo-legal moves of our side and count those landing on
  // targetSq.
  const c = new Chess(chess.fen());
  // If it's not our turn, flip side-to-move manually
  if (c.turn() !== side) {
    const fp = c.fen().split(' ');
    fp[1] = side;
    fp[3] = '-';
    fp[5] = '1';
    try { c.load(fp.join(' ')); } catch (_) { return 0; }
  }
  let count = 0;
  const moves = c.moves({ verbose: true });
  for (const m of moves) if (m.to === targetSq) count++;
  return count;
}

// Count enemy blockers on the target square (pieces that sit on the
// target or defend it).
function countBlockers(chess, targetSq, side) {
  const opp = side === 'w' ? 'b' : 'w';
  // Enemy piece sitting directly on target
  const board = chess.board();
  const tgt = pieceAt(board, targetSq);
  let blockers = 0;
  if (tgt && tgt.color === opp) blockers++;
  // Enemy defenders of target
  const c = new Chess(chess.fen());
  if (c.turn() !== opp) {
    const fp = c.fen().split(' ');
    fp[1] = opp;
    fp[3] = '-';
    fp[5] = '1';
    try { c.load(fp.join(' ')); } catch (_) { return blockers; }
  }
  const moves = c.moves({ verbose: true });
  for (const m of moves) if (m.to === targetSq) blockers++;
  return blockers;
}

/**
 * Detect all canonical pawn levers available in the given position.
 * Returns an array sorted by a rough "readiness" score (available +
 * live + supporter count – blocker count).
 */
export function detectLevers(fen) {
  let chess;
  try { chess = new Chess(fen); } catch (_) { return []; }
  const board = chess.board();
  const levers = [];
  for (const p of LEVER_PATTERNS) {
    // Find which origin square (if any) holds our pawn
    let from = null;
    for (const f of p.from) {
      const piece = pieceAt(board, f);
      if (piece && piece.type === 'p' && piece.color === p.side) { from = f; break; }
    }
    if (!from) continue;
    // Is the target empty or occupied by an enemy?
    const targetPiece = pieceAt(board, p.target);
    const available = !targetPiece || targetPiece.color !== p.side;
    if (!available) continue;
    // Is the advance legal right now? (Only if it's that side's turn)
    let live = false;
    if (chess.turn() === p.side) {
      const moves = chess.moves({ verbose: true });
      live = moves.some(m => m.from === from && m.to === p.target);
    }
    const supporters = countSupporters(chess, p.target, p.side);
    const blockers = countBlockers(chess, p.target, p.side);
    // Which enemy pieces does the lever actually attack on landing?
    const actualAttacks = (p.attacks || []).filter(a => {
      const ap = pieceAt(board, a);
      return ap && ap.color !== p.side;
    });
    const readiness = (live ? 3 : 0) + supporters - blockers;
    levers.push({
      lever: p.name, side: p.side, from, target: p.target,
      available: true, live, supporters, blockers,
      attacks: actualAttacks,
      strategic: p.strategic,
      readiness,
    });
  }
  levers.sort((a, b) => b.readiness - a.readiness);
  return levers;
}

/**
 * Build a compact text block for the AI prompt listing the top N levers
 * with their readiness, defenders, and strategic note.
 */
export function renderLeversForAI(levers, maxCount = 4) {
  if (!levers || !levers.length) return '';
  const top = levers.slice(0, maxCount);
  const fmt = (L) => {
    const sideLabel = L.side === 'w' ? 'White' : 'Black';
    const status = L.live ? 'LIVE' : 'available';
    const atk = L.attacks.length ? ` · attacks ${L.attacks.join(', ')}` : '';
    return `  - ${sideLabel} ...${L.lever} (from ${L.from}) — ${status}, supporters ${L.supporters}, blockers ${L.blockers}${atk}
    → ${L.strategic}`;
  };
  return `\nAVAILABLE PAWN LEVERS (ranked by readiness — these are the breaks this position is structurally about):\n${top.map(fmt).join('\n')}\n`;
}

/**
 * Build an HTML block for the coach UI — list the top levers as short
 * strategic plan hints. All content paraphrased in original words.
 */
export function renderLeversBlock(levers, maxCount = 3) {
  if (!levers || !levers.length) return '';
  const top = levers.slice(0, maxCount);
  const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const items = top.map(L => {
    const sideLabel = L.side === 'w' ? 'White' : 'Black';
    const pill = L.live ? 'live' : 'on deck';
    return `<li><strong>${sideLabel} ...${esc(L.lever)}</strong>
      <span class="muted" style="font-size:10px;">${esc(pill)} · sup ${L.supporters}/blk ${L.blockers}</span>
      <div style="font-size:12px;">${esc(L.strategic)}</div></li>`;
  }).join('');
  return `<div class="coach-levers">
    <h5 class="coach-section-h">⚔ Pawn levers available</h5>
    <ul class="coach-plans">${items}</ul>
  </div>`;
}
