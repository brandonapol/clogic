#!/usr/bin/env bash
# Builds the audio-only, LGPL-only ffmpeg and ffprobe that clogic bundles (ADR 0003, SPIKE-010).
# Target: macOS arm64, deployment target macOS 15.6. See packaging/README.md for what is verified.
set -euo pipefail

readonly FFMPEG_VERSION="9.0.2"
readonly FFMPEG_SHA256="8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e"
readonly FFMPEG_TARBALL="ffmpeg-${FFMPEG_VERSION}.tar.xz"
readonly FFMPEG_URL="https://ffmpeg.org/releases/${FFMPEG_TARBALL}"
readonly MACOS_MIN="15.6"
readonly ISSUES_URL="https://github.com/brandonapol/clogic/issues"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

# shellcheck source=packaging/lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

readonly DEMUXERS="wav,w64,aiff,caf,mp3,mov,flac,ogg,pcm_s16le,pcm_f32le"
readonly DECODERS="pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_f64be,mp3,mp3float,aac,aac_latm,alac,flac,vorbis,opus"
readonly ENCODERS="pcm_s16le,pcm_s24le,pcm_f32le"
readonly MUXERS="wav,pcm_f32le,pcm_s16le,null"
readonly PARSERS="aac,flac,mpegaudio,vorbis,opus"
readonly FILTERS="aresample,aformat,anull,atrim,pan,volume,ebur128,astats,volumedetect,loudnorm,silencedetect,showwavespic,aspectralstats,highpass,lowpass"

LOG_PREFIX="build-lgpl-ffmpeg"
DRY_RUN=0
TARGET="darwin-arm64"

usage() {
  cat <<EOF
usage: $(basename "$0") [--dry-run] [--print-source-offer] [--help]

Builds FFmpeg ${FFMPEG_VERSION} (audio only, LGPL-2.1-or-later) for macOS arm64.

  --dry-run             print the commands for the darwin-arm64 build without running them
  --print-source-offer  print the LGPL source-offer text and exit
  --help                show this help

Environment:
  WORK                          scratch directory (default: a new mktemp -d)
  OUT_DIR                       release artefacts (default: \$WORK/dist)
  CLOGIC_FFMPEG_TARBALL         use this pre-downloaded tarball instead of fetching it (still checksummed)
  CLOGIC_FFMPEG_PROXY_BUILD=1   allow a non-macOS host build as an unverified proxy (Linux x86_64)
EOF
}

host_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  if [[ "$os" == "Darwin" && "$arch" == "arm64" ]]; then
    echo "darwin-arm64"
  elif [[ "${CLOGIC_FFMPEG_PROXY_BUILD:-0}" == "1" && "$os" == "Linux" && "$arch" == "x86_64" ]]; then
    echo "proxy-linux-x86_64"
  else
    die "unsupported host $os $arch; build on an arm64 Mac, or set CLOGIC_FFMPEG_PROXY_BUILD=1 on Linux x86_64 for an unverified proxy build"
  fi
}

cpu_count() {
  case "$TARGET" in
    darwin-arm64) sysctl -n hw.ncpu 2>/dev/null || echo 4 ;;
    *) nproc 2>/dev/null || echo 4 ;;
  esac
}

verify_checksum() {
  local file="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '+ verify sha256 %s %s\n' "$FFMPEG_SHA256" "$(quote_arg "$file")"
    return 0
  fi
  local actual
  actual="$(sha256_of "$file")"
  if [[ "$actual" != "$FFMPEG_SHA256" ]]; then
    die "checksum mismatch for $file: expected $FFMPEG_SHA256, got $actual"
  fi
  log "sha256 OK $actual"
}

target_args() {
  case "$TARGET" in
    darwin-arm64)
      printf '%s\n' \
        "--arch=arm64" \
        "--target-os=darwin" \
        "--cc=clang" \
        "--extra-cflags=-mmacosx-version-min=${MACOS_MIN}" \
        "--extra-ldflags=-mmacosx-version-min=${MACOS_MIN}"
      ;;
    proxy-linux-x86_64)
      printf '%s\n' "--disable-x86asm"
      ;;
  esac
}

configure_args() {
  printf '%s\n' \
    "--disable-gpl" \
    "--disable-nonfree" \
    "--disable-version3" \
    "--disable-autodetect" \
    "--disable-network" \
    "--disable-doc" \
    "--disable-ffplay" \
    "--disable-everything" \
    "--enable-protocol=file,pipe" \
    "--enable-demuxer=${DEMUXERS}" \
    "--enable-decoder=${DECODERS}" \
    "--enable-encoder=${ENCODERS}" \
    "--enable-muxer=${MUXERS}" \
    "--enable-parser=${PARSERS}" \
    "--enable-filter=${FILTERS}" \
    "--enable-static" \
    "--disable-shared"
  target_args
}

