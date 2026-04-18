# stockfish-explain — session handoff

**Last live commit:** `9ac4525` (Stage 5 openings book + coach/AI integration)
**Repo:** `heartdrmd/stockfish-explain` on GitHub, auto-deploys to Render on push
**Local working dir:** `/Users/nadalmaker/stockfish-web/`
**Downloads mirror:** `/Users/nadalmaker/Downloads/stockfish-web/` (refreshed after each commit)

---

## What this app is

Browser-based chess analysis tool. Lichess-style UI. Bundles Stockfish WASM
(variants: stock lite/full + Kaufman/Classical/AlphaZero/Avrukh/Avrukh+) and
a proprietary positional coach. Deploys to Render as a Node/Express static
host with password-gated AI (Anthropic API server-side).

Public URL: `https://stockfish-explain.onrender.com` (once Render redeploys).
Password scheme (rotating daily, Central Time):
- Site: `9069` + tomorrow's 2-digit day (unlocks site + Haiku AI)
- Premium: `Dooha` + tomorrow's 2-digit day (unlocks Sonnet/Opus)

---

## Architecture summary

```
src/
  main.js             — UI wiring, gate/auth, event handlers, renderDissection
  board.js            — chessground + chess.js + variation tree navigation
  tree.js             — GameTree (lichess-style variations)
  engine.js           — Stockfish WASM wrapper (UCI, MultiPV, hash, threads)
  explain.js          — Engine info → pearl/depth/PV rendering + arrows
  editor.js           — Position-setup board (cburnett SVGs)

  coach_v2.js         — Synthesised positional coach (Dorfman / Silman /
                         Nimzowitsch / Aagaard / Capablanca / Dvoretsky /
                         Watson / AlphaZero / Stockfish HCE concepts)
  archetype.js        — IQP / Carlsbad / Hanging pawns / Maroczy detection
  traps.js            — 11 trap/tactical-pattern static detectors
  tablebase.js        — Lichess Syzygy API (≤7-piece perfect play)
  opening_explorer.js — Lichess Masters API (win/draw/loss stats)
  openings_book.js    — ~60 curated opening entries with plans/motifs
  validation_harness.js — Empirical calibration tool (dev console)

  ai-coach.js         — Anthropic prompt builder + API call
                         Now receives: coachV2Report + tablebase + openingExplorer
  dorfman.js          — Legacy; superseded by coach_v2 but kept for compat
  coach.js            — Legacy heuristic coachReport (still fed to AI)
  tournament.js       — Engine-vs-engine self-play
  openings.js         — 230+ opening move lines for practice/tournament
  narrate.js          — Engine-line prose utility
  analysis.js         — Heuristic strategy/tactics reports
  values.js           — Kaufman/Avrukh imbalance weights
  promotion.js        — Pawn-promotion UI overlay

server.js             — Express server + /api/gate + /api/ai proxy

styles/
  panels.css          — Main stylesheet (1700+ lines)
  board.css           — Chessground + pieces
  layout.css          — Top-level grid
  theme.css           — Dark theme variables
  fonts.css           — Font imports
```

---

## What shipped this session (last 5 stages)

