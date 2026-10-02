# 0009: Thin per-provider LLM adapters over plain fetch

- Status: proposed
- Date: 2026-10-02
- Related: SPIKE-009, #9, SPIKE-003

## Context

clogic must chat and call tools with Claude, OpenAI or Grok, using a key the user pastes once
([SPIKE-009 findings](../research/009-llm-providers-and-keys.md#findings)). The providers differ in tool
definition fields, how tool calls and results are encoded (object vs JSON-string arguments, user-role
`tool_result` blocks vs `function_call_output` items), error flags, and how reasoning state must be sent
back. xAI's recommended Responses API matches OpenAI's Responses API, and both providers mark Chat
Completions as legacy. Anthropic's current top models reject forced tool choice. AGENTS.md asks for a
pure core, I/O at the edges, failures as values, and few dependencies.

## Decision

- One provider-neutral model in `src/llm/types.ts`: tool definitions as JSON Schema, messages as
  user text, assistant text plus tool calls, and tool results, and responses with text, tool calls,
  normalised stop reason, token usage and an opaque per-provider `replay`.
- Two pure translation modules, one per wire format: Anthropic Messages (`anthropic.ts`) and the
  Responses API (`openai-responses.ts`), the latter set up for OpenAI and xAI with a small dialect
  record (base URL, stateless reasoning). They build `HttpRequest` values and parse JSON into
  `Result` values.
- One thin edge (`client.ts`) that takes an injected `fetch`, maps HTTP and network failures to typed
  `LlmError` values, and redacts keys from every error message.
- Key validation is a `GET /v1/models` call per provider.
- Keys live behind a `KeyStore` interface: an in-memory fake for tests and a macOS Keychain adapter
  using `/usr/bin/security`, passing the key on stdin, never argv.
- No provider SDK or multi-provider SDK for now.
- Only `auto` and `none` tool choice are exposed.

## Consequences

- Adding a tool is one `ToolDefinition`; it works with all three providers without per-provider code.
- Provider API changes mean editing our translation code; recorded-JSON tests make this cheap to check.
- Streaming, retries with backoff, and request timeouts are not built yet and must be added at the edge.
- Switching provider mid-conversation drops the previous provider's reasoning state.
- The Keychain adapter depends on the `security` CLI behaviour and access-control prompts that are not
  yet verified on a Mac. The process that creates the item may need to be the companion itself
  (SPIKE-003, SPIKE-010).
- Accepting this ADR needs the human end-to-end run listed in the SPIKE-009 findings.
