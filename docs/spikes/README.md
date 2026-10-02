# Spikes

Time-boxed investigations to find out what is actually possible before committing to an architecture.
Each spike ends with a short findings section appended to its file and a **go / no-go / partial** verdict.

The goal is a plugin you insert in Logic like any other, which asks for a Claude, OpenAI or Grok API key
once and then gives you a chat window that can analyse your mix, answer Logic questions, and change
session details for you. Logic Pro has no public scripting API, so every way to control it is indirect.
These spikes cover each candidate integration surface plus the pieces that do not depend on Apple at all.

| #   | Spike                                                                     | Surface                | Timebox | Priority | Depends on    |
| --- | ------------------------------------------------------------------------- | ---------------------- | ------- | -------- | ------------- |
| 001 | [Offline mix and stem analysis](./001-offline-audio-analysis.md)          | Bounced audio          | 2d      | P0       | none          |
| 002 | [Logic Pro documentation Q&A](./002-documentation-qa.md)                  | Apple docs             | 1d      | P1       | none          |
| 003 | [Plugin, companion service and tools](./003-architecture.md)              | Architecture           | 1d      | P0       | none          |
| 004 | [Control surface emulation](./004-control-surface-emulation.md)           | MIDI (MCU / HUI), OSC  | 3d      | P1       | 003           |
| 005 | [macOS Accessibility and key commands](./005-accessibility-automation.md) | macOS UI automation    | 2d      | P1       | 003           |
| 006 | [Logic project file introspection](./006-project-file-introspection.md)   | `.logicx` bundle       | 1d      | P2       | none          |
| 007 | [Audio Unit chat plugin shell](./007-audio-unit-chat-plugin.md)           | AUv2 / AUv3            | 3d      | P0       | 003           |
| 008 | [Scripter and MIDI FX](./008-scripter-midi-fx.md)                         | Logic Scripter         | 0.5d    | P3       | none          |
| 009 | [LLM providers and API keys](./009-llm-providers-and-keys.md)             | Claude / OpenAI / Grok | 1d      | P0       | 003           |
| 010 | [Installer, ffmpeg and distribution](./010-installer-and-distribution.md) | macOS `.pkg`           | 1.5d    | P1       | 003, 007, 009 |

Suggested order: 003 and 001 first, then 007 and 009 together (the minimal product loop: plugin, chat,
one analysis tool), then 004 and 005 (session control), then 010, 002, 006, 008.

## Template

Every spike uses the same sections:

- **Question**: the one thing we need to answer
- **Why it matters**: what it unlocks for mixing / mastering help
- **Timebox**
- **Investigate**: concrete tasks
- **Done when**: acceptance criteria
- **Risks / unknowns**
- **Findings**: filled in at the end, with a verdict

## Environment notes

- Spikes 004, 005, 006, 007, 008 and 010 need a Mac with Logic Pro installed. Record the macOS and Logic Pro
  versions in the findings, since behaviour may change between releases.
- Audio fixtures go in `fixtures/audio/` (git-ignored). Never commit copyrighted reference tracks.
