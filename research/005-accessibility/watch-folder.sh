#!/bin/sh
# Read-back check: lists audio files that appear in a folder while you export or bounce.
# Usage: ./watch-folder.sh /path/to/empty/folder [timeoutSeconds]
set -eu
dir="$1"
timeout="${2:-600}"
marker="$(mktemp)"
echo "watching $dir for $timeout s; start the export now"
elapsed=0
last=""
while [ "$elapsed" -lt "$timeout" ]; do
  now="$(find "$dir" -type f -newer "$marker" \( -iname '*.wav' -o -iname '*.aif*' -o -iname '*.caf' -o -iname '*.mp3' -o -iname '*.m4a' \) | sort)"
  if [ -n "$now" ] && [ "$now" = "$last" ]; then
    echo "stable after ${elapsed}s:"
    echo "$now" | while read -r f; do printf '%s\t%s bytes\n' "$f" "$(stat -f %z "$f")"; done
    rm -f "$marker"
    exit 0
  fi
  last="$now"
  sleep 5
  elapsed=$((elapsed + 5))
done
rm -f "$marker"
echo "no stable output within ${timeout}s"
exit 1
