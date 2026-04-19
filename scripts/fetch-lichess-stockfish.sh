#!/usr/bin/env bash
# fetch-lichess-stockfish.sh — download lichess's pre-built stockfish-web
# binary + the official Stockfish NNUE files.
#
# Why: building Stockfish WASM with fast-load flags (NNUE_EMBEDDING_OFF,
# MINIMAL_RUNTIME, wasm-opt, brotli) requires a full emscripten pipeline.
# Lichess already does it, publishes via npm, and downloads the same
# NNUEs at runtime. Vendoring their package is 1 step vs a multi-hour
# build pipeline.
#
# Produces:
#   assets/stockfish-web/sf_18.js, sf_18.wasm, (others)
#   assets/nnue/small.nnue   — current official smallnet (~6 MB)
#   assets/nnue/big.nnue     — current official bignet   (~75 MB)
#
# Idempotent — skips files already present.

set -u
cd "$(dirname "$0")/.."

mkdir -p assets/stockfish-web
mkdir -p assets/nnue

# ─── 1. lichess-org/stockfish-web from npm ───
PKG="@lichess-org/stockfish-web"
VERSION="0.3.0"   # bump as lichess publishes newer builds
TARBALL_URL="https://registry.npmjs.org/${PKG}/-/stockfish-web-${VERSION}.tgz"

echo "[stockfish-web] Fetching ${PKG}@${VERSION}…"
if [ -f "assets/stockfish-web/sf_18.js" ] && [ -f "assets/stockfish-web/sf_18.wasm" ]; then
  echo "  ✓ already vendored"
else
  TMP=$(mktemp -d)
  if curl -fL --retry 3 --retry-delay 2 --max-time 180 "${TARBALL_URL}" -o "${TMP}/pkg.tgz"; then
    tar -xzf "${TMP}/pkg.tgz" -C "${TMP}"
    # npm tarballs extract under a 'package/' root.
    cp -f "${TMP}/package/"*.js   assets/stockfish-web/ 2>/dev/null || true
    cp -f "${TMP}/package/"*.wasm assets/stockfish-web/ 2>/dev/null || true
    cp -f "${TMP}/package/"*.d.ts assets/stockfish-web/ 2>/dev/null || true
    echo "  ✓ fetched:"
    ls -lh assets/stockfish-web/ | awk '{print "      " $5, $9}' | grep -v "total"
  else
    echo "  ✗ tarball fetch failed — will fall back to existing custom variants"
  fi
  rm -rf "${TMP}"
fi

# ─── 2. NNUE files from the canonical test server ───
# Filenames live in Stockfish's src/evaluate.h. Update here if a new
# official network ships; the runtime UCI setoption reference must match.
SMALL_NET="nn-47fc8b7fff06.nnue"
BIG_NET="nn-f68ec79f0fe3.nnue"
BASE="https://tests.stockfishchess.org/api/nn"

fetch_net() {
  local name="$1" out="$2"
  if [ -f "$out" ] && [ "$(stat -f%z "$out" 2>/dev/null || stat -c%s "$out")" -gt 10000 ]; then
    echo "  ✓ $out already present"
    return 0
  fi
  echo "  ↓ ${name}  ->  ${out}"
  if curl -fL --retry 3 --retry-delay 3 --max-time 300 "${BASE}/${name}" -o "${out}"; then
    echo "    ok"
  else
    echo "    ✗ failed — boot will still work, variant just won't have that net"
    rm -f "$out"
    return 1
  fi
}

echo "[nnue] Fetching official networks…"
fetch_net "${SMALL_NET}" "assets/nnue/small.nnue" || true
fetch_net "${BIG_NET}"   "assets/nnue/big.nnue"   || true

echo
echo "Done."
