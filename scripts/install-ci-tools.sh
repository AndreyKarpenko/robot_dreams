#!/usr/bin/env bash
set -euo pipefail
mkdir -p .bin
BIN="$PWD/.bin"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
[ "$ARCH" != x86_64 ] || ARCH=amd64
[ "$ARCH" != aarch64 ] || ARCH=arm64
fetch_tar() {
  local base=$1 archive=$2 sums=$3 program=$4
  local temp
  temp=$(mktemp -d)
  curl -fsSL "$base/$archive" -o "$temp/$archive"
  curl -fsSL "$base/$sums" -o "$temp/checksums"
  (cd "$temp"; awk -v file="$archive" '$NF==file || $NF=="*"file {print}' checksums > selected; test -s selected; shasum -a 256 -c selected)
  tar -xzf "$temp/$archive" -C "$temp"
  install "$temp/$program" "$BIN/$program"
  rm -rf "$temp"
}
OAS_ARCH=$ARCH
[ "$OS" != darwin ] || OAS_ARCH=all
fetch_tar https://github.com/oasdiff/oasdiff/releases/download/v1.11.7 "oasdiff_1.11.7_${OS}_${OAS_ARCH}.tar.gz" checksums.txt oasdiff
fetch_tar https://github.com/rhysd/actionlint/releases/download/v1.7.7 "actionlint_1.7.7_${OS}_${ARCH}.tar.gz" actionlint_1.7.7_checksums.txt actionlint
if [ "${CI:-}" = true ]; then
  fetch_tar https://github.com/aquasecurity/trivy/releases/download/v0.76.1 trivy_0.76.1_Linux-64bit.tar.gz trivy_0.76.1_checksums.txt trivy
fi
[ -z "${GITHUB_PATH:-}" ] || echo "$BIN" >> "$GITHUB_PATH"
