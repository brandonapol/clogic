# SPIKE-001: Offline mix and stem analysis

Issue: [#1](https://github.com/brandonapol/clogic/issues/1)

## Question

Can we analyse a bounced mix and its stems from TypeScript accurately enough to give trustworthy,
specific mixing and mastering advice?

## Why it matters

This is the surface that does not depend on Apple at all. If it works, the assistant is useful on day one:
bounce, analyse, get advice, apply it by hand in Logic.

## Timebox

2 days

## Investigate

- [ ] Decoding: `ffmpeg` as a child process (bundled by the installer, see SPIKE-010) vs. pure JS / WASM
      decoders. Compare WAV, AIFF, CAF (Logic's
      default bounce formats), and check 24-bit and 32-bit float support.
- [ ] Loudness: integrated / short-term / momentary LUFS, loudness range (LRA) and true peak via
      `ffmpeg -af ebur128=peak=true`. Compare the numbers with Logic's Loudness Meter on the same file.
- [x] Spectral balance: FFT in TS (or a WASM library) to get energy per band, e.g. sub / low / low-mid /
      mid / high-mid / air.
- [x] Reference matching: diff the spectral curve and loudness of a mix against a user-supplied reference
      track.
- [x] Stereo: correlation, mid/side ratio, width per band, mono compatibility.
- [x] Dynamics: crest factor, PLR (peak to loudness ratio), and an estimate of how much compression or
      limiting has been applied.
- [x] Stem masking: find frequency regions where two stems both carry high energy at the same time (e.g.
      kick vs. bass, guitars vs. vocals).
- [x] Performance: time to analyse a 4-minute stereo 48 kHz file and a 30-stem folder.
- [x] Output shape: design a typed `AnalysisReport` that an LLM can reason over (numbers plus labelled
      findings, not raw arrays).

## Done when

- A throwaway script prints an `AnalysisReport` for a mix and for a folder of stems
- LUFS and true peak are within ±0.5 LU / ±0.3 dB of Logic's Loudness Meter on at least 3 test files
- Confirmation that the bundled ffmpeg covers every decoding and loudness need, or what pure TS / WASM
  must fill in

## Risks / unknowns

- Masking detection may produce noisy false positives without perceptual weighting
- Bundled ffmpeg size and licence (see SPIKE-010)

## Findings

Date: 2026-10-02. Status: **partial**. Everything below was done on Linux without a Mac or Logic Pro, so
nothing here has been compared with Logic's Loudness Meter yet.

### Environment

| Item     | Version                                                                  |
| -------- | ------------------------------------------------------------------------ |
| OS       | Linux 7.2.5 (Arch-based), Intel Core Ultra 7 355, 8 threads, 30 GB RAM   |
| Node     | v26.8.2                                                                  |
| ffmpeg   | n9.0.1 (`ffmpeg -version`), ffprobe n9.0.1                               |
| Code     | `src/analysis/` (core + adapter), `research/001-offline-analysis/` (CLI) |
| Standard | EBU Tech 3341 (Nov 2023), EBU Tech 3342 (Nov 2023)                       |

### What was built

- `src/analysis/adapter.ts` is the only module that spawns `ffmpeg` / `ffprobe` or touches the file
  system. It returns `Result` values (`tool-missing`, `tool-failed`, `no-audio-stream`, `empty-audio`,
  ...) instead of throwing.
- Pure core: ffprobe JSON parsing (`probe.ts`), `ebur128` log parsing (`loudness.ts`), FFT and band
  features (`fft.ts`, `features.ts`), report building and labelled findings (`report.ts`,
  `findings.ts`), stem masking (`masking.ts`) and reference comparison (`reference.ts`).
- `AnalysisReport` = source info + loudness (I, max S, max M, LRA, true peak) + spectral balance in six
  bands (sub 20-60, low 60-250, low-mid 250-500, mid 500-2k, high-mid 2k-6k, air 6k-20k Hz; RMS level
  and share of total energy) + stereo image (`{ kind: 'mono' }` or correlation, side/mid ratio, mono-sum
  loss, per-band correlation and width) + dynamics (sample peak, RMS, crest factor, PLR, PSR, a coarse
  compression label) + `findings` (severity, code, sentence). `StemsReport` adds per-stem reports and
  masking conflicts. Numbers are rounded and dB values are clamped to ±150 so the JSON never contains
  `Infinity` or `null` for silence.
- `research/001-offline-analysis/analyse.ts` prints either report as JSON:
  `npm run build && node research/001-offline-analysis/analyse.ts <file | stem-folder> [--reference f]`.
- Tests: `test/analysis/*.test.ts`. Fixtures are generated at test time with `ffmpeg -f lavfi`; the
  ffmpeg-dependent suites are skipped when `ffmpeg` / `ffprobe` are not on `PATH` (checked by running
  the suite with a `PATH` containing only `node`: 46 passed, 20 skipped).

### Verified against reference signals (ffmpeg `ebur128`, this machine)

| Signal (generated with `aevalsrc`)                   | Spec expectation          | Measured        |
| ---------------------------------------------------- | ------------------------- | --------------- |
| Tech 3341 #1: stereo 1 kHz, −23 dBFS, 20 s           | M, S, I = −23.0 ±0.1 LUFS | −23.0 (M, S, I) |
| Tech 3341 #2: stereo 1 kHz, −33 dBFS, 20 s           | I = −33.0 ±0.1 LUFS       | −33.0           |
| Tech 3342 #1: 20 s at −20 dBFS then 20 s at −30 dBFS | LRA = 10 ±1 LU            | 10.0 LU         |
| Tech 3341 #15: fs/4, 0.50 FFS, 0°, 10 ms tapers      | −6.0 +0.2/−0.4 dBTP       | −6.0            |
| Tech 3341 #16: fs/4, 0.50 FFS, 45°, 10 ms tapers     | −6.0 +0.2/−0.4 dBTP       | −6.0            |
| Tech 3341 #17: fs/6, 0.50 FFS, 60°                   | −6.0 +0.2/−0.4 dBTP       | −6.0            |
| Tech 3341 #18: fs/8, 0.50 FFS, 67.5°                 | −6.0 +0.2/−0.4 dBTP       | −6.0            |
| Tech 3341 #19: fs/4, 1.41 FFS, 45°                   | +3.0 +0.2/−0.4 dBTP       | +3.0            |
| 1 kHz sine at 0.1 FFS (−20 dBFS), mono               | peak −20, RMS −23, CF 3   | −20 / −23 / 3.0 |

Each row is an automated test in `test/analysis/adapter.test.ts` or `test/analysis/analyse.test.ts`.
Command used to read the summary by hand:

```sh
ffmpeg -hide_banner -nostats -i file.wav -af ebur128=peak=true:framelog=info -f null -
```

Notes:

- `aevalsrc` must be used rather than `sine`, whose default amplitude is 1/8 (−18.06 dBFS): a
  `sine=1000` source at `volume=-23dB` reads −41.1 LUFS, not −23.
- Without the 10 ms fade-in / fade-out the spec asks for, case #16 reads **−5.4 dBTP** (0.6 dB high)
  because the abrupt onset creates real inter-sample overshoot. With the tapers it reads −6.0. This is
  correct meter behaviour, but it means true peak on hard-edited material can read above a steady-state
  expectation.
- Pure-TS measures were checked with in-memory synthetic signals (`test/analysis/report.test.ts`):
  a 100 Hz sine lands in `low` at its RMS level, white noise splits by bandwidth (±1 dB), identical
  channels give correlation 1 and 0 dB mono loss, independent noise gives correlation ≈ 0 and −3 dB
  mono loss, polarity-inverted channels give correlation −1 and full cancellation, and 90° out-of-phase
  80 Hz is flagged as `wide-low-end`.

### Decoding

ffmpeg 9.0.1 decoded every format tested (`test/analysis/adapter.test.ts`, 0.5 s stereo tones, peak
level checked to 3 decimals): WAV 16-bit, 24-bit and 32-bit float; AIFF 24-bit and 32-bit float; CAF
24-bit and 32-bit float; ALAC 24-bit in `.m4a` and `.caf`. ffprobe reports `bits_per_raw_sample` (or
`bits_per_sample` for float) correctly for all of them. 5.1 files are downmixed to stereo with `-ac 2`
for the spectral / stereo pass; loudness is measured on the original layout.

**ALAC in CAF short decode (resolved 2026-10-03, ffmpeg n9.0.1, Linux).** ALAC in a CAF container
written by ffmpeg used to decode 576 frames short (23,424 of 24,000; the same audio in `.m4a` decoded in
full). Reproduce:

```sh
S='aevalsrc=0.5*sin(2*PI*1000*t)|0.25*sin(2*PI*1000*t):s=48000:d=0.5'
ffmpeg -v error -f lavfi -i "$S" -c:a alac -sample_fmt s32p a.caf
ffmpeg -v error -i a.caf -f f32le - | wc -c                       # 187392 bytes = 23424 frames
ffprobe -v error -show_entries stream=duration_ts,nb_frames -of compact a.caf  # duration_ts=24000
ffprobe -v error -show_packets -of compact a.caf | tail -1
# last packet: duration=3520, side_datum/skip_samples:discard_padding=576
ffmpeg -v error -flags2 +skip_manual -i a.caf -af atrim=end_sample=24000 -f f32le - | wc -c  # 24000 frames
```

Root cause: the trailing padding is removed twice. The CAF `pakt` chunk declares 6 packets, 24,000
valid frames, 0 priming and 576 remainder frames (6 × 4096 − 24,000). ffmpeg's CAF demuxer turns the
remainder into `discard_padding=576` on the last packet, but the ALAC bitstream's last frame already
holds only the 3,520 real samples, so the decoder drops 576 real samples on top. Probing is not the
problem: ffprobe reports the correct 0.5 s / 24,000 frames from the packet table; only decoding is short.
The `.m4a` muxer writes no discard padding, so it decodes in full. Loudness was affected too, because
`ebur128` runs on the same decode.

Fix (`src/analysis/adapter.ts`): for ALAC in CAF, both the PCM decode and the `ebur128` pass use
`-flags2 +skip_manual` (the decoder does not apply skip / discard side data) followed by
`atrim=end_sample=<frames from probe>`. That is correct both for this ffmpeg-written file and for a CAF
whose last ALAC packet is a full 4,096 frames with the padding as real samples. It assumes zero priming,
which holds for ALAC (no encoder delay; `pakt` priming is 0 here). `skip_manual` is **not** used for
other codecs: on MP3 and AAC it keeps the encoder delay (25,344 and 25,600 frames instead of 24,000).
As a guard, any PCM / ALAC / FLAC decode more than one frame shorter than the probed length returns a
`short-decode` error value instead of analysing truncated audio; lossy codecs are not checked because
their probed duration can be an estimate. Covered by `test/analysis/adapter.test.ts` ("decodes caf alac
24-bit", "measures CAF ALAC loudness including the final packet", "decode length checks").

Whether Logic-written ALAC CAF files hit the same double trim is still unknown and needs a real Logic
bounce. All test files were written by ffmpeg, not Logic, so Logic's own WAV / AIFF / CAF headers (e.g.
extra chunks) are untested.

A pure JS / WASM decoder was **not** evaluated: ffmpeg already covers decoding and loudness, so the only
reason to replace it is the bundling / licence question in SPIKE-010 / SPIKE-011.

### Performance

Measured with `research/001-offline-analysis/make-fixtures.sh` (pink-noise 4-minute stereo 48 kHz
24-bit WAV, and 30 four-minute stereo stems) and the CLI's wall-clock timer:

| Job                             | Time   | Breakdown                                                        |
| ------------------------------- | ------ | ---------------------------------------------------------------- |
| 4-min stereo mix                | 4.0 s  | `ebur128` with true peak 1.7 s (0.45 s without), decode 0.17 s   |
| 30 stems × 4 min, concurrency 4 | 72.9 s | TS spectral pass ≈1.7 s per stem, single-threaded; masking 0.9 s |

The TS spectral pass (8192-point FFT, 50 % overlap, both channels packed into one complex FFT) is the
bottleneck for stems because it runs on the main thread; ffmpeg processes run in parallel. Moving it to
`worker_threads` (or WASM) should bring 30 stems well under 30 s on this machine. Not done in this spike.

### Masking

Per stem, mid-channel energy in 30 third-octave bands per 85 ms frame. A band is "prominent" in a frame
if it is above −70 dBFS and within 15 dB of that frame's loudest band. Two stems conflict in a band when
both are prominent in at least 50 % of the frames where either is, and in at least 10 % of all frames.
Adjacent conflicting bands are merged and reported with the louder stem and the mean level difference.
Synthetic tests: kick vs bass at 60-80 Hz is found, bass vs hats and a sine vs near-silent noise are
not. This is a heuristic without perceptual weighting or spreading functions, so expect false positives
on dense real mixes; it needs tuning on real multitracks.

### Thresholds used for findings (conventions, not Logic behaviour)

True peak above −1 dBTP (warning) or 0 dBTP (problem); sample peak at 0 dBFS (clipping); informational
offset from a −14 LUFS normalisation target for mixes; PLR below 8 dB = heavy limiting (compression
label: < 8 heavy, < 11 moderate, < 14 light, else minimal); correlation < 0 problem, < 0.2 warning;
mono-sum loss worse than −4.5 dB; sub / low bands with side within 10 dB of mid and correlation < 0.5.
These are common mastering conventions chosen for the spike; they are constants in `findings.ts` and
`report.ts` and should be reviewed by someone who mixes before they reach users.

### Still needs a Mac with Logic Pro

1. Bounce at least 3 files from Logic (WAV, AIFF, CAF; 24-bit and 32-bit float) and compare integrated
   LUFS, short-term max, LRA and true peak with Logic's Loudness Meter. Done-when target: ±0.5 LU /
   ±0.3 dB. **Not yet verified.**
2. Check Logic-written CAF (PCM and ALAC) decodes in full with the bundled ffmpeg.
3. Run the stem CLI on a real Logic "Export All Tracks as Audio Files" folder to tune masking thresholds.

### Verdict

**Partial go.** ffmpeg (decode + `ebur128`) plus a pure-TS FFT core covers every analysis need in this
spike, and the loudness / true-peak path matches the EBU Tech 3341 / 3342 reference signals exactly on
this machine. The ±0.5 LU / ±0.3 dB agreement with Logic's Loudness Meter remains unverified until
someone runs the steps above on a Mac.
