import { createHash } from 'node:crypto'
import {
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PLIST_BYTES, readLogicProjectMetadata } from '../../src/project/adapter.js'
import { real, toBinaryPlist, toXmlPlist, type Plain } from './plists.js'

const handleCalls: string[] = []

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const wrapped = Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn(value as (...args: unknown[]) => unknown) : value,
    ]),
  )
  const open = vi.fn(async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args)
    return new Proxy(handle, {
      get: (target, property, receiver) => {
        const value: unknown = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') return value
        handleCalls.push(String(property))
        return (value as (...a: unknown[]) => unknown).bind(target)
      },
    })
  })
  return { ...wrapped, open, default: { ...wrapped, open } }
})

type Files = Readonly<Record<string, Uint8Array | string>>

const writeBundle = (root: string, name: string, files: Files): string => {
  const bundle = join(root, name)
  mkdirSync(bundle, { recursive: true })
  Object.entries(files).forEach(([path, content]) => {
    mkdirSync(dirname(join(bundle, path)), { recursive: true })
    writeFileSync(join(bundle, path), content)
  })
  return bundle
}

const logic12 = (encode: (value: Plain) => Uint8Array): Files => ({
  'Resources/ProjectInformation.plist': encode({
    LastSavedFrom: 'Logic Pro 12.3.1 (6682)',
    BundleVersion: '2.0',
  }),
  'Alternatives/000/MetaData.plist': encode({
    BeatsPerMinute: real(120),
    SampleRate: 44100,
    NumberOfTracks: 1,
    SongKey: 'C',
    SongGenderKey: 'major',
    SongSignatureNumerator: 4,
    SongSignatureDenominator: 4,
    Version: 3,
  }),
  'Alternatives/000/ProjectData': new Uint8Array([0x23, 0x47, 0xc0, 0xab, 1, 2, 3]),
  'Alternatives/001/MetaData.plist': encode({ BeatsPerMinute: real(97), SampleRate: 48000 }),
  'Contents/PkgInfo': 'BNDLband',
})

const listFiles = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  )

const snapshot = (bundle: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    listFiles(bundle).map((path) => {
      const info = statSync(path, { bigint: true })
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
      return [relative(bundle, path), `${info.size}:${info.mtimeNs}:${info.mode}:${digest}`]
    }),
  )

const setTreeMode = (dir: string, fileMode: number, dirMode: number): void => {
  readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) setTreeMode(path, fileMode, dirMode)
    chmodSync(path, entry.isDirectory() ? dirMode : fileMode)
  })
  chmodSync(dir, dirMode)
}

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'clogic-project-'))
})
afterAll(() => {
  setTreeMode(root, 0o644, 0o755)
  rmSync(root, { recursive: true, force: true })
})

