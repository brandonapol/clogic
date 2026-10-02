# SPIKE-001 prototype: offline analysis CLI

Throwaway scripts for [SPIKE-001](../../docs/research/001-offline-audio-analysis.md). Never imported by
`src/`. They use the built analysis core in `dist/`.

```sh
npm run build
node research/001-offline-analysis/analyse.ts path/to/mix.wav
node research/001-offline-analysis/analyse.ts path/to/mix.wav --reference path/to/reference.wav
node research/001-offline-analysis/analyse.ts path/to/stems/

# synthetic 4-minute mix and 30 stems for timing, written to fixtures/audio (git-ignored)
research/001-offline-analysis/make-fixtures.sh
```

Requires Node 22+ (type stripping is on by default from Node 23.6; on Node 22 add
`--experimental-strip-types`) and `ffmpeg` / `ffprobe` on `PATH`.
