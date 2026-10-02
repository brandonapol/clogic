# 0003: LGPL-only ffmpeg build with source offer

- Status: accepted
- Date: 2026-10-02
- Related: SPIKE-010, SPIKE-011, SPIKE-001

## Context

Audio analysis needs ffmpeg, bundled so users install nothing. SPIKE-010 found that every prebuilt macOS
ffmpeg it checked is a GPL build ([findings](../research/010-installer-and-distribution.md)), and that a
minimal audio-only LGPL build is about 5 MB. SPIKE-011 found that the default build is LGPL-2.1+, that
`--enable-gpl` makes the whole build GPL, that `--enable-nonfree` is not redistributable, and that the GPL-only
parts are video filters and x86 assembly, not the audio analysis filters
([findings](../research/011-legal-and-licensing.md)).

## Decision

- Build ffmpeg ourselves from a pinned release, LGPL-only: no `--enable-gpl`, no `--enable-nonfree`, audio
  decoders and filters only, no external libraries.
- Run it as a separate executable, never link its libraries.
- Record `ffmpeg -buildconf` in the repository.
- Ship the licence text, configure line and corresponding source (or an equivalent source offer) from the
  same download host as the binary.
- Attribute FFmpeg under LGPLv2.1 in download pages, the About box and the EULA. The EULA must not forbid
  reverse engineering of the ffmpeg binary.
- Sign and notarise the binary with the rest of the app.

## Consequences

- We own a build recipe and the duty to host source for every release.
- Any codec needing GPL or non-free components is out of scope.
- Patent exposure for AAC / MP3 decoding remains an open item in SPIKE-011.
- Compatible with the Apache-2.0 repository licence ([0002](./0002-apache-2-0-licence.md)) because ffmpeg is a
  separate executable.