describe('readLogicProjectMetadata', () => {
  it.each([
    ['binary', toBinaryPlist],
    ['XML', toXmlPlist],
  ])('reads a bundle with %s plists', async (format, encode) => {
    const bundle = writeBundle(root, `${format}.logicx`, logic12(encode))
    expect(await readLogicProjectMetadata(bundle)).toEqual({
      ok: true,
      value: {
        projectInformation: {
          status: 'read',
          value: {
            savedWith: {
              raw: 'Logic Pro 12.3.1 (6682)',
              product: 'Logic Pro',
              version: '12.3.1',
              build: '6682',
            },
            bundleVersion: '2.0',
          },
        },
        alternatives: [
          {
            id: '000',
            metadata: {
              status: 'read',
              value: {
                tempoBpm: 120,
                sampleRateHz: 44100,
                key: { tonic: 'C', mode: 'major' },
                timeSignature: { numerator: 4, denominator: 4 },
                trackCount: 1,
                metadataVersion: 3,
              },
            },
          },
          { id: '001', metadata: { status: 'read', value: { tempoBpm: 97, sampleRateHz: 48000 } } },
        ],
      },
    })
  })

  it('reports missing, invalid and oversized plists per file', async () => {
    const bundle = writeBundle(root, 'damaged.logicx', {
      'Alternatives/000/ProjectData': 'x',
      'Alternatives/001/MetaData.plist': '<plist><dict>',
      'Alternatives/002/MetaData.plist': toXmlPlist(['not', 'a', 'dict']),
      'Alternatives/003/MetaData.plist': new Uint8Array(MAX_PLIST_BYTES + 1),
      'Alternatives/notes/MetaData.plist': toXmlPlist({}),
    })
    mkdirSync(join(bundle, 'Alternatives', '004', 'MetaData.plist'), { recursive: true })
    const result = await readLogicProjectMetadata(bundle)
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.value.projectInformation).toEqual({ status: 'missing' })
    expect(result.value.alternatives.map((a) => [a.id, a.metadata.status])).toEqual([
      ['000', 'missing'],
      ['001', 'invalid'],
      ['002', 'invalid'],
      ['003', 'too-large'],
      ['004', 'unreadable'],
    ])
    expect(result.value.alternatives[2]?.metadata).toEqual({
      status: 'invalid',
      error: { kind: 'not-a-dictionary', found: 'array' },
    })
  })

  it('reports a missing path, a file, and a folder that is not a Logic bundle', async () => {
    const missing = join(root, 'nope.logicx')
    expect(await readLogicProjectMetadata(missing)).toEqual({
      ok: false,
      error: { kind: 'not-found', path: missing },
    })
    const file = join(root, 'file.logicx')
    writeFileSync(file, 'x')
    expect(await readLogicProjectMetadata(file)).toEqual({
      ok: false,
      error: { kind: 'not-a-bundle', path: file },
    })
    const folder = writeBundle(root, 'folder', { 'readme.txt': 'hi' })
    expect(await readLogicProjectMetadata(folder)).toEqual({
      ok: false,
      error: { kind: 'not-a-bundle', path: folder },
    })
  })
})

describe('readLogicProjectMetadata read-only guarantee', () => {
  const WRITE_APIS = [
    'appendFile',
    'chmod',
    'chown',
    'copyFile',
    'cp',
    'lchown',
    'link',
    'lutimes',
    'mkdir',
    'mkdtemp',
    'rename',
    'rm',
    'rmdir',
    'symlink',
    'truncate',
    'unlink',
    'utimes',
    'writeFile',
  ] as const

  beforeEach(() => {
    vi.clearAllMocks()
    handleCalls.length = 0
  })

  it('opens files read-only, never writes, and leaves the bundle byte-identical', async () => {
    const bundle = writeBundle(root, 'guarded.logicx', logic12(toBinaryPlist))
    setTreeMode(bundle, 0o444, 0o555)
    const before = snapshot(bundle)

    const result = await readLogicProjectMetadata(bundle)

    expect(result.ok).toBe(true)
    expect(snapshot(bundle)).toEqual(before)
    const openCalls = vi.mocked(fsPromises.open).mock.calls
    expect(openCalls.length).toBeGreaterThan(0)
    openCalls.forEach(([, flags, mode]) => {
      expect(flags).toBe(constants.O_RDONLY)
      expect(mode).toBeUndefined()
    })
    expect(openCalls.map(([path]) => relative(bundle, String(path))).sort()).toEqual([
      'Alternatives/000/MetaData.plist',
      'Alternatives/001/MetaData.plist',
      'Resources/ProjectInformation.plist',
    ])
    expect([...new Set(handleCalls)].sort()).toEqual(['close', 'readFile', 'stat'])
    WRITE_APIS.forEach((name) => {
      expect(vi.mocked(fsPromises[name]), name).not.toHaveBeenCalled()
    })
  })

  it('never opens ProjectData', async () => {
    const bundle = writeBundle(root, 'projectdata.logicx', logic12(toXmlPlist))
    await readLogicProjectMetadata(bundle)
    const opened = vi.mocked(fsPromises.open).mock.calls.map(([path]) => String(path))
    expect(opened.some((path) => path.includes('ProjectData'))).toBe(false)
  })
})
