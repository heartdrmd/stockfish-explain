// coach_v2.js — proprietary positional coach.
//
// Synthesizes public chess-theory concepts into a single static analyzer
// that produces a coaching report from a FEN. Rules are drawn from:
//
//   • Dorfman's Method — lexicographic static factors, critical moments,
//     phantom-queens eval, independence-of-plan.
//   • Silman's Seven Imbalances — minor pieces, structure, space,
//     material, weak squares/files, development, initiative.
//   • Nimzowitsch — overprotection, blockade, rook on 7th, restraint.
//   • Capablanca — rule of the square, king centralization, simplify.
//   • Shereshevsky — plan-for-the-endgame-from-move-20, two weaknesses.
//   • Dvoretsky — prophylactic thinking, schematic thinking.
//   • Aagaard — three questions: weaknesses / worst piece / opponent plan.
//   • Watson — rule-independence (penalty cancellations in context).
//   • AlphaZero observations — activity ≫ material, optionality.
//
// Concepts are codified as rules; no copyrighted text is used. All
// scores are in centipawns-ish units for readability, NOT a real eval.

import { Chess } from '../vendor/chess.js/chess.js';

// ─── constants ──────────────────────────────────────────────────────
const PIECE_CP = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const FILES = 'abcdefgh';
const CENTRE = new Set(['d4', 'd5', 'e4', 'e5']);

// ─── public API ─────────────────────────────────────────────────────

/**
 * Main entry point. Given a FEN, return a full coaching report.
 */
export function coachReport(fen) {
  const chess = new Chess(fen);
  const board = chess.board();
  const stm = chess.turn();                  // 'w' or 'b'

  // Extract every feature we need, per side.
  const features = extractFeatures(chess, board);

  // Score each Silman-style factor, with Dorfman lexicographic priority.
  const factors = scoreFactors(features);

  // Plan phase
  const phase = gamePhase(features);

  // Critical-moment detector (Dorfman)
  const critical = detectCritical(chess, board);

  // Prophylaxis — what's the opponent's best idea? (shallow null-move)
  const prophylaxis = detectProphylaxis(chess);

  // Silman's "worst piece" + reroute (Aagaard question 2)
  const worstW = detectWorstPiece(chess, board, 'w', features);
  const worstB = detectWorstPiece(chess, board, 'b', features);

  // Lexicographic verdict (Dorfman)
  const verdict = lexicographicVerdict(factors);

  // Plans — concrete bullet points per side based on active imbalances
  const plansW = generatePlans(features, factors, phase, 'w');
  const plansB = generatePlans(features, factors, phase, 'b');

  // Watson rule-independence — context-based penalty cancellations
  const contextNotes = watsonContextNotes(features);

  // Mode suggestion (Dorfman rule 9)
  const modeW = recommendedMode(verdict, phase, 'w');
  const modeB = recommendedMode(verdict, phase, 'b');

  return {
    sideToMove:  stm === 'w' ? 'White' : 'Black',
    phase,
    verdict,
    factors,
    features,
    critical,
    prophylaxis,
    worstPiece: { white: worstW, black: worstB },
    plans:      { white: plansW, black: plansB },
    contextNotes,
    mode:       { white: modeW, black: modeB },
  };
}

// ─── feature extraction ─────────────────────────────────────────────

