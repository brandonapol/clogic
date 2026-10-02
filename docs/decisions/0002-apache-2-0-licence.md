# 0002: Apache-2.0 licence

- Status: accepted
- Date: 2026-10-02
- Related: SPIKE-011, SPIKE-010

## Context

The repository needs a licence before public release. [SPIKE-011](../research/011-legal-and-licensing.md)
compared the options and recommended Apache-2.0 for a public project: it is permissive, has an explicit
patent grant, and has defined NOTICE handling, which suits a project that bundles an LGPL ffmpeg build and
may use Apache-2.0 and other permissively licensed components (Audio Unit SDK, JUCE under its licence).
[SPIKE-010](../research/010-installer-and-distribution.md) covers what ships in the installer.

## Decision

The repository is licensed under the Apache License 2.0, copyright Brandon Apol, 2026. The `LICENSE` file
holds the canonical text, `NOTICE` carries attribution, and `package.json` declares `"license":
"Apache-2.0"`. Third-party components keep their own licences and are listed in `THIRD_PARTY_NOTICES.md`
(to be added with the first release).

## Consequences

- Contributions are accepted under Apache-2.0 (section 5 of the licence).
- Dependencies must stay compatible: MIT, Apache-2.0, BSD, ISC. GPL / AGPL still need a decision record.
- Releases must carry `LICENSE` and `NOTICE`.
- The licence grants no rights to the project name or trademarks. The name decision is deferred.
