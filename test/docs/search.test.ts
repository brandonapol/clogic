import { describe, expect, it } from 'vitest'
import { searchTopics, tokenize, topics, topicUrl } from '../../src/docs/index.js'

const base = 'https://support.apple.com/guide/logicpro/'

const questions: readonly (readonly [string, string])[] = [
  ['How do I sidechain a compressor to the kick?', 'compressor-side-chain-parameters-lgce0b2501de'],
  ['How do I use Mastering Assistant?', 'mastering-assistant-overview-lgcp7f94da0b'],
  [
    'How do I split a song into vocal and instrumental stems?',
    'extract-vocal-instrumental-stems-stem-lgcp61bae908',
  ],
  ['How do I match the EQ of a reference track?', 'match-eq-overview-lgcef1edbfbe'],
  ['What does Smart Tempo do?', 'smart-tempo-overview-lgcp9281e70c'],
  ['How do I tune vocals with Flex Pitch?', 'edit-pitch-and-timing-with-flex-pitch-lgcpc53e6bef'],
  ['How do I bounce my mix to a WAV file?', 'bounce-a-project-to-an-audio-file-lgcp785a41c3'],
  [
    'How do I export every track as separate audio files?',
    'export-tracks-as-audio-files-lgcpb27f70f9',
  ],
  ['How do I freeze tracks to save CPU?', 'freeze-tracks-lgcpf1cbfd51'],
  ['How do I set up a reverb on a send?', 'route-audio-via-send-effects-lgcp8ea0091c'],
  ['How do I make a summing stack / subgroup?', 'create-mix-subgroups-lgcp8e8310ed'],
  ['How do VCA faders work?', 'use-vca-groups-lgcp4d50f425'],
  ['What is the difference between Read, Touch and Latch?', 'choose-automation-modes-lgcpb1a6ab26'],
  ['How do I measure LUFS loudness?', 'loudness-meter-lgce12d9d256'],
  ['How do I comp the best takes together?', 'comping-overview-lgcp317d758e'],
  ['How do I quantize MIDI notes?', 'quantize-the-timing-of-notes-lgcpfa6e7f80'],
  [
    'How do I add a Session Player and pick its style?',
    'choose-a-session-player-type-and-style-lgcp9cf380ab',
  ],
  [
    'How do I export a Dolby Atmos ADM BWF?',
    'export-a-spatial-audio-project-dolby-atmos-lgcp258ed132',
  ],
  ['Can I get a printable list of key commands?', 'copy-and-print-key-commands-lgcpeabb4c40'],
  ['How do I remove background noise from a recording?', 'denoiser-overview-lgcef2cbe4bd'],
]

describe('searchTopics', () => {
  it.each(questions)('finds the expected page in the top 3 for %s', (question, path) => {
    const urls = searchTopics(question, 3).map((link) => link.url)
    expect(urls).toContain(`${base}${path}/mac`)
  })

  it('ranks the expected page first for most questions', () => {
    const firsts = questions.filter(
      ([question, path]) => searchTopics(question, 1)[0]?.url === `${base}${path}/mac`,
    )
    expect(firsts.length).toBeGreaterThanOrEqual(18)
  })

  it('returns nothing for an empty or blank query', () => {
    expect(searchTopics('')).toEqual([])
    expect(searchTopics('   ?! ')).toEqual([])
  })

  it('returns nothing when no topic matches', () => {
    expect(searchTopics('zebra croissant xylophone')).toEqual([])
  })

  it('returns nothing for stop words only', () => {
    expect(searchTopics('how do I use Logic Pro')).toEqual([])
  })

  it('returns scores as positive numbers in descending order', () => {
    const links = searchTopics('compressor sidechain kick', 5)
    expect(links.length).toBeGreaterThan(1)
    expect(links.every((link) => link.score > 0)).toBe(true)
    const scores = links.map((link) => link.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('respects the limit', () => {
    expect(searchTopics('export audio tracks', 1)).toHaveLength(1)
    expect(searchTopics('export audio tracks', 0)).toEqual([])
  })

  it('is case insensitive', () => {
    expect(searchTopics('LUFS LOUDNESS')).toEqual(searchTopics('lufs loudness'))
  })

  it('searches a supplied topic list', () => {
    const custom = [{ path: 'x-lgcp0', title: 'Custom', description: 'd', keywords: ['widget'] }]
    expect(searchTopics('widget', 3, custom)).toEqual([
      { title: 'Custom', url: `${base}x-lgcp0/mac`, description: 'd', score: 2 },
    ])
  })
})

describe('tokenize', () => {
  it('lowercases, splits on punctuation and drops plural s', () => {
    expect(tokenize('Freeze Tracks, VCA/faders!')).toEqual(['freeze', 'track', 'vca', 'fader'])
  })
})

describe('topics', () => {
  it('uses only https support.apple.com Logic Pro guide URLs', () => {
    topics.forEach((topic) => {
      const url = new URL(topicUrl(topic))
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toBe('support.apple.com')
      expect(url.pathname.startsWith('/guide/logicpro/')).toBe(true)
      expect(url.pathname.endsWith('/mac')).toBe(true)
    })
  })

  it('ends every path with an Apple topic ID', () => {
    topics.forEach((topic) => expect(topic.path).toMatch(/(^|-)lg(cp|ce)[0-9a-f]+$/))
  })

  it('has unique paths', () => {
    const paths = topics.map((topic) => topic.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('covers every test question page', () => {
    const paths = new Set(topics.map((topic) => topic.path))
    questions.forEach(([, path]) => expect(paths.has(path)).toBe(true))
  })

  it('has a title, a one-line description and keywords for every topic', () => {
    topics.forEach((topic) => {
      expect(topic.title.length).toBeGreaterThan(0)
      expect(topic.description.length).toBeGreaterThan(0)
      expect(topic.description.length).toBeLessThanOrEqual(100)
      expect(topic.description).not.toContain('\n')
      expect(topic.keywords.length).toBeGreaterThan(0)
    })
  })
})
