# SPIKE-010: Installer, ffmpeg bundling and distribution

## Question

Can we ship a single installer that puts the plugin where Logic finds it, installs the companion service
and ffmpeg, and needs no terminal or Homebrew?

## Why it matters

It should install like any other Logic plugin. The user should never need to know ffmpeg exists.

## Timebox

1.5 days

## Investigate

- [ ] Installer format: signed `.pkg` installing the AU component to `/Library/Audio/Plug-Ins/Components`
      (or the user Library), plus the companion service and its `launchd` agent.
- [ ] Logic's plugin scan: confirm Logic picks up the new AU after install and that it passes validation
      in the Plug-in Manager.
- [ ] Companion runtime: ship Node as a single executable (Node SEA or Bun compile) so the user does not
      need Node installed. Check the size.
- [ ] ffmpeg: bundle a static universal (arm64 + x86_64) binary inside the app bundle. Check the licence:
      an LGPL-only build is safer to redistribute than a GPL build. List the codecs actually needed
      (WAV, AIFF, CAF, MP3, AAC, FLAC for reference tracks).
- [ ] Code signing and notarisation for the AU, the companion binary, and the bundled ffmpeg (every
      Mach-O binary must be signed). Requires an Apple Developer account.
- [ ] First-run flow: permissions (Accessibility, MIDI), API key prompt (SPIKE-009), control surface
      registration (SPIKE-004) if that can be automated.
- [ ] Updates: an auto-update mechanism (e.g. Sparkle) vs. manual reinstall.
- [ ] Uninstaller.
- [ ] CI: build and notarise on a macOS GitHub Actions runner.

## Done when

- A signed and notarised `.pkg` installs on a clean Mac, Logic finds the plugin, and the companion can
  run the bundled ffmpeg
- A licence note for every bundled third-party binary
- An estimate of the installer size

## Risks / unknowns

- Notarisation and Gatekeeper rejections for unsigned nested binaries
- ffmpeg licensing if GPL components are needed

## Findings

_TBD_
