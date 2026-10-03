# Packaging

Maintained scripts that build what the clogic installer ships. They replace the throwaway prototypes in
[`research/010-installer-and-distribution/`](../research/010-installer-and-distribution/) and follow
[SPIKE-010](../docs/research/010-installer-and-distribution.md),
[ADR 0003 (LGPL-only ffmpeg)](../docs/decisions/0003-lgpl-only-ffmpeg-build.md) and
[ADR 0002 (Apache-2.0)](../docs/decisions/0002-apache-2-0-licence.md).

> **Status: unverified on macOS.** These scripts were written and tested on Linux. No step that needs a
> Mac, Xcode or a Developer ID certificate has been run. Each such step is tied below to a check in
> [`docs/research/mac-checklist.md`](../docs/research/mac-checklist.md). Treat the `.pkg` script as a
> reviewed skeleton, not a working release pipeline, until those checks pass.

| Path                                      | What it does                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ffmpeg/build-lgpl-ffmpeg.sh`             | Builds pinned FFmpeg 9.0.2, audio only, LGPL-2.1-or-later, for macOS arm64; emits the source offer |
| `ffmpeg/assert-lgpl.sh`                   | Fails unless each binary's `-L` is the LGPL-2.1 text and `-buildconf` has no GPL / nonfree flags   |
| `pkg/build-pkg.sh`                        | Skeleton: stage, sign inside out, `pkgbuild` + `productbuild`, `notarytool`, `stapler`, `spctl`    |
| `pkg/entitlements/companion.entitlements` | Hardened runtime entitlements for the companion: `com.apple.security.cs.allow-jit` only            |
| `lib/common.sh`                           | Shared `run` / `--dry-run` helpers                                                                 |

Every script takes `--dry-run`, which prints each command (prefixed `+ `) instead of running it, and
`--help`. Dry runs work on any OS and need no credentials.

## ffmpeg

```sh
packaging/ffmpeg/build-lgpl-ffmpeg.sh --dry-run             # print the darwin-arm64 build
WORK=~/clogic-build/ffmpeg packaging/ffmpeg/build-lgpl-ffmpeg.sh   # on an arm64 Mac
packaging/ffmpeg/build-lgpl-ffmpeg.sh --print-source-offer  # text for the release page
```

What the script guarantees:

- **Pinned source.** `FFMPEG_VERSION` and `FFMPEG_SHA256` are constants, changed together in a reviewed
  commit. The tarball's SHA-256 is checked before it is extracted; a mismatch stops the build.
  `CLOGIC_FFMPEG_TARBALL=<path>` uses a cached tarball, still checksummed.
- **LGPL only.** The configure line passes `--disable-gpl --disable-nonfree --disable-version3`, and the
  script refuses to run if `--enable-gpl`, `--enable-nonfree` or `--enable-version3` ever appear in it.
- **Audio only, no autodetected libraries.** `--disable-everything --disable-autodetect
--disable-network` plus the SPIKE-010 allow list of demuxers, decoders, parsers and filters. SPIKE-001
  owns that list; every addition must keep `assert-lgpl.sh` passing.
- **Post-build licence assertion.** `assert-lgpl.sh` runs `ffmpeg -L` and `ffprobe -L` and requires the
  exact LGPL-2.1-or-later wording (whitespace-normalised) from FFmpeg's `fftools/opt_common.c`. It
  rejects GPL, LGPLv3 and nonfree builds, and any `-buildconf` with GPL / nonfree / version3 switches.
- **Release artefacts** in `$OUT_DIR` (default `$WORK/dist`): `ffmpeg`, `ffprobe`,
  `ffmpeg-buildconf.txt`, `COPYING.LGPLv2.1`, the source tarball and `SOURCE-OFFER.txt`. ADR 0003
  requires all but the binaries to be published next to each release.

Target flags: `--arch=arm64 --target-os=darwin --cc=clang` and `-mmacosx-version-min=15.6` (Logic
Pro's minimum, SPIKE-010). No universal binary.

The script refuses any host other than macOS arm64. `CLOGIC_FFMPEG_PROXY_BUILD=1` on Linux x86_64 runs
the same recipe with `--disable-x86asm` as an unverified proxy, which is how the Linux results below
were produced.

## pkg

```sh
packaging/pkg/build-pkg.sh --dry-run    # print every step with <PLACEHOLDER> values
```

On a Mac, all inputs come from the environment. Signing identities and the notary profile are never
written in the repository; the tests fail if a literal identity appears in the script.

| Variable                          | Meaning                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `CLOGIC_DEVELOPER_ID_APPLICATION` | `codesign` identity: `Developer ID Application: <name> (<team id>)`                          |
| `CLOGIC_DEVELOPER_ID_INSTALLER`   | `productbuild` identity: `Developer ID Installer: <name> (<team id>)`                        |
| `CLOGIC_NOTARY_PROFILE`           | Keychain profile saved with `xcrun notarytool store-credentials` (App Store Connect API key) |
| `CLOGIC_PKG_ID_PREFIX`            | Reverse-DNS prefix for package identifiers. The product name is not decided yet              |
| `CLOGIC_VERSION`                  | Package version                                                                              |
| `CLOGIC_APP`                      | Built `clogic.app` (Swift shell, SPIKE-003 / SPIKE-007)                                      |
| `CLOGIC_COMPANION_BIN`            | Companion single executable (Node SEA, SPIKE-010)                                            |
| `CLOGIC_FFMPEG_DIR`               | `OUT_DIR` from `build-lgpl-ffmpeg.sh`                                                        |
| `CLOGIC_COMPONENT`                | Optional AUv2 `clogic.component` (the SPIKE-007 fallback; AUv3 lives inside the app)         |

`--skip-notarize` stops after `productbuild` for local test builds.

### Component layout

```text
/Applications/clogic.app
  Contents/Helpers/clogic-companion                     hardened runtime + companion.entitlements
  Contents/Helpers/ffmpeg, ffprobe                      hardened runtime, no entitlements
  Contents/Resources/ThirdParty/FFmpeg/                 COPYING.LGPLv2.1, SOURCE-OFFER.txt, ffmpeg-buildconf.txt
