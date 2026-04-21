# stockfish-explain — session handoff (2026-04-20)

**Most recent commit:** `461aa72` (SVG pieces in preview boards)
**Repo:** `heartdrmd/stockfish-explain` on GitHub → auto-deploys to Render on push
**Local working dir:** `/Users/nadalmaker/stockfish-web/`
**Public URL:** `https://stockfish-explain.onrender.com`
**Gate passwords** (rotating daily, Central Time):
- Site: `9069` + tomorrow's 2-digit day
- Premium: `Dooha` + tomorrow's 2-digit day

---

## What this app is

Browser-based chess analyzer + practice trainer. Lichess-style UI. Bundles
multiple Stockfish WASM variants (Stock Lite/Full + Kaufman / Classical /
AlphaZero / Avrukh / Avrukh+) AND the lichess `@lichess-org/stockfish-web`
package. Node/Express server on Render with optional **Postgres backend**
for multi-user sync.

---

## 🆕 Major work done THIS session (Apr 19-20, 2026)

This was a long session covering a lot of ground. Commits in reverse
chronological order since the session started — group by theme:

### 1. Engine reliability / silent-engine saga (biggest arc)

Recurring symptom: user booted a multi-thread engine (Avrukh / Full NNUE)
and it would report `uciok` but emit ZERO `info` lines. Analysis dead.
User's reliable workaround: switch flavor to Stock Lite 7 MB, then back.

**What we shipped to fix it:**

- Engine lifecycle hardening (`src/engine.js`):
  - `_send()` gates pre-uciok commands (commit `a5676cd`)
  - `stopRequested` flag filters stale info lines after `stop` (same)
  - `stopRequested` cleared in `_doStart` so new searches always pass
    the guard (commit `6d511db`)
  - Always-stop-first pattern on every `start()` (commit `25b2122`)
  - Bestmove watchdog — auto-reboot if no bestmove in 3× movetime
    (commit `9106e09`)
  - Options-only-when-idle queue (setoption during active search is
    spec-violation per Stockfish docs)
  - Suppress stale trailing bestmove from prior stopped search
    (commit `e41d926`) — fixed "engine plays instantly even though I
    asked for 10s" bug
  - `_skipNextBestmove` counter to drain stale bestmoves

- Mismatch detector (commit `bfae5a2`):
  - Per-search counters: `infoReceived`, `infoDropped`, `infoDispatched`
  - 2-second health check — dispatches `engine-silent-detected` event if
    zero info received
  - Made debugging concrete; used throughout later fixes.

- **Auto-ritual** on boot (commit `9ec79e9` → improved in `dcf5c0b`):
  - Before booting any MT target, boot lite-single (ST) first for 200 ms
  - Terminate ST → new Engine → boot MT target
  - Rationale: SAB / pthread state from a previous MT worker can
    interfere with a fresh MT worker's thread init. ST warmup clears that
    state.

- **Reactive auto-recovery** when ritual fails (commits `7e7bd18`,
  `e51756e`):
  - If mismatch detector fires, main.js dispatches `ui.selectFlavor`
    change events: set value to 'lite-single' → change event → set back
    to target → change event
  - Goes through the EXISTING manual flavor-switch handler, which is the
    ONLY proven-reliable code path
  - User said "or i just do my ritual lol" — the recovery literally
    dispatches the same DOM events a manual ritual would

- **Root cause of a class of bugs** (commit `0b806f6`):
  - After any `engine = new Engine()`, the explainer and capture
    listeners were orphaned on the dead engine. Fixed at all five
    new-Engine sites (initial, flavor-switch, restart, auto-fallback,
    auto-ritual) — see `switchEngineFlavor()` in main.js and the
    `wireEngineCaptureListeners` helper.

### 2. Practice UX

- **Clock:**
  - 3-way mode dropdown: **None / Untimed / Timed** (commit `86cadfa`)
  - W / B letter labels instead of Unicode kings
  - User-color matches board: if you play Black, your clock is on bottom
  - Initial `tickingFor` reads `board.chess.turn()` (fixed off-by-one for
    openings ending on odd-parity moves, commit `2c415dc`)
  - Pause button freezes both sides
  - Styles: **Jumbo** (default), Mega, Stadium, Chronos GX (blue 7-seg
    tournament), Garde analog, Chrome analog
  - Mobile: fixed top-bar thin clock when active (commit `795aea5`)

