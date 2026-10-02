#!/usr/bin/env bash
set -euo pipefail

out="${1:-fixtures/audio/spike-001}"
mkdir -p "$out/stems"

ffmpeg -v error -y -f lavfi -i "anoisesrc=c=pink:r=48000:a=0.3:d=240:seed=1,aformat=channel_layouts=mono" \
  -f lavfi -i "anoisesrc=c=pink:r=48000:a=0.3:d=240:seed=2,aformat=channel_layouts=mono" \
  -filter_complex "[0][1]amerge=inputs=2,pan=stereo|c0=0.8*c0+0.2*c1|c1=0.2*c0+0.8*c1" \
  -c:a pcm_s24le "$out/mix-4min-48k.wav"

for i in $(seq -w 1 30); do
  hz=$((40 * 10#$i))
  ffmpeg -v error -y -f lavfi \
    -i "aevalsrc=0.3*sin(2*PI*${hz}*t)*(0.5+0.5*sin(2*PI*0.5*t))|0.3*sin(2*PI*${hz}*t):s=48000:d=240" \
    -c:a pcm_s24le "$out/stems/stem-$i.wav"
done

echo "wrote $out/mix-4min-48k.wav and 30 stems in $out/stems"