/Library/Audio/Plug-Ins/Components/clogic.component     only if CLOGIC_COMPONENT is set
```

`Contents/Helpers/` follows Apple's "Placing content in a bundle" table as cited in SPIKE-010. SPIKE-003
proposes a nested `clogic Helper.app` for SMAppService instead; if that lands, move the helpers and add a
signing step for the nested app before the outer app.

### Order of operations

1. Stage the layout above with `ditto`.
2. `assert-lgpl.sh` on the staged ffmpeg and ffprobe.
3. Sign inside out, each item separately, never `codesign --deep` to sign: ffmpeg, ffprobe, companion
   (with entitlements), then `clogic.app`, then the component. All with `--timestamp`; Mach-O code with
   `--options runtime`.
4. `codesign --verify --strict --deep` (verification only) and show the companion's entitlements.
5. `pkgbuild --analyze`, set `BundleIsRelocatable` to `NO` with `plutil`, then `pkgbuild` per component.
6. Generate `Distribution.xml` (arm64, macOS 15.6+, EULA placeholder) and `productbuild --sign` with the
   Installer identity; `pkgutil --check-signature`.
7. `xcrun notarytool submit --wait --output-format json`; fail unless the status is `Accepted`. Only the
   outermost container is notarised.
8. `xcrun stapler staple`, `stapler validate`, `spctl --assess --type install`.

There is no `postinstall` script. SPIKE-010 says to keep it minimal and to register the launch agent with
`SMAppService` from the app, not from the installer. Restarting `AudioComponentRegistrar` is only a
candidate, pending MAC-43.

## What has been verified

On Linux x86_64 (2026-10-03; see
[the research note](../docs/research/notes/packaging-2026-10-03-scripts.md)):

| Check                                                                                     | Result   |
| ----------------------------------------------------------------------------------------- | -------- |
| `shellcheck` 0.11.0 on every script                                                       | Clean    |
| Pinned SHA-256 matches the tarball, and the tarball's FFmpeg release-key GPG signature    | Verified |
| Proxy build (`CLOGIC_FFMPEG_PROXY_BUILD=1`): checksum, configure, build, `assert-lgpl.sh` | Passes   |
| Proxy build size, stripped: `ffmpeg` 4,988,440 bytes, `ffprobe` 4,775,264 bytes           | Measured |
| Proxy build decodes a WAV and runs `ebur128`                                              | Works    |
| `--dry-run` output, signing order, env-only identities, licence assertion (Vitest)        | Tested   |

Tests: `test/packaging/assert-lgpl.test.ts`, `test/packaging/build-lgpl-ffmpeg.test.ts`,
`test/packaging/build-pkg.test.ts`. They run the scripts through `bash`, so they need no Mac.

## What has not been verified

Everything that needs macOS. Each item maps to a Mac checklist entry:

| Unverified                                                                                               | Mac check      |
| -------------------------------------------------------------------------------------------------------- | -------------- |
| The darwin-arm64 configure flags build with Apple clang; NEON asm on; binary size; `file` says arm64     | MAC-39         |
| `assert-lgpl.sh` on the real macOS binaries                                                              | MAC-39         |
| Companion runs under hardened runtime with `allow-jit` only                                              | MAC-40         |
| `codesign` commands and order accepted; `codesign --verify --strict` passes on the staged app            | MAC-40, MAC-43 |
| `pkgbuild --analyze` plist shape (`0.BundleIsRelocatable` key path) and the generated `Distribution.xml` | MAC-43         |
| `notarytool --output-format json` status field, `stapler`, `spctl` results                               | MAC-43         |
| Installed app can spawn the bundled ffmpeg; Logic sees the plugin                                        | MAC-43         |
| `.pkg` size and uninstall                                                                                | MAC-44         |

The checklist's MAC-39 still names the research script. Point it at `packaging/ffmpeg/build-lgpl-ffmpeg.sh`
when it is next edited; the recipe is the same plus the checksum, macOS target flags and licence
assertion.