| Commit | What |
|---|---|
| `81d2bae` | Empirical validation harness — `window.__runCoachValidation()` in devtools, 15 canonical FENs hitting Lichess masters API + sign-agreement table |
| `1be061f` | Syzygy tablebase module — auto-fires when ≤7 pieces; queries `tablebase.lichess.ovh/standard`; gold panel in Coach |
| `b84f08d` | Lichess Masters opening explorer — purple panel in opening phase; W/D/L bars + top moves table; `explorer.lichess.ovh/masters` |
| `883edab` | Trap library (11 detectors: Scholar's, Fool's, Noah's Ark, Légal, Fried Liver, Shilling, Greek-gift, back-rank, hanging piece, absolute pin, en-passant) + AI coach enrichment — AI prompt now receives full coach_v2 context + tablebase + explorer |
| `9ac4525` | Openings book with ~60 curated entries covering every family (Sicilian / 1.e4 e5 / Semi-open / QGD-QGA-Slav / Indian / English / Flank / Rare). Detection via longest-prefix SAN match. Purple opening block in Coach + AI prompt. |

---

## Next work — 10-chunk openings-book expansion

Goal: grow `src/openings_book.js` from ~60 to ~200 entries, broken into 10
chunks so Render has a working deploy after every step.

Format for each entry (already established in `src/openings_book.js`):

```js
{ name: '...', eco: '...', parent: '...',
  moves: ['e4','e5',...],
  structure: '1-sentence paraphrase in original words',
  whitePlans: ['plan 1', 'plan 2', 'plan 3'],
  blackPlans: ['plan 1', 'plan 2', 'plan 3'],
  pitfalls: ['pitfall'],
  motifs: ['motif1', 'motif2'],
},
```

IMPORTANT: all narrative text must be paraphrased original wording. Move
sequences and ECO codes are factual data and are fine to reproduce as-is.
Do not copy prose from any published opening book, chess.com article, or
Wikipedia entry.

### The 10 chunks (commit + push after each)

1. **Sicilian** — Classical Richter-Rauzer, Four Knights, Kalashnikov, Lowenthal, Paulsen umbrella, Closed Sicilian, Bc4 Quiet, Chekhover, KIA vs Sicilian, Wing Gambit, Hyperaccelerated Dragon (~11 entries)
2. **1.e4 e5** — Ruy Zaitsev, Breyer, Smyslov, Anti-Marshall 8.h3/8.a4, Steinitz, Schliemann, Classical, Bird, Open Ruy, Pianissimo variants, Scotch Four Knights, Scotch Gambit, Three Knights, Centre, Danish, Bishop's, Ponziani, Latvian, Elephant (~15)
3. **French** — Winawer sub-lines, Classical Steinitz, McCutcheon, Rubinstein, Burn, Fort Knox, KIA vs French (~8)
4. **Caro/Pirc/Modern/Alekhine/Scandi** — Caro Two Knights, Fantasy, Modern (Bronstein-Larsen), Karpov; Pirc Austrian, 150 Attack, Byrne, Monkey's Bum; Alekhine Four Pawns, Exchange, Chase; Scandi Modern, Portuguese (~12)
5. **QGD/QGA** — Lasker, Tartakower, Semi-Tarrasch, Ragozin, Vienna, Tarrasch; QGA Central, Furman, Janowski; Albin, Marshall, Chigorin, Baltic, Triangle (~12)
6. **Slav/Semi-Slav/Catalan** — Chebanenko, Exchange Slav, Schlechter, Slav Gambit, Anti-Meran, Moscow, Anti-Moscow, Botvinnik, Shabalov-Shirov, Closed Catalan, Bogo 4.Bd2/4.Nbd2 (~11)
7. **KID/Grünfeld** — 9.Ne1 Mar del Plata, Bayonet, Sämisch, Four Pawns, Fianchetto, Averbakh, Classical Exchange; Grünfeld Russian, Modern Exchange, Fianchetto, Bf4, Qb3, Hungarian (~13)
8. **Nimzo/QID/Benoni/Benko/Dutch/Budapest** — Nimzo Classical/Sämisch/Leningrad/Kasparov/Hübner/Noa/Keres; QID Petrosian, Kasparov-Petrosian, Fianchetto; Benoni Classical/Taimanov/Four Pawns/Fianchetto/Flick-Knife; Benko Declined; Dutch Classical/Stonewall/Staunton/Anti-Dutch; Old Indian; Budapest, Fajarowicz; Blumenfeld (~22)
9. **English + flank** — English Hedgehog, Double Fianchetto, Botvinnik, Anti-KID, Anti-QGD, Anti-Slav, Mikenas, Kramnik-Shirov, Réti Classical, KIA systems, Réti Gambit, Zukertort; Bird Classical, From's, Sokolsky, Larsen, Grob, Anderssen, Mieses, Van't Kruijs, Ware, Hungarian, Amar, Polish, Durkin (~20)
10. **Rare + d-pawn specials** — London Classical, Colle-Zukertort, Torre, Pseudo-Trompowsky, Trompowsky, Veresov, Richter-Veresov, Jobava London, BDG main, BDG Ryder, Stonewall Attack, London vs KID, Torre vs KID, Englund Main/Declined, Czech/Rat, Mikenas/Queen's Knight, English Defence, Owen's, Modern vs 1.d4, Anti-Dutch variants, Jerome, Halloween, Cochrane, Max Lange, Schilling-Kostic, Fischer 1.b3 vs 1.e5, BDG Lemberger (~20)

### Execution pattern per chunk

```bash
cd /Users/nadalmaker/stockfish-web

# 1. Edit src/openings_book.js — add N entries to BOOK_RAW array
#    (the file auto-sorts longest-prefix-first at load, so insertion order doesn't matter)

# 2. Smoke test
ANTHROPIC_API_KEY=test_placeholder PORT=8200 node server.js &
SERVER_PID=$!
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8200/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8200/src/openings_book.js
kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null

# 3. Commit + push + refresh Downloads
git add src/openings_book.js
git commit -m "Expand openings book: chunk N — <families>"
git push
rm -rf /Users/nadalmaker/Downloads/stockfish-web
cp -R /Users/nadalmaker/stockfish-web /Users/nadalmaker/Downloads/stockfish-web
```

---

## Secondary backlog (after 10 chunks done)

- **Empirical weight calibration** — run `window.__runCoachValidation()`
  end-to-end and feed the suggested weight deltas back into
  `coach_v2.js::scoreFactors`.
- **More trap detectors** — 11 shipped; could add Monticelli, Marshall
  Petroff, Tarrasch, Siberian, Kieninger, Rubinstein QGD, Magnus-Smith,
  Poisoned Pawn, Fishing-Pole, Englund decline (~10 more named traps).
- **Generic-pattern detectors** — knight fork setup, discovered attack,
  overloaded defender, smothered-mate prerequisites, pinned-pawn push,
  loose-piece double attack. Specs are already in `traps.js` comments.
- **Opening-explorer inline with openings-book block** — currently two
  separate panels; merging would be cleaner UX.
- **Inline practice-from-archetype** — from the Coach panel, offer "Play
  this structure vs the engine" launching Practice pre-loaded with the
  current FEN and a skill-level picker.

---

## Dev / local test

```bash
cd /Users/nadalmaker/stockfish-web
npm install                                       # once, to install express + cookie-parser
ANTHROPIC_API_KEY=<real-key> PORT=8000 node server.js
# open http://localhost:8000
```

Today's passwords are printed in the server's startup log.

---

## Deploy

```bash
git push   # triggers Render auto-deploy (autoDeploy: true in render.yaml)
```

Render builds Node service, fetches full WASM binaries from GitHub Releases
via `scripts/fetch-full-wasms.sh` (too big for git — 108 MB each).
ANTHROPIC_API_KEY env var is set once in the Render dashboard.

---

## Known quirks

- Rate limit on agent dispatches: Anthropic backend throttles if you spawn
  many parallel research agents. Do them serially.
- Session context window: last session reached 88% — a fresh session with
  this file in front of it has full capacity.
- `navigator.deviceMemory` is quantized at 8 GB max and returns undefined
  in Firefox/Safari — hash picker treats it as a floor, not ceiling.
- GitHub Pages can't run server code or set COOP/COEP; multi-threaded
  Stockfish only works on Render (or locally via python3 scripts/serve.py).
- `coach_v2.js` has 4 call sites in `main.js`; all now pass `sanHistory`
  via the engineSnapshot object. If you add a 5th call site, include it.

---

## Opening the new session

> Read /Users/nadalmaker/stockfish-web/HANDOFF.md first. Then proceed with
> Chunk 1 of the 10-chunk openings-book expansion plan. Commit and push
> after each chunk. All narrative text must be paraphrased in original
> words — do not reproduce prose from any published source. Move
> sequences and ECO codes are factual and are fine to reproduce as-is.
