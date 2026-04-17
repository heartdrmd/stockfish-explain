#!/usr/bin/env bash
# fetch-full-wasms.sh — download all 108 MB full-net Stockfish WASM variants
# from the GitHub Release. Use this on Render (as build command) or after
# cloning the repo locally if you want the full-NNUE variants available.
#
# Skips files already present (idempotent).
#
# Usage:
#   bash scripts/fetch-full-wasms.sh

set -e
cd "$(dirname "$0")/.."
cd assets/stockfish

BASE="https://github.com/heartdrmd/stockfish-explain/releases/latest/download"

# All 12 full-net variants — stock + custom piece values, in both
# single-thread and multi-thread flavors. ~1.3 GB total.
variants=(
  # Stock
  stockfish-18                        # multi-thread full (strongest)
  stockfish-stock-single              # single-thread full (file://-safe)
  # Single-thread full-net with custom piece values
  stockfish-kaufman-single
  stockfish-classical-single
  stockfish-alphazero-single
  stockfish-avrukh-single
  stockfish-avrukhplus-single         # with C++ SEE pair patch
  # Multi-thread full-net with custom piece values (strongest per-variant)
  stockfish-kaufman
  stockfish-classical
  stockfish-alphazero
  stockfish-avrukh
  stockfish-avrukhplus                # with C++ SEE pair patch
)

for v in "${variants[@]}"; do
  for ext in js wasm; do
    f="${v}.${ext}"
    if [[ -f "$f" && $(stat -f%z "$f" 2>/dev/null || stat -c%s "$f") -gt 1000 ]]; then
      echo "  ✓ $f already present (skipping)"
    else
      echo "  ↓ ${f}"
      curl -sfL "${BASE}/${f}" -o "${f}"
    fi
  done
done

echo
echo "Done. Full-net variants available in $(pwd)"
