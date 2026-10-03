import { mkdtempSync, writeFileSync } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandLines, indexOfCommand, runScript } from './run-script.js'

const script = 'ffmpeg/build-lgpl-ffmpeg.sh'
const isMacArm = platform() === 'darwin' && arch() === 'arm64'
const isLinuxX64 = platform() === 'linux' && arch() === 'x64'

const dryRun = runScript(script, ['--dry-run'], { WORK: '/tmp/clogic-ffmpeg-test' })
const lines = commandLines(dryRun.stdout)
const configure = lines.find((line) => line.includes('./configure')) ?? ''

describe('build-lgpl-ffmpeg.sh --dry-run', () => {
  it('succeeds and runs nothing', () => {
    expect(dryRun.status).toBe(0)
    expect(lines.length).toBeGreaterThan(5)
  })

  it('downloads the pinned release and verifies its sha256 before extracting', () => {
    const download = indexOfCommand(
      lines,
      /^\+ curl .*ffmpeg\.org\/releases\/ffmpeg-9\.0\.2\.tar\.xz$/,
    )
    const verify = indexOfCommand(lines, /^\+ verify sha256 [0-9a-f]{64} /)
    const extract = indexOfCommand(lines, /^\+ tar -xJf /)
    const configureAt = indexOfCommand(lines, /\.\/configure /)
    expect(download).toBeGreaterThanOrEqual(0)
    expect(download).toBeLessThan(verify)
    expect(verify).toBeLessThan(extract)
    expect(extract).toBeLessThan(configureAt)
  })

  it('configures an LGPL-only, audio-only, network-free build', () => {
    expect(configure).not.toMatch(/--enable-(gpl|nonfree|version3)\b/)
    for (const flag of [
      '--disable-gpl',
      '--disable-nonfree',
      '--disable-version3',
      '--disable-everything',
      '--disable-autodetect',
      '--disable-network',
      '--disable-ffplay',
    ]) {
      expect(configure).toContain(flag)
    }
    expect(configure).toMatch(/--enable-filter=\S*ebur128/)
    expect(configure).not.toMatch(/--enable-(decoder|encoder)=\S*(h264|hevc|libx26)/)
  })

  it('targets macOS arm64 with the Logic Pro minimum OS', () => {
    expect(configure).toContain('--arch=arm64')
    expect(configure).toContain('--target-os=darwin')
    expect(configure).toContain('-mmacosx-version-min=15.6')
  })

  it('asserts the licence after building and before copying artefacts', () => {
    const strip = indexOfCommand(lines, /^\+ strip /)
    const assert = indexOfCommand(lines, /assert-lgpl\.sh .*\/ffmpeg .*\/ffprobe$/)
    const copy = indexOfCommand(lines, /^\+ cp .*\/out\/bin\/ffmpeg /)
    expect(strip).toBeLessThan(assert)
    expect(assert).toBeLessThan(copy)
  })

  it('emits the buildconf, licence text and source offer as artefacts', () => {
    expect(dryRun.stdout).toContain(
      '-buildconf > /tmp/clogic-ffmpeg-test/dist/ffmpeg-buildconf.txt',
    )
    expect(dryRun.stdout).toContain('COPYING.LGPLv2.1')
    expect(dryRun.stdout).toContain(
      'write source offer > /tmp/clogic-ffmpeg-test/dist/SOURCE-OFFER.txt',
    )
  })
})

describe('build-lgpl-ffmpeg.sh --print-source-offer', () => {
  const offer = runScript(script, ['--print-source-offer'])

  it('names the version, source URL, checksum, licence and a contact', () => {
    expect(offer.status).toBe(0)
    expect(offer.stdout).toContain('FFmpeg 9.0.2')
    expect(offer.stdout).toContain('https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz')
    expect(offer.stdout).toMatch(/SHA-256 [0-9a-f]{64}/)
    expect(offer.stdout).toContain('version 2.1 or (at your')
    expect(offer.stdout).toContain('https://github.com/brandonapol/clogic/issues')
  })

  it('records the configure line without local paths or GPL switches', () => {
    const line = offer.stdout.split('\n').find((l) => l.includes('./configure')) ?? ''
    expect(line).toContain('--disable-everything')
    expect(line).not.toContain('--prefix')
    expect(line).not.toMatch(/--enable-(gpl|nonfree|version3)\b/)
  })

  it('matches the offer printed by --dry-run', () => {
    expect(dryRun.stdout).toContain(offer.stdout.trim())
  })
})

describe('build-lgpl-ffmpeg.sh real run', () => {
  it.skipIf(isMacArm)('refuses an unsupported host without the proxy opt-in', () => {
    const result = runScript(script, [], { WORK: mkdtempSync(join(tmpdir(), 'clogic-ffmpeg-')) })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unsupported host')
  })

  it.runIf(isLinuxX64)('stops on a tarball whose checksum does not match the pin', () => {
    const work = mkdtempSync(join(tmpdir(), 'clogic-ffmpeg-'))
    const tarball = join(work, 'tampered.tar.xz')
    writeFileSync(tarball, 'not the ffmpeg release')
    const result = runScript(script, [], {
      WORK: work,
      CLOGIC_FFMPEG_PROXY_BUILD: '1',
      CLOGIC_FFMPEG_TARBALL: tarball,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('checksum mismatch')
    expect(result.stderr).not.toContain('configure')
  })

  it('rejects unknown options', () => {
    expect(runScript(script, ['--enable-gpl']).status).toBe(2)
  })
})
