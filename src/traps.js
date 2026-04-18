// traps.js — static FEN-level trap + tactical-pattern detector.
//
// Pure functions over (chess, stm, sanHistory). No engine, no search.
// Each detector is cheap: at worst one chess.moves() call and a
// handful of piece lookups. The pipeline early-exits after two
// warnings so render cost stays under ~10 ms even with all detectors
// registered.
//
// Warning shape:
//   {
//     name:         string,                         // detector key
//     severity:     'critical' | 'warn' | 'info',
//     message:      string,                         // one-line imperative
//     affectedSide: 'w' | 'b',
//     focusSquare?: string,
//     moveToAvoid?: string,
//   }

import { Chess } from '../vendor/chess.js/chess.js';

const SEV_RANK = { critical: 3, warn: 2, info: 1 };
const FILES = 'abcdefgh';

// ─── public API ─────────────────────────────────────────────────────

export function detectTraps(fen, sanHistory = [], engineData = null) {
  let chess;
  try { chess = new Chess(fen); } catch { return []; }
  const stm = chess.turn();

  const raw = [];
  for (const fn of DETECTORS) {
    try {
      const w = fn(chess, stm, sanHistory);
      if (w) raw.push(w);
    } catch (_) { /* detector errors should never break the pipeline */ }
  }

  // Suppress noise in clearly-lost positions: if engine knows we're -5 or
  // worse, warn/info warnings add no value. Keep only critical.
  let filtered = raw;
  if (engineData && typeof engineData.score === 'number') {
    const s = engineData.score;
    if (Math.abs(s) >= 500) {
      filtered = raw.filter(w => w.severity === 'critical');
    }
  }
  return dedupeAndRank(filtered).slice(0, 2);
}

function dedupeAndRank(ws) {
  // Named traps suppress same-square generic patterns.
  const bySquare = new Map();
  for (const w of ws) {
    const key = w.focusSquare || w.moveToAvoid || w.name;
    const prev = bySquare.get(key);
    if (!prev || SEV_RANK[w.severity] > SEV_RANK[prev.severity]) {
      bySquare.set(key, w);
    }
  }
  return [...bySquare.values()]
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}

// ─── tiny helpers ───────────────────────────────────────────────────

function findPiece(chess, type, color) {
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = FILES[f] + (8 - r);
    const p = chess.get(sq);
    if (p && p.type === type && p.color === color) return sq;
  }
  return null;
}
function scanPieces(chess, color, types) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = FILES[f] + (8 - r);
    const p = chess.get(sq);
    if (p && p.color === color && types.includes(p.type)) out.push(sq);
  }
  return out;
}
function rayClearOnFile(chess, from, to) {
  if (from[0] !== to[0]) return false;
  const f = from[0];
  const r1 = Math.min(+from[1], +to[1]);
  const r2 = Math.max(+from[1], +to[1]);
  for (let r = r1 + 1; r < r2; r++) if (chess.get(f + r)) return false;
  return true;
}
function fullmoveNumber(chess) {
  const parts = chess.fen().split(' ');
  return parseInt(parts[5] || '1', 10) || 1;
}
function getMoves(chess, color) {
  // chess.js's .moves() always returns for the side-to-move. If we need
  // moves for the OTHER side, we swap the side-to-move in a clone.
  if (chess.turn() === color) {
    return chess.moves({ verbose: true });
  }
  const parts = chess.fen().split(' ');
  parts[1] = color;
  parts[3] = '-';
  try {
    return new Chess(parts.join(' ')).moves({ verbose: true });
  } catch { return []; }
}

// ─── named traps ────────────────────────────────────────────────────

function detectScholarsMate(chess, stm) {
  if (fullmoveNumber(chess) > 10) return null;
  // Check both sides (either may be threatening).
  for (const color of ['w', 'b']) {
    const Q = findPiece(chess, 'q', color);
    const B = findPiece(chess, 'b', color);
    if (!Q || !B) continue;
    const bishopOK = color === 'w' ? B === 'c4' : B === 'c5';
    const queenOK  = color === 'w'
      ? ['h5', 'f3', 'g4'].includes(Q)
      : ['h4', 'f6', 'g5'].includes(Q);
    if (!bishopOK || !queenOK) continue;
    const target = color === 'w' ? 'f7' : 'f2';
    const moves = getMoves(chess, color);
    const mate = moves.some(m => m.to === target && m.piece === 'q' && m.san.endsWith('#'));
    if (mate) {
      return {
        name: 'scholars_mate',
        severity: 'critical',
        message: color === 'w'
          ? 'White threatens Qxf7# (Scholar\'s mate) — defend f7 now.'
          : 'Black threatens Qxf2# (Scholar\'s mate) — defend f2 now.',
        affectedSide: color === 'w' ? 'b' : 'w',
        focusSquare: target,
      };
    }
  }
  return null;
}

