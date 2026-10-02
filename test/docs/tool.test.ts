import { describe, expect, it } from 'vitest'
import { maxLimit, runSearchLogicDocs, searchLogicDocsTool } from '../../src/docs/index.js'

describe('searchLogicDocsTool', () => {
  it('is named search_logic_docs and requires a query', () => {
    expect(searchLogicDocsTool.name).toBe('search_logic_docs')
    expect(searchLogicDocsTool.inputSchema.required).toEqual(['query'])
  })
})

describe('runSearchLogicDocs', () => {
  it('returns links with the guide version', () => {
    const result = runSearchLogicDocs({ query: 'freeze tracks cpu' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.guideVersion).toBe('Logic Pro for Mac 12.3')
    expect(result.value.links[0]?.url).toBe(
      'https://support.apple.com/guide/logicpro/freeze-tracks-lgcpf1cbfd51/mac',
    )
    expect(result.value.links.length).toBeLessThanOrEqual(3)
  })

  it('returns only link fields', () => {
    const result = runSearchLogicDocs({ query: 'loudness meter lufs', limit: 1 })
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.links.map((link) => Object.keys(link).sort())).toEqual([
      ['description', 'score', 'title', 'url'],
    ])
  })

  it('returns an empty list when nothing matches', () => {
    expect(runSearchLogicDocs({ query: '' })).toEqual({
      ok: true,
      value: { guideVersion: 'Logic Pro for Mac 12.3', links: [] },
    })
  })

  it('rejects a missing or non-string query', () => {
    expect(runSearchLogicDocs({})).toEqual({ ok: false, error: { kind: 'invalid_query' } })
    expect(runSearchLogicDocs({ query: 3 })).toEqual({
      ok: false,
      error: { kind: 'invalid_query' },
    })
  })

  it.each([0, -1, 1.5, maxLimit + 1, '3'])('rejects limit %s', (limit) => {
    expect(runSearchLogicDocs({ query: 'freeze', limit })).toEqual({
      ok: false,
      error: { kind: 'invalid_limit' },
    })
  })

  it('honours a valid limit', () => {
    const result = runSearchLogicDocs({ query: 'export tracks audio key commands', limit: 2 })
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.links).toHaveLength(2)
  })
})
