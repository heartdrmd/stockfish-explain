# Stockfish.explain

A chess analysis web app that **plays like [lichess.org](https://lichess.org), thinks with [Stockfish 17](https://stockfishchess.org), and explains with [Claude](https://www.anthropic.com/claude)**.

![screenshot](https://user-images.githubusercontent.com/placeholder.png) <!-- optional -->

## What makes it different

- **Multi-variant Stockfish** — ships six custom-compiled WASM builds with different internal piece values (Kaufman, Classical 1/3/3/5/9, AlphaZero-derived, Avrukh-style) plus an **Avrukh+** variant that includes a real C++ source patch (`position.cpp`) adding bishop-pair-aware SEE. Pick any variant from the Engine dropdown.
- **AI-augmented analysis** — bring your own Anthropic API key. The app sends the position + Stockfish's MultiPV=5 ground truth to Claude with a strict "only cite engine moves" system prompt. Every SAN move Claude mentions is **verified against the engine's top-5** and flagged if it hallucinates.
- **Engine-vs-engine tournaments** — any two variants can play each other over N games with configurable time controls and forced openings (230+ opening lines in the dropdown). Watch Elo differentials accumulate live.
- **Practice from any opening** — pick an opening + your color + engine strength (0-20) and play Stockfish from move 1 of that line.
- **Lichess-style UI** — `chessground` + `chess.js`, dark theme, cburnett pieces, brown board. Six input methods (drag, click-click, click-target-first, drag-target-first, SAN typing, click-PV-to-play).

## Quick start

### Online (GitHub Pages)
Visit **https://heartdrmd.github.io/stockfish-explain/** (lite variants only — see below).

### Local (full features)

```bash
git clone https://github.com/heartdrmd/stockfish-explain.git
cd stockfish-explain
python3 scripts/serve.py
# opens http://localhost:8000/ in your browser
```

The Python server adds `Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy` headers, which unlock `SharedArrayBuffer` and enable **multi-threaded Stockfish**.

## The 108 MB full-net Stockfish WASMs

GitHub rejects files > 100 MB, so the six full-net variants (Stockfish 17 with the big NNUE network baked in, one per value system) are attached to a [**GitHub Release**](../../releases/latest) instead of committed to the repo.

To enable them locally:

```bash
# Download all full-net WASMs to assets/stockfish/
cd assets/stockfish/
for v in stockfish-18 stockfish-stock-single stockfish-kaufman-single \
         stockfish-classical-single stockfish-alphazero-single \
         stockfish-avrukh-single stockfish-avrukhplus-single; do
  curl -L "https://github.com/heartdrmd/stockfish-explain/releases/latest/download/${v}.wasm" -o "${v}.wasm"
  curl -L "https://github.com/heartdrmd/stockfish-explain/releases/latest/download/${v}.js"   -o "${v}.js"
done
```

After that, all variants in the Engine dropdown work. The 7 MB lite variants (included in the repo) work without this step.

## Anthropic API key

The AI Coach / Position / Tactics tabs call Claude's [Messages API](https://docs.anthropic.com/en/api/messages) directly from the browser using the `anthropic-dangerous-direct-browser-access` header. Your key is stored **only in your browser's localStorage** — never sent to any server except Anthropic.

Click **🔑 Key** in the top AI bar → paste key → save. Model selector next to it lets you pick from 20+ Claude models (Opus / Sonnet / Haiku tiers). Cost tracker shows live session spend.

Per-analysis cost (approximate, at Sonnet 4.6 pricing $3/$15 per M tokens):
- **~1400 input + ~400 output tokens** = **~$0.01 per analysis**

## Building your own Stockfish variants

The `scripts/build-variants.sh` script compiles custom Stockfish WASMs with your own piece values. Requires Emscripten 3.1.7 (the nmrugg/stockfish.js build system is pinned to that version).

```bash
# Install Emscripten 3.1.7
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install 3.1.7
./emsdk activate 3.1.7
source ./emsdk_env.sh

# Clone nmrugg's Stockfish.js (build system)
cd ~
git clone https://github.com/nmrugg/stockfish.js.git

# Patch types.h with your values, then build
cd stockfish.js/src
# edit types.h: change KnightValue, BishopValue, RookValue, QueenValue
cd ..
node build.js --lite --single-threaded --skip-em-check --force --no-split

# Output at src/stockfish-18-lite-single.{js,wasm}
# Copy into this repo's assets/stockfish/ as stockfish-<yourname>-lite-single.*
# Add entry to src/engine.js ENGINE_FLAVORS and HTML dropdown
```

## Tech stack

| Layer | What |
|---|---|
| Engine | [Stockfish 17 WASM](https://github.com/nmrugg/stockfish.js) (nmrugg's Emscripten port), lite + full-NNUE variants |
| Board | [chessground](https://github.com/lichess-org/chessground) (lichess.org's renderer, GPL-3) |
| Rules | [chess.js](https://github.com/jhlywa/chess.js) (BSD-2) |
| Pieces | [cburnett](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett) SVG set from lila |
| AI | Anthropic Claude Messages API (user-supplied key) |
| Server | Python 3 `http.server` with COOP/COEP headers |

No build step, no npm. All vendor code shipped pre-compiled in `vendor/`.

## License

GPL-3.0 (inherited from Stockfish + chessground). See `COPYING.txt`.

## Credits

- **Stockfish** — T. Romstad, M. Costalba, J. Kiiski, G. Linscott, and hundreds of contributors
- **Stockfish.js** port — nmrugg (with Chess.com)
- **chessground + lila** — Thibault Duplessis and the lichess.org team
- **NNUE network** — Linmiao Xu (linrock) and the Stockfish testing team
- **This wrapper** — built with [Claude Code](https://claude.com/claude-code)
