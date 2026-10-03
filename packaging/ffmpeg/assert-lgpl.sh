#!/usr/bin/env bash
# Fails unless every given ffmpeg-family binary reports the default LGPL-2.1-or-later licence via -L
# and its -buildconf has no GPL, version3 or nonfree switches. See ADR 0003.
set -euo pipefail

readonly LGPL_21_TEXT='GNU Lesser General Public License as published by the Free Software Foundation; either version 2.1 of the License, or (at your option) any later version.'

usage() {
  echo "usage: $(basename "$0") <ffmpeg-binary> [<ffprobe-binary> ...]" >&2
}

normalise() {
  tr -s '[:space:]' ' '
}

check_one() {
  local bin="$1"
  local licence buildconf

  if [[ ! -x "$bin" ]]; then
    echo "assert-lgpl: not an executable: $bin" >&2
    return 1
  fi

  licence="$("$bin" -hide_banner -L 2>&1 | normalise)" || {
    echo "assert-lgpl: $bin -L failed" >&2
    return 1
  }

  case "$licence" in
    *nonfree* | *"not legally redistributable"*)
      echo "assert-lgpl: FAIL $bin: nonfree build, not redistributable" >&2
      return 1
      ;;
    *"GNU General Public License"*)
      echo "assert-lgpl: FAIL $bin: GPL build" >&2
      return 1
      ;;
    *"$LGPL_21_TEXT"*) ;;
    *)
      echo "assert-lgpl: FAIL $bin: -L does not report LGPL-2.1-or-later" >&2
      return 1
      ;;
  esac

  buildconf="$("$bin" -hide_banner -buildconf 2>&1 | normalise)" || {
    echo "assert-lgpl: $bin -buildconf failed" >&2
    return 1
  }

  case "$buildconf" in
    *--enable-gpl* | *--enable-nonfree* | *--enable-version3*)
      echo "assert-lgpl: FAIL $bin: -buildconf enables GPL, nonfree or version3" >&2
      return 1
      ;;
  esac

  echo "assert-lgpl: OK $bin: LGPL-2.1-or-later"
}

main() {
  if [[ $# -eq 0 ]]; then
    usage
    exit 2
  fi
  local status=0
  local bin
  for bin in "$@"; do
    check_one "$bin" || status=1
  done
  exit "$status"
}

main "$@"
