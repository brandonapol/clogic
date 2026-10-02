import { describe, expect, it } from 'vitest'
import { err, ok } from '../../../src/analysis/result.js'
import { createRegistry, registryExecutor } from '../../../src/tools/registry.js'
import {
  analyseStemsTool,
  compareReferenceTool,
  listAudioFilesTool,
  MAX_ANALYSED_STEMS,
  STEMS_LIMITS,
  stemsTools,
} from '../../../src/tools/stems/index.js'
import { audioInfo, bands, conflict, fakeDeps, report, stemsReport } from './fixtures.js'

const ctx = { instanceId: 'i1' }

const failed = (message: string) => ({ ok: false, error: { kind: 'failed', message } })

const valueOf = (result: { readonly ok: boolean; readonly value?: unknown }): unknown =>
  result.ok ? result.value : undefined

describe('stemsTools', () => {
  it('are read tools on the analysis surface with valid unique names', () => {
    const tools = stemsTools(fakeDeps({}).deps)
    expect(tools.map((t) => [t.definition.name, t.kind, t.surface])).toEqual([
      ['analyse_stems', 'read', 'analysis'],
      ['compare_reference', 'read', 'analysis'],
      ['list_audio_files', 'read', 'analysis'],
    ])
    expect(createRegistry(tools).ok).toBe(true)
  })

  it('declare absolute path parameters', () => {
    const [stems, reference, list] = stemsTools(fakeDeps({}).deps)
    expect(stems?.definition.inputSchema.required).toEqual(['folder'])
    expect(reference?.definition.inputSchema.required).toEqual(['mix', 'reference'])
    expect(list?.definition.inputSchema.required).toEqual(['folder'])
  })
})

