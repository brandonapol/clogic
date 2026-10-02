# SPIKE-010 prototypes

Throwaway scripts behind the measurements in
[`docs/research/010-installer-and-distribution.md`](../../docs/research/010-installer-and-distribution.md).
Nothing here is imported by `src/`.

| Script                 | What it does                                                                                                                                    | Runs on                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `measure-sizes.sh`     | Downloads official Node, Bun and a third-party ffmpeg macOS build, then prints binary sizes, `file` output and the ffmpeg configure line        | Linux or macOS (uses GNU `stat`) |
| `build-lgpl-ffmpeg.sh` | Builds a minimal audio-only FFmpeg from the release tarball with the default LGPL configuration, then prints `ffmpeg -L` and the stripped sizes | Linux now; macOS is a Mac check  |

Both take `WORK=<dir>` to choose the scratch directory, and the pinned versions are overridable through
environment variables at the top of each script. Downloads and build output stay in `WORK`, never in the
repo.
