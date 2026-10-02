# Security policy

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting on this repository
(Security > Report a vulnerability).

## Sensitive areas

- API keys for AI providers: stored only in the macOS Keychain, never logged, never written to Logic
  projects or plugin state.
- Local IPC between the plugin and the companion service: must only accept local connections.
- Tools that change a Logic session: require user confirmation.
- Bundled binaries (ffmpeg): pinned versions, verified checksums, signed.