function extractFeatures(chess, board) {
  const f = {
    material:     { w: 0, b: 0, diff: 0 },
    piece:        { w: pieceCountInit(), b: pieceCountInit() },
    bishopColours:{ w: { light: 0, dark: 0 }, b: { light: 0, dark: 0 } },
    mobility:     { w: 0, b: 0, perPiece: [] },
    pawns:        { w: pawnStats(board, 'w'), b: pawnStats(board, 'b') },
    space:        { w: 0, b: 0 },
    kingSquare:   { w: null, b: null },
    kingSafety:   { w: null, b: null },
    openFiles:    [],
    halfOpenFiles:{ w: [], b: [] },
    rooksOnFile:  { w: { open: 0, half: 0, seventh: 0 }, b: { open: 0, half: 0, seventh: 0 } },
    outposts:     { w: [], b: [] },
    holes:        { w: [], b: [] },
    bishopsBad:   { w: false, b: false },
    hasBishopPair:{ w: false, b: false },
    openness:     null,
    totalNonPawnMaterial: 0,
  };

  // One pass over the board collecting material + piece counts + king sq
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c]; if (!p) continue;
    const side = p.color;
    f.material[side]    += PIECE_CP[p.type];
    f.piece[side][p.type]++;
    if (p.type === 'b') {
      const colour = ((r + c) % 2 === 0) ? 'dark' : 'light';
      f.bishopColours[side][colour]++;
    }
    if (p.type === 'k') {
      f.kingSquare[side] = { r, c, sq: FILES[c] + (8 - r) };
    }
    if (p.type !== 'p' && p.type !== 'k') {
      f.totalNonPawnMaterial += PIECE_CP[p.type];
    }
  }
  f.material.diff = f.material.w - f.material.b;
  f.hasBishopPair.w = f.piece.w.b >= 2;
  f.hasBishopPair.b = f.piece.b.b >= 2;

  // Openness heuristic: locked pawn pairs (own pawn directly in front of
  // enemy pawn on same file). Fewer locked pairs = more open.
  let locked = 0;
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 7; r++) {
      const a = board[r][c], b = board[r+1][c];
      if (a && b && a.type === 'p' && b.type === 'p' && a.color !== b.color) locked++;
    }
  }
  f.openness = locked <= 1 ? 'open' : locked <= 3 ? 'semi-open' : 'closed';

  // Open / half-open files
  for (let c = 0; c < 8; c++) {
    let wP = false, bP = false;
    for (let r = 0; r < 8; r++) {
      const p = board[r][c];
      if (p && p.type === 'p') {
        if (p.color === 'w') wP = true; else bP = true;
      }
    }
    if (!wP && !bP) f.openFiles.push(FILES[c]);
    else if (!wP)   f.halfOpenFiles.w.push(FILES[c]);
    else if (!bP)   f.halfOpenFiles.b.push(FILES[c]);
  }

  // Rooks on open / half-open / 7th
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p.type !== 'r') continue;
    const side = p.color;
    const file = FILES[c];
    if (f.openFiles.includes(file))             f.rooksOnFile[side].open++;
    else if (f.halfOpenFiles[side].includes(file)) f.rooksOnFile[side].half++;
    const seventhRow = side === 'w' ? 1 : 6;   // r-index of own 7th rank
    if (r === seventhRow)                        f.rooksOnFile[side].seventh++;
  }

  // Holes / outposts (squares in opp half, defended by own pawn, not
  // attackable by enemy pawn)
  for (const side of ['w', 'b']) {
    const enemy = side === 'w' ? 'b' : 'w';
    // Opp half for white = ranks 4..7 (r-index 0..3); for black = 0..3 (r-index 4..7)
    const range = side === 'w' ? [0, 4] : [4, 8];
    for (let r = range[0]; r < range[1]; r++) for (let c = 0; c < 8; c++) {
      if (!squareIsHole(board, r, c, side)) continue;
      f.holes[side].push(FILES[c] + (8 - r));
      // outpost = hole + defended by own pawn + not occupied by enemy piece
      if (isDefendedByPawn(board, r, c, side)
          && !(board[r][c] && board[r][c].color === enemy)) {
        f.outposts[side].push(FILES[c] + (8 - r));
      }
    }
  }

  // Bad bishop: own bishop on a colour where > 55% of own pawns sit
  for (const side of ['w', 'b']) {
    const total = f.pawns[side].files.reduce((a, b) => a + b, 0);
    if (!total) continue;
    const pawnsByColour = pawnsOnColour(board, side);
    const bishop = pieceLocations(board, side, 'b')[0];
    if (bishop) {
      const bSq = bishop;
      const bColour = ((bSq.r + bSq.c) % 2 === 0) ? 'dark' : 'light';
      if (pawnsByColour[bColour] / total > 0.55) f.bishopsBad[side] = true;
    }
  }

  // Space = sum of (pawn advancement rank − 1) per own pawn
  for (const side of ['w', 'b']) {
    for (let c = 0; c < 8; c++) for (let r = 0; r < 8; r++) {
      const p = board[r][c];
      if (p && p.type === 'p' && p.color === side) {
        const rank = side === 'w' ? (8 - r) : (r + 1);
        f.space[side] += Math.max(0, rank - 2);
      }
    }
  }

  // King safety — shield holes + attackers-vs-defenders in 3x3 around king
  for (const side of ['w', 'b']) {
    const k = f.kingSquare[side]; if (!k) continue;
    const shieldDir = side === 'w' ? 1 : -1;      // toward own side from r-index POV
    let shieldHoles = 0;
    for (const dc of [-1, 0, 1]) {
      const nc = k.c + dc, nr = k.r + shieldDir;
      if (nc < 0 || nc > 7 || nr < 0 || nr > 7) continue;
      const p = board[nr][nc];
      if (!p || p.type !== 'p' || p.color !== side) shieldHoles++;
    }
    // zone attackers / defenders
    let attackers = 0, defenders = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = k.r + dr, nc = k.c + dc;
      if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
      const sq = FILES[nc] + (8 - nr);
      attackers += countAttackers(chess, sq, side === 'w' ? 'b' : 'w');
      defenders += countAttackers(chess, sq, side);
    }
    // Open file on king
    const kingFile = FILES[k.c];
    const fileOpen = f.openFiles.includes(kingFile) || f.halfOpenFiles[side === 'w' ? 'b' : 'w'].includes(kingFile);
    // Castled?
    const castled = (side === 'w' && k.r === 7 && (k.c <= 2 || k.c >= 6))
                 || (side === 'b' && k.r === 0 && (k.c <= 2 || k.c >= 6));
    f.kingSafety[side] = { shieldHoles, attackers, defenders, fileOpen, castled };
  }

  // Mobility per piece (approximate — counted via chess.moves per side)
  for (const side of ['w', 'b']) {
    const otherTurn = chess.turn() !== side;
    let legalForSide;
    if (otherTurn) {
      // temporarily pretend it's this side's move
      const fp = chess.fen().split(' ');
      fp[1] = side;
      fp[3] = '-';
      try { legalForSide = new Chess(fp.join(' ')).moves({ verbose: true }); }
      catch { legalForSide = []; }
    } else {
      legalForSide = chess.moves({ verbose: true });
    }
    f.mobility[side] = legalForSide.length;
  }

  return f;
}

