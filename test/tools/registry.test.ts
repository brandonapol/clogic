import { describe, expect, it } from 'vitest'
import { err, ok } from '../../src/llm/result.js'
import { defineChangeTool, defineReadTool } from '../../src/tools/define.js'
import { stringParam } from '../../src/tools/params.js'
import {
  annotationsFor,
  availableTools,
  createRegistry,
  registryExecutor,
  toolDefinitions,
  toolKinds,
} from '../../src/tools/registry.js'
import type { ChangeRow } from '../../src/tools/types.js'

const echo = defineReadTool({
  name: 'echo',
  description: 'Echoes text',
  surface: 'docs',
  params: { text: stringParam('Text') },
  run: async ({ text }) => ok({ text }),
})

const broken = defineReadTool({
  name: 'broken',
  description: 'Throws',
  surface: 'docs',
  params: {},
  run: async () => {
    throw new Error('boom')
  },
})

const applied: ChangeRow[][] = []

const rename = defineChangeTool({
  name: 'rename_track',
  description: 'Renames a track',
  surface: 'accessibility',
  params: { from: stringParam('Old name'), to: stringParam('New name') },
  plan: async ({ from, to }) =>
    from === to
      ? err({ kind: 'invalid_input', message: 'Names are the same' })
      : ok([{ id: 'r1', control: 'name', location: from, before: from, after: to }]),
  apply: async (rows) => {
    applied.push([...rows])
    return { applied: rows.map((row) => row.id), failed: [] }
  },
})

const registry = () => {
  const created = createRegistry([echo, broken, rename])
  if (!created.ok) throw new Error(created.error)
  return created.value
}

const ctx = { instanceId: 'i1' }

describe('createRegistry', () => {
  it('rejects duplicate names', () => {
    expect(createRegistry([echo, echo])).toEqual({ ok: false, error: 'Duplicate tool name: echo' })
  })

  it('rejects names providers cannot accept', () => {
    const bad = { ...echo, definition: { ...echo.definition, name: 'has space' } }
    expect(createRegistry([bad])).toEqual({ ok: false, error: 'Invalid tool name: has space' })
  })
})

describe('registry views', () => {
  it('filters by available surface and exposes provider-neutral definitions', () => {
    const tools = availableTools(registry(), ['docs'])
    expect(toolDefinitions(tools).map((d) => d.name)).toEqual(['echo', 'broken'])
    expect(toolDefinitions(tools)[0]?.inputSchema).toEqual({
      type: 'object',
      properties: { text: { type: 'string', description: 'Text' } },
      required: ['text'],
      additionalProperties: false,
    })
  })

  it('maps names to kinds', () => {
    expect(toolKinds(registry().tools)).toEqual({
      echo: 'read',
      broken: 'read',
      rename_track: 'change',
    })
  })

  it('derives MCP annotations from the kind', () => {
    expect(annotationsFor(echo).readOnlyHint).toBe(true)
    expect(annotationsFor(rename)).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
  })
})

describe('registryExecutor', () => {
  const executor = registryExecutor(registry(), ctx)

  it('runs a read tool with parsed input', async () => {
    expect(await executor.run('echo', { text: 'hi' })).toEqual({ ok: true, value: { text: 'hi' } })
  })

  it('returns invalid input as a value', async () => {
    expect(await executor.run('echo', {})).toEqual({
      ok: false,
      error: { kind: 'invalid_input', message: 'text is required' },
    })
  })

  it('turns a thrown error into a failed result', async () => {
    expect(await executor.run('broken', {})).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'boom' },
    })
  })

  it('reports unknown tools', async () => {
    const result = await executor.run('nope', {})
    expect(result.ok || result.error.kind).toBe('unknown_tool')
  })

  it('never runs a change tool through run', async () => {
    const result = await executor.run('rename_track', { from: 'a', to: 'b' })
    expect(result.ok || result.error.kind).toBe('unavailable')
    expect(applied).toHaveLength(0)
  })

  it('plans a change without applying it', async () => {
    const result = await executor.plan('rename_track', { from: 'Vox', to: 'Lead Vox' })
    expect(result).toEqual({
      ok: true,
      value: [{ id: 'r1', control: 'name', location: 'Vox', before: 'Vox', after: 'Lead Vox' }],
    })
    expect(applied).toHaveLength(0)
  })

  it('refuses to plan with a read tool', async () => {
    const result = await executor.plan('echo', { text: 'x' })
    expect(result.ok || result.error.kind).toBe('unavailable')
  })

  it('reports every row as failed when apply targets a read tool', async () => {
    const row = { id: 'r1', control: 'name', location: 'Vox', before: 'a', after: 'b' }
    expect(await executor.apply('echo', [row])).toEqual({
      applied: [],
      failed: [{ id: 'r1', message: 'echo is not a change tool' }],
    })
  })
})
