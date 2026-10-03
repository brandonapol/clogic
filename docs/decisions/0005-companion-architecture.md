# 0005: AUv3 plugin as a thin view, launchd companion owns the agent and tools

> Promoted from [the SPIKE-003 draft](../research/notes/003-adr-draft.md) on 2026-10-03. Not accepted:
> the owner decides after the **Mac checks** in [SPIKE-003 Findings](../research/003-architecture.md#findings)
> (collected in [mac-checklist.md](../research/mac-checklist.md)) pass or are waived. Rationale, evidence
> and sources: [SPIKE-003](../research/003-architecture.md) and
> [003-sources-2026-10-02.md](../research/notes/003-sources-2026-10-02.md).

- Status: Proposed
- Date: 2026-10-03
- Related: [SPIKE-003](../research/003-architecture.md), #3, SPIKE-007, SPIKE-009, [ADR 0001](./0001-llm-provider-adapters.md)

## Context

clogic is a chat window inside a Logic Pro plugin. The work behind the chat (LLM calls, ffmpeg analysis,
virtual MIDI control surfaces, Accessibility automation) cannot run on an audio render thread and, for
an AUv3, runs in an app extension that Logic loads out of process and that we expect to be sandboxed.
Sandboxed children inherit the sandbox (to confirm on a Mac), and macOS attributes privacy prompts to
the responsible parent of a spawned process. Apple documents app groups as the way for a sandboxed extension and a non-sandboxed process
from the same team to talk over Mach, XPC or UNIX domain sockets, with the socket inside the group
container. The LLM and tool code is TypeScript (`src/llm`, `src/analysis`). AGENTS.md rule 8 forbids
changing a session without user confirmation.

## Decision

1. **Two processes.** The AUv3 extension (`clogic.appex`, sandboxed) renders the chat UI, meters audio
   and persists per-instance state. A companion (`clogic Helper`, Node single executable, not
   sandboxed) owns the conversation, LLM calls, API keys, tools and the confirmation state machine.
2. **Launch.** `clogic.app` registers the companion as a LaunchAgent with
   `SMAppService.agent(plistName:)` (macOS 13+), `BundleProgram` inside the app bundle, `KeepAlive`
   on. The plugin never launches processes.
3. **IPC.** UNIX domain socket at `~/Library/Group Containers/<TeamID>.clogic/c.sock`, app group
   `<TeamID>.clogic` on both sides. Newline-delimited JSON-RPC 2.0. The extension's Swift code bridges
   between the socket and the web view. Fallback if the socket is blocked in practice: XPC via a small
   Swift shim; last resort localhost TCP with a per-boot token in the group container.
4. **Protocol (plugin ↔ companion).**
   - Plugin → companion requests: `session.hello {instanceId, contextName, sampleRate, protocolVersion}`,
     `chat.send {instanceId, text}`, `change.decide {proposalId, acceptedRowIds}`, `chat.cancel`,
     `keys.set {provider, key}`, `keys.status`.
   - Plugin → companion notifications: `meter {instanceId, momentaryLufs, bands}` at about 10 Hz,
     `context.changed {instanceId, contextName}`.
   - Companion → plugin notifications: `chat.message`, `chat.delta` (when streaming exists),
     `tool.started`, `tool.finished`, `change.proposed {proposalId, rows, reason, expiresAt}`,
     `change.applied {proposalId, applied, failed}`, `usage`, `error`.
5. **Tool registry.** One registry built on `ToolDefinition` from `src/llm`, with the effect kind as a
   discriminated union:

   ```ts
   type ToolSurface = 'analysis' | 'docs' | 'control_surface' | 'accessibility' | 'project_file'

   type ReadTool<I> = {
     readonly kind: 'read'
     readonly definition: ToolDefinition
     readonly surface: ToolSurface
     readonly parse: (input: JsonObject) => Result<I, string>
     readonly run: (input: I, ctx: ToolContext) => Promise<Result<JsonValue, ToolError>>
   }

   type ChangeRow = {
     readonly id: string
     readonly control: string
     readonly location: string
     readonly before: JsonValue | 'unknown'
     readonly after: JsonValue
   }

   type ChangeTool<I> = {
     readonly kind: 'change'
     readonly definition: ToolDefinition
     readonly surface: ToolSurface
     readonly parse: (input: JsonObject) => Result<I, string>
     readonly plan: (input: I, ctx: ToolContext) => Promise<Result<readonly ChangeRow[], ToolError>>
     readonly apply: (rows: readonly ChangeRow[], ctx: ToolContext) => Promise<ApplyReport>
   }
   ```

   Read tools run on call. Change tools only `plan` when the model calls them; `apply` is reachable
   only from a `change.decide` message that matches an unexpired, unused proposal. MCP annotations are
   derived from `kind`. Unavailable surfaces are filtered out of the tool list sent to the model.

6. **Agent loop** is a pure reducer `(state, event) → (state, effects)` in `src/agent`, driven by a thin
   companion `main`. One conversation per plugin instance, keyed by an instance UUID saved in plugin
   state; the plugin also saves a transcript snapshot so chats reopen with the project.
7. **Keys** are pasted in the plugin UI, sent once over the socket, and stored by the companion in the
   Keychain. The plugin never stores or logs them.
8. **MCP** (optional, later): a `clogic mcp` stdio entry point exposing read tools only.

## Consequences

- Easier: all product logic stays in TypeScript and is testable without a Mac; Swift is limited to the
  extension shell, metering and the socket bridge. Privacy prompts belong to a named helper, not Logic.
  Rule 8 is enforced by types and the protocol, not by prompting the model.
- Harder: two signed binaries plus a LaunchAgent to install, notarise and update (SPIKE-010); the user
  may need to approve a login item; the plugin needs an "offline" state when the companion is not
  running; protocol versioning between plugin and companion builds.
- Ruled out: LLM calls or tools inside the plugin; the plugin spawning helpers; change tools that apply
  without a UI decision; exposing change tools over MCP before a separate decision.
- Open: everything listed as a Mac check in SPIKE-003; the AUv2 fallback (runs inside Logic's process,
  so this split would need revisiting if SPIKE-007 chooses it); project identity (no AU API found).