function pieceCountInit() { return { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }; }

function pieceLocations(board, side, type) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (p && p.color === side && p.type === type) out.push({ r, c });
  }
  return out;
}

function pawnsOnColour(board, side) {
  let light = 0, dark = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p.type !== 'p' || p.color !== side) continue;
    if ((r + c) % 2 === 0) dark++; else light++;
  }
  return { light, dark };
}

function pawnStats(board, side) {
  const files = [0,0,0,0,0,0,0,0];
  const pawnsByFile = [[],[],[],[],[],[],[],[]];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (p && p.type === 'p' && p.color === side) {
      files[c]++;
      pawnsByFile[c].push(r);
    }
  }
  const doubled = files.reduce((s, v) => s + Math.max(0, v - 1), 0);

  let isolated = 0;
  for (let c = 0; c < 8; c++) if (files[c] > 0) {
    const left  = c === 0 || files[c-1] === 0;
    const right = c === 7 || files[c+1] === 0;
    if (left && right) isolated += files[c];
  }

  let islands = 0, inside = false;
  for (let c = 0; c < 8; c++) {
    if (files[c] > 0 && !inside) { islands++; inside = true; }
    else if (files[c] === 0)     { inside = false; }
  }

  let passed = 0, backward = 0;
  const enemy = side === 'w' ? 'b' : 'w';
  for (let c = 0; c < 8; c++) for (const r of pawnsByFile[c]) {
    // passed: no enemy pawn on adjacent files ahead
    let blocked = false;
    for (const dc of [-1, 0, 1]) {
      const ec = c + dc; if (ec < 0 || ec > 7) continue;
      for (let er = 0; er < 8; er++) {
        if (side === 'w' ? er >= r : er <= r) continue;
        const p = board[er][ec];
        if (p && p.type === 'p' && p.color === enemy) { blocked = true; break; }
      }
      if (blocked) break;
    }
    if (!blocked) passed++;

    // backward: no same-side pawn on adjacent files even with or behind
    let hasNeighborBehindOrEqual = false;
    for (const dc of [-1, 1]) {
      const nc = c + dc; if (nc < 0 || nc > 7) continue;
      for (const nr of pawnsByFile[nc]) {
        if (side === 'w' ? nr >= r : nr <= r) { hasNeighborBehindOrEqual = true; break; }
      }
      if (hasNeighborBehindOrEqual) break;
    }
    if (!hasNeighborBehindOrEqual) backward++;
  }

  // Hanging pair heuristic: two adjacent pawns on rank 4/5 with no pawn support
  let hangingPair = false;
  for (let c = 0; c < 7; c++) {
    const r = side === 'w' ? 4 : 3;          // own rank 4 = r-index 4 for white
    if (pawnsByFile[c].includes(r) && pawnsByFile[c+1].includes(r)) hangingPair = true;
  }

  return { files, doubled, isolated, islands, passed, backward, hangingPair };
}

