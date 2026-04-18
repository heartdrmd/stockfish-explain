// validation_harness.js — empirical weight calibration against Lichess masters DB.
//
// Dev-facing tool. Runs offline (no UI) via `window.__runCoachValidation()`
// from the browser console. For each canonical test FEN it fetches the
// master-game win-rate stats, compares against the coach's predicted
// sign, and prints a recommended centipawn weight adjustment.
//
// Formula: near W=0.5, cp ≈ 4.05 × (%-delta in expected score).
// That's the local slope of the logistic W(cp) = 1/(1 + 10^(-cp/400·K))
// with K ≈ 1.13 for master chess (documented on chessprogramming.org).

import { coachReport }           from './coach_v2.js';
import { queryOpeningExplorer }  from './opening_explorer.js';

// ─── canonical test positions ───────────────────────────────────────
// 15 FENs covering every archetype our detector recognises + common
// middlegame types. All publicly known opening/middlegame positions;
// expected_eval is a rough Stockfish-style sign estimate for sanity.
export const TEST_FENS = [
  { label: 'Classic IQP (White)',     fen: 'r1bqk2r/pp1n1ppp/2p1pn2/8/1bBP4/2N1PN2/PP3PPP/R1BQ1RK1 b kq - 0 1',     expected: +0.20 },
  { label: 'Carlsbad QGD Exchange',   fen: 'r1bq1rk1/pp1nbppp/2p1pn2/3p4/3P1B2/2N1PN2/PPQ1BPPP/R3K2R w KQ - 0 1',   expected: +0.15 },
  { label: 'Maroczy Bind',            fen: 'r1bqkb1r/pp2pp1p/2n3p1/3p4/2PN4/2N1P3/PP3PPP/R1BQKB1R b KQkq - 0 1',    expected: +0.25 },
  { label: 'Hanging pawns (Black)',   fen: 'r1bq1rk1/pp2bppp/2n1pn2/8/2pp4/2N1PNB1/PPQ1BPPP/R4RK1 w - - 0 1',       expected:  0.00 },
  { label: 'Ruy Lopez closed',        fen: 'r1bq1rk1/2p1bppp/p1np1n2/1p2p3/4P3/1BP2N1P/PP1P1PP1/RNBQR1K1 w - - 0 1', expected: +0.10 },
  { label: 'KID locked center',       fen: 'r1bq1rk1/pp2npbp/3p1np1/2pPp3/2P1P3/2N2N2/PP2BPPP/R1BQ1RK1 b - - 0 1',  expected:  0.00 },
  { label: 'French Advance',          fen: 'rnbqkbnr/pp3ppp/4p3/2ppP3/3P4/8/PPP2PPP/RNBQKBNR w KQkq - 0 1',         expected: +0.10 },
  { label: 'Najdorf mainline',        fen: 'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 1',      expected: +0.20 },
  { label: 'Nimzo doubled c-pawns',   fen: 'r1bqk2r/ppp2ppp/2n1pn2/3p4/1bPP4/P1N1P3/1P3PPP/R1BQKBNR w KQkq - 0 1',  expected: +0.10 },
  { label: 'Yugoslav Dragon',         fen: 'r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w KQ - 0 1',      expected:  0.00 },
  { label: 'QGA classical',           fen: 'rnbqkb1r/ppp1pppp/5n2/8/2pP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 0 1',         expected: +0.20 },
  { label: 'Caro Panov IQP',          fen: 'rnbqkb1r/pp3ppp/4pn2/2p5/2BP4/2N2N2/PP3PPP/R1BQK2R b KQkq - 0 1',       expected: +0.25 },
  { label: 'English Symmetrical',     fen: 'r1bqkb1r/pp1ppp1p/2n2np1/2p5/2P5/2N2NP1/PP1PPPBP/R1BQK2R w KQkq - 0 1', expected: +0.05 },
  { label: 'Berlin endgame',          fen: 'r1b1k2r/ppp2ppp/2p5/4Pb2/8/5N2/PPPP1PPP/RNB1K2R b KQkq - 0 1',          expected: +0.05 },
  { label: 'Grünfeld exchange',       fen: 'rnbqk2r/pp2ppbp/6p1/2p5/3PP3/2N2N2/PP3PPP/R1BQKB1R b KQkq - 0 1',       expected: +0.10 },
];

