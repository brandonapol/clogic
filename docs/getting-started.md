# Getting started

clogic is in the research phase. Today the repository holds a TypeScript core (analysis, LLM adapters,
tools, agent loop, companion service, terminal client) that you can build and test on Linux or macOS. The
Logic Pro plugin itself does not exist yet. Read [docs/research/README.md](./research/README.md) for what
is known and unknown, and [ADR 0005](./decisions/0005-companion-architecture.md) (Proposed) for the
intended process split.

## What runs today (Linux or macOS)

Requirements: Node 22 (see `.nvmrc`). `ffmpeg` and `ffprobe` on `PATH` are needed for audio analysis.

```sh
npm install
npm run check    # typecheck + lint + format check + tests
npm run build
npm test
npm run format   # fix formatting
```

`npm run check` must pass before every commit. Tests use fakes for ffmpeg, HTTP, MIDI and the keychain, so
they do not need a Mac, Logic Pro or an API key.

### Source layout

| Path             | Contents                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| `src/analysis/`  | Pure offline audio analysis core (loudness, bands, masking, reference comparison)     |
| `src/llm/`       | Provider-neutral model, Anthropic and OpenAI-style Responses adapters, key store      |
| `src/mcu/`       | Mackie Control message encoding, decoding and planning, with a MIDI port interface    |
| `src/tools/`     | Tool registry types and definitions: read tools, and change tools that only plan      |
| `src/agent/`     | Pure agent step: `(state, event) -> (state, effects)`, plus the runner that drives it |
| `src/rpc/`       | JSON-RPC framing, message types and the socket client and server                      |
| `src/companion/` | The companion service: wires the router, agent, LLM and tools to a socket             |
| `src/docs/`      | Logic Pro documentation topic search (link map)                                       |
| `src/project/`   | Not on this branch yet; project file introspection is still a research spike          |
| `src/prompts/`   | System prompt and report prompt text                                                  |
| `src/history/`   | Conversation history records, codec, compaction and redaction                         |
| `src/cli/`       | `clogic-chat`, a terminal client for the companion                                    |

Tests in `test/` mirror `src/`. The design rules (pure core, I/O at thin edges, failures as values) are
in [AGENTS.md](../AGENTS.md).

### Try the terminal client

`src/companion` and `src/cli` are present on this branch, and `package.json` declares two bins:
`clogic-companion` and `clogic-chat`. After `npm run build`, in one terminal start the companion on a
socket path of your choice:

```sh
node dist/companion/main.js /tmp/clogic.sock
```

The companion stores API keys through `src/llm/keychain.ts`, which calls `/usr/bin/security`, so key
storage works on macOS only. The tests cover the rest on Linux.

In a second terminal, store a key with a hidden prompt (it is never taken from the command line), check
status, then chat:

```sh
export CLOGIC_SOCKET=/tmp/clogic.sock
node dist/cli/main.js --set-key anthropic
node dist/cli/main.js --status
node dist/cli/main.js
```

`--provider` accepts `anthropic`, `openai` or `xai`. Type `/quit` to exit and press Ctrl-C to cancel the
running turn. Run `node dist/cli/main.js --help` for the full usage. When the package is installed, the
`clogic-companion` and `clogic-chat` bins do the same.

The client talks to the companion over the same JSON-RPC protocol the plugin is planned to use, so it
exercises the agent loop, tools and the change-approval flow without Logic Pro. Session changes are only
proposed and need your explicit approval; the terminal client prompts for it.

## What needs a Mac

Nothing about Logic Pro, Audio Unit hosting, Mackie Control behaviour inside Logic, Accessibility
automation, the Keychain, signing or notarisation has been verified yet. Those checks need a Mac with
Logic Pro and, for the LLM path, real API keys. They are collected in
[docs/research/mac-checklist.md](./research/mac-checklist.md). Start there, use scratch projects or
copies, and record results as the checklist describes.

For what each area is expected to do and why, follow the spikes in
[docs/research/](./research/README.md) rather than relying on this page. Per AGENTS.md rule 4, claims
about Logic Pro behaviour live in the research docs with sources.

## Next steps

- Contributing: [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md).
- Decisions: [docs/decisions/](./decisions/README.md).
- Design: [docs/design/](./design/README.md).