assert_no_forbidden_flags() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --enable-gpl | --enable-nonfree | --enable-version3)
        die "forbidden configure flag $arg (ADR 0003)"
        ;;
    esac
  done
}

source_offer() {
  local configure_line="$1"
  cat <<EOF
FFmpeg source offer (LGPL-2.1-or-later)

This clogic release includes the ffmpeg and ffprobe executables from FFmpeg ${FFMPEG_VERSION}
(https://ffmpeg.org), licensed under the GNU Lesser General Public License, version 2.1 or (at your
option) any later version. clogic runs them as separate programs and does not link against FFmpeg
libraries.

The complete corresponding source code is the unmodified official release tarball:

  ${FFMPEG_TARBALL}
  ${FFMPEG_URL}
  SHA-256 ${FFMPEG_SHA256}

clogic publishes that tarball, this notice, the LGPL-2.1 licence text (COPYING.LGPLv2.1) and the exact
build configuration (ffmpeg-buildconf.txt) on the same release page and download host as the clogic
binary. No patches are applied. The binaries were configured with:

  ./configure ${configure_line}

If you cannot find these files, open an issue at ${ISSUES_URL} and we will provide them.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project. clogic is not affiliated
with or endorsed by the FFmpeg project.
EOF
}

main() {
  local print_offer=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --print-source-offer) print_offer=1 ;;
      --help | -h)
        usage
        exit 0
        ;;
      *)
        usage >&2
        exit 2
        ;;
    esac
    shift
  done

  local work out_dir prefix src
  if [[ "$DRY_RUN" -eq 1 || "$print_offer" -eq 1 ]]; then
    work="${WORK:-<WORK>}"
  else
    TARGET="$(host_target)"
    work="${WORK:-$(mktemp -d)}"
  fi
  out_dir="${OUT_DIR:-$work/dist}"
  prefix="$work/out"
  src="$work/ffmpeg-${FFMPEG_VERSION}"

  local args=()
  local line
  while IFS= read -r line; do
    args+=("$line")
  done < <(configure_args)
  assert_no_forbidden_flags "${args[@]}"

  local configure_line="${args[*]}"

  if [[ "$print_offer" -eq 1 ]]; then
    source_offer "$configure_line"
    exit 0
  fi

  log "FFmpeg ${FFMPEG_VERSION} target=${TARGET} work=${work} dry_run=${DRY_RUN}"

  run mkdir -p "$work" "$out_dir"
  if [[ -n "${CLOGIC_FFMPEG_TARBALL:-}" ]]; then
    run cp "$CLOGIC_FFMPEG_TARBALL" "$work/$FFMPEG_TARBALL"
  else
    run curl -fsSL -o "$work/$FFMPEG_TARBALL" "$FFMPEG_URL"
  fi
  verify_checksum "$work/$FFMPEG_TARBALL"
  run tar -xJf "$work/$FFMPEG_TARBALL" -C "$work"

  run_in "$src" ./configure "--prefix=$prefix" "${args[@]}"
  run_in "$src" make -j"$(cpu_count)"
  run_in "$src" make install
  run strip "$prefix/bin/ffmpeg" "$prefix/bin/ffprobe"

  run "$SCRIPT_DIR/assert-lgpl.sh" "$prefix/bin/ffmpeg" "$prefix/bin/ffprobe"

  run cp "$prefix/bin/ffmpeg" "$prefix/bin/ffprobe" "$out_dir/"
  run cp "$src/COPYING.LGPLv2.1" "$work/$FFMPEG_TARBALL" "$out_dir/"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '+ %s -hide_banner -buildconf > %s\n' "$(quote_arg "$prefix/bin/ffmpeg")" "$(quote_arg "$out_dir/ffmpeg-buildconf.txt")"
    printf '+ write source offer > %s\n' "$(quote_arg "$out_dir/SOURCE-OFFER.txt")"
    printf '\n'
    source_offer "$configure_line"
    return 0
  fi

  "$prefix/bin/ffmpeg" -hide_banner -buildconf >"$out_dir/ffmpeg-buildconf.txt"
  source_offer "$configure_line" >"$out_dir/SOURCE-OFFER.txt"

  log "artefacts in $out_dir"
  file "$out_dir/ffmpeg" "$out_dir/ffprobe" >&2 || true
  printf 'ffmpeg %s bytes, ffprobe %s bytes (stripped, target %s)\n' \
    "$(wc -c <"$out_dir/ffmpeg" | tr -d ' ')" "$(wc -c <"$out_dir/ffprobe" | tr -d ' ')" "$TARGET"
}

main "$@"
