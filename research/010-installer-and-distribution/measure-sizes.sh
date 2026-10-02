#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v24.21.0}"
BUN_VERSION="${BUN_VERSION:-bun-v1.4.2}"
FFMPEG_BUILD="${FFMPEG_BUILD:-1789931890_9.0.2}"
WORK="${WORK:-$(mktemp -d)}"

cd "$WORK"
echo "work dir: $WORK"

for arch in arm64 x64; do
  name="node-${NODE_VERSION}-darwin-${arch}"
  curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/${name}.tar.xz"
  tar -xJf "${name}.tar.xz" "${name}/bin/node"
  printf 'node %s darwin-%s: tarball %s bytes, bin/node %s bytes\n' \
    "$NODE_VERSION" "$arch" "$(stat -c %s "${name}.tar.xz")" "$(stat -c %s "${name}/bin/node")"
  file "${name}/bin/node"
done

for arch in aarch64 x64; do
  name="bun-darwin-${arch}"
  curl -fsSLO "https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${name}.zip"
  unzip -oq "${name}.zip"
  printf 'bun %s darwin-%s: zip %s bytes, bun %s bytes\n' \
    "$BUN_VERSION" "$arch" "$(stat -c %s "${name}.zip")" "$(stat -c %s "${name}/bun")"
  file "${name}/bun"
done

base="https://ffmpeg.martin-riedl.de/download/macos/arm64/${FFMPEG_BUILD}"
mkdir -p ffmpeg-arm64
curl -fsSL -o ffmpeg-arm64/ffmpeg.zip "${base}/ffmpeg.zip"
curl -fsSL -o ffmpeg-arm64/versions.txt "${base}/versions.txt"
curl -fsSL -o ffmpeg-arm64/codecs.txt "${base}/codecs.txt"
(cd ffmpeg-arm64 && unzip -oq ffmpeg.zip)
printf 'ffmpeg %s macos-arm64 (martin-riedl.de): zip %s bytes, ffmpeg %s bytes\n' \
  "$FFMPEG_BUILD" "$(stat -c %s ffmpeg-arm64/ffmpeg.zip)" "$(stat -c %s ffmpeg-arm64/ffmpeg)"
file ffmpeg-arm64/ffmpeg
strings ffmpeg-arm64/ffmpeg | grep -m1 -- '--prefix\|--enable-' || true
cat ffmpeg-arm64/versions.txt
