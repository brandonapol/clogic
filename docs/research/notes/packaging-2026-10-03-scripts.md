# Packaging scripts: evidence (2026-10-03)

Related: [SPIKE-010](../010-installer-and-distribution.md), [ADR 0003](../../decisions/0003-lgpl-only-ffmpeg-build.md),
[`packaging/`](../../../packaging/README.md). Host: Linux x86_64, no Mac, no Developer ID.

## FFmpeg 9.0.2 tarball checksum

```sh
curl -fsSLO https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz
curl -fsSLO https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz.asc
sha256sum ffmpeg-9.0.2.tar.xz
# 8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e  (12,040,788 bytes)
curl -fsSL https://ffmpeg.org/ffmpeg-devel.asc | gpg --import
gpg --verify ffmpeg-9.0.2.tar.xz.asc ffmpeg-9.0.2.tar.xz
# Signature made Thu 17 Sep 2026 ... using RSA key FCF986EA15E6E293A5644F10B4322F04D67658D8
# Good signature from "FFmpeg release signing key <ffmpeg-devel@ffmpeg.org>" [unknown]
```

The key was fetched from ffmpeg.org over HTTPS and not cross-certified (gpg reports `[unknown]` trust).
ffmpeg.org publishes `.asc` signatures, not SHA-256 files, so the pinned checksum is our own, taken from a
tarball whose signature verified.

## `ffmpeg -L` wording

The assertion matches the default (LGPL-2.1-or-later) text in `fftools/opt_common.c`, `show_license()`,
of the 9.0.2 tarball. The same function prints "GNU General Public License" for GPL builds, "GNU Lesser
General Public License ... version 3" for `--enable-version3`, and "has nonfree parts compiled in" for
`--enable-nonfree`. `assert-lgpl.sh` rejects all three.

## Proxy build

```sh
CLOGIC_FFMPEG_PROXY_BUILD=1 WORK=/tmp/t42/proxy packaging/ffmpeg/build-lgpl-ffmpeg.sh
# ==> sha256 OK 8c38...002e
# License: LGPL version 2.1 or later            (configure summary)
# assert-lgpl: OK .../ffmpeg: LGPL-2.1-or-later
# assert-lgpl: OK .../ffprobe: LGPL-2.1-or-later
# ffmpeg 4988440 bytes, ffprobe 4775264 bytes (stripped, target proxy-linux-x86_64)
```

Byte-identical sizes to the SPIKE-010 research build, as expected for the same recipe. A 3 s, 440 Hz,
16-bit mono WAV generated with Python decoded and gave `I: -9.9 LUFS` through `ebur128`.

## shellcheck

ShellCheck 0.11.0 (the upstream static Linux release binary, run from `/tmp`, not added to the repo) with
`shellcheck -x packaging/*/*.sh packaging/lib/common.sh`: no findings. It is not part of `npm run check`
because it is not an npm package and adding a dependency needs approval (AGENTS.md rule 9).

## Not verified

Anything macOS: see the table at the end of [`packaging/README.md`](../../../packaging/README.md),
mapped to MAC-39, MAC-40, MAC-43 and MAC-44.
