import type { Result } from '../llm/result.js'
import type { JsonObject, JsonValue, ToolDefinition } from '../llm/types.js'

export type ToolKind = 'read' | 'change'

export type ToolSurface = 'analysis' | 'docs' | 'control_surface' | 'accessibility' | 'project_file'

export type ToolErrorKind = 'invalid_input' | 'unknown_tool' | 'unavailable' | 'failed'

export type ToolError = {
  readonly kind: ToolErrorKind
  readonly message: string
}

export type ToolContext = {
  readonly instanceId: string
}

export type ChangeRow = {
  readonly id: string
  readonly control: string
  readonly location: string
  readonly before: JsonValue
  readonly after: JsonValue
}

export type FailedRow = {
  readonly id: string
  readonly message: string
}

export type ApplyReport = {
  readonly applied: readonly string[]
  readonly failed: readonly FailedRow[]
}

export type ReadTool = {
  readonly kind: 'read'
  readonly definition: ToolDefinition
  readonly surface: ToolSurface
  readonly run: (input: JsonObject, ctx: ToolContext) => Promise<Result<JsonValue, ToolError>>
}

export type ChangeTool = {
  readonly kind: 'change'
  readonly definition: ToolDefinition
  readonly surface: ToolSurface
  readonly plan: (
    input: JsonObject,
    ctx: ToolContext,
  ) => Promise<Result<readonly ChangeRow[], ToolError>>
  readonly apply: (rows: readonly ChangeRow[], ctx: ToolContext) => Promise<ApplyReport>
}

export type Tool = ReadTool | ChangeTool

export type ToolAnnotations = {
  readonly readOnlyHint: boolean
  readonly destructiveHint: boolean
  readonly idempotentHint: boolean
  readonly openWorldHint: boolean
}
