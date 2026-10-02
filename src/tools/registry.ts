import { err, ok, type Result } from '../llm/result.js'
import type { JsonObject, JsonValue, ToolDefinition } from '../llm/types.js'
import type {
  ApplyReport,
  ChangeRow,
  Tool,
  ToolAnnotations,
  ToolContext,
  ToolError,
  ToolKind,
  ToolSurface,
} from './types.js'

export type Registry = {
  readonly tools: readonly Tool[]
}

export type ToolExecutor = {
  readonly run: (name: string, input: JsonObject) => Promise<Result<JsonValue, ToolError>>
  readonly plan: (
    name: string,
    input: JsonObject,
  ) => Promise<Result<readonly ChangeRow[], ToolError>>
  readonly apply: (name: string, rows: readonly ChangeRow[]) => Promise<ApplyReport>
}

const toolNamePattern = /^[a-zA-Z0-9_-]{1,64}$/

export const createRegistry = (tools: readonly Tool[]): Result<Registry, string> => {
  const names = tools.map((tool) => tool.definition.name)
  const invalid = names.find((name) => !toolNamePattern.test(name))
  if (invalid !== undefined) return err(`Invalid tool name: ${invalid}`)
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  if (duplicate !== undefined) return err(`Duplicate tool name: ${duplicate}`)
  return ok({ tools })
}

export const findTool = (registry: Registry, name: string): Tool | undefined =>
  registry.tools.find((tool) => tool.definition.name === name)

export const availableTools = (
  registry: Registry,
  surfaces: readonly ToolSurface[],
): readonly Tool[] => registry.tools.filter((tool) => surfaces.includes(tool.surface))

export const toolDefinitions = (tools: readonly Tool[]): readonly ToolDefinition[] =>
  tools.map((tool) => tool.definition)

export const toolKinds = (tools: readonly Tool[]): Readonly<Record<string, ToolKind>> =>
  Object.fromEntries(tools.map((tool) => [tool.definition.name, tool.kind]))

export const annotationsFor = (tool: Tool): ToolAnnotations =>
  tool.kind === 'read'
    ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    : { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }

const unknownTool = (name: string): ToolError => ({
  kind: 'unknown_tool',
  message: `No tool named ${name}`,
})

const wrongKind = (name: string, expected: ToolKind): ToolError => ({
  kind: 'unavailable',
  message: `${name} is not a ${expected} tool`,
})

const failure = (cause: unknown): ToolError => ({
  kind: 'failed',
  message: cause instanceof Error ? cause.message : String(cause),
})

export const registryExecutor = (registry: Registry, ctx: ToolContext): ToolExecutor => ({
  run: async (name, input) => {
    const tool = findTool(registry, name)
    if (tool === undefined) return err(unknownTool(name))
    if (tool.kind !== 'read') return err(wrongKind(name, 'read'))
    try {
      return await tool.run(input, ctx)
    } catch (cause) {
      return err(failure(cause))
    }
  },
  plan: async (name, input) => {
    const tool = findTool(registry, name)
    if (tool === undefined) return err(unknownTool(name))
    if (tool.kind !== 'change') return err(wrongKind(name, 'change'))
    try {
      return await tool.plan(input, ctx)
    } catch (cause) {
      return err(failure(cause))
    }
  },
  apply: async (name, rows) => {
    const tool = findTool(registry, name)
    const failAll = (message: string): ApplyReport => ({
      applied: [],
      failed: rows.map((row) => ({ id: row.id, message })),
    })
    if (tool === undefined) return failAll(unknownTool(name).message)
    if (tool.kind !== 'change') return failAll(wrongKind(name, 'change').message)
    try {
      return await tool.apply(rows, ctx)
    } catch (cause) {
      return failAll(failure(cause).message)
    }
  },
})
