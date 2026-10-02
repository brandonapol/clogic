# SPIKE-009: Multi-provider LLM support and API key handling

Issue: [#9](https://github.com/brandonapol/clogic/issues/9)

## Question

Can one agent and tool layer work across Claude, OpenAI (Codex / GPT) and Grok, with the user just
pasting an API key into the plugin once?

## Why it matters

Setup should be: install, open the plugin, paste a key, start chatting. No config files, no terminal.

## Timebox

1 day

## Investigate

- [ ] Tool calling differences between the Anthropic Messages API, the OpenAI API and the xAI API
      (schemas, streaming, parallel tool calls). Is a thin adapter per provider enough, or use an
      existing multi-provider SDK?
- [ ] Model choice per provider: default model, and whether to let the user pick.
- [ ] Key storage in the macOS Keychain, readable by the companion service but never written to the
      Logic project or logs.
- [ ] Key validation on entry (cheap test call) with a clear error message.
- [ ] Cost visibility: show token usage per conversation so analysis-heavy chats do not surprise the user.
- [ ] Audio input: which providers accept audio directly, and whether that is useful versus sending our
      numeric `AnalysisReport` (SPIKE-001).
- [ ] Offline behaviour: what still works with no network (local analysis, cached docs).

## Done when

- The same `get_loudness` tool call works end to end with all three providers
- Keys are stored in and read from the Keychain
- A decision on the adapter approach

## Risks / unknowns

- Provider APIs change; tool-calling quality varies between models
- Docs Q&A and mixing advice quality may differ a lot between providers

## Findings

_TBD_
