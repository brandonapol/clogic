import { describe, expect, it } from 'vitest'
import { approvalPrompt, parseApproval } from '../../src/cli/approval.js'
import type { ChangeRow } from '../../src/tools/types.js'

const rows: readonly ChangeRow[] = [
  { id: 'Vox-fader', control: 'fader', location: 'Vox', before: -10, after: -6 },
  { id: 'Vox-mute', control: 'mute', location: 'Vox', before: true, after: false },
  { id: 'Bass-pan', control: 'pan', location: 'Bass', before: 0, after: -20 },
]

describe('parseApproval', () => {
  it('accepts every row on yes', () => {
    expect(parseApproval('y', rows)).toEqual({
      ok: true,
      value: ['Vox-fader', 'Vox-mute', 'Bass-pan'],
    })
    expect(parseApproval(' YES ', rows)).toMatchObject({ ok: true, value: { length: 3 } })
  })

  it('accepts no rows on no', () => {
    expect(parseApproval('n', rows)).toEqual({ ok: true, value: [] })
    expect(parseApproval('No', rows)).toEqual({ ok: true, value: [] })
  })

  it('accepts a subset by 1-based row number, ignoring duplicates', () => {
    expect(parseApproval('1,3', rows)).toEqual({ ok: true, value: ['Vox-fader', 'Bass-pan'] })
    expect(parseApproval('3 1 3', rows)).toEqual({ ok: true, value: ['Bass-pan', 'Vox-fader'] })
  })

  it('rejects empty, unknown and out of range answers', () => {
    expect(parseApproval('', rows)).toMatchObject({ ok: false })
    expect(parseApproval('maybe', rows)).toMatchObject({ ok: false })
    expect(parseApproval('0', rows)).toEqual({
      ok: false,
      error: 'Row numbers must be between 1 and 3',
    })
    expect(parseApproval('4', rows)).toMatchObject({ ok: false })
    expect(parseApproval('1.5', rows)).toMatchObject({ ok: false })
  })
})

describe('approvalPrompt', () => {
  it('offers row numbers only when there is more than one row', () => {
    expect(approvalPrompt(1)).toBe('Apply? [y]es / [n]o: ')
    expect(approvalPrompt(2)).toContain('row numbers')
  })
})