describe('analyse_stems', () => {
  it('summarises stems and masking conflicts with rounded numbers and labels', async () => {
    const { deps, calls } = fakeDeps(
      { '/stems': ['Bass.wav', 'Kick.wav'] },
      {
        analyseStems: async () =>
          ok(
            stemsReport(
              ['Bass', 'Kick'],
              [
                conflict('Bass', 'Kick', 0.876),
                conflict('Bass', 'Kick', 0.55, {
                  lowHz: 250.4,
                  highHz: 499.6,
                  region: 'lowMid',
                  louderStem: 'Kick',
                }),
              ],
            ),
          ),
      },
    )
    const result = await analyseStemsTool(deps).run({ folder: '/stems' }, ctx)
    expect(calls).toEqual(['stat /stems', 'list /stems'])
    expect(result).toEqual(
      ok({
        folder: '/stems',
        summary: '2 stems analysed; 2 masking conflicts (1 warning).',
        stemCount: 2,
        stems: [
          {
            name: 'Bass',
            durationSeconds: 180,
            integratedLufs: -9.8,
            truePeakDbtp: -0.9,
            loudnessRangeLu: 4.2,
            plrDb: 8.9,
            compression: 'moderate',
            stereo: 'stereo',
            correlation: 0.83,
            dominantBand: 'low',
            findings: ['[warning] Integrated loudness is high.'],
            omittedFindings: 0,
          },
          expect.objectContaining({ name: 'Kick' }),
        ],
        omittedStems: 0,
        masking: {
          status: 'analysed',
          conflictCount: 2,
          conflicts: [
            {
              severity: 'warning',
              stems: ['Bass', 'Kick'],
              rangeHz: '63-250',
              region: 'low',
              overlapPercent: 88,
              louderStem: 'Bass',
              levelDifferenceDb: 3.1,
            },
            {
              severity: 'info',
              stems: ['Bass', 'Kick'],
              rangeHz: '250-500',
              region: 'lowMid',
              overlapPercent: 55,
              louderStem: 'Kick',
              levelDifferenceDb: 3.1,
            },
          ],
          omittedConflicts: 0,
        },
        findings: [],
      }),
    )
  })

  it('passes every listed audio file to the analysis', async () => {
    const seen: (readonly string[])[] = []
    const { deps } = fakeDeps(
      { '/stems': ['Bass.wav', 'Kick.aif'] },
      {
        analyseStems: async (paths) => {
          seen.push(paths)
          return ok(stemsReport([], []))
        },
      },
    )
    await analyseStemsTool(deps).run({ folder: '/stems' }, ctx)
    expect(seen).toEqual([['/stems/Bass.wav', '/stems/Kick.aif']])
  })

  it('caps stems, per-stem findings and conflicts', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `Stem ${String(i)}`)
    const conflicts = Array.from({ length: 15 }, () => conflict('Stem 0', 'Stem 1', 0.6))
    const noisy = stemsReport(names, conflicts)
    const findings = Array.from({ length: 5 }, (_, i) => ({
      severity: i === 4 ? ('problem' as const) : ('info' as const),
      code: `c${String(i)}`,
      message: `finding ${String(i)}`,
    }))
    const withFindings = {
      ...noisy,
      stems: noisy.stems.map((s) => ({ ...s, report: { ...s.report, findings } })),
    }
    const { deps } = fakeDeps(
      { '/stems': names.map((n) => `${n}.wav`) },
      { analyseStems: async () => ok(withFindings) },
    )
    const value = valueOf(await analyseStemsTool(deps).run({ folder: '/stems' }, ctx))
    expect(value).toMatchObject({
      stemCount: 30,
      omittedStems: 30 - STEMS_LIMITS.maxStems,
      masking: { conflictCount: 15, omittedConflicts: 15 - STEMS_LIMITS.maxConflicts },
    })
    const summary = value as {
      readonly stems: readonly { readonly findings: readonly string[] }[]
      readonly masking: { readonly conflicts: readonly unknown[] }
    }
    expect(summary.stems).toHaveLength(STEMS_LIMITS.maxStems)
    expect(summary.masking.conflicts).toHaveLength(STEMS_LIMITS.maxConflicts)
    expect(summary.stems[0]?.findings).toEqual([
      '[problem] finding 4',
      '[info] finding 0',
      '[info] finding 1',
    ])
    expect(summary.stems[0]).toMatchObject({ omittedFindings: 2 })
  })

  it('reports why masking is unavailable and keeps other findings', async () => {
    const { deps } = fakeDeps(
      { '/stems': ['Vox.wav'] },
      {
        analyseStems: async () =>
          ok({
            ...stemsReport(['Vox'], []),
            masking: { kind: 'unavailable', reason: 'masking needs at least two stems' },
            findings: [
              {
                severity: 'info',
                code: 'masking-unavailable',
                message: 'masking needs at least two stems',
              },
              { severity: 'warning', code: 'other', message: 'Something else.' },
            ],
          }),
      },
    )
    expect(valueOf(await analyseStemsTool(deps).run({ folder: '/stems' }, ctx))).toMatchObject({
      summary: '1 stem analysed; masking unavailable: masking needs at least two stems.',
      masking: { status: 'unavailable', reason: 'masking needs at least two stems' },
      findings: ['[warning] Something else.'],
    })
  })

  it('fails on an empty folder without analysing', async () => {
    const { deps, calls } = fakeDeps({ '/stems': [] })
    expect(await analyseStemsTool(deps).run({ folder: '/stems' }, ctx)).toEqual(
      failed('No audio files found in /stems'),
    )
    expect(calls).toEqual(['stat /stems', 'list /stems'])
  })

  it('refuses folders with too many stems', async () => {
    const files = Array.from({ length: MAX_ANALYSED_STEMS + 1 }, (_, i) => `${String(i)}.wav`)
    const { deps, calls } = fakeDeps({ '/stems': files })
    const result = await analyseStemsTool(deps).run({ folder: '/stems' }, ctx)
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid_input' } })
    expect(calls.some((c) => c.startsWith('stems'))).toBe(false)
  })

  it('validates the folder before listing it', async () => {
    const { deps, calls } = fakeDeps({ '/songs/mix.wav': 'file' })
    expect(await analyseStemsTool(deps).run({ folder: 'stems' }, ctx)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input', message: 'folder must be absolute, got stems' },
    })
    expect(await analyseStemsTool(deps).run({ folder: '/nowhere' }, ctx)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input', message: 'folder does not exist: /nowhere' },
    })
    expect(await analyseStemsTool(deps).run({ folder: '/songs/mix.wav' }, ctx)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input' },
    })
    expect(calls.filter((c) => !c.startsWith('stat'))).toEqual([])
  })

  it('maps analysis errors to failed tool errors', async () => {
    const { deps } = fakeDeps(
      { '/stems': ['a.wav', 'b.wav'] },
      { analyseStems: async () => err({ kind: 'tool-missing', tool: 'ffmpeg' }) },
    )
    expect(await analyseStemsTool(deps).run({ folder: '/stems' }, ctx)).toEqual(
      failed('ffmpeg is not installed or not on the PATH'),
    )
  })
})

