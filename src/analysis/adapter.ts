import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { parseEbur128Log } from './loudness.js'
import { parseProbeJson } from './probe.js'
import { err, ok, type Result } from './result.js'
import type { AnalysisError, AudioInfo, LoudnessMeasurement, PcmAudio } from './types.js'

export type Tools = {
  readonly ffmpeg: string
  readonly ffprobe: string
}

export const DEFAULT_TOOLS: Tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }

export const AUDIO_EXTENSIONS: readonly string[] = [
  '.wav',
  '.wave',
  '.aif',
  '.aiff',
  '.aifc',
  '.caf',
  '.flac',
  '.m4a',
  '.mp3',
]

type ProcessOutput = {
  readonly stdout: Buffer
  readonly stderr: string
}

const run = (
  tool: string,
  args: readonly string[],
): Promise<Result<ProcessOutput, AnalysisError>> =>
  new Promise((resolve) => {
    const child = spawn(tool, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error: NodeJS.ErrnoException) => {
      resolve(
        error.code === 'ENOENT'
          ? err({ kind: 'tool-missing', tool })
          : err({ kind: 'tool-failed', tool, exitCode: null, stderr: error.message }),
      )
    })
    child.on('close', (code) => {
      const stderrText = Buffer.concat(stderr).toString('utf8')
      resolve(
        code === 0
          ? ok({ stdout: Buffer.concat(stdout), stderr: stderrText })
          : err({ kind: 'tool-failed', tool, exitCode: code, stderr: stderrText.slice(-2000) }),
      )
    })
  })

export const probeAudio = async (
  path: string,
  tools: Tools = DEFAULT_TOOLS,
): Promise<Result<AudioInfo, AnalysisError>> => {
  const result = await run(tools.ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample,sample_fmt,duration:format=format_name,duration',
    '-of',
    'json',
    path,
  ])
  return result.ok ? parseProbeJson(path, result.value.stdout.toString('utf8')) : result
}

export const deinterleave = (bytes: Buffer, channelCount: number): readonly Float32Array[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frames = Math.floor(bytes.byteLength / (4 * channelCount))
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < channelCount; c++) {
      const channel = channels[c]
      if (channel) channel[frame] = view.getFloat32((frame * channelCount + c) * 4, true)
    }
  }
  return channels
}

export type DecodeStrategy = 'default' | 'manual-trailing-trim'

export const expectedFrames = (info: AudioInfo): number =>
  Math.round(info.durationSeconds * info.sampleRate)

export const decodeStrategy = (info: AudioInfo): DecodeStrategy =>
  info.codec === 'alac' && info.container === 'caf' ? 'manual-trailing-trim' : 'default'

const EXACT_LENGTH_CODECS: readonly string[] = ['alac', 'flac']

export const hasExactLength = (info: AudioInfo): boolean =>
  info.codec.startsWith('pcm_') || EXACT_LENGTH_CODECS.includes(info.codec)

export const checkDecodedLength = (
  info: AudioInfo,
  decodedFrames: number,
): Result<number, AnalysisError> => {
  const expected = expectedFrames(info)
  return hasExactLength(info) && expected > 0 && decodedFrames < expected - 1
    ? err({ kind: 'short-decode', path: info.path, expectedFrames: expected, decodedFrames })
    : ok(decodedFrames)
}

const decodeArgs = (info: AudioInfo, filters: readonly string[]): readonly string[] => {
  const manual = decodeStrategy(info) === 'manual-trailing-trim'
  const chain = [
    ...(manual ? [`atrim=end_sample=${String(expectedFrames(info))}`] : []),
    ...filters,
  ]
  return [
    ...(manual ? ['-flags2', '+skip_manual'] : []),
    '-i',
    info.path,
    '-map',
    '0:a:0',
    ...(chain.length > 0 ? ['-af', chain.join(',')] : []),
  ]
}

export const decodePcm = async (
  info: AudioInfo,
  tools: Tools = DEFAULT_TOOLS,
): Promise<Result<PcmAudio, AnalysisError>> => {
  const channelCount = Math.min(info.channels, 2)
  const result = await run(tools.ffmpeg, [
    '-v',
    'error',
    '-nostdin',
    ...decodeArgs(info, []),
    '-ac',
    String(channelCount),
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    'pipe:1',
  ])
  if (!result.ok) return result
  const channels = deinterleave(result.value.stdout, channelCount)
  const decodedFrames = channels[0]?.length ?? 0
  if (decodedFrames === 0) return err({ kind: 'empty-audio', path: info.path })
  const length = checkDecodedLength(info, decodedFrames)
  return length.ok ? ok({ sampleRate: info.sampleRate, channels }) : length
}

export const measureLoudnessOf = async (
  info: AudioInfo,
  tools: Tools = DEFAULT_TOOLS,
): Promise<Result<LoudnessMeasurement, AnalysisError>> => {
  const result = await run(tools.ffmpeg, [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-v',
    'info',
    ...decodeArgs(info, ['ebur128=peak=true:framelog=info']),
    '-f',
    'null',
    '-',
  ])
  return result.ok ? parseEbur128Log(result.value.stderr) : result
}

export const measureLoudness = async (
  path: string,
  tools: Tools = DEFAULT_TOOLS,
): Promise<Result<LoudnessMeasurement, AnalysisError>> => {
  const info = await probeAudio(path, tools)
  return info.ok ? measureLoudnessOf(info.value, tools) : info
}

export const isAudioFileName = (name: string): boolean =>
  !name.startsWith('.') && AUDIO_EXTENSIONS.includes(extname(name).toLowerCase())

export const listAudioFiles = async (
  directory: string,
): Promise<Result<readonly string[], AnalysisError>> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return ok(
      entries
        .filter((entry) => entry.isFile() && isAudioFileName(entry.name))
        .map((entry) => join(directory, entry.name))
        .sort(),
    )
  } catch (error) {
    return err({ kind: 'read-failed', path: directory, message: String(error) })
  }
}