- **Forced-move short-circuit** (commit `599852a`): when chess.js reports
  1 legal move, play instantly after 150 ms — skip engine round-trip.

- **Critical-position time boost** (same commit): if the previous
  search's bestmove flipped ≥3 times across iterations OR the cp swing
  between mid-iteration and end was ≥100 cp, next movetime doubles (cap
  18 s). Mirrors Stockfish's own `timeman.cpp` logic.

- **Seconds-per-move preset pulldown** (commit `ff5bb79`): Practice
  think-time mode defaults to "Seconds / move (fixed)" with 1/2/3/5/10/
  15/20/30/60 presets. Legacy "By depth" / "By time (ms)" still available.

- **Retry fireAnalysis when engine becomes ready** (commit `4811f86`):
  fixed "engine just sat waiting" when practice started before engine
  boot completed.

### 3. Learn-from-mistakes (lichess retro clone)

Big feature. Click an accuracy pill after a game → floating panel pops
next to the board, asks you to find a better move.

- Base implementation (commit `654676e`): state machine (`find / eval /
  win / fail / view / end`), engine probes at 1.5s movetime, win-chances
  delta < 0.04 acceptance.
- Lichess-styled visuals (commit `b263ab9`): title bar, counter, ✓/✗
  glyphs, uppercase continue button.
- Pill colors: blue = inaccuracy, gray = mistake, black = blunder
  (commit `9509ea9`)
- Positioning near the board with live reposition on resize/scroll
  (commit `b74e807`)
- Classifier ported to lichess formula (commit `aa0fe6d`):
  `cpWin(cp) = 2/(1+exp(-0.004*cp)) - 1`, thresholds 0.06 / 0.12 / 0.20
  on win-% delta instead of raw cp.
- Practice filter (commit `c089e16`): only USER's moves, skip opening
  plies (stored in `window.__practiceOpeningPlies`).

### 4. Practice opening tree UX

- **Hover preview** (commit `7704b2c` → SVG in `461aa72`): 250 ms hover →
  400×400 SVG board tooltip showing opening's resulting position. Uses
  cburnett piece set at `/assets/pieces/cburnett/*.svg`.
- **➕ Add new opening modal** (commit `988437a`): FEN input + live
  preview + name + folder + side (White/Black/Both). Writes to
  `stockfish-explain.practice-custom-openings` localStorage.