// Hole: a square that no enemy pawn can ever attack (adjacent-file enemy
// pawns have all advanced beyond it or don't exist).
function squareIsHole(board, r, c, forSide) {
  const enemy = forSide === 'w' ? 'b' : 'w';
  for (const dc of [-1, 1]) {
    const ec = c + dc; if (ec < 0 || ec > 7) continue;
    // Check for any enemy pawn on file ec that could still attack (r,c)
    const behindRange = enemy === 'w' ? [r+1, 8] : [0, r];    // enemy pawns still BEHIND square
    for (let er = behindRange[0]; er < behindRange[1]; er++) {
      const p = board[er][ec];
      if (p && p.type === 'p' && p.color === enemy) return false;
    }
  }
  return true;
}
function isDefendedByPawn(board, r, c, side) {
  const behindDir = side === 'w' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const nc = c + dc, nr = r + behindDir;
    if (nc < 0 || nc > 7 || nr < 0 || nr > 7) continue;
    const p = board[nr][nc];
    if (p && p.type === 'p' && p.color === side) return true;
  }
  return false;
}

function countAttackers(chess, square, byColor) {
  const fp = chess.fen().split(' ');
  fp[1] = byColor; fp[3] = '-';
  try {
    const t = new Chess(fp.join(' '));
    return t.moves({ verbose: true }).filter(m => m.to === square).length;
  } catch { return 0; }
}

// ─── scoring ────────────────────────────────────────────────────────

function scoreFactors(f) {
  const out = {};

  // F1. King safety (highest priority — Dorfman rule 1).
  out.kingSafety = scoreKingSafety(f);
  // F2. Material (standard count + bishop pair nuance).
  out.material   = scoreMaterial(f);
  // F3. Phantom queens — does removing both Qs flip the sign?
  out.queensOff  = scoreQueensOff(f);
  // F4. Piece activity (mobility + rooks on files + outposts).
  out.activity   = scoreActivity(f);
  // F5. Pawn structure.
  out.pawns      = scorePawns(f);
  // F6. Space.
  out.space      = scoreSpace(f);
  // F7. Files & diagonals.
  out.files      = scoreFiles(f);
  // F8. Dynamics — initiative, tempo.
  out.dynamics   = scoreDynamics(f);

  return out;
}

function scoreKingSafety(f) {
  const w = f.kingSafety.w, b = f.kingSafety.b;
  if (!w || !b) return { sign: 0, note: 'king safety N/A' };
  // Alarm when shield≥2 holes AND attackers≥defenders
  const wAlarm = w.shieldHoles >= 2 && w.attackers >= w.defenders;
  const bAlarm = b.shieldHoles >= 2 && b.attackers >= b.defenders;
  const wUncastled = !w.castled;
  const bUncastled = !b.castled;
  let sign = 0, detail = 'both kings adequately safe';
  if (wAlarm && !bAlarm)       { sign = -1; detail = 'White king is exposed — shield gaps and attackers ≥ defenders'; }
  else if (bAlarm && !wAlarm)  { sign = +1; detail = 'Black king is exposed — shield gaps and attackers ≥ defenders'; }
  else if (wAlarm && bAlarm)   { sign = 0;  detail = 'both kings under fire — races and forcing play matter most'; }
  else if (wUncastled && !bUncastled) { sign = -1; detail = 'White king still in the middle'; }
  else if (bUncastled && !wUncastled) { sign = +1; detail = 'Black king still in the middle'; }
  return { sign, note: detail, white: w, black: b };
}