describe('compare_reference', () => {
  const files = { '/songs/mix.wav': 'file', '/refs/ref.flac': 'file' } as const

  it('summarises the comparison with labelled findings', async () => {
    const { deps, calls } = fakeDeps(files, {
      analyseFile: async (path) =>
        ok(
          path === '/songs/mix.wav'
            ? report(path, { findings: [] })
            : report(path, {
                loudness: { ...report(path).loudness, integratedLufs: -12.84 },
                dynamics: { ...report(path).dynamics, plrDb: 12.04 },
                spectrum: { bands: bands([-20, -9.04, -6, -8, -12, -18]) },
                stereo: { kind: 'mono' },
              }),
        ),
    })
    const result = await compareReferenceTool(deps).run(
      { mix: '/songs/mix.wav', reference: '/refs/ref.flac' },
      ctx,
    )
    expect(calls).toEqual(['stat /songs/mix.wav', 'stat /refs/ref.flac'])
    expect(result).toEqual(
      ok({
        mix: {
          file: 'mix.wav',
          integratedLufs: -9.8,
          truePeakDbtp: -0.9,
          loudnessRangeLu: 4.2,
          plrDb: 8.9,
          compression: 'moderate',
          stereo: 'stereo',
          correlation: 0.83,
        },
        reference: {
          file: 'ref.flac',
          integratedLufs: -12.8,
          truePeakDbtp: -0.9,
          loudnessRangeLu: 4.2,
          plrDb: 12,
          compression: 'moderate',
          stereo: 'mono',
          correlation: null,
        },
        differences: {
          integratedLu: 3,
          truePeakDb: 0,
          loudnessRangeLu: 0,
          plrDb: -3.1,
          correlation: null,
        },
        bands: [
          { band: 'sub', mixShareDb: -20, referenceShareDb: -20, diffDb: 0 },
          { band: 'low', mixShareDb: -4, referenceShareDb: -9, diffDb: 5 },
          { band: 'lowMid', mixShareDb: -6, referenceShareDb: -6, diffDb: 0 },
          { band: 'mid', mixShareDb: -8, referenceShareDb: -8, diffDb: 0 },
          { band: 'highMid', mixShareDb: -12, referenceShareDb: -12, diffDb: 0 },
          { band: 'air', mixShareDb: -18, referenceShareDb: -18, diffDb: 0 },
        ],
        findings: [
          '[warning] The low band carries 5 dB more of the energy than in the reference.',
          '[info] The mix is 3 LU louder than the reference.',
          '[info] The mix has 3.1 dB less peak-to-loudness ratio than the reference.',
        ],
        mixFindings: [],
      }),
    )
  })

  it('rejects non-audio files without touching them', async () => {
    const { deps, calls } = fakeDeps({ ...files, '/songs/notes.txt': 'file' })
    const result = await compareReferenceTool(deps).run(
      { mix: '/songs/mix.wav', reference: '/songs/notes.txt' },
      ctx,
    )
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid_input' } })
    expect(calls).toEqual(['stat /songs/mix.wav'])
  })

  it('rejects missing files and folders', async () => {
    const { deps, calls } = fakeDeps({ '/songs/mix.wav': 'file', '/refs/dir.wav': 'directory' })
    expect(
      await compareReferenceTool(deps).run(
        { mix: '/songs/gone.wav', reference: '/refs/x.wav' },
        ctx,
      ),
    ).toMatchObject({ ok: false, error: { message: 'mix does not exist: /songs/gone.wav' } })
    expect(
      await compareReferenceTool(deps).run(
        { mix: '/songs/mix.wav', reference: '/refs/dir.wav' },
        ctx,
      ),
    ).toMatchObject({ ok: false, error: { kind: 'invalid_input' } })
    expect(calls.some((c) => c.startsWith('analyse'))).toBe(false)
  })

  it('rejects comparing a file with itself', async () => {
    const { deps } = fakeDeps(files)
    expect(
      await compareReferenceTool(deps).run(
        { mix: '/songs/mix.wav', reference: '/songs/./mix.wav' },
        ctx,
      ),
    ).toEqual({
      ok: false,
      error: { kind: 'invalid_input', message: 'mix and reference must be different files' },
    })
  })

  it('maps analysis errors to failed tool errors', async () => {
    const { deps } = fakeDeps(files, {
      analyseFile: async (path) =>
        path === '/refs/ref.flac' ? err({ kind: 'no-audio-stream', path }) : ok(report(path)),
    })
    expect(
      await compareReferenceTool(deps).run(
        { mix: '/songs/mix.wav', reference: '/refs/ref.flac' },
        ctx,
      ),
    ).toEqual(failed('/refs/ref.flac has no audio stream'))
  })
})

