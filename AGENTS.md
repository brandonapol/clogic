# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, ...) working in this repository.
Humans should read [CONTRIBUTING.md](./CONTRIBUTING.md) too.

## Project

clogic is an AI assistant for Logic Pro, delivered as an Audio Unit plugin with a chat window. The user
pastes a Claude, OpenAI or Grok API key once and then chats to analyse mixes, get mixing and mastering
advice, ask Logic Pro documentation questions, and change session details.

The project is in the **research phase**. Logic Pro has no public scripting API, so what is possible is
still being established. Read [docs/research/README.md](./docs/research/README.md) before proposing
architecture.

## Commands

```sh
npm install
npm run check      # typecheck + lint + format check + tests; must pass before every commit
npm run build
npm run format     # fix formatting
npm test
```

Node 22 (see `.nvmrc`). ffmpeg is required for audio analysis work.

## Layout

| Path              | Contents                                                                      |
| ----------------- | ----------------------------------------------------------------------------- |
| `src/`            | Production TypeScript (companion service, analysis core, tools)               |
| `test/`           | Vitest tests, mirroring `src/`                                                |
| `docs/research/`  | Spikes, findings and dated research notes. All research output goes here.     |
| `docs/decisions/` | Architecture decision records                                                 |
| `research/`       | Throwaway spike prototypes, `research/<NNN>-<slug>/`. Never imported by `src` |
| `fixtures/audio/` | Local audio fixtures, git-ignored                                             |

## Code style

- TypeScript, strict mode. No `any`, no non-null assertions, no `@ts-ignore`.
- Functional style: pure functions, immutable data (`readonly`, `as const`), no classes unless a library
  requires them, no mutation of arguments. Push I/O (files, ffmpeg, MIDI, network) to thin adapters at
  the edges so the core stays pure and testable.
- Model failures as values (discriminated unions / result types) in the core; throw only at boundaries.
- Do not add code comments or emojis unless asked. Prefer clear names.
- ES modules with `.js` extensions in relative imports.
- Match the style of surrounding code.

## Rules

1. **Run `npm run check` before every commit.** Do not commit failing code.
2. **Every behaviour change ships with tests.** Bug fixes start with a failing test.
3. **Small changes.** One concern per PR. Aim for diffs a human can review in ten minutes.
4. **Do not invent Logic Pro capabilities.** Logic has no public API. Any claim about what Logic, Audio
   Units, MCU / HUI, or macOS allow must cite a source (Apple docs, SDK headers, a reproducible test) in
   the research docs. If unsure, say so and add it to a spike instead of guessing.
5. **Research goes in `docs/research/`.** Update the relevant spike's Findings with evidence (commands,
   versions, dates, links). New questions become new spikes using `docs/research/_template.md`.
6. **Decisions go in `docs/decisions/`** as ADRs. Do not silently change an accepted decision.
7. **Never commit secrets.** No API keys, tokens or `.env` files. API keys belong in the macOS Keychain
   at runtime. CI runs a secret scanner.
8. **Never modify a user's Logic project or audio files.** Read only. Session changes go through the
   approved control surfaces only, with user confirmation.
9. **Dependencies:** ask before adding one. Prefer small, maintained, permissively licensed packages
   (MIT, Apache-2.0, BSD, ISC). No GPL / AGPL dependencies without a decision record (see SPIKE-011).
10. **No copied code** from other projects unless its licence allows it and it is credited.
11. **Do not touch** `.github/workflows/`, `AGENTS.md`, or licence files unless the task is about them.

## Commits and PRs

- Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, `research:`.
- Fill in every section of the PR template, including how the change was verified and the AI assistance
  disclosure.
- Link the issue the PR closes.

## When stuck

Stop and ask rather than guessing when: the task needs a Mac / Logic Pro and you cannot run one, a
requirement conflicts with these rules, or a change would touch legal, licensing, or security concerns.