function scoreMaterial(f) {
  let diff = f.material.diff;
  // Bishop-pair nuance: small bonus when open
  if (f.hasBishopPair.w && !f.hasBishopPair.b) diff += f.openness === 'closed' ? 15 : 30;
  if (f.hasBishopPair.b && !f.hasBishopPair.w) diff -= f.openness === 'closed' ? 15 : 30;
  let sign = 0, note = 'material balanced';
  if (diff >= 90)      { sign = +1; note = `White up ~${(diff/100).toFixed(2)}`; }
  else if (diff <= -90){ sign = -1; note = `Black up ~${(-diff/100).toFixed(2)}`; }
  return { sign, note, diff };
}

function scoreQueensOff(f) {
  // Phantom eval with queens removed = simple material-only diff minus 900
  // per side that still has queen. We just report whether the SIGN flips
  // relative to the full-position material diff.
  const base = f.material.diff;
  const wQ = f.piece.w.q, bQ = f.piece.b.q;
  const phantom = base - wQ * 900 + bQ * 900;
  const flip = Math.sign(base) !== Math.sign(phantom) && Math.abs(base) > 40;
  let sign = 0, note = 'queen trade preserves balance';
  if (flip) { sign = Math.sign(phantom); note = 'queen trade would flip the evaluation — trade-sensitive'; }
  return { sign, note, phantom };
}

function scoreActivity(f) {
  // mobility, outposts, and rook-on-open-file
  const wAct = f.mobility.w * 0.5
             + f.outposts.w.length * 40
             + f.rooksOnFile.w.open * 25
             + f.rooksOnFile.w.half * 12
             + f.rooksOnFile.w.seventh * 30;
  const bAct = f.mobility.b * 0.5
             + f.outposts.b.length * 40
             + f.rooksOnFile.b.open * 25
             + f.rooksOnFile.b.half * 12
             + f.rooksOnFile.b.seventh * 30;
  const diff = wAct - bAct;
  let sign = 0, note;
  if (diff >= 25)       { sign = +1; note = 'White has more active pieces'; }
  else if (diff <= -25) { sign = -1; note = 'Black has more active pieces'; }
  else                   note = 'piece activity roughly balanced';
  return { sign, note, wAct, bAct };
}

function scorePawns(f) {
  const wP = f.pawns.w, bP = f.pawns.b;
  const wScore = wP.passed * 35 - wP.isolated * 18 - wP.doubled * 12 - wP.backward * 10 - wP.islands * 6;
  const bScore = bP.passed * 35 - bP.isolated * 18 - bP.doubled * 12 - bP.backward * 10 - bP.islands * 6;
  const diff = wScore - bScore;
  let sign = 0, note;
  if (diff >= 20)       { sign = +1; note = `White pawn structure is better (+${diff})`; }
  else if (diff <= -20) { sign = -1; note = `Black pawn structure is better (${diff})`; }
  else                   note = 'pawn structures balanced';
  return { sign, note, diff, wP, bP };
}

function scoreSpace(f) {
  const diff = f.space.w - f.space.b;
  let sign = 0, note;
  if (diff >= 4)       { sign = +1; note = `White has more space (+${diff} pawn-ranks)`; }
  else if (diff <= -4) { sign = -1; note = `Black has more space (${diff} pawn-ranks)`; }
  else                  note = 'space balanced';
  return { sign, note, diff };
}

function scoreFiles(f) {
  const wScore = f.rooksOnFile.w.open * 20 + f.halfOpenFiles.w.length * 5;
  const bScore = f.rooksOnFile.b.open * 20 + f.halfOpenFiles.b.length * 5;
  const diff = wScore - bScore;
  let sign = 0, note;
  if (diff >= 15)       { sign = +1; note = 'White controls more files/diagonals'; }
  else if (diff <= -15) { sign = -1; note = 'Black controls more files/diagonals'; }
  else                   note = 'file/diagonal control balanced';
  return { sign, note, diff };
}

