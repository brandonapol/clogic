import { describe, expect, it } from 'vitest'
import { DANGEROUS_BUTTONS } from '../../../src/mcu/index.js'
import {
  mixerTools,
  setTrackMute,
  setTrackSolo,
  setTrackVolume,
  listTracks,
} from '../../../src/tools/mixer/index.js'
import { createRegistry, registryExecutor } from '../../../src/tools/registry.js'
import type { ChangeRow } from '../../../src/tools/types.js'
import { harness, hex, lcdNames, mixerSession } from './fixtures.js'

const ctx = { instanceId: 'i1' }

const kickWithoutCalibration = {
  strip: 1,
  name: 'Kick',
  faderPosition: 8192,
  volume: 'unknown',
  mute: 'off',
  solo: 'off',
}

const rowsOf = (result: { readonly ok: boolean; readonly value?: readonly ChangeRow[] }) =>
  result.ok ? (result.value ?? []) : []

describe('list_tracks', () => {
  it('lists named strips with fader, mute and solo state', async () => {
    const { deps } = harness(mixerSession())
    const result = await listTracks(deps).run({}, ctx)
    expect(result).toEqual({
      ok: true,
      value: {
        tracks: [
          {
            strip: 1,
            name: 'Kick',
            faderPosition: 8192,
            volume: '-10.0 dB',
            mute: 'off',
            solo: 'off',
          },
          {
            strip: 2,
            name: 'Snare',
            faderPosition: 12288,
            volume: '0.0 dB',
            mute: 'on',
            solo: 'off',
          },
          {
            strip: 3,
            name: 'LeadVo',
            faderPosition: null,
            volume: 'unknown',
            mute: 'unknown',
            solo: 'unknown',
          },
          {
            strip: 4,
            name: 'Bass',
            faderPosition: null,
            volume: 'unknown',
            mute: 'unknown',
            solo: 'flashing',
          },
          {
            strip: 5,
            name: 'Pad',
            faderPosition: null,
            volume: 'unknown',
            mute: 'unknown',
            solo: 'unknown',
          },
          {
            strip: 6,
            name: 'pad',
            faderPosition: null,
            volume: 'unknown',
            mute: 'unknown',
            solo: 'unknown',
          },
        ],
      },
    })
  })

  it('reports volume as unknown without a calibration', async () => {
    const { deps } = harness(mixerSession(), { calibrated: false })
    const result = await listTracks(deps).run({}, ctx)
    expect(result).toMatchObject({
      ok: true,
      value: { tracks: expect.arrayContaining([{ ...kickWithoutCalibration }]) },
    })
  })

  it('is unavailable before Logic has sent any track names', async () => {
    const { deps } = harness([])
    const result = await listTracks(deps).run({}, ctx)
    expect(result.ok || result.error.kind).toBe('unavailable')
  })
})

describe('set_track_volume', () => {
  it('previews the current and target volume without sending anything', async () => {
    const { deps, fake } = harness(mixerSession())
    const plan = await setTrackVolume(deps).plan({ track: 'Kick', db: -6.04 }, ctx)
    expect(plan).toEqual({
      ok: true,
      value: [
        {
          id: 'volume:0',
          control: 'volume',
          location: 'Kick',
          before: '-10.0 dB',
          after: '-6.0 dB',
        },
      ],
    })
    expect(fake.sent()).toEqual([])
  })

  it('sends fader touch, position and release when applied', async () => {
    const { deps, fake } = harness(mixerSession())
    const tool = setTrackVolume(deps)
    const rows = rowsOf(await tool.plan({ track: 'Snare', db: -10 }, ctx))
    expect(await tool.apply(rows, ctx)).toEqual({ applied: ['volume:1'], failed: [] })
    expect(fake.sent()).toEqual([hex('90 69 7F'), hex('E1 00 40'), hex('90 69 00')])
  })

  it('refuses with a clear error when the dB calibration is missing', async () => {
    const { deps, fake } = harness(mixerSession(), { calibrated: false })
    const plan = await setTrackVolume(deps).plan({ track: 'Kick', db: -6 }, ctx)
    expect(plan.ok).toBe(false)
    expect(plan.ok || plan.error.kind).toBe('unavailable')
    expect(plan.ok || plan.error.message).toMatch(/calibration has not been measured/)
    expect(fake.sent()).toEqual([])
  })

  it('refuses at apply time when the calibration has gone away', async () => {
    const { deps, fake } = harness(mixerSession())
    const rows = rowsOf(await setTrackVolume(deps).plan({ track: 'Kick', db: -6 }, ctx))
    const report = await setTrackVolume({ ...deps, calibration: () => undefined }).apply(rows, ctx)
    expect(report.applied).toEqual([])
    expect(report.failed[0]?.message).toMatch(/calibration has not been measured/)
    expect(fake.sent()).toEqual([])
  })

  it('refuses targets outside the calibrated range', async () => {
    const { deps } = harness(mixerSession())
    const plan = await setTrackVolume(deps).plan({ track: 'Kick', db: 12 }, ctx)
    expect(plan.ok || plan.error).toEqual({
      kind: 'invalid_input',
      message: '12 dB is outside the calibrated range -inf dB to 6.0 dB',
    })
  })
})

