import { err, type Result } from '../llm/result.js'
import type { JsonValue } from '../llm/types.js'
import { parseParams, toInputSchema, type Params, type ParsedParams } from './params.js'
import type {
  ApplyReport,
  ChangeRow,
  ChangeTool,
  ReadTool,
  ToolContext,
  ToolError,
  ToolSurface,
} from './types.js'

type ToolSpec<P extends Params> = {
  readonly name: string
  readonly description: string
  readonly surface: ToolSurface
  readonly params: P
}

export type ReadToolSpec<P extends Params> = ToolSpec<P> & {
  readonly run: (input: ParsedParams<P>, ctx: ToolContext) => Promise<Result<JsonValue, ToolError>>
}

export type ChangeToolSpec<P extends Params> = ToolSpec<P> & {
  readonly plan: (
    input: ParsedParams<P>,
    ctx: ToolContext,
  ) => Promise<Result<readonly ChangeRow[], ToolError>>
  readonly apply: (rows: readonly ChangeRow[], ctx: ToolContext) => Promise<ApplyReport>
}

const invalidInput = (message: string): ToolError => ({ kind: 'invalid_input', message })

export const defineReadTool = <P extends Params>(spec: ReadToolSpec<P>): ReadTool => ({
  kind: 'read',
  surface: spec.surface,
  definition: {
    name: spec.name,
    description: spec.description,
    inputSchema: toInputSchema(spec.params),
  },
  run: async (input, ctx) => {
    const parsed = parseParams(spec.params, input)
    return parsed.ok ? spec.run(parsed.value, ctx) : err(invalidInput(parsed.error))
  },
})

export const defineChangeTool = <P extends Params>(spec: ChangeToolSpec<P>): ChangeTool => ({
  kind: 'change',
  surface: spec.surface,
  definition: {
    name: spec.name,
    description: spec.description,
    inputSchema: toInputSchema(spec.params),
  },
  plan: async (input, ctx) => {
    const parsed = parseParams(spec.params, input)
    return parsed.ok ? spec.plan(parsed.value, ctx) : err(invalidInput(parsed.error))
  },
  apply: spec.apply,
})
