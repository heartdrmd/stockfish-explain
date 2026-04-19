#!/usr/bin/env bash
# fetch-full-wasms.sh — download all 12 full-NNUE Stockfish WASM
# variants from the GitHub Release.
#
# Root-cause fix: the previous version had `set -e` + `curl -sf`
# which meant ANY transient CDN hiccup (even a single 5xx retry-
# able error) killed the whole deploy. We still want ALL variants
# available to the user — just retry on failure instead of bailing.
#
# Retries each file up to 5 times with progressive backoff.
# Skips files already present (idempotent).

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

fetched=0
failed=0
for v in "${variants[@]}"; do
  for ext in js wasm; do
    f="${v}.${ext}"
    if [[ -f "$f" && $(stat -f%z "$f" 2>/dev/null || stat -c%s "$f") -gt 1000 ]]; then
      echo "  ✓ $f already present (skipping)"
      continue
    fi
    # Up to 5 attempts with progressive backoff. curl's built-in
    # --retry handles 5xx + transient network errors transparently.
    ok=0
    for attempt in 1 2 3 4 5; do
      echo "  ↓ ${f} (attempt $attempt/5)"
      if curl -fL \
              --retry 2 --retry-delay 3 \
              --connect-timeout 30 --max-time 300 \
              "${BASE}/${f}" -o "${f}"; then
        ok=1
        fetched=$((fetched + 1))
        break
      fi
      echo "    ⚠ attempt $attempt failed; backing off $((attempt * 5))s"
      rm -f "$f"
      sleep $((attempt * 5))
    done
    if [[ $ok -eq 0 ]]; then
      echo "  ✗ $f — all 5 attempts failed. App will fall back to lite variants for this flavor."
      failed=$((failed + 1))
    fi
  done
done

echo
echo "Done. Fetched $fetched file(s), $failed failure(s)."
echo "Full list requested — all 24 files attempted."
# Don't bail on failures: lite variants ship in git so the app still
# boots. The Render build was breaking because any single hiccup
# would kill the deploy entirely, which is strictly worse than
# shipping with whichever engines we DID manage to pull.
exit 0