function detectFoolsMate(chess, stm) {
  if (fullmoveNumber(chess) > 4) return null;
  // Either side can threaten: check if the enemy has Qh4#/Qh5# legal.
  const other = stm === 'w' ? 'b' : 'w';
  const moves = getMoves(chess, other);
  const mate = moves.find(m => m.piece === 'q' && m.san.endsWith('#') &&
                               (m.to === 'h4' || m.to === 'h5'));
  if (!mate) return null;
  return {
    name: 'fools_mate',
    severity: 'critical',
    message: `${other === 'w' ? 'White' : 'Black'} threatens ${mate.san} — kingside diagonal is fatally exposed.`,
    affectedSide: stm,
    focusSquare: mate.to,
  };
}

function detectNoahsArkRuy(chess, stm) {
  if (fullmoveNumber(chess) > 12) return null;
  // Fires for either side when their own LSB on b3/b6 can be trapped by
  // pawns a6/b5/c5 ready to play c4 (or mirror).
  for (const color of ['w', 'b']) {
    const bSq = color === 'w' ? 'b3' : 'b6';
    const b = chess.get(bSq);
    if (!b || b.type !== 'b' || b.color !== color) continue;
    const enemy = color === 'w' ? 'b' : 'w';
    const aPawn = chess.get(color === 'w' ? 'a6' : 'a3');
    const bPawn = chess.get(color === 'w' ? 'b5' : 'b4');
    const cPawn = chess.get(color === 'w' ? 'c5' : 'c4');
    const allPawns = aPawn?.type === 'p' && aPawn.color === enemy
                  && bPawn?.type === 'p' && bPawn.color === enemy
                  && cPawn?.type === 'p' && cPawn.color === enemy;
    if (!allPawns) continue;
    return {
      name: 'noahs_ark',
      severity: 'critical',
      message: color === 'w'
        ? '…c4 traps the Bb3 (Noah\'s Ark) — move the bishop to safety now.'
        : 'c5 traps the Bb6 (Noah\'s Ark mirror) — move the bishop now.',
      affectedSide: color,
      focusSquare: bSq,
    };
  }
  return null;
}

function detectLegalsMate(chess, stm, sanHist) {
  if (fullmoveNumber(chess) > 8) return null;
  // White wants Nf3+Bc4+e4 vs Black's bg4 "pinning" Nf3 onto queen.
  if (stm !== 'w') return null;
  const b = chess.get('c4'), n = chess.get('f3'), e4 = chess.get('e4');
  const bb = chess.get('g4');
  if (!b || b.color !== 'w' || b.type !== 'b') return null;
  if (!n || n.color !== 'w' || n.type !== 'n') return null;
  if (!e4 || e4.color !== 'w' || e4.type !== 'p') return null;
  if (!bb || bb.color !== 'b' || bb.type !== 'b') return null;
  const moves = chess.moves({ verbose: true });
  const canNxe5 = moves.some(m => m.from === 'f3' && m.to === 'e5');
  if (!canNxe5) return null;
  return {
    name: 'legals_mate',
    severity: 'critical',
    message: 'Nxe5! works — the pin on the f3-knight is illusory; Bxf7+ and Nd5# follows.',
    affectedSide: 'b',
    focusSquare: 'f3',
  };
}

function detectFriedLiver(chess, stm) {
  if (fullmoveNumber(chess) > 8) return null;
  if (stm !== 'w') return null;
  const n = chess.get('g5');
  if (!n || n.type !== 'n' || n.color !== 'w') return null;
  // Is Black's king still on e8 and f7 defended only by king?
  const k = chess.get('e8');
  if (!k || k.type !== 'k' || k.color !== 'b') return null;
  const moves = chess.moves({ verbose: true });
  const nxf7 = moves.find(m => m.from === 'g5' && m.to === 'f7' && m.flags.includes('c'));
  if (!nxf7) return null;
  return {
    name: 'fried_liver',
    severity: 'critical',
    message: 'Nxf7! (Fried Liver) drags the Black king into the open.',
    affectedSide: 'b',
    focusSquare: 'f7',
  };
}