describe('set_track_mute and set_track_solo', () => {
  it('previews a mute as off to on', async () => {
    const { deps } = harness(mixerSession())
    expect(await setTrackMute(deps).plan({ track: 'Kick', on: true }, ctx)).toEqual({
      ok: true,
      value: [{ id: 'mute:0', control: 'mute', location: 'Kick', before: 'off', after: 'on' }],
    })
  })

  it('presses MUTE on the resolved strip when applied', async () => {
    const { deps, fake } = harness(mixerSession())
    const tool = setTrackMute(deps)
    const rows = rowsOf(await tool.plan({ track: 'Snare', on: false }, ctx))
    expect(await tool.apply(rows, ctx)).toEqual({ applied: ['mute:1'], failed: [] })
    expect(fake.sent()).toEqual([hex('90 11 7F'), hex('90 11 00')])
  })

  it('presses SOLO on the resolved strip when applied', async () => {
    const { deps, fake } = harness(mixerSession())
    const tool = setTrackSolo(deps)
    const rows = rowsOf(await tool.plan({ track: 'Kick', on: true }, ctx))
    expect(await tool.apply(rows, ctx)).toEqual({ applied: ['solo:0'], failed: [] })
    expect(fake.sent()).toEqual([hex('90 08 7F'), hex('90 08 00')])
  })

  it('proposes nothing when the track is already in the requested state', async () => {
    const { deps } = harness(mixerSession())
    expect(await setTrackMute(deps).plan({ track: 'Snare', on: true }, ctx)).toEqual({
      ok: true,
      value: [],
    })
  })

  it('refuses when the LED state is unknown or flashing', async () => {
    const { deps } = harness(mixerSession())
    const unknown = await setTrackMute(deps).plan({ track: 'Bass', on: true }, ctx)
    const flashing = await setTrackSolo(deps).plan({ track: 'Bass', on: false }, ctx)
    expect(unknown.ok || unknown.error.kind).toBe('unavailable')
    expect(flashing.ok || flashing.error.message).toMatch(/solo state of strip 4 is not known/)
  })

  it('fails a row whose state changed after the preview and sends nothing', async () => {
    const { deps, fake } = harness(mixerSession())
    const tool = setTrackMute(deps)
    const rows = rowsOf(await tool.plan({ track: 'Kick', on: true }, ctx))
    fake.receive(hex('90 10 7F'))
    expect(await tool.apply(rows, ctx)).toEqual({
      applied: [],
      failed: [{ id: 'mute:0', message: 'Kick mute changed since the preview: it is now on' }],
    })
    expect(fake.sent()).toEqual([])
  })

  it('fails a row whose track moved to another strip after the preview', async () => {
    const { deps, fake } = harness(mixerSession())
    const tool = setTrackMute(deps)
    const rows = rowsOf(await tool.plan({ track: 'Kick', on: true }, ctx))
    fake.receive(lcdNames(['Snare', 'Kick']))
    fake.receive(hex('90 11 00'))
    const report = await tool.apply(rows, ctx)
    expect(report.failed[0]?.message).toMatch(/moved to a different strip/)
    expect(fake.sent()).toEqual([])
  })

  it('reports a closed port as a failed row', async () => {
    const { deps, fake } = harness(mixerSession())
    const tool = setTrackMute(deps)
    const rows = rowsOf(await tool.plan({ track: 'Kick', on: true }, ctx))
    fake.close()
    expect(await tool.apply(rows, ctx)).toEqual({
      applied: [],
      failed: [{ id: 'mute:0', message: 'The MIDI port is closed' }],
    })
  })

  it('rejects rows that belong to a different control', async () => {
    const { deps, fake } = harness(mixerSession())
    const row: ChangeRow = {
      id: 'mute:0',
      control: 'mute',
      location: 'Kick',
      before: 'off',
      after: 'on',
    }
    const report = await setTrackSolo(deps).apply([row], ctx)
    expect(report.failed[0]?.message).toBe('Row is not a solo change')
    expect(fake.sent()).toEqual([])
  })
})

