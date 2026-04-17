// coach.js — canonical GM-coaching questions answered from board geometry
// + engine queries. No LLM required; produces structured data the UI can
// render, and the `ai-coach.js` layer can optionally send to Claude for
// prose.
//
// Questions addressed (adapted from Aagaard, Silman, Dvoretsky, Rowson):
//   1. What is my opponent threatening?                → threats()
//   2. Where are my weaknesses?                         → weaknesses()
//   3. What is my worst-placed piece?                   → worstPiece()
//   4. What is my best-placed piece?                    → bestPiece()
//   5. What's the pawn structure telling us?            → pawnStructureStory()
//   6. Who has the initiative / who is attacking?       → initiative()
//   7. Candidate plans (concrete ideas + verbal goal)   → plans()

import { Chess } from '../vendor/chess.js/chess.js';

const PIECE_NAME = { p:'pawn', n:'knight', b:'bishop', r:'rook', q:'queen', k:'king' };
const PIECE_VALUE = { p:1, n:3, b:3.25, r:5, q:9, k:0 };

// ──────────────────────────────────────────────────────────────────
//  Top-level: produce a full "coach report" for a position.
// `engineTop` is an optional {score, scoreKind, pv} from the engine.
// `opponentThreatMove` is optional: the engine's best move for the side
// NOT to move (i.e., what they'd play if they had the move). That's the
// sharpest "threat" signal we can get.
// ──────────────────────────────────────────────────────────────────
export function coachReport(fen, { engineTop = null, opponentThreatMove = null } = {}) {
  const chess = new Chess(fen);
  const board = chess.board();
  const stm   = chess.turn();   // whose turn it IS
  const opp   = stm === 'w' ? 'b' : 'w';

  return {
    side: stm,
    opponent: opp,
    sideName: stm === 'w' ? 'White' : 'Black',
    oppName:  opp === 'w' ? 'White' : 'Black',
    threats:        threats(chess, board, stm, opp, opponentThreatMove),
    weaknesses:     weaknesses(chess, board, stm),
    worstPiece:     worstPiece(chess, board, stm),
    bestPiece:      bestPiece(chess, board, stm),
    structureStory: pawnStructureStory(board, stm),
    initiative:     initiative(chess, board, stm, engineTop),
    plans:          plans(chess, board, stm, engineTop),
  };
}