function detectShillingGambit(chess, stm, sanHist) {
  if (fullmoveNumber(chess) > 6) return null;
  // Detection: Black n on d4, White B on c4, and it's White's move. If
  // White plays Nxe5??, Qg5 double-attacks g2 and e5. Warn White.
  if (stm !== 'w') return null;
  const nd4 = chess.get('d4');
  const bc4 = chess.get('c4');
  if (!nd4 || nd4.type !== 'n' || nd4.color !== 'b') return null;
  if (!bc4 || bc4.type !== 'b' || bc4.color !== 'w') return null;
  // Is White's knight on f3 ready to capture on e5?
  const moves = chess.moves({ verbose: true });
  const nxe5 = moves.find(m => m.from === 'f3' && m.to === 'e5' && m.flags.includes('c'));
  if (!nxe5) return null;
  return {
    name: 'blackburne_shilling',
    severity: 'critical',
    message: 'Don\'t play Nxe5 — Black\'s …Qg5! forks e5 and g2 (Shilling trap).',
    affectedSide: 'w',
    moveToAvoid: 'Nxe5',
  };
}

// ─── generic tactical patterns ──────────────────────────────────────

function detectBackRank(chess, stm) {
  const us = stm;
  const enemy = us === 'w' ? 'b' : 'w';
  const homeRank = us === 'w' ? '1' : '8';
  const luftRank = us === 'w' ? '2' : '7';
  const kSq = findPiece(chess, 'k', us);
  if (!kSq || kSq[1] !== homeRank) return null;

  const fileCode = kSq.charCodeAt(0);
  const shields = [-1, 0, 1]
    .map(d => String.fromCharCode(fileCode + d) + luftRank)
    .filter(s => /^[a-h][1-8]$/.test(s));
  const allPawns = shields.every(s => {
    const p = chess.get(s);
    return p && p.color === us && p.type === 'p';
  });
  if (!allPawns) return null;

  for (const enemySq of scanPieces(chess, enemy, ['r', 'q'])) {
    if (enemySq[0] !== kSq[0]) continue;
    if (!rayClearOnFile(chess, enemySq, kSq)) continue;
    return {
      name: 'back_rank',
      severity: 'warn',
      message: `Back-rank is vulnerable — make luft (a pawn move on the ${luftRank}-rank) before heavy pieces invade.`,
      affectedSide: us,
      focusSquare: kSq,
    };
  }
  return null;
}

function detectHangingPiece(chess, stm) {
  const us = stm;
  const enemy = us === 'w' ? 'b' : 'w';
  const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const enemyMoves = getMoves(chess, enemy);
  const ourMoves   = getMoves(chess, us);
  const attackersOf = (sq, byColor) => {
    const ms = byColor === enemy ? enemyMoves : ourMoves;
    return ms.filter(m => m.to === sq);
  };

  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = FILES[f] + (8 - r);
    const p = chess.get(sq);
    if (!p || p.color !== us || p.type === 'k') continue;
    const atk = attackersOf(sq, enemy);
    if (!atk.length) continue;
    const def = attackersOf(sq, us);
    const minAttackerVal = Math.min(...atk.map(m => PIECE_VAL[m.piece] || 9));
    const myVal = PIECE_VAL[p.type];
    // Fire if attacker value < piece value (pure loss), OR equal values
    // but attackers exceed defenders.
    if (minAttackerVal < myVal || (minAttackerVal === myVal && atk.length > def.length)) {
      return {
        name: 'hanging_piece',
        severity: myVal >= 3 ? 'critical' : 'warn',
        message: `Your ${pieceName(p.type)} on ${sq} is hanging — defend or move it.`,
        affectedSide: us,
        focusSquare: sq,
      };
    }
  }
  return null;
}

