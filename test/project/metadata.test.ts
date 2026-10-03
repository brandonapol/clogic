import { describe, expect, it } from 'vitest'
import {
  parseLogicVersion,
  parseMetaData,
  parseProjectInformation,
} from '../../src/project/metadata.js'
import { real, toBinaryPlist, toXmlPlist } from './plists.js'

const logic12MetaData = {
  BeatsPerMinute: real(120),
  SampleRate: 44100,
  NumberOfTracks: 24,
  SongKey: 'C',
  SongGenderKey: 'major',
  SongSignatureNumerator: 4,
  SongSignatureDenominator: 4,
  HasARAPlugins: false,
  isTimeCodeBased: false,
  SurroundFormatIndex: 5,
  Version: 3,
  AudioFiles: ['/Users/someone/Music/Song/Audio Files/Vox_01.wav'],
  SomethingNew: true,
}

describe('parseMetaData', () => {
  it.each([
    ['XML', toXmlPlist],
    ['binary', toBinaryPlist],
  ])('reads session facts from a Logic 12 style %s MetaData.plist', (_, encode) => {
    expect(parseMetaData(encode(logic12MetaData))).toEqual({
      ok: true,
      value: {
        tempoBpm: 120,
        sampleRateHz: 44100,
        key: { tonic: 'C', mode: 'major' },
        timeSignature: { numerator: 4, denominator: 4 },
        trackCount: 24,
        metadataVersion: 3,
      },
    })
  })

  it('tolerates an old save with only a Version key', () => {
    const bytes = toBinaryPlist({ Version: 3, AudioFiles: [], SamplerInstrumentsFiles: ['/a.exs'] })
    expect(parseMetaData(bytes)).toEqual({ ok: true, value: { metadataVersion: 3 } })
  })

  it('tolerates an empty dictionary', () => {
    expect(parseMetaData(toXmlPlist({}))).toEqual({ ok: true, value: {} })
  })

  it('accepts integer tempo and real sample rate', () => {
    const result = parseMetaData(toXmlPlist({ BeatsPerMinute: 97, SampleRate: real(48000) }))
    expect(result).toEqual({ ok: true, value: { tempoBpm: 97, sampleRateHz: 48000 } })
  })

  it('keeps a key without a mode', () => {
    expect(parseMetaData(toXmlPlist({ SongKey: 'F#' }))).toEqual({
      ok: true,
      value: { key: { tonic: 'F#' } },
    })
  })

  it('drops keys with the wrong type or impossible values', () => {
    const bytes = toXmlPlist({
      BeatsPerMinute: '120',
      SampleRate: 0,
      NumberOfTracks: real(2.5),
      SongKey: '  ',
      SongGenderKey: 'minor',
      SongSignatureNumerator: 7,
      Version: -1,
    })
    expect(parseMetaData(bytes)).toEqual({ ok: true, value: {} })
  })

  it('reports a root that is not a dictionary', () => {
    expect(parseMetaData(toXmlPlist([1]))).toEqual({
      ok: false,
      error: { kind: 'not-a-dictionary', found: 'array' },
    })
  })

  it('reports an unparseable plist', () => {
    const result = parseMetaData(new TextEncoder().encode('<plist><dict>'))
    expect(!result.ok && result.error.kind).toBe('invalid-plist')
  })
})

describe('parseProjectInformation', () => {
  it('reads the saving Logic version, bundle version and folder flag', () => {
    const bytes = toBinaryPlist({
      LastSavedFrom: 'Logic Pro 12.3.1 (6682)',
      BundleVersion: '2.0',
      HasProjectFolder: false,
      VariantNames: { '0': 'Song' },
    })
    expect(parseProjectInformation(bytes)).toEqual({
      ok: true,
      value: {
        savedWith: {
          raw: 'Logic Pro 12.3.1 (6682)',
          product: 'Logic Pro',
          version: '12.3.1',
          build: '6682',
        },
        bundleVersion: '2.0',
        hasProjectFolder: false,
      },
    })
  })

  it('tolerates missing keys', () => {
    expect(parseProjectInformation(toXmlPlist({}))).toEqual({ ok: true, value: {} })
  })
})

describe('parseLogicVersion', () => {
  it('splits product, version and build', () => {
    expect(parseLogicVersion('Logic Pro X 10.0.3 (2911.58)')).toEqual({
      raw: 'Logic Pro X 10.0.3 (2911.58)',
      product: 'Logic Pro X',
      version: '10.0.3',
      build: '2911.58',
    })
  })

  it('accepts a version without a build', () => {
    expect(parseLogicVersion('Logic Pro 11.2')).toEqual({
      raw: 'Logic Pro 11.2',
      product: 'Logic Pro',
      version: '11.2',
    })
  })

  it('keeps an unrecognised string raw', () => {
    expect(parseLogicVersion('Synthetic')).toEqual({ raw: 'Synthetic' })
  })
})