// ══════════════════════════════════════════════════════════════════
//  1. What is opponent threatening?
// ══════════════════════════════════════════════════════════════════
// Two signals:
//   (a) Static: hanging pieces of ours + squares the opponent double-attacks
//   (b) Dynamic: if available, the opponent's "best move if they had a free tempo"
function threats(chess, board, stm, opp, opponentThreatMove) {
  const findings = [];

  // (a) Static: are any of our pieces insufficiently defended?
  const fen = chess.fen();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.color !== stm || s.type === 'k') continue;
    const sq = coord(f, 7 - r);
    const atk = countAttackers(fen, sq, opp);
    const def = countAttackers(fen, sq, stm);
    if (atk > def) {
      findings.push({
        kind: 'hanging',
        square: sq,
        text: `Your <strong>${PIECE_NAME[s.type]} on ${sq}</strong> is under-defended (${atk} attackers vs ${def} defenders).`,
      });
    }
  }

  // (b) Dynamic: what if opponent had a free tempo?
  if (opponentThreatMove && opponentThreatMove.length >= 4) {
    try {
      const ghostFen = flipStm(fen, opp);
      const ghost = new Chess(ghostFen);
      const mv = ghost.move({
        from: opponentThreatMove.slice(0,2),
        to: opponentThreatMove.slice(2,4),
        promotion: opponentThreatMove.length > 4 ? opponentThreatMove[4] : undefined,
      });
      if (mv) {
        findings.push({
          kind: 'tempo-threat',
          text: `If opponent had a free move, they would play <strong>${mv.san}</strong> — take this seriously when considering your move.`,
        });
      }
    } catch (_e) { /* FEN flip failed (king in check etc.); skip */ }
  }

  // (c) Check if our king is exposed
  if (chess.inCheck()) {
    findings.push({ kind: 'check', text: 'You are in <strong>check</strong> — this is the immediate and only concern.' });
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════
//  2. Where are MY weaknesses?
// ══════════════════════════════════════════════════════════════════
function weaknesses(chess, board, stm) {
  const findings = [];
  const fen = chess.fen();
  const opp = stm === 'w' ? 'b' : 'w';

  // Isolated pawns (own)
  const isol = findIsolatedPawns(board, stm);
  if (isol.length) findings.push({
    kind: 'isolated',
    text: `Isolated pawn${isol.length>1?'s':''} on <strong>${isol.join(', ')}</strong> — no friendly pawns on adjacent files to support them.`,
  });

  // Doubled pawns
  const dbl = findDoubledPawns(board, stm);
  if (dbl.length) findings.push({
    kind: 'doubled',
    text: `Doubled pawns on the ${dbl.map(d => d.file).join(', ')}-file — reduced pawn mobility and potential weakness.`,
  });

  // Backward pawns
  const back = findBackwardPawns(board, stm);
  if (back.length) findings.push({
    kind: 'backward',
    text: `Backward pawn${back.length>1?'s':''} on <strong>${back.join(', ')}</strong> — can't advance safely and the square in front is a hole.`,
  });

  // Holes / weak squares near our king
  const holes = findHolesNearKing(board, stm);
  if (holes.length) findings.push({
    kind: 'king-holes',
    text: `Weak squares around your king: <strong>${holes.join(', ')}</strong> — enemy pieces (especially knights) can land here without being kicked.`,
  });

  // King exposure
  const kingExposure = kingSafetyCheck(chess, board, stm);
  if (kingExposure) findings.push(kingExposure);

  // Bad bishop — own color-blocked pawns
  const bishops = findBadBishops(board, stm);
  for (const b of bishops) findings.push({
    kind: 'bad-bishop',
    text: `${b.sq}: bad bishop (${b.pawnsOnColor}/${b.totalPawns} of your pawns are on ${b.color} squares — this bishop is blocked by your own structure).`,
  });

  // Loose (undefended, non-king) pieces
  const loose = findLoosePieces(fen, board, stm, opp);
  if (loose.length) findings.push({
    kind: 'loose',
    text: `Loose (undefended) pieces: <strong>${loose.join(', ')}</strong> — Nunn's LPDO: "Loose pieces drop off." Watch for tactics.`,
  });

  return findings;
}

// ══════════════════════════════════════════════════════════════════
//  3. What is MY worst-placed piece?
// ══════════════════════════════════════════════════════════════════
// Heuristic: piece with low mobility AND no active role (not defending
// something critical, not attacking anything). Standard Silman question:
// "what's my worst piece — improving it might be the plan."
function worstPiece(chess, board, stm) {
  const fen = chess.fen();
  const opp = stm === 'w' ? 'b' : 'w';
  const ghostFen = flipStm(fen, stm);
  const ghost = (() => { try { return new Chess(ghostFen); } catch { return null; } })();
  if (!ghost) return null;

  let worst = null;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.color !== stm) continue;
    if (s.type === 'p' || s.type === 'k') continue;   // skip pawns + king
    const sq = coord(f, 7 - r);
    let moves;
    try { moves = ghost.moves({ square: sq, verbose: true }); }
    catch { continue; }
    const mobility = moves.length;
    // Score: fewer legal moves = worse. Also penalize pieces on back rank
    // and pieces that are attacked but undefended.
    let score = mobility;
    if (s.type === 'n' && mobility <= 2) score -= 3;         // cornered knight
    if (s.type === 'b' && mobility <= 2) score -= 3;         // bad bishop
    if (s.type === 'r' && !onOpenFile(board, f, stm)) score -= 2;
    // Undefended + attacked = urgent worst
    const atk = countAttackers(fen, sq, opp);
    const def = countAttackers(fen, sq, stm);
    if (atk > def) score -= 10;
    if (!worst || score < worst.score) {
      worst = { square: sq, piece: s.type, mobility, score };
    }
  }
  if (!worst) return null;
  return {
    square: worst.square,
    piece: worst.piece,
    mobility: worst.mobility,
    text: `Your <strong>${PIECE_NAME[worst.piece]} on ${worst.square}</strong> is likely your worst-placed piece — only ${worst.mobility} legal moves and little activity. Silman's rule: "find your worst piece and improve it."`,
  };
}

