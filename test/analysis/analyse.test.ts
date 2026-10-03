import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyseFile, analyseStemFolder } from '../../src/analysis/analyse.js'
import type { AnalysisReport } from '../../src/analysis/types.js'
import { dbfs, pcm, renderLavfi, stereoTone } from './fixtures.js'
import { hasFfmpeg } from './signals.js'

const ffmpegTimeoutMs = 30_000

describe.skipIf(!hasFfmpeg())(
  'analyseFile against reference signals',
  { timeout: ffmpegTimeoutMs },
  () => {
    let dir = ''
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'clogic-analyse-'))
    })
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    const analyse = async (name: string, source: string): Promise<AnalysisReport> => {
      const result = await analyseFile(renderLavfi(dir, name, source))
      if (!result.ok) throw new Error(JSON.stringify(result.error))
      return result.value
    }

    it('EBU Tech 3341 case 2: stereo 1 kHz at -33 dBFS reads -33 LUFS', async () => {
      const report = await analyse('ebu-case2', stereoTone(dbfs(-33), 1000, 20))
      expect(Math.abs(report.loudness.integratedLufs + 33)).toBeLessThanOrEqual(0.1)
      expect(report.dynamics.samplePeakDbfs).toBeCloseTo(-33, 1)
      expect(report.dynamics.crestFactorDb).toBeCloseTo(3, 1)
      expect(report.stereo).toMatchObject({ kind: 'stereo', correlation: 1 })
    })

    it('EBU Tech 3342 case 1: 20 s at -20 dBFS then 20 s at -30 dBFS reads LRA 10 LU', async () => {
      const gain = `if(lt(t\\,20)\\,${dbfs(-20)}\\,${dbfs(-30)})`
      const tone = `${gain}*sin(2*PI*1000*t)`
      const report = await analyse('ebu-lra1', `aevalsrc=${tone}|${tone}:s=48000:d=40`)
      expect(Math.abs(report.loudness.loudnessRangeLu - 10)).toBeLessThanOrEqual(1)
      expect(report.loudness.shortTermMaxLufs).toBeCloseTo(-20, 0)
    }, 30_000)

    it('reads the true peak of a 1 kHz sine at -6.02 dBFS', async () => {
      const report = await analyse('tp-1k', 'aevalsrc=0.5*sin(2*PI*1000*t):s=48000:d=5')
      expect(Math.abs(report.loudness.truePeakDbtp + 6.02)).toBeLessThanOrEqual(0.1)
      expect(report.stereo).toEqual({ kind: 'mono' })
    })

    const truePeakCases = [
      { case: 15, hz: 12000, amplitude: 0.5, phase: '0', expected: -6 },
      { case: 16, hz: 12000, amplitude: 0.5, phase: 'PI/4', expected: -6 },
      { case: 17, hz: 8000, amplitude: 0.5, phase: 'PI/3', expected: -6 },
      { case: 18, hz: 6000, amplitude: 0.5, phase: '3*PI/8', expected: -6 },
      { case: 19, hz: 12000, amplitude: 1.41, phase: 'PI/4', expected: 3 },
    ] as const

    it.each(truePeakCases)(
      'EBU Tech 3341 case $case: tapered sine reads $expected dBTP within +0.2/-0.4 dB',
      async ({ case: n, hz, amplitude, phase, expected }) => {
        const tone = `${amplitude}*sin(2*PI*${hz}*t+${phase})`
        const taper = 'afade=t=in:d=0.01,afade=t=out:st=4.99:d=0.01'
        const report = await analyse(`ebu-tp${n}`, `aevalsrc=${tone}|${tone}:s=48000:d=5,${taper}`)
        expect(report.loudness.truePeakDbtp).toBeGreaterThanOrEqual(expected - 0.4)
        expect(report.loudness.truePeakDbtp).toBeLessThanOrEqual(expected + 0.2)
      },
    )

    it('sees the inter-sample peak 3 dB above the sample peak in case 16', async () => {
      const report = await analyse(
        'tp-intersample',
        'aevalsrc=0.5*sin(2*PI*12000*t+PI/4):s=48000:d=5,afade=t=in:d=0.01,afade=t=out:st=4.99:d=0.01',
      )
      expect(report.dynamics.samplePeakDbfs).toBeCloseTo(-9, 0)
      expect(report.loudness.truePeakDbtp - report.dynamics.samplePeakDbfs).toBeCloseTo(3, 0)
    })

    it('flags a loud, limited, phase-inverted mix', async () => {
      const report = await analyse(
        'bad-mix',
        'aevalsrc=0.99*sin(2*PI*80*t)|-0.99*sin(2*PI*80*t):s=48000:d=5',
      )
      const codes = report.findings.map((f) => f.code)
      expect(report.role).toBe('mix')
      expect(codes).toEqual(
        expect.arrayContaining([
          'true-peak-high',
          'streaming-normalisation',
          'negative-correlation',
          'mono-loss',
          'wide-low-end',
        ]),
      )
    })

    it('returns a tool failure for a missing file', async () => {
      const result = await analyseFile(join(dir, 'missing.wav'))
      expect(!result.ok && result.error.kind).toBe('tool-failed')
    })
  },
)

describe.skipIf(!hasFfmpeg())('analyseStemFolder', { timeout: ffmpegTimeoutMs }, () => {
  let dir = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clogic-stems-'))
    const stems = join(dir, 'stems')
    mkdirSync(stems)
    const env = '(0.5+0.5*sin(2*PI*2*t))'
    renderLavfi(
      stems,
      'kick',
      `aevalsrc=0.6*${env}*sin(2*PI*60*t):s=48000:d=6`,
      pcm('wav', 'pcm_s24le'),
    )
    renderLavfi(
      stems,
      'bass',
      'aevalsrc=0.3*sin(2*PI*62*t)+0.1*sin(2*PI*124*t):s=48000:d=6',
      pcm('aiff', 'pcm_s24be'),
    )
    renderLavfi(
      stems,
      'hats',
      'anoisesrc=a=0.2:c=white:r=48000:d=6,highpass=f=8000:p=2',
      pcm('caf', 'pcm_f32le'),
    )
    mkdirSync(join(dir, 'empty'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reports every stem and the kick/bass conflict, but not the hats', async () => {
    const result = await analyseStemFolder(join(dir, 'stems'))
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    const { stems, masking, findings } = result.value
    expect(stems.map((s) => s.name)).toEqual(['bass', 'hats', 'kick'])
    expect(stems.every((s) => s.report.role === 'stem')).toBe(true)
    expect(masking.kind).toBe('analysed')
    if (masking.kind !== 'analysed') return
    const pairs = masking.conflicts.map((c) => `${c.stemA}/${c.stemB}`)
    expect(pairs).toContain('bass/kick')
    expect(pairs.some((p) => p.includes('hats'))).toBe(false)
    const conflict = masking.conflicts.find((c) => c.stemA === 'bass' && c.stemB === 'kick')
    expect(conflict?.region).toMatch(/sub|low/)
    expect(findings.some((f) => f.code === 'stem-masking')).toBe(true)
  })

  it('returns no-stems for a folder without audio', async () => {
    const result = await analyseStemFolder(join(dir, 'empty'))
    expect(result).toEqual({ ok: false, error: { kind: 'no-stems', path: join(dir, 'empty') } })
  })
})
