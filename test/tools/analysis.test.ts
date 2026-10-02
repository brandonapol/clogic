import { describe, expect, it } from 'vitest'
import { err, ok } from '../../src/analysis/result.js'
import { getLoudnessTool } from '../../src/llm/example-tools.js'
import {
  analyseMix,
  analysisTools,
  describeAnalysisError,
  getLoudness,
  type AnalysisDeps,
} from '../../src/tools/analysis.js'
import { loudness, mixReport } from './fixtures.js'

const ctx = { instanceId: 'i1' }

const recordingDeps = () => {
  const paths: string[] = []
  const deps: AnalysisDeps = {
    analyseFile: async (path) => {
      paths.push(path)
      return ok(mixReport)
    },
    measureLoudness: async (path) => {
      paths.push(path)
      return ok(loudness)
    },
  }
  return { deps, paths }
}

describe('analysis read tools', () => {
  it('are read tools on the analysis surface', () => {
    const tools = analysisTools(recordingDeps().deps)
    expect(tools.map((t) => [t.definition.name, t.kind, t.surface])).toEqual([
      ['get_loudness', 'read', 'analysis'],
      ['analyse_mix', 'read', 'analysis'],
    ])
  })

  it('get_loudness keeps the src/llm definition', () => {
    expect(getLoudness(recordingDeps().deps).definition).toEqual(getLoudnessTool)
  })

  it('get_loudness returns the measurement from the injected dependency', async () => {
    const { deps, paths } = recordingDeps()
    expect(await getLoudness(deps).run({ path: '/tmp/mix.wav' }, ctx)).toEqual(ok(loudness))
    expect(paths).toEqual(['/tmp/mix.wav'])
  })

  it('analyse_mix returns the full report', async () => {
    const { deps } = recordingDeps()
    expect(await analyseMix(deps).run({ path: '/tmp/mix.wav' }, ctx)).toEqual(ok(mixReport))
  })

  it('rejects relative paths without touching the file system', async () => {
    const { deps, paths } = recordingDeps()
    const result = await analyseMix(deps).run({ path: 'mix.wav' }, ctx)
    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid_input', message: 'path must be absolute, got mix.wav' },
    })
    expect(paths).toEqual([])
  })

  it('maps analysis errors to failed tool errors', async () => {
    const deps: AnalysisDeps = {
      analyseFile: async () => err({ kind: 'tool-missing', tool: 'ffmpeg' }),
      measureLoudness: async () => err({ kind: 'empty-audio', path: '/tmp/x.wav' }),
    }
    expect(await analyseMix(deps).run({ path: '/tmp/x.wav' }, ctx)).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'ffmpeg is not installed or not on the PATH' },
    })
    expect(await getLoudness(deps).run({ path: '/tmp/x.wav' }, ctx)).toEqual({
      ok: false,
      error: { kind: 'failed', message: '/tmp/x.wav contains no audio' },
    })
  })

  it('describes tool failures with the exit code', () => {
    expect(
      describeAnalysisError({ kind: 'tool-failed', tool: 'ffprobe', exitCode: 1, stderr: 'bad' }),
    ).toBe('ffprobe failed (exit code 1): bad')
  })
})