- **🔍 FEN search** (commit `e4e840b`): paste any FEN, scans all ~3,950
  openings + Lichess DB for matches via `fenKey` (first 4 FEN fields so
  move counters don't block matches). If no match: offers to seed the
  Add-Opening flow.
- **▼ Collapse all / ▶ Expand all** toggle (same commit).
- **Save current board as new opening** (commit `9074839`): renamed
  flow, added Side selector, auto-stars on save.
- **Per-favourite W/B/↔ side selector** (commit `6dfefc3`): three mini
  buttons next to the ★. 'Both' = coin-flip on each queue rotation.

### 5. Multi-user / cloud sync (Phase 1-3 of a 3-phase plan)

**Phase 1** — DB + auth (commit `3732fe6`):
- `render.yaml` declares Postgres starter-plan DB
- Schema: 7 idempotent migrations in `src/server/db.js`
  (users, sessions, games, mistakes, srs_cards, favourites, user_prefs)
- `src/server/auth.js` — bcryptjs + opaque session tokens
- Endpoints: `POST /api/auth/signup|login|logout`, `GET /api/auth/me`
- **No SESSION_SECRET needed** — we use opaque DB-stored tokens, not
  signed cookies (commit `29e49b0`)

**Phase 2** — games endpoints (commit `0794709`):
- `src/server/games.js`
- `POST /api/games` (autosave)
- `GET /api/games` (list with `?from&to` date range)
- `GET /api/games/:id` (full PGN + plies)
- `DELETE /api/games/:id`
- `GET /api/games/export.pgn?from=&to=` (download as multi-game PGN)

**Phase 3** — client UI (commits `86b7879`, `e94f6b2`):
- `src/api.js` — fetch wrapper with credentials
- Auth area in header (green `👤 Sign in` or `username / Logout`)
- Sign in / sign up modal with toggle
- Cloud autosave in `finishPracticeGame` — POSTs PGN + plies + mistake
  counts
- 🗑 **Don't save** button — DELETEs the just-saved cloud game; local
  archive entry stays
- ☁ **My cloud games** modal — list/filter/delete/export

**To activate:** create a Postgres instance in Render dashboard, paste
its Internal Database URL into web service's `DATABASE_URL` env var.
Migrations run on next deploy.

### 6. Multi-tab coordination + mobile

- Multi-tab lock via BroadcastChannel (commit `d194175`): new tab
  opens → old tabs terminate their engine + show "another tab has this
  app open — click to reactivate" banner.
- Mobile fixes (commit `795aea5`): RangeError on load (applySize
  recursion guard), clock becomes fixed top bar on mobile.

### 7. Misc polish

- **Blue Always-visible header buttons** (commit `a5d9bfb`): 🆕 New game
  + 🎯 Practice stay reachable even when toolbar auto-collapses during
  practice.
- **Toolbar auto-collapse on practice start** — uncluttered view during
  a game.
- **Pause clock** button (commit `3abb460`).
- **Kill "Resume game?" prompt on every page load** (same): now
  auto-restores drafts <24h old silently; discards older.
- **Live calculating indicator during practice** — shows depth/nodes/nps
  so user knows engine is actually thinking (anti-cheat: no PV, no eval).
- **Engine cache clear button** (🗑 Clear engine cache, commit `377326e`).
- **Preload engines button** — warms Chrome's HTTP cache for all
  variants. Simplified from SW-intercept to plain fetch after Chrome
  "Aw Snap" crashes (commit `209c71b` → `c621770`).
- **Lichess stockfish-web + NNUE** fetched at build time via
  `scripts/fetch-lichess-stockfish.sh` (commit `975f1d2`). Provides
  `sf-fast` flavor but currently unused in auto-ritual — ST lite-single
  is the warmup path that actually works.

---

## Architecture

```
stockfish-web/
├── server.js                 — Express server, proxies AI, serves static
├── render.yaml               — Render infra declaration (web + DB)
├── package.json              — express, cookie-parser, pg, bcryptjs
├── index.html                — all the DOM
├── sw.js                     — self-uninstalling service worker
├── scripts/
│   ├── fetch-full-wasms.sh   — pulls custom SF variants from GitHub release
│   └── fetch-lichess-stockfish.sh — pulls @lichess-org/stockfish-web + NNUEs
├── src/
│   ├── main.js               — ~5000 lines, all client wiring
│   ├── api.js                — fetch wrapper for /api/* endpoints
│   ├── engine.js             — Stockfish WASM worker + UCI protocol
│   ├── board.js              — chessground + chess.js + variation tree
│   ├── tree.js               — GameTree (lichess-style)
│   ├── explain.js            — positional explainer
│   ├── openings.js           — curated opening list
│   ├── openings_lichess.js   — 3,690 openings imported from lichess
│   ├── game_archive.js       — localStorage game archive
│   ├── ai-coach.js           — Claude API integration (server-proxied)
│   ├── [+ many domain modules: pawn_levers, king_attack,
│   │                          coach_v2, archetype, values, …]
│   └── server/
│       ├── db.js             — Postgres pool + 7 migrations
│       ├── auth.js           — bcryptjs + session tokens
│       └── games.js          — /api/games endpoints
├── styles/                   — theme.css, layout.css, board.css, panels.css
├── vendor/                   — chessground, chess.js (vendored, not npm)
└── assets/
    ├── stockfish/            — 20 custom WASM variants (7 MB lite to 108 MB full)
    ├── stockfish-web/        — lichess pre-built sf_18.{js,wasm} (~8 MB)
    ├── nnue/                 — small.nnue (~6 MB) + big.nnue (~75 MB)
    └── pieces/cburnett/      — SVG piece set
```

**Key runtime shapes:**

- `engine` — single Engine instance, gets replaced on flavor-switch.
  Consumer listeners (explainer + captureEngineThinkingEval) MUST be
  re-attached on every `new Engine()`. See `switchEngineFlavor` helper.
- `board` — single BoardController. `board.chess` = live chess.js.
  `board.tree` = the full variation tree.
- `practiceColor` — `'white'`, `'black'`, or `null`. Null means analysis
  mode (no engine auto-play). Set at practice-start, cleared on
  `new-game`.
- `fenEvalCache` — in-memory Map of FEN→`{cpWhite, mate, depth}` used by
  the accuracy-pill classifier + learn-mode.
- `window.__currentUser` — `{id, username}` when logged in, `null`
  otherwise.
- `window.__lastSavedGameId` — set after successful cloud autosave so
  the 🗑 Don't save button knows what to DELETE.

---

## Open threads / known issues / next work

### Known / deliberate

- **`lite-single` variant crashes with `RuntimeError: unreachable`** in
  some browser states — the auto-ritual + auto-fallback chain handles
  it, but the underlying WASM bug is unresolved. Don't make it the
  default.
- **Draft auto-restore uses localStorage**. If user logs in on a new
  device, they don't see their old drafts from the previous device.
  Acceptable — drafts are ephemeral.
- **Mistake bank + SRS cards + favourites + user_prefs** have DB tables
  but no client wiring yet (Phase 4, not built this session).
- **Opening-book skip in learn-mode** — lichess excludes moves that
  appear in master DB. We skip based on user-defined opening-plies
  length, which is simpler but misses "user made a great move in the
  book".

### Feature backlog (not started)

- Phase 4 DB sync: mistake bank, SRS cards, favourites, prefs — extend
  `src/server/games.js` pattern to new endpoints, wire client.
- Shared/public game database (famous games library).
- Smallnet + separate NNUE hot-swap (biggest cold-boot win, requires
  rebuilding Stockfish).
- Brotli-precompress WASM + NNUE (~35% smaller downloads).
- Proper mobile redesign (side panel → bottom sheet is workable but
  rough).

### Tiny things observed but not fixed

- `HTTP 401 [openings]` spam in the log — some /api/openings endpoint
  returns unauthorized. Cosmetic, doesn't affect anything.
- FEN-search's "Select" button only jumps the practice picker — doesn't
  scroll the tree to the match. Nice-to-have.

---

## How to pick up from here

1. **Read this file and the most recent 10-20 commits** — `git log --oneline -30`
   shows the thread.
2. **To continue DB work (Phase 4)**: extend `src/server/games.js`
   pattern. Mistake bank endpoints are obvious next (`/api/mistakes`
   POST/GET/DELETE), then SRS (`/api/srs/due`, `/api/srs/grade`), then
   favourites (`/api/favourites` PUT/GET), then prefs
   (`/api/user_prefs`). Client mirrors: add API helpers in `src/api.js`,
   wire into existing localStorage callers with `if
   (window.__currentUser) api.xxx(...)` dual-write.
3. **If engine issues reappear**: check the auto-recovery path. The
   mismatch detector logs `⚠ MISMATCH: 2 s passed, worker emitted ZERO
   info`. If this fires and recovery succeeds, no action needed. If
   recovery fails, the log's caller stack on every `stop()` call tells
   you which code path terminated the engine.
4. **To add a new preview board anywhere**: use
   `previewBoardSvg(fen, { squarePx })` — it's a top-level helper in
   main.js.
5. **To add an auth-protected endpoint**: import `requireAuth` from
   `src/server/auth.js` and use as middleware (see
   `src/server/games.js` for examples).

---

## Environment setup quick-ref

Render dashboard:
- Web service: `stockfish-explain` · Node · Starter $7/mo · Ohio
- Database: `stockfish-explain-db` (MANUALLY create via + New →
  PostgreSQL; set `DATABASE_URL` env var on web service to its
  Internal URL)
- Env vars on web service:
  - `ANTHROPIC_API_KEY` — Claude API (gated via daily passwords)
  - `DATABASE_URL` — Postgres connection string (from the DB service)

Local dev:
```bash
cd ~/stockfish-web
npm install
node server.js                          # port 8000 by default
# OR for COOP/COEP in dev (multi-thread WASM needs it):
python3 scripts/serve.py
```

Without `DATABASE_URL`, the server still runs — just localStorage-only
mode (guests). Login endpoints return 500.

---

*Written 2026-04-20 while active context was at ~91%. Most recent work
captured verbatim; earlier session history was already compressed by the
time this was written but the git log preserves everything.*