// ══════════════════════════════════════════════════════════════════
//  4. What is MY best-placed piece?
// ══════════════════════════════════════════════════════════════════
function bestPiece(chess, board, stm) {
  const fen = chess.fen();
  const ghostFen = flipStm(fen, stm);
  const ghost = (() => { try { return new Chess(ghostFen); } catch { return null; } })();
  if (!ghost) return null;

  let best = null;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.color !== stm) continue;
    if (s.type === 'p' || s.type === 'k') continue;
    const sq = coord(f, 7 - r);
    let moves;
    try { moves = ghost.moves({ square: sq, verbose: true }); }
    catch { continue; }
    let score = moves.length;
    // Bonus for outpost knight
    if (s.type === 'n' && isOutpost(board, f, 7 - r, stm)) score += 5;
    // Bonus for rook on open file
    if (s.type === 'r' && onOpenFile(board, f, stm)) score += 4;
    // Bonus for piece with captures available
    const captures = moves.filter(m => m.flags.includes('c')).length;
    score += captures * 2;
    if (!best || score > best.score) {
      best = { square: sq, piece: s.type, mobility: moves.length, score };
    }
  }
  if (!best) return null;
  return {
    square: best.square,
    piece: best.piece,
    mobility: best.mobility,
    text: `Your <strong>${PIECE_NAME[best.piece]} on ${best.square}</strong> is your most active piece (${best.mobility} moves). Keep it; exchanging an active piece is usually wrong.`,
  };
}

// ══════════════════════════════════════════════════════════════════
//  5. Pawn-structure story
// ══════════════════════════════════════════════════════════════════
function pawnStructureStory(board, stm) {
  // Count pawns per side + islands
  let pW = 0, pB = 0;
  const filesW = new Set(), filesB = new Set();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.type !== 'p') continue;
    if (s.color === 'w') { pW++; filesW.add(f); } else { pB++; filesB.add(f); }
  }
  const total = pW + pB;
  let closedness;
  if (total >= 14) closedness = 'closed';
  else if (total >= 10) closedness = 'semi-open';
  else closedness = 'open';

  const lines = [];
  lines.push(`Pawn count: White ${pW}, Black ${pB}. Structure is <strong>${closedness}</strong>.`);
  if (closedness === 'open') {
    lines.push('Open positions favor <strong>bishops, rooks, and queen</strong>. Knights are worse here. The side with the bishop pair typically has the edge.');
  } else if (closedness === 'closed') {
    lines.push('Closed positions favor <strong>knights</strong> over bishops. The bishop pair loses much of its value. Look for pawn breaks (c4/c5, f4/f5) to open files.');
  } else {
    lines.push('Semi-open — the position hasn\'t committed. Whichever side opens files first usually benefits, if their pieces are ready.');
  }
  return lines;
}

// ══════════════════════════════════════════════════════════════════
//  6. Initiative / attacker-vs-defender
// ══════════════════════════════════════════════════════════════════
function initiative(chess, board, stm, engineTop) {
  if (engineTop && engineTop.scoreKind === 'cp') {
    // Tie to eval (from side-to-move POV)
    const s = engineTop.score;
    if (s > 150) return {
      text: `<strong>You have the initiative.</strong> Engine shows +${(s/100).toFixed(2)} for you — keep pressing with active moves, avoid trades that relieve pressure.`,
    };
    if (s < -150) return {
      text: `<strong>You are on the defensive.</strong> Engine shows ${(s/100).toFixed(2)} — consolidate, trade pieces if possible, look for counter-play.`,
    };
    return { text: `Position is roughly balanced (${(s/100).toFixed(2)}). Both sides have resources — it depends on who finds the better plan.` };
  }
  return { text: '(Initiative assessment needs the engine\'s evaluation — it will appear once the engine is running.)' };
}

// ══════════════════════════════════════════════════════════════════
//  7. Candidate plans
// ══════════════════════════════════════════════════════════════════
function plans(chess, board, stm, engineTop) {
  const plansList = [];
  // Concrete from engine
  if (engineTop && engineTop.pv && engineTop.pv.length) {
    const chess2 = new Chess(chess.fen());
    const firstUci = engineTop.pv[0];
    let firstSan = null;
    try {
      const mv = chess2.move({ from: firstUci.slice(0,2), to: firstUci.slice(2,4), promotion: firstUci.length>4?firstUci[4]:undefined });
      if (mv) firstSan = mv.san;
    } catch {}
    if (firstSan) plansList.push({
      kind: 'engine-move',
      text: `Engine's top move: <strong>${firstSan}</strong>. Ask: why is this move good? What idea does it serve?`,
    });
  }

  // Structural plans
  const story = pawnStructureStoryCompact(board);
  if (story.passedOurs.length) plansList.push({
    kind: 'passer',
    text: `Push your passed pawn on <strong>${story.passedOurs.join(', ')}</strong>. A passed pawn's lust to expand must be satisfied (Nimzowitsch).`,
  });
  if (story.openFiles.length) plansList.push({
    kind: 'open-file',
    text: `Open file(s) on <strong>${story.openFiles.join(', ')}</strong>: rooks want to be here.`,
  });

  // Piece improvement (from worstPiece)
  const worst = worstPiece(chess, board, stm);
  if (worst) plansList.push({
    kind: 'improve-piece',
    text: `Plan: improve the ${PIECE_NAME[worst.piece]} on ${worst.square}. Where would it be more useful?`,
  });

  return plansList;
}

