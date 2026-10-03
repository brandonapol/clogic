# Third-party notices

clogic is licensed under the Apache License, Version 2.0 (see [LICENSE](./LICENSE) and
[NOTICE](./NOTICE)). This file lists third-party components that clogic bundles or plans to bundle, and
the third-party packages used to develop it.

Status: clogic has not shipped a release yet. The "Planned bundled components" below come from
[ADR 0003](./docs/decisions/0003-lgpl-only-ffmpeg-build.md) and
[SPIKE-010](./docs/research/010-installer-and-distribution.md). Update this file whenever a bundled
component, its version, or its build configuration changes.

## Planned bundled components

### FFmpeg

- Component: FFmpeg (`ffmpeg` and `ffprobe` executables), <https://ffmpeg.org>
- Version: pinned release, currently 9.0.2 in the
  [packaging build script](./packaging/ffmpeg/build-lgpl-ffmpeg.sh)
- Licence: GNU Lesser General Public License, version 2.1 or (at your option) any later version
  (LGPL-2.1-or-later)
- Build: built by the clogic project from the official release tarball, LGPL-only. No `--enable-gpl`,
  no `--enable-nonfree`, no `--enable-version3`, no external libraries, audio decoders and filters only.
  The exact `ffmpeg -buildconf` output is recorded in the repository for each release.
- Use: run as a separate executable. clogic does not link against FFmpeg libraries.
- Changes: any patches applied to the FFmpeg source are published as a diff alongside the source.

**Source offer.** For every clogic release that includes FFmpeg, the complete corresponding FFmpeg source
code, any patches, the configure line and the LGPL-2.1 licence text are published on the same download
host and release page as the clogic binary. If you cannot find them, open an issue at
<https://github.com/brandonapol/clogic/issues> and we will provide them.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project. clogic is not affiliated with
or endorsed by the FFmpeg project.

### Node.js runtime

- Component: Node.js, <https://nodejs.org>, shipped as a Node single executable application that
  contains the runtime plus clogic's JavaScript (planned in SPIKE-010)
- Version: the Node LTS line used for the release build (development uses Node 22, see `.nvmrc`)
- Licence: MIT
- Node.js itself bundles third-party components (for example V8, libuv, OpenSSL, ICU, llhttp, zlib) under
  their own permissive licences. Their notices are in the `LICENSE` file of the Node.js release used for
  the build, which will be shipped with clogic alongside this file.

## npm packages

All current npm packages are development dependencies (`devDependencies` in `package.json`). They are
used to build, lint and test clogic and are not shipped in the product. clogic currently has no runtime
npm `dependencies`.

| Package             | Version | Licence    |
| ------------------- | ------- | ---------- |
| `@eslint/js`        | 10.0.1  | MIT        |
| `@types/node`       | 26.6.4  | MIT        |
| `eslint`            | 10.11.0 | MIT        |
| `prettier`          | 3.9.9   | MIT        |
| `typescript`        | 6.0.3   | Apache-2.0 |
| `typescript-eslint` | 8.71.0  | MIT        |
| `vitest`            | 5.0.3   | MIT        |

Versions are those installed from `package-lock.json`. Transitive development packages were audited in
[SPIKE-011](./docs/research/011-legal-and-licensing.md): no GPL or AGPL licences were found.

## Apple Logic Pro User Guide links

The `search_logic_docs` tool (`src/docs/`) contains links to pages of Apple's online Logic Pro User Guide
at `support.apple.com`, with titles and one-line descriptions written by the clogic project. It contains
no text copied from Apple's documentation. Logic Pro is a trademark of Apple Inc., registered in the U.S.
and other countries. clogic is not affiliated with or endorsed by Apple Inc.