describe('list_audio_files', () => {
  it('lists audio files with rounded durations and probe errors', async () => {
    const { deps } = fakeDeps(
      { '/bounces': ['mix.wav', 'broken.wav'] },
      {
        probeAudio: async (path) =>
          path.endsWith('broken.wav')
            ? err({ kind: 'no-audio-stream', path })
            : ok(audioInfo(path, 201.456)),
      },
    )
    expect(await listAudioFilesTool(deps).run({ folder: '/bounces' }, ctx)).toEqual(
      ok({
        directory: '/bounces',
        fileCount: 2,
        files: [
          {
            name: 'mix.wav',
            durationSeconds: 201.5,
            sampleRate: 48000,
            channels: 2,
            bitDepth: 32,
            codec: 'pcm_f32le',
          },
          { name: 'broken.wav', error: '/bounces/broken.wav has no audio stream' },
        ],
        omittedFiles: 0,
      }),
    )
  })

  it('caps the listing and only probes the files it shows', async () => {
    const names = Array.from({ length: STEMS_LIMITS.maxFiles + 5 }, (_, i) => `${String(i)}.wav`)
    const { deps, calls } = fakeDeps({ '/bounces': names })
    const value = valueOf(await listAudioFilesTool(deps).run({ folder: '/bounces' }, ctx))
    expect(value).toMatchObject({ fileCount: STEMS_LIMITS.maxFiles + 5, omittedFiles: 5 })
    expect(calls.filter((c) => c.startsWith('probe'))).toHaveLength(STEMS_LIMITS.maxFiles)
  })

  it('reports listing failures', async () => {
    const { deps } = fakeDeps(
      { '/bounces': [] },
      {
        listAudioFiles: async (path) =>
          err({ kind: 'read-failed', path, message: 'EACCES: permission denied' }),
      },
    )
    expect(await listAudioFilesTool(deps).run({ folder: '/bounces' }, ctx)).toEqual(
      failed('Could not read /bounces: EACCES: permission denied'),
    )
  })

  it('rejects relative paths and files', async () => {
    const { deps, calls } = fakeDeps({ '/songs/mix.wav': 'file' })
    expect(await listAudioFilesTool(deps).run({ folder: '../songs' }, ctx)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input' },
    })
    expect(await listAudioFilesTool(deps).run({ folder: '/songs/mix.wav' }, ctx)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_input' },
    })
    expect(calls).toEqual(['stat /songs/mix.wav'])
  })

  it('runs through the registry executor', async () => {
    const { deps } = fakeDeps({ '/bounces': ['mix.wav'] })
    const registry = createRegistry(stemsTools(deps))
    if (!registry.ok) throw new Error(registry.error)
    const result = await registryExecutor(registry.value, ctx).run('list_audio_files', {
      folder: '/bounces',
    })
    expect(result).toMatchObject({ ok: true, value: { fileCount: 1 } })
  })
})
