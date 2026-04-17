#!/usr/bin/env bash
#
# build-variants.sh — compile Stockfish WASM variants with different
# piece-value tables. Produces one .js + .wasm pair per variant, ready
# to drop into assets/stockfish/.
#
# Requires: Emscripten SDK (emsdk) installed at ~/stockfish-build/emsdk
#           nmrugg stockfish.js fork at ~/stockfish-build/stockfish.js
#           (both are set up by this project's initial build run)
#
# Run from project root:
#     bash scripts/build-variants.sh [variant1 variant2 ...]
#
# Variants: kaufman  |  classical  |  avrukh  |  alphazero  |  all
#
# Output: assets/stockfish/stockfish-18-lite-<variant>.{js,wasm}

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EMSDK_DIR="$HOME/stockfish-build/emsdk"
SF_SRC="$HOME/stockfish-build/stockfish.js"

[[ -d "$EMSDK_DIR" ]] || { echo "Install emsdk first: see scripts/setup-build.sh"; exit 1; }
[[ -d "$SF_SRC"   ]] || { echo "Clone nmrugg/stockfish.js first to $SF_SRC"; exit 1; }

source "$EMSDK_DIR/emsdk_env.sh" >/dev/null

TYPES_H="$SF_SRC/src/types.h"
BACKUP="$SF_SRC/src/types.h.orig"
[[ -f "$BACKUP" ]] || cp "$TYPES_H" "$BACKUP"

apply_values() {
  local P=$1 N=$2 B=$3 R=$4 Q=$5
  cp "$BACKUP" "$TYPES_H"
  # Replace the five constexpr Value lines
  sed -i '' -E \
    -e "s/(constexpr Value PawnValue   = )[0-9]+;/\1${P};/" \
    -e "s/(constexpr Value KnightValue = )[0-9]+;/\1${N};/" \
    -e "s/(constexpr Value BishopValue = )[0-9]+;/\1${B};/" \
    -e "s/(constexpr Value RookValue   = )[0-9]+;/\1${R};/" \
    -e "s/(constexpr Value QueenValue  = )[0-9]+;/\1${Q};/" \
    "$TYPES_H"
  echo "   values: P=$P  N=$N  B=$B  R=$R  Q=$Q"
}

build_variant() {
  local name=$1 P=$2 N=$3 B=$4 R=$5 Q=$6
  echo
  echo "▶ Building variant: $name"
  apply_values "$P" "$N" "$B" "$R" "$Q"

  cd "$SF_SRC"
  rm -f src/stockfish-*.js src/stockfish-*.wasm 2>/dev/null || true
  node build.js --only-lite-single --skip-em-check --force 2>&1 | tail -5

  local jsFile wasmFile
  jsFile="$(ls src/stockfish-*-lite-single.js 2>/dev/null | head -1)"
  wasmFile="$(ls src/stockfish-*-lite-single.wasm 2>/dev/null | head -1)"
  [[ -f "$jsFile"   ]] || { echo "FAILED: no .js produced"; return 1; }
  [[ -f "$wasmFile" ]] || { echo "FAILED: no .wasm produced"; return 1; }

  local dest="$REPO_ROOT/assets/stockfish/stockfish-18-lite-single-${name}"
  cp "$jsFile"   "${dest}.js"
  cp "$wasmFile" "${dest}.wasm"
  echo "   → $(du -h "${dest}.js" | cut -f1) js  $(du -h "${dest}.wasm" | cut -f1) wasm"
}

# Preset variants (piece values in Stockfish's internal units,
# keeping P=208 as the fixed reference the engine uses elsewhere).
build_kaufman()    { build_variant "kaufman"    208 676 676 1040 2028; }  # P=1 N=3.25 B=3.25 R=5.0 Q=9.75
build_classical()  { build_variant "classical"  208 624 624  1040 1872; }  # 1/3/3/5/9
build_avrukh()     { build_variant "avrukh"     208 676 676 1040 2028; }  # Kaufman-equivalent (pair handled in our app)
build_alphazero()  { build_variant "alphazero"  208 634 693 1171 1976; }  # 1/3.05/3.33/5.63/9.5
build_default()    { build_variant "default"    208 781 825 1276 2538; }  # original

wanted=("${@:-all}")
[[ "${wanted[0]}" == "all" ]] && wanted=(default classical kaufman avrukh alphazero)

for v in "${wanted[@]}"; do
  case "$v" in
    default)    build_default ;;
    classical)  build_classical ;;
    kaufman)    build_kaufman ;;
    avrukh)     build_avrukh ;;
    alphazero)  build_alphazero ;;
    *) echo "Unknown variant: $v (use default|classical|kaufman|avrukh|alphazero|all)"; exit 1 ;;
  esac
done

# Restore original types.h
cp "$BACKUP" "$TYPES_H"
echo
echo "✔ Done. Variants in: $REPO_ROOT/assets/stockfish/"
ls -lh "$REPO_ROOT/assets/stockfish/" | grep 'stockfish-18-lite-single-' || echo "  (no variant files found)"
