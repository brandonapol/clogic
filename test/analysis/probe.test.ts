import { describe, expect, it } from 'vitest'
import { parseProbeJson } from '../../src/analysis/probe.js'

describe('parseProbeJson', () => {
  it('reads stream and format details', () => {
    const json = JSON.stringify({
      streams: [
        {
          codec_name: 'pcm_s24le',
          sample_fmt: 's32',
          sample_rate: '48000',
          channels: 2,
          bits_per_sample: 24,
          duration: '20.000000',
          bits_per_raw_sample: '24',
        },
      ],
      format: { format_name: 'caf', duration: '20.000000' },
    })
    expect(parseProbeJson('/a.caf', json)).toEqual({
      ok: true,
      value: {
        path: '/a.caf',
        container: 'caf',
        codec: 'pcm_s24le',
        sampleRate: 48000,
        channels: 2,
        bitDepth: 24,
        sampleFormat: 's32',
        durationSeconds: 20,
      },
    })
  })

  it('falls back to bits_per_sample and format duration', () => {
    const json = JSON.stringify({
      streams: [
        { codec_name: 'pcm_f32le', sample_rate: '44100', channels: 1, bits_per_sample: 32 },
      ],
      format: { format_name: 'wav', duration: '1.5' },
    })
    const result = parseProbeJson('/a.wav', json)
    expect(result.ok && result.value.bitDepth).toBe(32)
    expect(result.ok && result.value.durationSeconds).toBe(1.5)
  })

  it('reports a file without an audio stream', () => {
    expect(parseProbeJson('/v.mp4', JSON.stringify({ streams: [], format: {} }))).toEqual({
      ok: false,
      error: { kind: 'no-audio-stream', path: '/v.mp4' },
    })
  })

  it('reports unparseable output', () => {
    const result = parseProbeJson('/a.wav', 'not json')
    expect(!result.ok && result.error.kind).toBe('probe-parse-failed')
  })
})