function detectAbsolutePin(chess, stm) {
  // Walk 8 rays from our king; first own piece we hit, then an enemy
  // slider compatible with that ray behind it → absolute pin.
  const us = stm;
  const enemy = us === 'w' ? 'b' : 'w';
  const kSq = findPiece(chess, 'k', us);
  if (!kSq) return null;
  const kFile = kSq.charCodeAt(0) - 97;
  const kRank = +kSq[1] - 1;

  const RAYS = [
    // name: [df, dr, enemyTypes]
    ['file-up',    [0, +1], ['r', 'q']],
    ['file-down',  [0, -1], ['r', 'q']],
    ['rank-right', [+1, 0], ['r', 'q']],
    ['rank-left',  [-1, 0], ['r', 'q']],
    ['diag-ur',    [+1, +1], ['b', 'q']],
    ['diag-ul',    [-1, +1], ['b', 'q']],
    ['diag-dr',    [+1, -1], ['b', 'q']],
    ['diag-dl',    [-1, -1], ['b', 'q']],
  ];
  for (const [, [df, dr], types] of RAYS) {
    let f = kFile + df, r = kRank + dr;
    let ownPiece = null, ownSq = null;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = FILES[f] + (r + 1);
      const p = chess.get(sq);
      if (p) {
        if (!ownPiece) {
          if (p.color !== us) break;
          if (p.type === 'k') break;
          ownPiece = p; ownSq = sq;
        } else {
          if (p.color === enemy && types.includes(p.type)) {
            // Don't raise for pawns — pawn pins are usually info-level.
            return {
              name: 'absolute_pin',
              severity: ownPiece.type === 'p' ? 'info' : 'warn',
              message: `Your ${pieceName(ownPiece.type)} on ${ownSq} is pinned to the king — don\'t rely on its defence.`,
              affectedSide: us,
              focusSquare: ownSq,
            };
          }
          break;
        }
      }
      f += df; r += dr;
    }
  }
  return null;
}

function detectEnPassantWindow(chess, stm) {
  const parts = chess.fen().split(' ');
  const ep = parts[3];
  if (ep === '-') return null;
  // If we have a legal en-passant capture, surface it — humans forget.
  const moves = chess.moves({ verbose: true });
  const epMove = moves.find(m => m.flags.includes('e'));
  if (!epMove) return null;
  return {
    name: 'en_passant',
    severity: 'info',
    message: `En-passant available: ${epMove.san} is legal this move only.`,
    affectedSide: stm,
    focusSquare: ep,
  };
}

function detectGreekGiftSetup(chess, stm) {
  // Warn Black (defender) when White has Bd3 + Nf3 aimed at h7, Black's
  // Nf6 absent from f6, king on g8 with h7+g7 pawns as only shield.
  for (const color of ['w', 'b']) {
    const us = color;                    // attacker
    const them = us === 'w' ? 'b' : 'w';
    const bSq = us === 'w' ? 'd3' : 'd6';
    const nSq = us === 'w' ? 'f3' : 'f6';
    const kSq = them === 'w' ? 'g1' : 'g8';
    const hSq = them === 'w' ? 'h2' : 'h7';
    const gSq = them === 'w' ? 'g2' : 'g7';
    const fSq = them === 'w' ? 'f6' : 'f3';   // square the defending knight would occupy
    const b = chess.get(bSq);
    const n = chess.get(nSq);
    const k = chess.get(kSq);
    const hP = chess.get(hSq);
    const gP = chess.get(gSq);
    const fDef = chess.get(fSq);
    if (!b || b.type !== 'b' || b.color !== us) continue;
    if (!n || n.type !== 'n' || n.color !== us) continue;
    if (!k || k.type !== 'k' || k.color !== them) continue;
    if (!hP || hP.type !== 'p' || hP.color !== them) continue;
    if (!gP || gP.type !== 'p' || gP.color !== them) continue;
    if (fDef && fDef.type === 'n' && fDef.color === them) continue;   // defender still home
    return {
      name: 'greek_gift_setup',
      severity: 'warn',
      message: us === 'w'
        ? 'Greek-gift danger: Bxh7+! Kxh7 Ng5+ is on the menu for White.'
        : 'Greek-gift danger: …Bxh2+! Kxh2 …Ng4+ is on the menu for Black.',
      affectedSide: them,
      focusSquare: hSq,
    };
  }
  return null;
}

function pieceName(t) {
  return ({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' })[t] || t;
}

// ─── detector registry ─────────────────────────────────────────────
const DETECTORS = [
  detectScholarsMate,
  detectFoolsMate,
  detectNoahsArkRuy,
  detectLegalsMate,
  detectFriedLiver,
  detectShillingGambit,
  detectGreekGiftSetup,
  detectBackRank,
  detectHangingPiece,
  detectAbsolutePin,
  detectEnPassantWindow,
];
