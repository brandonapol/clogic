import { describe, expect, it } from 'vitest'
import { DB_FLOOR } from '../../src/analysis/db.js'
import { parseEbur128Log } from '../../src/analysis/loudness.js'

const frame = (m: string, s: string): string =>
  `[Parsed_ebur128_0 @ 0x1] t: 0.1   TARGET:-23 LUFS    M: ${m} S: ${s}     I: -23.0 LUFS       LRA:   0.0 LU  TPK: -3.0 -3.0 dBFS`

const summary = (integrated: string, peak: string): string => `[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         ${integrated} LUFS
    Threshold: -33.0 LUFS

  Loudness range:
    LRA:         6.5 LU
    Threshold: -43.0 LUFS
    LRA low:   -27.0 LUFS
    LRA high:  -20.5 LUFS

  True peak:
    Peak:       ${peak} dBFS
`

describe('parseEbur128Log', () => {
  it('reads the summary and the loudest momentary and short-term frames', () => {
    const log = [frame('-120.7', '-120.7'), frame('-18.2', '-19.9'), frame('-21.0', '-19.5')].join(
      '\n',
    )
    const result = parseEbur128Log(`${log}\n${summary('-23.0', '-1.2')}`)
    expect(result).toEqual({
      ok: true,
      value: {
        integratedLufs: -23,
        shortTermMaxLufs: -19.5,
        momentaryMaxLufs: -18.2,
        loudnessRangeLu: 6.5,
        loudnessRangeLowLufs: -27,
        loudnessRangeHighLufs: -20.5,
        truePeakDbtp: -1.2,
      },
    })
  })

  it('maps -inf peaks of silent files to the dB floor', () => {
    const result = parseEbur128Log(summary('-70.0', '-inf'))
    expect(result.ok && result.value.truePeakDbtp).toBe(DB_FLOOR)
    expect(result.ok && result.value.shortTermMaxLufs).toBe(-70)
  })

  it('returns an error value when there is no summary', () => {
    expect(parseEbur128Log('Invalid data found when processing input')).toEqual({
      ok: false,
      error: { kind: 'loudness-parse-failed', message: 'ebur128 summary not found' },
    })
  })

  it('returns an error value when the summary is incomplete', () => {
    const result = parseEbur128Log('Summary:\n  Integrated loudness:\n    I: -23.0 LUFS\n')
    expect(result.ok).toBe(false)
  })
})
