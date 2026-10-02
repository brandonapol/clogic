# SPIKE-003: Plugin, companion service and tool architecture

Issue: [#3](https://github.com/brandonapol/clogic/issues/3)

## Question

How do the in-Logic chat plugin, the LLM, and the tools (analysis, docs, mixer control, UI automation)
fit together, and which process does what?

## Why it matters

The product is a chat window inside a Logic plugin. An Audio Unit runs inside the host's sandbox and
real-time constraints, so most of the work (LLM calls, ffmpeg, MIDI control, Accessibility automation)
probably has to live in a separate local process. Every other spike plugs into this decision.

## Timebox

1 day

## Investigate

- [ ] Process split: what can run inside the AU (UI, metering) vs. a companion service (LLM calls,
      tools, ffmpeg, MIDI, AX). Is a companion process allowed at all, and how is it launched (login item,
      `launchd` agent, spawned on demand by the plugin)?
- [ ] Plugin to companion IPC: local socket / XPC / HTTP on localhost, and what the AU sandbox permits
      (especially for AUv3, which runs out-of-process).
- [ ] Tool layer: define tools once (MCP-style schemas) so they work with any LLM provider (SPIKE-009),
      and can optionally also be exposed as an MCP server for Claude Desktop / Claude Code.
- [ ] Agent loop: who owns the conversation, tool calling, and streaming responses back to the plugin UI.
- [ ] Safety model for tools that change the Logic session: dry run, explicit confirmation in the chat UI,
      undo story.
- [ ] Session context: how the companion knows which Logic project and which track the plugin instance
      is on.
- [ ] Module layout that stays functional and testable: pure analysis / domain core, thin I/O adapters
      per surface (ffmpeg, MIDI, AX, docs, LLM providers).

## Done when

- An architecture diagram: AU plugin, companion service, tools, providers, and how spikes 001 to 009 plug
  in
- A hello-world companion service in TypeScript with one tool (`get_loudness(path)`) callable from a
  minimal chat loop
- A decision on the process split and IPC mechanism

## Risks / unknowns

- macOS permission prompts (Accessibility, MIDI, file access) may be attributed to Logic instead of our
  companion process
- If a companion process is not viable, the plugin shrinks to what an AU can do alone

## Findings

_TBD_