function scoreDynamics(f) {
  // Rough tempo proxy: mobility delta bias
  const diff = f.mobility.w - f.mobility.b;
  let sign = 0, note;
  if (diff >= 6)       { sign = +1; note = 'White has easier play (more candidate moves)'; }
  else if (diff <= -6) { sign = -1; note = 'Black has easier play (more candidate moves)'; }
  else                  note = 'tempo/candidate-move balance is even';
  return { sign, note, diff };
}

function lexicographicVerdict(factors) {
  // Dorfman-style: walk in priority order; first non-zero wins.
  const ordered = [
    ['King safety',             factors.kingSafety],
    ['Material',                factors.material],
    ['Phantom queen trade',     factors.queensOff],
    ['Piece activity',          factors.activity],
    ['Pawn structure',          factors.pawns],
    ['Space',                   factors.space],
    ['Files / diagonals',       factors.files],
    ['Initiative / tempo',      factors.dynamics],
  ];
  for (const [label, factor] of ordered) {
    if (factor.sign && factor.sign !== 0) {
      return {
        sign: factor.sign,
        dominant: label,
        reason: factor.note,
      };
    }
  }
  return { sign: 0, dominant: null, reason: 'no decisive static factor — position is balanced' };
}

// ─── game phase ─────────────────────────────────────────────────────

function gamePhase(f) {
  // Non-pawn material determines phase. Opening thresholds loose.
  const m = f.totalNonPawnMaterial;
  // Starting non-pawn material = 2*(Q+2R+2N+2B) = 2*(900+1000+640+660)=6400
  if (m >= 5500) return 'opening';
  if (m >= 2800) return 'middlegame';
  return 'endgame';
}

// ─── critical moment (Dorfman) ──────────────────────────────────────

function detectCritical(chess, board) {
  const moves = chess.moves({ verbose: true });
  const captures = moves.filter(m => m.flags.includes('c') || m.flags.includes('e'));
  const centralPush = moves.some(m => m.piece === 'p' &&
    (m.from[0] === 'd' || m.from[0] === 'e') && (m.to[1] === '4' || m.to[1] === '5'));
  const check = chess.inCheck();
  // Any hanging piece?
  const hanging = findHangingPieces(chess, board);

  const triggers = [];
  if (captures.length > 0) triggers.push('exchange on the board');
  if (centralPush)         triggers.push('central pawn push available');
  if (check)               triggers.push('side to move is in check');
  if (hanging.length)      triggers.push(`hanging piece${hanging.length>1?'s':''}: ${hanging.join(', ')}`);

  return {
    isCritical: triggers.length > 0,
    triggers,
    note: triggers.length
      ? 'Critical moment — spend extra time here'
      : 'play within your plan',
  };
}

function findHangingPieces(chess, board) {
  const hanging = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p.type === 'k' || p.type === 'p') continue;
    const sq = FILES[c] + (8 - r);
    const enemy = p.color === 'w' ? 'b' : 'w';
    const atk = countAttackers(chess, sq, enemy);
    if (!atk) continue;
    const def = countAttackers(chess, sq, p.color);
    if (atk > def) hanging.push(sq);
  }
  return hanging;
}

// ─── prophylaxis (Dvoretsky / Aagaard Q3) ──────────────────────────

function detectProphylaxis(chess) {
  // Look at opponent's best move if they had the turn — note it as "their idea"
  const fp = chess.fen().split(' ');
  const theirColor = fp[1] === 'w' ? 'b' : 'w';
  fp[1] = theirColor; fp[3] = '-';
  let opMoves = [];
  try { opMoves = new Chess(fp.join(' ')).moves({ verbose: true }); } catch {}
  if (!opMoves.length) return { note: 'opponent has no useful moves', opponentIdea: null };

  // Very rough "best move" proxy: prefer captures, then checks, then central pawn pushes
  let best = null;
  for (const m of opMoves) {
    let score = 0;
    if (m.flags.includes('c') || m.flags.includes('e')) score += 100;
    if (m.san.endsWith('+') || m.san.endsWith('#'))     score += 80;
    if (m.piece === 'p' && (m.to[1] === '4' || m.to[1] === '5')) score += 30;
    if (CENTRE.has(m.to))                               score += 20;
    if (!best || score > best._score) best = { ...m, _score: score };
  }
  return {
    opponentIdea: best ? `${best.san}${best.flags.includes('c') ? ' (captures)' : ''}` : null,
    note: best ? `Watch for ${best.san} — the opponent's sharpest candidate` : '',
  };
}