// ══════════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════════

function coord(f, rFromBottom) {
  return String.fromCharCode(97 + f) + (rFromBottom + 1);
}

function flipStm(fen, forceColor) {
  const p = fen.split(' ');
  p[1] = forceColor;
  p[3] = '-';
  return p.join(' ');
}

function countAttackers(fen, square, color) {
  try {
    const g = new Chess(flipStm(fen, color));
    const moves = g.moves({ verbose: true });
    return moves.filter(m => m.to === square).length;
  } catch { return 0; }
}

function onOpenFile(board, f, color) {
  for (let r = 0; r < 8; r++) {
    const s = board[r][f];
    if (s && s.type === 'p') return false;
  }
  return true;
}

function findIsolatedPawns(board, color) {
  const byFile = Array(8).fill(0).map(() => []);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (s && s.type === 'p' && s.color === color) byFile[f].push(7 - r + 1);
  }
  const out = [];
  for (let f = 0; f < 8; f++) {
    if (!byFile[f].length) continue;
    const hasNeighbor = (f>0 && byFile[f-1].length) || (f<7 && byFile[f+1].length);
    if (!hasNeighbor) byFile[f].forEach(r => out.push(coord(f, r-1)));
  }
  return out;
}

function findDoubledPawns(board, color) {
  const byFile = Array(8).fill(0);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (s && s.type === 'p' && s.color === color) byFile[f]++;
  }
  const out = [];
  for (let f = 0; f < 8; f++) if (byFile[f] >= 2) out.push({ file: String.fromCharCode(97+f), count: byFile[f] });
  return out;
}

function findBackwardPawns(board, color) {
  // Simplified: pawn that can't be defended by a friendly pawn on adjacent
  // file, AND the square in front is controlled by an enemy pawn
  const enemy = color === 'w' ? 'b' : 'w';
  const fwd = color === 'w' ? 1 : -1;
  const out = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.type !== 'p' || s.color !== color) continue;
    const rank = 7 - r + 1;
    // Can a friendly pawn defend us from behind? Adjacent file, same or
    // behind rank (in the color's direction).
    let defended = false;
    for (const df of [-1, 1]) {
      const nf = f + df;
      if (nf < 0 || nf > 7) continue;
      for (let rr = 0; rr < 8; rr++) {
        const p = board[rr]?.[nf];
        if (!p || p.type !== 'p' || p.color !== color) continue;
        const prank = 7 - rr + 1;
        if (color === 'w' ? prank <= rank : prank >= rank) defended = true;
      }
    }
    if (defended) continue;
    // Is the square in front controlled by enemy pawns?
    const fwdRank = rank + fwd;
    if (fwdRank < 1 || fwdRank > 8) continue;
    let frontControl = false;
    for (const df of [-1, 1]) {
      const nf = f + df;
      if (nf < 0 || nf > 7) continue;
      const attackerRankInOurNumbering = color === 'w' ? fwdRank + 1 : fwdRank - 1;
      const rIdx = 8 - attackerRankInOurNumbering;
      const p = board[rIdx]?.[nf];
      if (p && p.type === 'p' && p.color === enemy) frontControl = true;
    }
    if (frontControl) out.push(coord(f, rank - 1));
  }
  return out;
}

function findHolesNearKing(board, color) {
  // Find our king
  let kf=-1, kr=-1;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (s && s.type === 'k' && s.color === color) { kf = f; kr = 7 - r; }
  }
  if (kf < 0) return [];
  const out = [];
  // Look at squares within 2 of king that no friendly pawn can defend
  for (let df = -2; df <= 2; df++) for (let dr = -2; dr <= 2; dr++) {
    const f = kf + df, r = kr + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    if (df === 0 && dr === 0) continue;
    // Can a friendly pawn defend this square? (pawns attack diagonally
    // forward one square; so defenders come from the pawn side — for white
    // that's one rank below + one file beside)
    const pawnRank = color === 'w' ? r - 1 : r + 1;
    if (pawnRank < 0 || pawnRank > 7) continue;
    let defendable = false;
    for (const dff of [-1, 1]) {
      const pf = f + dff;
      if (pf < 0 || pf > 7) continue;
      // Could our pawn eventually reach this square geometrically?
      // Simplified: is there ANY pawn behind on that file, same color?
      for (let rr = 0; rr < 8; rr++) {
        const s = board[rr]?.[pf];
        if (!s || s.type !== 'p' || s.color !== color) continue;
        const pr = 7 - rr;
        // Pawn on file pf can attack (pf+1, pr+1) or (pf-1, pr+1) for white
        // After advancing and capturing, covers several squares. Simplest:
        // if a pawn exists on adjacent file, we can potentially defend.
        defendable = true;
      }
    }
    if (!defendable && isInEnemyCamp(r, color)) {
      out.push(coord(f, r));
    }
  }
  return out.slice(0, 3); // don't overwhelm
}