// ─── known-good sanity-check weights (chessprogramming.org, Kaufman) ─
// Your recalibration should land in these ranges; otherwise treat as a
// data-pipeline bug, not a discovery.
export const SANITY_WEIGHTS = {
  bishopPairOpen:       { range: [30, 70],  source: 'Kaufman 1999' },
  rookOnOpenFile:       { range: [8,  40],  source: 'Stockfish HCE / chessprogramming.org' },
  rookOnSemiOpenFile:   { range: [4,  20],  source: 'Stockfish HCE' },
  knightOutpostCentral: { range: [15, 30],  source: 'Stockfish HCE / PeSTO' },
  doubledPawn:          { range: [-20, -5], source: 'Kaufman 1999' },
  passedPawn7th:        { range: [80, 150], source: 'PeSTO PST delta' },
};

const K_FACTOR = 1.13;
const CP_PER_PERCENT = 4.05;                  // local slope at W=0.5

// ─── main harness ───────────────────────────────────────────────────

/**
 * Hit the Lichess masters API for each test FEN, collect observed W/D/B
 * stats, compare against what the coach predicts, and suggest weight
 * adjustments. Intended for dev-console use; prints a table to console.
 */
export async function runCoachValidation({ onlyLabel = null, verbose = true } = {}) {
  const rows = [];
  const picked = onlyLabel
    ? TEST_FENS.filter(f => f.label.includes(onlyLabel))
    : TEST_FENS;

  for (const { label, fen, expected } of picked) {
    const stats = await queryOpeningExplorer(fen);
    // Throttle between requests (120 ms budget lives inside the explorer module)
    if (!stats || !stats.total) {
      if (verbose) console.warn('[validation]', label, '— no master data');
      rows.push({ label, fen, expected, stats: null, rep: null });
      continue;
    }
    let rep = null;
    try { rep = coachReport(fen); } catch (err) {
      if (verbose) console.warn('[validation] coachReport failed for', label, err.message);
    }
    const wScore = stats.total ? (stats.white + 0.5 * stats.draws) / stats.total : 0.5;
    const delta  = wScore - 0.5;               // positive → White scores above mid
    const cpSuggested = Math.round(delta * 100 * CP_PER_PERCENT);
    rows.push({
      label, fen, expected,
      observed: {
        totalGames: stats.total,
        pctW: stats.pctWhite,
        pctD: stats.pctDraw,
        pctB: stats.pctBlack,
        wScore: +wScore.toFixed(3),
      },
      cpSuggested,
      coachVerdictSign: rep ? rep.verdict.sign : null,
      coachDominant:    rep ? rep.verdict.dominant : null,
      agreesWithData:   rep && Math.sign(delta) !== 0
                         ? (Math.sign(rep.verdict.sign || 0) === Math.sign(delta))
                         : null,
    });
  }

  if (verbose) printValidationTable(rows);
  return rows;
}

function printValidationTable(rows) {
  console.group('[validation] coach calibration report');
  console.table(rows.map(r => ({
    label:        r.label,
    games:        r.observed?.totalGames ?? '—',
    'W%':         r.observed?.pctW ?? '—',
    'D%':         r.observed?.pctD ?? '—',
    'B%':         r.observed?.pctB ?? '—',
    'obs cp':     r.cpSuggested,
    'coach sign': r.coachVerdictSign,
    agrees:       r.agreesWithData === null ? '—' : r.agreesWithData ? '✓' : '✗',
  })));
  const scored = rows.filter(r => r.agreesWithData !== null);
  const hits = scored.filter(r => r.agreesWithData).length;
  const rate = scored.length ? (hits / scored.length * 100).toFixed(1) : '—';
  console.log(`sign-agreement: ${hits}/${scored.length} = ${rate}%`);
  console.groupEnd();
}

// Expose globally for dev-console use. Typing `__runCoachValidation()`
// in devtools hits Lichess once per FEN and prints the calibration
// table. Gated with a flag so it only attaches in the browser.
if (typeof window !== 'undefined') {
  window.__runCoachValidation = runCoachValidation;
  window.__coachTestFens = TEST_FENS;
}