// ─── worst piece (Silman + Aagaard Q2) ─────────────────────────────

function detectWorstPiece(chess, board, side, features) {
  const enemy = side === 'w' ? 'b' : 'w';
  let worst = null;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p.color !== side || p.type === 'k' || p.type === 'p') continue;
    const sq = FILES[c] + (8 - r);
    // Approximate per-piece mobility: count legal moves from this square
    const fp = chess.fen().split(' ');
    fp[1] = side; fp[3] = '-';
    let thisMob = 0;
    try { thisMob = new Chess(fp.join(' ')).moves({ square: sq, verbose: true }).length; }
    catch {}
    const maxMob = { n: 8, b: 13, r: 14, q: 27 }[p.type] || 8;
    const lack   = maxMob - thisMob;

    let badness = lack;
    // Bishop on own-pawn colour penalty
    if (p.type === 'b') {
      const bColour = ((r + c) % 2 === 0) ? 'dark' : 'light';
      const cnt = pawnsOnColour(board, side);
      const total = cnt.light + cnt.dark;
      if (total && cnt[bColour] / total > 0.55) badness += 3;
    }
    // Undeveloped knight / bishop in opening
    if ((p.type === 'n' || p.type === 'b') && isStartingSquare(side, p.type, r, c)
        && features.phase === 'opening') badness += 4;
    if (!worst || badness > worst.badness) {
      worst = { square: sq, type: p.type, badness };
    }
  }
  if (worst) {
    worst.reroute = suggestReroute(chess, board, worst.square, worst.type, side);
  }
  return worst;
}

function isStartingSquare(side, type, r, c) {
  if (side === 'w') {
    if (type === 'n' && r === 7 && (c === 1 || c === 6)) return true;
    if (type === 'b' && r === 7 && (c === 2 || c === 5)) return true;
  } else {
    if (type === 'n' && r === 0 && (c === 1 || c === 6)) return true;
    if (type === 'b' && r === 0 && (c === 2 || c === 5)) return true;
  }
  return false;
}

function suggestReroute(chess, board, fromSq, type, side) {
  // Score each of our outposts / central squares by distance + reachability
  const targets = [];
  // Prefer our detected outposts first
  const enemy = side === 'w' ? 'b' : 'w';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const sq = FILES[c] + (8 - r);
    if (squareIsHole(board, r, c, side) && isDefendedByPawn(board, r, c, side)) {
      // prefer central
      const central = CENTRE.has(sq) ? 10 : 0;
      targets.push({ sq, score: 30 + central });
    }
  }
  targets.sort((a, b) => b.score - a.score);
  const best = targets[0];
  if (!best) return null;
  return `consider rerouting toward ${best.sq}`;
}

// ─── plan generation (per dominant imbalance) ───────────────────────

