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

- [x] Tool calling differences between the Anthropic Messages API, the OpenAI API and the xAI API
      (schemas, streaming, parallel tool calls). Is a thin adapter per provider enough, or use an
      existing multi-provider SDK?
- [x] Model choice per provider: default model, and whether to let the user pick.
- [ ] Key storage in the macOS Keychain, readable by the companion service but never written to the
      Logic project or logs. (Adapter written and unit tested; not yet run on a Mac.)
- [x] Key validation on entry (cheap test call) with a clear error message.
- [ ] Cost visibility: show token usage per conversation so analysis-heavy chats do not surprise the user.
      (Per-response usage is parsed; summing and pricing are not built.)
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

Date: 2026-10-02. Done on Linux (Node 26.8.2) with no Mac, no Logic Pro and no real API keys. Everything
below is from provider documentation, Apple's open-source `security` tool, and mocked-fetch unit tests.
Nothing has been run against a live provider or a real Keychain yet; see
[What a human must still run](#what-a-human-must-still-run).

**Verdict: partial go.** A thin adapter per provider over plain `fetch` covers tool calling for all
three providers, and needs less code than expected: there are only **two wire formats**, because xAI's
recommended API matches OpenAI's Responses API. The Keychain adapter is written but unverified on macOS.
The adapter approach is in [ADR 0009](../decisions/0009-llm-provider-adapters.md) (Proposed).

### Tool calling across providers

| Aspect           | Anthropic Messages                                                                                     | OpenAI Responses                                                                                                          | xAI Responses                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Endpoint         | `POST https://api.anthropic.com/v1/messages`                                                           | `POST https://api.openai.com/v1/responses`                                                                                | `POST https://api.x.ai/v1/responses`                                           |
| Auth             | `x-api-key: <key>`, `anthropic-version: 2023-06-01`                                                    | `Authorization: Bearer <key>`                                                                                             | `Authorization: Bearer <key>`                                                  |
| Tool definition  | `{name, description, input_schema}`                                                                    | `{type: "function", name, description, parameters, strict}`                                                               | same as OpenAI                                                                 |
| Call in response | `content[]` block `{type: "tool_use", id, name, input}` with `input` an object                         | `output[]` item `{type: "function_call", call_id, name, arguments}` with `arguments` a **JSON string**                    | same as OpenAI                                                                 |
| Result sent back | `user` message, `{type: "tool_result", tool_use_id, content, is_error?}` blocks, which must come first | input item `{type: "function_call_output", call_id, output}`                                                              | same as OpenAI                                                                 |
| Tool error flag  | `is_error: true`                                                                                       | none, so we prefix `Error: ` to `output`                                                                                  | none, same                                                                     |
| Stop signal      | `stop_reason: "tool_use"`                                                                              | presence of `function_call` items; `status`, `incomplete_details.reason`                                                  | same as OpenAI                                                                 |
| Parallel calls   | several `tool_use` blocks per turn                                                                     | default on; `parallel_tool_calls: false` limits it                                                                        | default on; `parallel_tool_calls: false` limits it                             |
| `tool_choice`    | `auto`, `any`, `tool`, `none`; **Opus 5.5 / Sonnet 5.5 return 400 for `any` and `tool`**               | `auto`, `required`, `{type: "function", name}`, `none`                                                                    | `auto`, `required`, `{type: "function", function: {name}}`, `none`             |
| Reasoning state  | `thinking` blocks must be sent back unchanged with tool use                                            | `reasoning` items; with `store: false`, request `include: ["reasoning.encrypted_content"]` and send them back             | encrypted reasoning supported; exact stateless setup unverified                |
| Legacy API       | n/a                                                                                                    | Chat Completions "remains supported, Responses is recommended for all new projects"; Assistants API was sunset 2026-08-26 | Chat Completions is labelled "Deprecated" / "Legacy endpoint, limited updates" |
| Error body       | `{type: "error", error: {type, message}, request_id}`                                                  | `{error: {message, type, code}}`                                                                                          | `error.message` (assumed OpenAI-like; unverified)                              |

What this means for the design (implemented in `src/llm/`):

- **The neutral model** (`src/llm/types.ts`) is: `ToolDefinition` (name, description, JSON Schema),
  `Message` = user text | assistant text + `ToolCall[]` | tool `ToolResult[]`, and `ChatResponse` with
  text, tool calls, a normalised `StopReason`, and token `Usage`. Tool calls are always arrays, so
  parallel calls need no special case.
- **Replay is required.** Anthropic rejects tool-use turns whose thinking blocks were dropped or edited,
  and OpenAI expects reasoning items to come back with function calls. Each `ChatResponse` carries an
  opaque `replay` (the provider's raw content/output items). When the next request goes to the same
  provider the adapter sends those items back unchanged; when the user switches provider mid-chat it
  rebuilds plain text and tool calls and the reasoning is dropped.
- **Forced tool use cannot be relied on.** Anthropic's current top models reject `tool_choice` `any` and
  `tool`, so the neutral `ToolChoice` is only `auto | none`.
- **Strict schemas.** OpenAI `strict: true` needs every property in `required` and
  `additionalProperties: false`. The neutral schema type forces `additionalProperties: false`, and the
  OpenAI/xAI adapters set `strict` only when every property is required (`isStrictCompatible`).
  Anthropic also has `strict`, which we do not send yet.
- **Privacy default.** The OpenAI adapter sends `store: false` so conversations (which may include mix
  analysis and file paths) are not stored for 30 days. xAI stores responses for 30 days by default;
  whether xAI accepts `store: false` with encrypted reasoning still needs checking with a real key.
- **Streaming** is not implemented. All three stream over SSE with different event shapes. Streaming
  only affects how fast text appears in the chat, so it can come later as a second parse function per
  wire format.

**SDK or thin adapters?** Thin adapters. The translation is about 300 lines across two wire formats,
is pure and fully unit-testable with recorded JSON, and adds no dependency (AGENTS.md rule 9). Official
SDKs would mean three dependencies with different abstractions; multi-provider SDKs (for example the
Vercel AI SDK or LiteLLM) add a large dependency surface and their own lag on new provider features such
as thinking replay. Revisit if streaming or provider churn makes the adapters expensive to maintain.

### Model choice

Defaults (in `src/llm/providers.ts`): `claude-sonnet-5-5`, `gpt-6.1-sol`, `grok-4.7`. These are the
mid-price capable models per provider as listed in the docs on 2026-10-02: OpenAI describes GPT-6.1 Sol
as "near-Astra performance at lower cost" ($2 / $10 per M tokens), and xAI's docs recommend Grok 4.7.
Let the user pick: key validation already returns the model list, so a settings drop-down can be filled
from it. Defaults should be checked against the model lists when someone runs the end-to-end script.

### Key validation

`validateKey` sends a `GET /v1/models` request (Anthropic: `?limit=1`) with the key. This uses no tokens,
returns 401 for a bad key, and gives the model list for the picker. HTTP errors become values
(`auth`, `permission`, `billing`, `rate_limit`, `overloaded`, `server`, `network`, ...) and
`describeError` turns each one into a one-line message for the chat UI. Pasted keys are trimmed and
checked for stray spaces or line breaks before storage (`normalizeApiKey`).

### Keys in the Keychain and out of logs

`keychainKeyStore` (`src/llm/keychain.ts`) stores one generic password per provider: service
`clogic.llm-api-key`, account `anthropic` | `openai` | `xai`. It uses `/usr/bin/security`:

- **Read:** `security find-generic-password -s <service> -a <provider> -w` prints only the password.
- **Write:** the key must not go on the command line, because argv is visible to other processes in
  `ps`. The man page says of `-w`: "Put at end of command to be prompted (recommended)", but prompting
  needs a TTY. Instead we run `security -i` and write one line to its stdin:
  `add-generic-password -U -s <service> -a <provider> -X <hex of key>`. `-X` takes the password as hex
  (man page: "Specify password data to be added as a hexadecimal string"), which gives a plain token
  that needs no quoting. `-U` updates an existing item.
- Evidence from Apple's source (`apple-oss-distributions/Security`, tag `Security-61901.120.67`,
  `SecurityTool/macOS/security.c`): interactive mode reads stdin lines up to 4096 bytes, `split_line`
  tokenises on whitespace with quote and backslash handling, the prompt is only shown when stdin is a
  TTY, and the process exit status is the last command's result. A not-found lookup returns
  `errSecItemNotFound` (-25300), which becomes exit status 44 (-25300 mod 256). We treat 44, or stderr
  containing "could not be found", as "no key".
- **Delete:** `security delete-generic-password -s <service> -a <provider>`; a missing item counts as
  success.
- **Redaction:** every error message that can contain provider or `security` output is passed through
  `redactSecrets`, which removes the exact key (and its hex form) plus anything that looks like
  `sk-ant-…`, `sk-proj-…`, `sk-…` or `xai-…`. Tests check this for server-echoed keys, network errors and
  `security` stderr. The library never logs; `redactHeaders` is there for any future request logging.
- **Open question (Mac needed):** an item created by `/usr/bin/security` lists that binary in its access
  control list. A future signed companion app reading the item through the Security framework, or a
  different binary, may get a Keychain access prompt or a denial. SPIKE-003/010 must decide whether the
  companion creates the item itself (so it is trusted) and whether to use `-T` for the companion path.
- `memoryKeyStore` is the in-memory fake for tests and non-macOS development.

### Cost visibility, audio input, offline

- Every `ChatResponse` has `usage.inputTokens` / `usage.outputTokens` from all three providers. Summing
  per conversation and converting to money (needs a price table per model) is not built yet.
- Audio input and offline behaviour were **not investigated** in this pass. Leave those boxes open.

### Verified here

- `npm run check` passes (typecheck, lint, format, 77 tests).
- Tests in `test/llm/`: `anthropic.test.ts` and `openai-responses.test.ts` (request translation,
  replay, error marking, strict flag, stop reasons, malformed tool calls), `client.test.ts`
  (`get_loudness` two-turn round trip through all three adapters with scripted fetch, HTTP status to
  error mapping, network and non-JSON failures, missing key, key redaction, `validateKey` URLs),
  `redact.test.ts`, `keystore.test.ts`, `keychain.test.ts` (argv never contains the key, stdin script
  is hex, exit 44 is "not found", failures redacted, real `execFile` runner behaviour).
- On Linux, `research/009-llm-providers/e2e.ts run anthropic` fails cleanly with
  `spawn /usr/bin/security ENOENT` reported as `unavailable`. The first run of this found that spawn
  failures were reported as `command_failed`; fixed with a test.

### What a human must still run

Needs a Mac (record the macOS version) and one real key per provider. From the repo root:

```sh
npm install && npm run build
pbpaste | node --experimental-strip-types research/009-llm-providers/e2e.ts save anthropic
pbpaste | node --experimental-strip-types research/009-llm-providers/e2e.ts save openai
pbpaste | node --experimental-strip-types research/009-llm-providers/e2e.ts save xai
security find-generic-password -s clogic.llm-api-key -a anthropic     # item exists; metadata only, no -w
node --experimental-strip-types research/009-llm-providers/e2e.ts run
echo 'sk-bad' | node --experimental-strip-types research/009-llm-providers/e2e.ts save openai
node --experimental-strip-types research/009-llm-providers/e2e.ts remove xai
node --experimental-strip-types research/009-llm-providers/e2e.ts run xai
```

Record:

1. `save` succeeds for each provider and the item shows in Keychain Access under `clogic.llm-api-key`.
   Check `ps`/shell history shows no key.
2. `run` prints, per provider, `stopReason` `tool_use` with a `get_loudness` call for `/tmp/mix.wav`, then
   a final answer that quotes -9.8 LUFS. Note the token usage and any 400 errors (likely suspects: xAI
   replay of OpenAI-style output items, `store`/`include` handling, default model ids no longer valid).
3. The bad key gives the "rejected the API key" message and nothing is saved.
4. After `remove xai`, `run xai` reports that no key is saved.
5. Whether any Keychain access prompt appears, and for which binary.
6. Also try `MODEL=<cheaper model>` per provider to check that tool calling works on a cheap model.

### Sources (all accessed 2026-10-02)

- Anthropic, Define tools: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- Anthropic, Handle tool calls: https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
- Anthropic, Errors (incl. forced tool use not supported, thinking blocks must be passed back): https://platform.claude.com/docs/en/api/errors
- Anthropic, List models: https://platform.claude.com/docs/en/api/models/list
- OpenAI, Function calling: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI, Create a response: https://developers.openai.com/api/reference/resources/responses/methods/create
- OpenAI, Migrate to Responses: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI, List models: https://developers.openai.com/api/reference/resources/models/methods/list
- OpenAI, Error codes: https://developers.openai.com/api/docs/guides/error-codes
- OpenAI, Models: https://developers.openai.com/api/docs/models
- xAI, Function calling: https://docs.x.ai/docs/guides/function-calling
- xAI, API reference (Responses): https://docs.x.ai/docs/api-reference
- xAI, Model capabilities comparison (Chat Completions deprecated): https://docs.x.ai/developers/model-capabilities/text/comparison
- xAI, Models and pricing: https://docs.x.ai/docs/models
- xAI `GET /v1/models` (third-party mirror of the xAI REST reference; confirm on the official docs): https://glama.ai/mcp/servers/@tetsuo-ai/grok-api-mcp/blob/34e8a2fd0fa50f77e7e1894f18eb2f26c2fdb13c/src/data/api-reference.md
- Apple `security` source and man page: https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/security.c and https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/security.1 (tag `Security-61901.120.67`)
- `security` command summary: https://ss64.com/mac/security.html
