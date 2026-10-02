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
- [ ] Spectral balance: FFT in TS (or a WASM library) to get energy per band, e.g. sub / low / low-mid /
      mid / high-mid / air.
- [ ] Reference matching: diff the spectral curve and loudness of a mix against a user-supplied reference
      track.
- [ ] Stereo: correlation, mid/side ratio, width per band, mono compatibility.
- [ ] Dynamics: crest factor, PLR (peak to loudness ratio), and an estimate of how much compression or
      limiting has been applied.
- [ ] Stem masking: find frequency regions where two stems both carry high energy at the same time (e.g.
      kick vs. bass, guitars vs. vocals).
- [ ] Performance: time to analyse a 4-minute stereo 48 kHz file and a 30-stem folder.
- [ ] Output shape: design a typed `AnalysisReport` that an LLM can reason over (numbers plus labelled
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

_TBD_