function generatePlans(features, factors, phase, side) {
  const mySign = side === 'w' ? +1 : -1;
  const plans = [];
  // Minor-piece plans
  if (features.hasBishopPair[side] && !features.hasBishopPair[side==='w'?'b':'w']) {
    plans.push({ pri: 1, text: `You have the bishop pair — ${features.openness === 'closed' ? 'aim to OPEN files to activate both bishops' : 'keep lines open and pressure both wings'}.` });
  }
  if (features.bishopsBad[side]) {
    plans.push({ pri: 2, text: `Your bishop is blocked by your own pawns — either trade it for an enemy piece or plan a pawn break that frees its diagonal.` });
  }
  if (features.outposts[side].length) {
    plans.push({ pri: 1, text: `Install a piece on ${features.outposts[side][0]} — it's a permanent outpost (defended by pawn, unassailable by enemy pawns).` });
  }
  // Pawn plans
  if (features.pawns[side].passed) {
    plans.push({ pri: 1, text: `You have a passed pawn — push it with piece support; trade pieces, keep pawns.` });
  }
  const enemy = side === 'w' ? 'b' : 'w';
  if (features.pawns[enemy].passed) {
    plans.push({ pri: 1, text: `Opponent has a passed pawn — blockade it IN FRONT (knight ideal), then attack the base.` });
  }
  if (features.pawns[side].isolated) {
    plans.push({ pri: 2, text: `Your isolated pawn is static target — compensate with piece activity; avoid trades that lead to a pure endgame.` });
  }
  // File / 7th rank
  if (features.rooksOnFile[side].open) {
    plans.push({ pri: 2, text: `Your rook is on an open file — consider doubling rooks or invading the 7th rank.` });
  }
  if (features.rooksOnFile[side].seventh) {
    plans.push({ pri: 1, text: `Rook on 7th rank — hunt enemy pawns on that rank; the enemy king is often cut off.` });
  }
  // King-safety-driven plans
  const myKS = features.kingSafety[side], oppKS = features.kingSafety[enemy];
  if (oppKS && oppKS.shieldHoles >= 2 && oppKS.attackers >= oppKS.defenders) {
    plans.push({ pri: 1, text: `Opponent's king is exposed — keep attackers on the board and bring more forces to the king zone.` });
  }
  if (myKS && !myKS.castled && phase !== 'endgame') {
    plans.push({ pri: 1, text: `Your king is uncastled — castle before opening lines, or tuck the king to safety.` });
  }
  // Mode suggestion from lexicographic verdict
  const verdictSign = factors.kingSafety.sign || factors.material.sign || factors.activity.sign || factors.pawns.sign;
  if (verdictSign === mySign) {
    plans.push({ pri: 3, text: `You are statically better — consolidate: improve your worst piece, avoid unnecessary sharpening, steer toward endgames if material is up.` });
  } else if (verdictSign === -mySign) {
    plans.push({ pri: 3, text: `You are statically worse — seek dynamics: look for forcing moves, pawn breaks, piece activity over material trades.` });
  }
  // Endgame specifics (Capablanca / Shereshevsky)
  if (phase === 'endgame') {
    plans.push({ pri: 2, text: `Endgame — centralize your king; activate the rook; don't hurry.` });
  }
  // Two weaknesses (Shereshevsky)
  if ((features.pawns[enemy].isolated >= 1 || features.pawns[enemy].backward >= 1) && features.halfOpenFiles[side].length >= 1) {
    plans.push({ pri: 2, text: `Opponent has a structural weakness — create a SECOND weakness on the opposite wing to overstretch their defense.` });
  }
  return plans.sort((a, b) => a.pri - b.pri).slice(0, 5);
}

// ─── Watson rule-independence context notes ────────────────────────

function watsonContextNotes(f) {
  const notes = [];
  // Knight on rim pointing at a target — don't penalize if it attacks a hole
  // Bishop on own-pawn colour that defends critical pawn — not bad bishop
  // IQP / hanging pawns with active minors — not necessarily bad
  const wP = f.pawns.w, bP = f.pawns.b;
  if (wP.hangingPair && f.outposts.w.length) notes.push('White has hanging pawns BUT outposts to compensate — dynamic balance.');
  if (bP.hangingPair && f.outposts.b.length) notes.push('Black has hanging pawns BUT outposts to compensate — dynamic balance.');
  if (f.bishopsBad.w && f.piece.w.b >= 2) notes.push('White has the bishop pair — one bad bishop doesn\'t erase the pair bonus.');
  if (f.bishopsBad.b && f.piece.b.b >= 2) notes.push('Black has the bishop pair — one bad bishop doesn\'t erase the pair bonus.');
  return notes;
}

// ─── mode suggestion ────────────────────────────────────────────────

function recommendedMode(verdict, phase, side) {
  const mySign = side === 'w' ? +1 : -1;
  if (verdict.sign === 0) return 'balanced — play principled moves';
  if (verdict.sign === mySign) {
    return phase === 'endgame' ? 'convert — simplify toward a won endgame' : 'consolidate — improve pieces, avoid unnecessary risk';
  }
  return 'seek dynamics — forcing moves, pawn breaks, piece activity';
}
