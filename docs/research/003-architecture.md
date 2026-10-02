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

- [x] Process split: what can run inside the AU (UI, metering) vs. a companion service (LLM calls,
      tools, ffmpeg, MIDI, AX). Is a companion process allowed at all, and how is it launched (login item,
      `launchd` agent, spawned on demand by the plugin)?
- [x] Plugin to companion IPC: local socket / XPC / HTTP on localhost, and what the AU sandbox permits
      (especially for AUv3, which runs out-of-process).
- [x] Tool layer: define tools once (MCP-style schemas) so they work with any LLM provider (SPIKE-009),
      and can optionally also be exposed as an MCP server for Claude Desktop / Claude Code.
- [x] Agent loop: who owns the conversation, tool calling, and streaming responses back to the plugin UI.
- [x] Safety model for tools that change the Logic session: dry run, explicit confirmation in the chat UI,
      undo story.
- [x] Session context: how the companion knows which Logic project and which track the plugin instance
      is on.
- [x] Module layout that stays functional and testable: pure analysis / domain core, thin I/O adapters
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

Researched 2026-10-02 from Linux with WebSearch and WebFetch. No Mac, no Logic Pro, no Xcode: macOS
version n/a, Logic Pro version n/a. Every source, with its date and how it was read, is in
[notes/003-sources-2026-10-02.md](./notes/003-sources-2026-10-02.md). Anything marked **Mac check** is
an untested inference and must be confirmed on a Mac before it is relied on.

**Verdict: partial go.** A separate companion process is allowed and is the only place the tools can
live: the plugin is a sandboxed AUv3 extension that Logic runs out of process, and macOS documents an
IPC path (a UNIX domain socket in a shared app group container) between a sandboxed extension and a
non-sandboxed helper from the same team. Nothing found blocks the split. What is not yet proven is that
it works inside Logic in practice (sandbox, socket, permission prompts) and the hello-world loop below.
The proposed architecture is in [notes/003-adr-draft.md](./notes/003-adr-draft.md) (Proposed ADR
draft, for the owner to promote to `docs/decisions/`).

### Process split

| Process                 | What it is                                                                         | Runs                                                                                                                       | Must not                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Plugin** (AUv3 appex) | Audio FX extension inside `clogic.app`; sandboxed; Logic loads it out of process   | Chat web view, render block (pass-through + metering), a non-real-time sender thread, IPC client, plugin state persistence | Call LLMs, hold the API key, run ffmpeg / MIDI / AX, block the render thread |
| **Companion**           | Non-sandboxed Node binary, LaunchAgent registered by `clogic.app` via SMAppService | Agent loop, LLM providers (`src/llm`), tool registry and executors, Keychain, confirmation state machine, IPC server       | Touch the audio thread; change the session without a UI confirmation         |
| **ffmpeg**, AX helper   | Child processes of the companion                                                   | Offline analysis (SPIKE-001), UI automation (SPIKE-005)                                                                    | Be launched by the plugin (wrong TCC attribution, sandbox)                   |

Evidence:

- AUv2 is loaded into the host process; AUv3 is loaded out of process by default, and in-process
  loading is a macOS-only option the host requests and the AU must support (Apple, _Migrating Your
  Audio Unit Host to the AUv3 API_). A developer reported in Oct 2023 that Logic on Apple Silicon loads
  AUv3 out of process with no in-process option (forum 728404, not an Apple statement). So the plugin
  process is our own sandboxed extension process, not Logic. **Mac check:** confirm in Logic 12.x with
  Activity Monitor or `ps` while the plugin is inserted.