function isInEnemyCamp(rankIdxFromBottom, color) {
  return color === 'w' ? rankIdxFromBottom >= 3 : rankIdxFromBottom <= 4;
}

function findBadBishops(board, color) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.type !== 'b' || s.color !== color) continue;
    const sqColor = (f + (7-r)) % 2 === 0 ? 'dark' : 'light';
    // Count friendly pawns on same color squares
    let sameColor = 0, total = 0;
    for (let rr = 0; rr < 8; rr++) for (let ff = 0; ff < 8; ff++) {
      const p = board[rr][ff];
      if (!p || p.type !== 'p' || p.color !== color) continue;
      total++;
      const pColor = (ff + (7-rr)) % 2 === 0 ? 'dark' : 'light';
      if (pColor === sqColor) sameColor++;
    }
    if (total >= 4 && sameColor / total >= 0.66) {
      out.push({
        sq: coord(f, 7 - r),
        color: sqColor,
        pawnsOnColor: sameColor,
        totalPawns: total,
      });
    }
  }
  return out;
}

function findLoosePieces(fen, board, stm, opp) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (!s || s.color !== stm || s.type === 'k' || s.type === 'p') continue;
    const sq = coord(f, 7 - r);
    const def = countAttackers(fen, sq, stm);
    if (def === 0) out.push(`${PIECE_NAME[s.type]} ${sq}`);
  }
  return out;
}

function isOutpost(board, f, rFromBottom, color) {
  const enemy = color === 'w' ? 'b' : 'w';
  // Square is an outpost if no enemy pawn can ever attack it AND it's in
  // enemy territory for us
  if (color === 'w' && rFromBottom < 3) return false;
  if (color === 'b' && rFromBottom > 4) return false;
  // Can an enemy pawn attack this square?
  for (const df of [-1, 1]) {
    const nf = f + df;
    if (nf < 0 || nf > 7) continue;
    for (let rr = 0; rr < 8; rr++) {
      const s = board[rr]?.[nf];
      if (!s || s.type !== 'p' || s.color !== enemy) continue;
      const pr = 7 - rr;
      // Enemy pawn at nf, rank pr can reach attacking squares if it can
      // advance toward our piece.
      if (color === 'w' && pr > rFromBottom) return false;
      if (color === 'b' && pr < rFromBottom) return false;
    }
  }
  return true;
}

function kingSafetyCheck(chess, board, stm) {
  let kf=-1, kr=-1;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (s && s.type === 'k' && s.color === stm) { kf = f; kr = 7 - r; }
  }
  if (kf < 0) return null;
  const homeRank = stm === 'w' ? 0 : 7;
  // Count pawn-shield pieces on 3 files in front of king
  const dir = stm === 'w' ? 1 : -1;
  let shield = 0;
  for (let df = -1; df <= 1; df++) {
    const f = kf + df;
    if (f < 0 || f > 7) continue;
    for (const dr of [1, 2]) {
      const targetRankIdxFromBottom = kr + dir * dr;
      const rIdx = 8 - (targetRankIdxFromBottom + 1);
      const p = board[rIdx]?.[f];
      if (p && p.type === 'p' && p.color === stm) { shield++; break; }
    }
  }
  if (kr === homeRank && shield < 2) {
    return {
      kind: 'king-exposed',
      text: `King is uncastled/exposed with only ${shield} pawn-shield stones. Castling or reinforcing the king's cover should be a priority.`,
    };
  }
  if (shield < 2) {
    return {
      kind: 'king-exposed',
      text: `King has thin pawn cover (${shield} shield pawns). Avoid opening lines near your king.`,
    };
  }
  return null;
}

function pawnStructureStoryCompact(board) {
  const passedOurs = [];
  const openFiles = [];
  const byFile = { w: Array(8).fill(0).map(() => []), b: Array(8).fill(0).map(() => []) };
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = board[r][f];
    if (s && s.type === 'p') byFile[s.color][f].push(7 - r + 1);
  }
  for (let f = 0; f < 8; f++) {
    if (!byFile.w[f].length && !byFile.b[f].length) openFiles.push(String.fromCharCode(97+f));
  }
  return { passedOurs, openFiles };
}
