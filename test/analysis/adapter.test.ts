import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  decodePcm,
  deinterleave,
  isAudioFileName,
  listAudioFiles,
  measureLoudness,
  probeAudio,
} from '../../src/analysis/adapter.js'
import { dbfs, pcm, renderLavfi, stereoTone, type Encoding } from './fixtures.js'
import { hasFfmpeg } from './signals.js'

describe('deinterleave', () => {
  it('splits little-endian float32 frames into channels', () => {
    const bytes = Buffer.alloc(16)
    ;[0.5, -0.5, 0.25, -0.25].forEach((value, i) => bytes.writeFloatLE(value, i * 4))
    expect(deinterleave(bytes, 2).map((c) => [...c])).toEqual([
      [0.5, 0.25],
      [-0.5, -0.25],
    ])
  })

  it('drops a trailing partial frame', () => {
    expect(deinterleave(Buffer.alloc(12), 2)[0]).toHaveLength(1)
  })
})

describe('isAudioFileName', () => {
  it('accepts Logic bounce formats and rejects others', () => {
    expect(['a.wav', 'b.AIF', 'c.aiff', 'd.caf', 'e.flac'].every(isAudioFileName)).toBe(true)
    expect(['notes.txt', '.hidden.wav', 'project.logicx'].some(isAudioFileName)).toBe(false)
  })
})

describe('tool errors', () => {
  it('reports a missing ffprobe as a value', async () => {
    const result = await probeAudio('/nope.wav', { ffmpeg: 'ffmpeg', ffprobe: '/no/such/ffprobe' })
    expect(result).toEqual({ ok: false, error: { kind: 'tool-missing', tool: '/no/such/ffprobe' } })
  })

  it('reports an unreadable directory as a value', async () => {
    const result = await listAudioFiles('/no/such/dir')
    expect(!result.ok && result.error.kind).toBe('read-failed')
  })
})

describe.skipIf(!hasFfmpeg())('ffmpeg adapter', () => {
  let dir = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clogic-adapter-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const formats: readonly {
    readonly name: string
    readonly encoding: Encoding
    readonly bits: number
  }[] = [
    { name: 'wav 16-bit', encoding: pcm('wav', 'pcm_s16le'), bits: 16 },
    { name: 'wav 24-bit', encoding: pcm('wav', 'pcm_s24le'), bits: 24 },
    { name: 'wav 32-bit float', encoding: pcm('wav', 'pcm_f32le'), bits: 32 },
    { name: 'aiff 24-bit', encoding: pcm('aiff', 'pcm_s24be'), bits: 24 },
    { name: 'aiff 32-bit float', encoding: pcm('aiff', 'pcm_f32be'), bits: 32 },
    { name: 'caf 24-bit', encoding: pcm('caf', 'pcm_s24le'), bits: 24 },
    { name: 'caf 32-bit float', encoding: pcm('caf', 'pcm_f32le'), bits: 32 },
    {
      name: 'm4a alac 24-bit',
      encoding: { extension: 'm4a', args: ['-c:a', 'alac', '-sample_fmt', 's32p'] },
      bits: 24,
    },
  ]

  it.each(formats)('decodes $name', async ({ name, encoding, bits }) => {
    const source = 'aevalsrc=0.5*sin(2*PI*1000*t)|0.25*sin(2*PI*1000*t):s=48000:d=0.5'
    const path = renderLavfi(dir, name.replaceAll(' ', '-'), source, encoding)
    const info = await probeAudio(path)
    expect(info.ok).toBe(true)
    if (!info.ok) return
    expect(info.value).toMatchObject({ sampleRate: 48000, channels: 2, bitDepth: bits })
    const pcm = await decodePcm(info.value)
    if (!pcm.ok) throw new Error(JSON.stringify(pcm.error))
    const [left, right] = pcm.value.channels
    expect(left).toHaveLength(24000)
    expect(Math.max(...(left ?? []))).toBeCloseTo(0.5, 3)
    expect(Math.max(...(right ?? []))).toBeCloseTo(0.25, 3)
  })

  it('downmixes multichannel files to stereo for spectral analysis', async () => {
    const path = renderLavfi(
      dir,
      'surround',
      'aevalsrc=0.1*sin(2*PI*440*t)|0.1*sin(2*PI*440*t)|0.1*sin(2*PI*440*t)|0|0|0:s=48000:d=0.5:c=5.1',
    )
    const info = await probeAudio(path)
    if (!info.ok) throw new Error(JSON.stringify(info.error))
    expect(info.value.channels).toBe(6)
    const pcm = await decodePcm(info.value)
    expect(pcm.ok && pcm.value.channels.length).toBe(2)
  })

  it('measures EBU Tech 3341 case 1: stereo 1 kHz at -23 dBFS reads -23 LUFS', async () => {
    const path = renderLavfi(dir, 'ebu-case1', stereoTone(dbfs(-23), 1000, 20))
    const result = await measureLoudness(path)
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(Math.abs(result.value.integratedLufs + 23)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(result.value.shortTermMaxLufs + 23)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(result.value.momentaryMaxLufs + 23)).toBeLessThanOrEqual(0.1)
    expect(result.value.truePeakDbtp).toBeCloseTo(-23, 1)
  })

  it('reports a file that is not audio as a tool failure', async () => {
    const path = join(dir, 'fake.wav')
    writeFileSync(path, 'not audio')
    const result = await probeAudio(path)
    expect(!result.ok && result.error.kind).toBe('tool-failed')
  })

  it('lists only audio files in a stem folder, sorted', async () => {
    const stems = mkdtempSync(join(dir, 'stems-'))
    for (const name of ['b.wav', 'a.aif', 'readme.txt', '.c.wav']) {
      writeFileSync(join(stems, name), '')
    }
    const result = await listAudioFiles(stems)
    expect(result).toEqual({ ok: true, value: [join(stems, 'a.aif'), join(stems, 'b.wav')] })
  })
})
