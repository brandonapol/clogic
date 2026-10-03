import { describe, expect, it } from 'vitest'
import { diagnosticsBundle } from '../../src/log/diagnostics.js'
import { anthropicLike, bearer, record } from './fixtures.js'

const versions = { clogic: '0.1.0', companion: '0.1.0', logicPro: '11.2' }
const os = { platform: 'darwin', release: '24.1.0', arch: 'arm64' }

const records = [
  record({
    event: 'chat.turn',
    fields: {
      provider: 'anthropic',
      text: 'please make my secret demo louder',
      messages: [{ role: 'user', text: 'hidden' }],
      inputTokens: 120,
    },
  }),
  record({
    level: 'error',
    event: 'analysis.failed',
    context: { component: 'analysis' },
    fields: {
      file: '/Users/sam/Music/Album Sessions/Track 01/lead vox.wav',
      error: 'ffmpeg could not read /Users/sam/Music/Album Sessions/Track 01/lead vox.wav',
    },
  }),
]

describe('diagnosticsBundle', () => {
  it('omits message contents by default', () => {
    const bundle = diagnosticsBundle({ generatedAt: 0, versions, os, records })
    expect(bundle.json).not.toContain('louder')
    expect(bundle.json).not.toContain('hidden')
    expect(bundle.text).not.toContain('louder')
    expect(bundle.report.includesContent).toBe(false)
    expect(bundle.report.records[0]?.fields).toEqual({
      provider: 'anthropic',
      text: '[CONTENT OMITTED]',
      messages: '[CONTENT OMITTED]',
      inputTokens: 120,
    })
  })

  it('includes message contents only when asked', () => {
    const bundle = diagnosticsBundle({
      generatedAt: 0,
      versions,
      os,
      records,
      includeContent: true,
    })
    expect(bundle.json).toContain('louder')
    expect(bundle.report.includesContent).toBe(true)
    expect(bundle.text).toContain('Message contents: included')
  })

  it('never includes audio paths beyond basenames', () => {
    const bundle = diagnosticsBundle({ generatedAt: 0, versions, os, records })
    expect(bundle.json).not.toContain('/Users')
    expect(bundle.json).not.toContain('Album Sessions')
    expect(bundle.report.records[1]?.fields).toEqual({
      file: 'lead vox.wav',
      error: 'ffmpeg could not read lead vox.wav',
    })
  })

  it('re-redacts records, versions and OS info', () => {
    const bundle = diagnosticsBundle({
      generatedAt: 0,
      versions: { ...versions, note: anthropicLike() },
      os: { ...os, home: '/Users/sam' },
      records: [record({ event: `boom ${bearer()}`, fields: { token: 'abc' } })],
      secrets: ['abc'],
      includeContent: true,
    })
    expect(bundle.json).not.toContain(anthropicLike())
    expect(bundle.json).not.toContain(bearer())
    expect(bundle.json).not.toContain('abc')
    expect(bundle.json).not.toContain('/Users')
  })

  it('produces parseable JSON and a readable text summary', () => {
    const bundle = diagnosticsBundle({
      generatedAt: Date.UTC(2026, 9, 3),
      versions,
      os,
      records,
    })
    expect(JSON.parse(bundle.json)).toEqual(bundle.report)
    expect(bundle.report).toMatchObject({
      format: 'clogic-diagnostics',
      formatVersion: 1,
      generatedAt: '2026-10-03T00:00:00.000Z',
      versions,
      os,
    })
    expect(bundle.text).toContain('Generated: 2026-10-03T00:00:00.000Z')
    expect(bundle.text).toContain('  logicPro: 11.2')
    expect(bundle.text).toContain('  platform: darwin')
    expect(bundle.text).toContain('Recent log records (2):')
    expect(bundle.text).toContain('ERROR analysis.failed')
    expect(bundle.text).toContain('Message contents: omitted')
  })
})
