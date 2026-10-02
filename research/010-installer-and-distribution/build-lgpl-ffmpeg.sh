#!/usr/bin/env bash
set -euo pipefail

FFMPEG_VERSION="${FFMPEG_VERSION:-9.0.2}"
WORK="${WORK:-$(mktemp -d)}"
PREFIX="$WORK/out"

cd "$WORK"
echo "work dir: $WORK"
curl -fsSLO "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
tar -xJf "ffmpeg-${FFMPEG_VERSION}.tar.xz"
cd "ffmpeg-${FFMPEG_VERSION}"

DEMUXERS=wav,w64,aiff,caf,mp3,mov,flac,ogg,pcm_s16le,pcm_f32le
DECODERS=pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_f64be,mp3,mp3float,aac,aac_latm,alac,flac,vorbis,opus
ENCODERS=pcm_s16le,pcm_s24le,pcm_f32le
MUXERS=wav,pcm_f32le,pcm_s16le,null,null
PARSERS=aac,flac,mpegaudio,vorbis,opus
FILTERS=aresample,aformat,anull,atrim,pan,volume,ebur128,astats,volumedetect,loudnorm,silencedetect,showwavespic,aspectralstats,highpass,lowpass

./configure \
  --prefix="$PREFIX" \
  --disable-gpl --disable-nonfree --disable-version3 \
  --disable-autodetect --disable-network --disable-doc \
  --disable-ffplay --disable-x86asm \
  --disable-everything \
  --enable-protocol=file,pipe \
  --enable-demuxer="$DEMUXERS" \
  --enable-decoder="$DECODERS" \
  --enable-encoder="$ENCODERS" \
  --enable-muxer="$MUXERS" \
  --enable-parser="$PARSERS" \
  --enable-filter="$FILTERS" \
  --enable-static --disable-shared \
  | tail -n 20

make -j"$(nproc)" >/dev/null
make install >/dev/null
strip "$PREFIX/bin/ffmpeg" "$PREFIX/bin/ffprobe"

"$PREFIX/bin/ffmpeg" -hide_banner -L | head -n 3
"$PREFIX/bin/ffmpeg" -hide_banner -buildconf | head -n 5
printf 'ffmpeg %s bytes, ffprobe %s bytes (stripped, %s)\n' \
  "$(stat -c %s "$PREFIX/bin/ffmpeg")" "$(stat -c %s "$PREFIX/bin/ffprobe")" "$(uname -m)"
