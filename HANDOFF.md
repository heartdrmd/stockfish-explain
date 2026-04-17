# Handoff — what I set up overnight

## Status: LIVE ✅

- **GitHub repo**: https://github.com/heartdrmd/stockfish-explain
- **GitHub Pages**: https://heartdrmd.github.io/stockfish-explain/  ← **works right now, open it**
- **Release with 108 MB WASMs**: https://github.com/heartdrmd/stockfish-explain/releases/tag/v1.0-binaries

## What's in the repo (56 MB total)

- All source code (`src/`, `styles/`, `index.html`, `replay.html`)
- `vendor/chessground/`, `vendor/chess.js/` (rendering + rules)
- `assets/pieces/cburnett/` (12 SVG piece images)
- `assets/stockfish/stockfish-18-lite*.{js,wasm}` — the 7 MB lite variants
- `scripts/serve.py` (Python dev server with COOP/COEP headers)
- `scripts/build-variants.sh` (recompile Stockfish variants with patched piece values)

## What's in the release (~1.3 GB, 24 assets)

All 12 full-net Stockfish WASMs + their 31 KB JS loaders, as release assets:

### Multi-threaded (strongest — requires COOP/COEP server)
- `stockfish-18.{js,wasm}` — **stock Stockfish 17, multi-threaded, full NNUE**
- `stockfish-kaufman.{js,wasm}` — Kaufman piece values, MT full
- `stockfish-classical.{js,wasm}` — 1/3/3/5/9, MT full
- `stockfish-alphazero.{js,wasm}` — AlphaZero-derived, MT full
- `stockfish-avrukh.{js,wasm}` — Avrukh-style, MT full
- `stockfish-avrukhplus.{js,wasm}` — Avrukh + bishop-pair SEE C++ patch, MT full

### Single-threaded (works on any server, including file://)
- `stockfish-stock-single.{js,wasm}` — stock, single-threaded
- `stockfish-kaufman-single.{js,wasm}`, `-classical-single`, `-alphazero-single`, `-avrukh-single`, `-avrukhplus-single`

Direct download pattern:
```
https://github.com/heartdrmd/stockfish-explain/releases/latest/download/<filename>
```

## Behavior differences by environment

| Environment | Lite 7 MB variants | Full 108 MB variants | Multi-thread |
|---|---|---|---|
| **GitHub Pages** (what you see online) | ✅ work | ❌ disabled in dropdown (link to Release) | ❌ no COOP/COEP on Pages |
| **Local `python3 scripts/serve.py`** | ✅ work | ✅ if you curl them from Release into `assets/stockfish/` | ✅ COOP/COEP headers set |
| **Render / Netlify / Vercel** | ✅ | depends on how you host the big files | ✅ if you set headers |

## Next step: Render deployment

Your Render deployment should work well. Two approaches:

### Approach A — Static site on Render (simplest, no backend)

In Render dashboard:
1. **New → Static Site**
2. **Connect** `heartdrmd/stockfish-explain`
3. **Publish directory**: `/` (root)
4. **Build command**: *(leave empty)*
5. **Environment**: none needed

**Add the COOP/COEP headers** (this unlocks multi-threaded Stockfish):
Create `render.yaml` in the repo root (I haven't added this yet — you might want to):

```yaml
services:
  - type: web
    name: stockfish-explain
    runtime: static
    buildCommand: ""
    staticPublishPath: "."
    headers:
      - path: "/*"
        name: Cross-Origin-Opener-Policy
        value: same-origin
      - path: "/*"
        name: Cross-Origin-Embedder-Policy
        value: require-corp
```

With those headers, the multi-threaded lite variants will work on your Render deployment (unlike GitHub Pages which doesn't allow custom headers).

### Approach B — Web service on Render (Python)

If you want the full Python server (identical to local dev):
1. **New → Web Service**
2. **Connect** the repo
3. **Build command**: *(empty)*
4. **Start command**: `python3 scripts/serve.py $PORT` — but note: the script hardcodes port 8000. You'd need to tweak it to read `$PORT` from env vars.

Quick patch for `scripts/serve.py`:
```python
PORT = int(os.environ.get('PORT', 8000))
```

Approach A is simpler. Go with that.

### Getting the 108 MB files onto Render

Option 1: **Commit them to a separate `wasm` branch**. Render can clone + deploy from any branch but the repo bloats.

Option 2: **Fetch at build time** — Render's free tier supports 400 GB outbound/mo, so you can `curl` them from the GitHub Release during the build step. In `render.yaml`:
```yaml
buildCommand: |
  cd assets/stockfish
  for v in stockfish-18 stockfish-stock-single stockfish-kaufman-single \
           stockfish-classical-single stockfish-alphazero-single \
           stockfish-avrukh-single stockfish-avrukhplus-single; do
    curl -sL "https://github.com/heartdrmd/stockfish-explain/releases/latest/download/${v}.wasm" -o "${v}.wasm"
    curl -sL "https://github.com/heartdrmd/stockfish-explain/releases/latest/download/${v}.js"   -o "${v}.js"
  done
```

Then also update `src/main.js`: change the `isPagesHost` detection so full-net variants are enabled on Render:
```js
// near line 60 in main.js:
const isPagesHost = /\.github\.io$/i.test(location.hostname);  // ← Pages only disables full-net
// Your Render URL (e.g. stockfish-explain.onrender.com) passes the check.
```
No change needed — that regex only matches `.github.io`, so Render URLs keep full-net enabled.

## Things I didn't touch

- **Did NOT update git config** or change any git settings
- **Did NOT force-push** or do anything destructive
- **Did NOT use the Anthropic API key** you pasted earlier — please still rotate it
- **Did NOT add any secrets** to the repo (I double-checked — no keys, tokens, or personal info in committed files)
- **Did NOT create a `render.yaml`** — that's your call; you might want different settings

## Quick verification checklist

Open https://heartdrmd.github.io/stockfish-explain/ and you should see:

- [ ] Board renders with pieces in correct starting position (cburnett brown theme)
- [ ] Engine pill shows "booting…" then "Stock Lite · 1 thread" (multi-thread disabled on Pages)
- [ ] Engine dropdown shows:
  - Stock Lite (single-thread) — usable
  - Stock Lite (multi-thread) — disabled ("needs COOP/COEP")
  - Full variants — disabled ("— download from Releases")
  - Custom lite variants (Kaufman/Classical/AlphaZero/Avrukh+) — usable
- [ ] Click a pawn, it moves; engine starts analyzing
- [ ] Click 🔑 Key → modal pops up for Anthropic key
- [ ] All tabs render

## If something looks broken

Check DevTools Console. The logs should include:
- `[models] select populated with 21 models`
- `[key] modal wired successfully — click 🔑 Key to open`
- `[ai] tab buttons wired — coach: true position: true tactics: true`
- After clicking engine loads: `[engine] ready, threaded=false`

If any of those lines are missing, something failed — paste me the errors and I'll fix.

## Copy in Downloads

Latest everything (including the 108 MB full-net WASMs locally) is at:
`/Users/nadalmaker/Downloads/stockfish-web/` (818 MB)

That's your "full working local copy" — use with `python3 scripts/serve.py`.

Sleep well. Tell me in the morning how you want to proceed with Render.
