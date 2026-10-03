# shellcheck shell=bash
# Shared helpers for packaging scripts. Source it; do not execute it.
# Callers set DRY_RUN=0|1 and LOG_PREFIX before using run / run_in / die.

quote_arg() {
  local safe='^[A-Za-z0-9_@%+=:,./<>-]+$'
  if [[ "$1" =~ $safe ]]; then
    printf '%s' "$1"
  else
    printf '%q' "$1"
  fi
}

print_cmd() {
  local first=1
  local arg
  for arg in "$@"; do
    if [[ "$first" -eq 1 ]]; then
      first=0
    else
      printf ' '
    fi
    quote_arg "$arg"
  done
}

log() {
  printf '==> %s\n' "$*" >&2
}

die() {
  printf '%s: %s\n' "${LOG_PREFIX:-packaging}" "$*" >&2
  exit 1
}

run() {
  if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
    printf '+ %s\n' "$(print_cmd "$@")"
  else
    "$@"
  fi
}

run_in() {
  local dir="$1"
  shift
  if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
    printf '+ (cd %s && %s)\n' "$(quote_arg "$dir")" "$(print_cmd "$@")"
  else
    (cd "$dir" && "$@")
  fi
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}