- AUv3 plug-ins are app extensions inside a containing app (Apple, same article: "a robust plug-in model
  built on app extensions"), and we assume they run sandboxed, as the other extension types in forum
  703702 do. **Mac check:** build the Xcode AUv3 template and inspect its entitlements. The containing
  app is needed anyway, which gives us a natural home for the companion and its LaunchAgent plist.
- The render thread must avoid file and network I/O, memory allocation, Objective-C messaging and
  anything that can block (Apple QA1715). Metering therefore goes render block → lock-free ring buffer
  → sender thread → socket, as SPIKE-007 already plans.
- AUv2 is the fallback if AUv3 does not work out (SPIKE-007). An AUv2 runs inside Logic's process, so
  Logic's own sandbox and entitlements would govern what the plugin can do. **Mac check:**
  `codesign -d --entitlements - "/Applications/Logic Pro.app"` to see whether Logic is sandboxed and
  whether it carries `com.apple.security.cs.disable-library-validation`. Not established by any source
  found.

### Launching the companion

| Option                                                     | Pros                                                                                                                                                             | Cons                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **A. LaunchAgent via `SMAppService.agent(plistName:)`**    | macOS 13+; plist lives in `Contents/Library/LaunchAgents` with `BundleProgram`; shown under our app name in Settings; user can disable it and we can detect that | User may have to approve it in System Settings > Login Items; runs at login even when Logic is closed (idle cost) |
| B. Spawned by the plugin on demand                         | No login item                                                                                                                                                    | A sandboxed child inherits the sandbox (inference, **Mac check**); TCC would blame Logic or the extension         |
| C. Login item app (`SMAppService.loginItem`)               | Has its own app identity for TCC                                                                                                                                 | Only one XPC listener, named after the login item (Quinn, forum 703702); heavier than A                           |
| D. Old-style plist in `~/Library/LaunchAgents` (installer) | Works before macOS 13                                                                                                                                            | "No longer the supported path" since SMAppService; anonymous label in Settings                                    |

Recommendation: **A**, registered when the user first opens `clogic.app` (or when the installer from
SPIKE-010 runs it once), with `KeepAlive` so it restarts after a crash. The plugin shows a "companion
not running" state with a button that opens `clogic.app` if the socket is missing.

TCC (Accessibility, Automation, file access) attributes a child process's access to its responsible
parent, while processes launched by launchd are responsible for themselves (Qt blog, 2022-02-04). So
spawning helpers from the plugin would put prompts on Logic or the extension, which is the risk listed
above; a launchd-started companion owns its prompts. Prompts name the responsible binary, and a bare
versioned binary shows up as an unhelpful name and loses its grant on update (claude-code issue 66216).
So the companion should be a named, stably signed bundle (for example `clogic Helper.app` inside
`clogic.app`), not a loose executable. **Mac check:** which name the Accessibility prompt shows, and
whether grants survive an update.

### Plugin to companion IPC

| Option                                            | Sandbox (AUv3)                                                                                           | Node side                                          | Auth                                                                                                                                           | Verdict                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **UNIX domain socket in the app group container** | Documented: socket path must be in the group container; works sandboxed ↔ non-sandboxed (App Groups doc) | `node:net` built in                                | Filesystem: only same-team group members and the user's processes can reach the container                                                      | **Recommended**                |
| XPC / Mach service named `<group id>.<name>`      | Documented for app groups; Quinn's recipe for extensions → login item                                    | No XPC in Node; needs a Swift shim or native addon | Code-signature based                                                                                                                           | Later, if sockets fail         |
| Localhost TCP / WebSocket / HTTP                  | Needs `com.apple.security.network.client` in the extension                                               | Built in                                           | None by default; any local process or a web page via DNS rebinding can try (MCP transport spec requires `Origin` checks, 127.0.0.1 bind, auth) | Fallback, with a token         |
| Shared files / defaults polling                   | Allowed in group container                                                                               | Easy                                               | Same as socket                                                                                                                                 | Too slow for chat and metering |

Use a `<TeamID>.<group name>` app group (for example `ABCDE12345.clogic`), not `group.…`: macOS checks
the Team ID prefix against the code signature, it needs no portal registration, and on macOS 15 apps
outside the Mac App Store that use other forms can trigger a "would like to access data from other
apps" prompt (App Groups doc; forums 763826, 758358). The companion is a member of the same group. Keep
the socket path short (`…/Group Containers/ABCDE12345.clogic/c.sock`) because socket names are length
limited. **Mac check:** the extension, signed with the group entitlement, can `connect()` to a socket
created by the non-sandboxed companion inside Logic, with no prompt.

Framing: newline-delimited JSON-RPC 2.0, the same framing MCP uses on stdio (MCP transports spec). The
web view cannot open a UNIX socket, so the extension's Swift code bridges `WKScriptMessageHandler`
messages to the socket and back. Message shape is in the ADR draft.

### Tool layer and registry

`src/llm` (t3, [ADR 0001](../decisions/0001-llm-provider-adapters.md)) already defines a provider-neutral
`ToolDefinition` = `{name, description, inputSchema}` with a strict JSON Schema object, and translates
it for Anthropic and the OpenAI / xAI Responses API. That is a subset of the MCP tool shape (`name`,
`title`, `description`, `inputSchema`, `outputSchema`, `annotations`; MCP spec 2025-11-25), so one
definition can serve all three providers and an MCP server.

What the registry adds on top (pure data plus functions, no classes):

- **Effect kind** as a discriminated union, not a flag: `read` tools run immediately; `change` tools
  only _plan_ a change and never apply it themselves. This is how AGENTS.md rule 8 is enforced in code
  rather than by prompt.
- **Surface** (`analysis`, `docs`, `control_surface`, `accessibility`, `project_file`) so the agent can
  hide tools whose surface is unavailable (no Mac permission, companion offline) and the UI can label
  them.
- **Input parsing** to a typed value as a `Result`, so a bad tool call becomes an `isError: true` tool
  result the model can correct (MCP's split between protocol errors and tool execution errors).
- MCP annotations derived from the effect kind: `read` → `readOnlyHint: true`; `change` →
  `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true` for "set to value" tools,
  `openWorldHint: false`. The spec says annotations are hints and untrusted, so our own confirmation does
  not depend on them.

Optional MCP server: a `clogic mcp` stdio entry point exposing the same registry to Claude Desktop /
Claude Code. It should expose **read tools only** at first, because an external MCP client owns its own
confirmation UI and we cannot guarantee rule 8 there. The official `@modelcontextprotocol/sdk` is MIT
(1.30.0); adding it needs owner approval (rule 9), and the stdio framing is small enough to write by
hand if not.

### Agent loop and streaming

The companion owns the conversation: it holds the messages, calls `chat()` from `src/llm`, runs tool
calls, and loops until the stop reason is `end_turn`, `max_tokens` or `refusal`, or a step limit is hit.
The plugin is a view: it sends user messages and confirmation decisions, and renders events
(`assistant text`, `tool call started / finished`, `change proposed`, `usage`). `src/llm` has no
streaming yet (SPIKE-009), so text arrives per turn; when streaming lands it becomes extra
`chat.delta` notifications with no change to the plugin protocol shape.

One conversation per plugin instance, keyed by an instance UUID stored in the plugin's saved state.
The plugin also saves a transcript snapshot in its state so the chat reopens with the project (SPIKE-007
item). That means chat text ends up inside the user's `.logicx` (Logic writes it, we do not edit the
file), which matters if the user shares projects; note it in `PRIVACY.md` (SPIKE-011).

### Session change safety (AGENTS.md rule 8)

1. The model calls a `change` tool, for example `set_fader_db({track: "Vox", db: -6})`.
2. The executor _plans_: it resolves the target, reads the current value through the surface
   (SPIKE-004 / 005), and builds a `ChangeProposal` with `{control, location, before, after}` rows. No
   write happens. If the current value cannot be read, the row says "unknown" and cannot be reverted.
3. The companion sends `change.proposed` to the plugin and suspends the loop. The UI is the
   confirmation dialog in [docs/design](../design/README.md) (per-row checkboxes, no default action
   on Return).
4. Only a `change.decide` message from the plugin UI, carrying the proposal ID and the chosen rows,
   can apply it. The model has no tool that confirms; model output can never produce a decision.
   Proposals expire (for example after 5 minutes or on the next user message) and are applied at most
   once.
5. The executor applies the chosen rows, reads them back, and records the `before` values for
   **Revert**. The tool result sent back to the model lists applied, declined and failed rows.
6. Revert is a user action in the UI that applies the recorded `before` values, which is itself the
   confirmation.

Dry run is step 2 alone ("what would you change?"). Whether control-surface changes appear in Logic's
own undo history is unknown: **Mac check** in SPIKE-004. MCP's spec says clients SHOULD keep a human in
the loop and show tool inputs before calling, which this flow does. Tools never write the project file
or audio, in line with rule 8.

### Session context

- Track name: `AUAudioUnit.contextName` is the host's context string for display, bridged to
  `kAudioUnitProperty_ContextName` (Apple). A developer reported that Logic sets it and keeps it updated
  for Audio FX AUv3s, but only once for MIDI FX (forum 744380, Jan 2024, no Apple reply). Use it as a
  hint, sent to the companion on connect and on change. **Mac check** on Logic 12.x.
- Tempo, transport and position: AUv3 host blocks (`musicalContextBlock`, `transportStateBlock`) are
  for SPIKE-007 to confirm in Logic.
- Project identity and path: no Audio Unit API found that gives the host's project. Options: ask the
  user, read the front window title via AX (SPIKE-005), or infer from the folder bounces land in. Open.
- Which instance is which: each instance sends `{instanceId, contextName, sampleRate}` on connect; the
  companion keeps a table and the model sees it as context.

### Module layout

```text
src/
  analysis/         pure analysis core (t2, SPIKE-001)
  llm/              provider adapters, keys (t3, SPIKE-009)
  tools/            registry types, pure planners, tool definitions per surface
  agent/            pure agent step: (state, event) -> (state, effects); proposal state machine
  protocol/         plugin <-> companion message types and codecs (JSON-RPC), pure
  adapters/         thin I/O edges: ffmpeg, midi, ax, keychain, fs, socket server, mcp stdio
  companion/        main(): wires adapters into the agent, owns process lifecycle
plugin/             Swift AUv3 extension + clogic.app container (SPIKE-007), not TypeScript
```

The agent step is a pure reducer so the loop, the confirmation flow and expiry can be unit-tested
without a provider, a socket or a Mac. Only `adapters/` and `companion/` do I/O.

### Architecture diagram

```text
 Logic Pro (host process)
   │  XPC, managed by macOS (AUv3 out of process)
   ▼
 clogic.appex  [sandboxed, app group ABCDE12345.clogic]
   ├─ render block ──lock-free ring──► sender thread ──┐  meters ~10 Hz
   └─ WKWebView chat UI ◄──bridge──► Swift IPC client ─┤  JSON-RPC, newline framed
                                                       ▼
            ~/Library/Group Containers/ABCDE12345.clogic/c.sock   (UNIX domain socket)
                                                       ▲
 clogic Helper (companion, Node SEA)  [not sandboxed, launchd agent via SMAppService]
   ├─ protocol ─► agent loop (pure) ─► src/llm ─► Anthropic | OpenAI | xAI   (key from Keychain)
   ├─ tool registry
   │    read:   get_loudness, analyse_mix (SPIKE-001)  ─► ffmpeg child process
   │            search_logic_docs (SPIKE-002, link map)
   │            get_track_state (SPIKE-004)            ─► virtual MIDI ports (MCU / HUI)
   │    change: set_fader_db, set_plugin_param (004)   ─► virtual MIDI ports
   │            bounce_stems, open_window (SPIKE-005)  ─► AX helper
   │            (project file read only, SPIKE-006)
   └─ optional `clogic mcp` (stdio, read tools) ◄── Claude Desktop / Claude Code
```

SPIKE-008 (Scripter) is not in the diagram: it is a separate MIDI FX path with no IPC. SPIKE-010 ships
`clogic.app` (appex + helper + LaunchAgent plist + ffmpeg) as one signed, notarised `.pkg`.

### Packaging the TypeScript companion

Node single executable applications (Node 26.10 docs, stability "1.1 Active development") build one
binary with `node --build-sea`, then re-sign on macOS. The docs do not cover entitlements. Hardened
runtime is required for notarisation and JIT engines need `com.apple.security.cs.allow-jit` (Apple
hardened runtime docs, secondary sources). **Mac check** for SPIKE-010: which entitlements a signed,
notarised Node SEA needs, and whether native addons (MIDI) work when loaded through `process.dlopen`.

### Keys

The key never enters the plugin beyond the paste field: the UI sends it once over the socket and the
companion stores it with `keychainKeyStore`. Because the companion creates the Keychain item, it is the
trusted creator, which answers SPIKE-009's open question in the simplest way; but `keychain.ts` creates
items through `/usr/bin/security`, so the ACL may list `security` rather than the companion. **Mac
check**, with SPIKE-009.

### Not done in this spike

- The hello-world companion with `get_loudness` callable from a minimal chat loop was **not built**.
  `src/analysis` (t2) and `src/llm` (t3) were being written in parallel, and this task was scoped to
  research and a proposal. Next step: `research/003-companion-hello/` with a socket server, the
  registry types, and the `chat()` loop calling t2's loudness function, plus a Node test client that
  plays the plugin's role.
- Everything marked **Mac check** above, collected:
  1. Logic 12.x loads our AUv3 out of process (process list while inserted).
  2. `codesign -d --entitlements -` on Logic Pro: sandboxed or not, library validation.
  3. Extension with `ABCDE12345.clogic` group connects to the companion's socket in the group
     container, inside Logic, with no prompt, on macOS 15 and 26.
  4. SMAppService agent registration and approval UX; restart after crash.
  5. Accessibility / Automation prompt names the helper bundle; grant survives an update.
  6. `contextName` updates for Audio FX on Logic 12.x.
  7. Control-surface changes and Logic's undo history (SPIKE-004).
  8. Node SEA signing, entitlements, notarisation, native addon loading (SPIKE-010).
  9. Keychain ACL for items created via `/usr/bin/security` then read by the helper (SPIKE-009).
