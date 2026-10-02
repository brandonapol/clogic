# Research

All research for this project lives here: time-boxed spikes, their findings, and supporting notes.
Architecture decisions that come out of research go in [`../decisions`](../decisions/README.md).

## Spikes

Time-boxed investigations to find out what is actually possible before committing to an architecture.
Each spike ends with a short findings section appended to its file and a **go / no-go / partial** verdict.

The goal is a plugin you insert in Logic like any other, which asks for a Claude, OpenAI or Grok API key
once and then gives you a chat window that can analyse your mix, answer Logic questions, and change
session details for you. Logic Pro has no public scripting API, so every way to control it is indirect.
These spikes cover each candidate integration surface plus the pieces that do not depend on Apple at all.

| #   | Issue                                                  | Spike                                                                     | Surface                | Timebox | Priority | Depends on    |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------- | ------- | -------- | ------------- |
| 001 | [#1](https://github.com/brandonapol/clogic/issues/1)   | [Offline mix and stem analysis](./001-offline-audio-analysis.md)          | Bounced audio          | 2d      | P0       | none          |
| 002 | [#2](https://github.com/brandonapol/clogic/issues/2)   | [Logic Pro documentation Q&A](./002-documentation-qa.md)                  | Apple docs             | 1d      | P1       | none          |
| 003 | [#3](https://github.com/brandonapol/clogic/issues/3)   | [Plugin, companion service and tools](./003-architecture.md)              | Architecture           | 1d      | P0       | none          |
| 004 | [#4](https://github.com/brandonapol/clogic/issues/4)   | [Control surface emulation](./004-control-surface-emulation.md)           | MIDI (MCU / HUI), OSC  | 3d      | P1       | 003           |
| 005 | [#5](https://github.com/brandonapol/clogic/issues/5)   | [macOS Accessibility and key commands](./005-accessibility-automation.md) | macOS UI automation    | 2d      | P1       | 003           |
| 006 | [#6](https://github.com/brandonapol/clogic/issues/6)   | [Logic project file introspection](./006-project-file-introspection.md)   | `.logicx` bundle       | 1d      | P2       | none          |
| 007 | [#7](https://github.com/brandonapol/clogic/issues/7)   | [Audio Unit chat plugin shell](./007-audio-unit-chat-plugin.md)           | AUv2 / AUv3            | 3d      | P0       | 003           |
| 008 | [#8](https://github.com/brandonapol/clogic/issues/8)   | [Scripter and MIDI FX](./008-scripter-midi-fx.md)                         | Logic Scripter         | 0.5d    | P3       | none          |
| 009 | [#9](https://github.com/brandonapol/clogic/issues/9)   | [LLM providers and API keys](./009-llm-providers-and-keys.md)             | Claude / OpenAI / Grok | 1d      | P0       | 003           |
| 010 | [#10](https://github.com/brandonapol/clogic/issues/10) | [Installer, ffmpeg and distribution](./010-installer-and-distribution.md) | macOS `.pkg`           | 1.5d    | P1       | 003, 007, 009 |
| 011 | [#11](https://github.com/brandonapol/clogic/issues/11) | [Legal, licensing and compliance](./011-legal-and-licensing.md)           | Legal                  | 1.5d    | P0       | none          |

Suggested order: 011 and 003 first (011 can run in parallel with everything and may rename the
project), then 001, then 007 and 009 together (the minimal product loop: plugin, chat,
one analysis tool), then 004 and 005 (session control), then 010, 002, 006, 008.

## Workflow

1. Each spike has a GitHub issue (label `spike`) and a file here. The issue tracks status; the file holds
   the content.
2. Work happens on a branch. Throwaway prototype code goes in `research/<NNN>-<slug>/` at the repo root,
   never in `src/`.
3. Fill in the **Findings** section with evidence (commands run, versions, numbers, links, dates) and a
   verdict, then open a PR that closes the issue.
4. If the verdict leads to a decision, record it in [`../decisions`](../decisions/README.md).
5. Extra notes that do not fit a spike go in `notes/` as dated files (`YYYY-MM-DD-topic.md`).

## Template

New spikes copy [`_template.md`](./_template.md). Every spike uses the same sections:

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