describe('strip name resolution', () => {
  it.each([
    ['exact name', 'Snare', false, 'mute:1'],
    ['surrounding spaces', '  Snare ', false, 'mute:1'],
    ['different case', 'snare', false, 'mute:1'],
    ['full name of a truncated strip', 'LeadVocals', true, 'mute:2'],
  ])('resolves by %s', async (_, track, on, id) => {
    const { deps } = harness([...mixerSession(), hex('90 12 00')])
    const plan = await setTrackMute(deps).plan({ track, on }, ctx)
    expect(rowsOf(plan).map((row) => row.id)).toEqual([id])
  })

  it('prefers an exact match over a case-insensitive one', async () => {
    const { deps } = harness([...mixerSession(), hex('90 14 00')])
    const plan = await setTrackMute(deps).plan({ track: 'Pad', on: true }, ctx)
    expect(rowsOf(plan).map((row) => row.id)).toEqual(['mute:4'])
  })

  it('refuses names that match more than one strip', async () => {
    const { deps } = harness(mixerSession())
    const plan = await setTrackMute(deps).plan({ track: 'PAD', on: true }, ctx)
    expect(plan.ok || plan.error).toEqual({
      kind: 'invalid_input',
      message:
        '"PAD" matches more than one visible track (strips 5, 6). Rename the tracks so their names are unique.',
    })
  })

  it('refuses unknown tracks and lists the visible ones', async () => {
    const { deps } = harness(mixerSession())
    const plan = await setTrackVolume(deps).plan({ track: 'Guitar', db: -3 }, ctx)
    expect(plan.ok || plan.error).toEqual({
      kind: 'invalid_input',
      message:
        'No visible track named "Guitar". Visible tracks: Kick, Snare, LeadVo, Bass, Pad, pad',
    })
  })

  it('does not treat a short prefix as a truncated name', async () => {
    const { deps } = harness(mixerSession())
    const plan = await setTrackMute(deps).plan({ track: 'Kickdrum', on: true }, ctx)
    expect(plan.ok).toBe(false)
  })
})

describe('mixerTools', () => {
  it('registers cleanly and routes plan and apply through the executor', async () => {
    const { deps, fake } = harness(mixerSession())
    const registry = createRegistry(mixerTools(deps))
    if (!registry.ok) throw new Error(registry.error)
    expect(registry.value.tools.map((tool) => [tool.definition.name, tool.kind])).toEqual([
      ['list_tracks', 'read'],
      ['set_track_volume', 'change'],
      ['set_track_mute', 'change'],
      ['set_track_solo', 'change'],
    ])
    expect(registry.value.tools.every((tool) => tool.surface === 'control_surface')).toBe(true)
    const executor = registryExecutor(registry.value, ctx)
    const rows = rowsOf(await executor.plan('set_track_volume', { track: 'Kick', db: 0 }))
    expect(fake.sent()).toEqual([])
    expect(await executor.apply('set_track_volume', rows)).toEqual({
      applied: ['volume:0'],
      failed: [],
    })
    expect(fake.sent()).toEqual([hex('90 68 7F'), hex('E0 00 60'), hex('90 68 00')])
  })

  it('never sends a dangerous control', async () => {
    const { deps, fake } = harness([...mixerSession(), hex('90 12 00'), hex('90 0A 00')])
    const executor = registryExecutor(
      (() => {
        const registry = createRegistry(mixerTools(deps))
        if (!registry.ok) throw new Error(registry.error)
        return registry.value
      })(),
      ctx,
    )
    const calls = [
      ['set_track_volume', { track: 'Kick', db: -3 }],
      ['set_track_volume', { track: 'Snare', db: 6 }],
      ['set_track_mute', { track: 'Kick', on: true }],
      ['set_track_mute', { track: 'LeadVocals', on: true }],
      ['set_track_solo', { track: 'Kick', on: true }],
      ['set_track_solo', { track: 'LeadVocals', on: true }],
    ] as const
    for (const [name, input] of calls) {
      const rows = rowsOf(await executor.plan(name, input))
      await executor.apply(name, rows)
    }
    const pressed = fake
      .sent()
      .filter((message) => message[0] === 0x90)
      .map((message) => message[1] ?? -1)
    expect(fake.sent().length).toBeGreaterThan(0)
    expect(pressed.filter((id) => DANGEROUS_BUTTONS.has(id))).toEqual([])
    expect(fake.sent().every((message) => message.length === 3)).toBe(true)
  })
})
