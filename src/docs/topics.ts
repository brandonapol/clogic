import type { DocTopic } from './types.js'

export const guideBaseUrl = 'https://support.apple.com/guide/logicpro/' as const

export const guideVersion = 'Logic Pro for Mac 12.3' as const

export const topicUrl = (topic: DocTopic): string => `${guideBaseUrl}${topic.path}/mac`

export const topics: readonly DocTopic[] = [
  {
    path: 'compressor-side-chain-parameters-lgce0b2501de',
    title: 'Compressor side chain parameters',
    description: 'Feeding another track, such as a kick, into the Compressor to trigger ducking.',
    keywords: ['sidechain', 'side chain', 'ducking', 'duck', 'kick', 'compressor', 'key input'],
  },
  {
    path: 'compressor-lgce44b18080',
    title: 'Compressor',
    description: 'The built-in dynamics compressor plug-in and its main controls.',
    keywords: ['compressor', 'compression', 'dynamics', 'threshold', 'ratio', 'attack', 'release'],
  },
  {
    path: 'mastering-assistant-overview-lgcp7f94da0b',
    title: 'Mastering Assistant overview',
    description: 'Automatic analysis and mastering chain on the stereo output.',
    keywords: ['mastering assistant', 'mastering', 'master', 'stereo out', 'finalize'],
  },
  {
    path: 'extract-vocal-instrumental-stems-stem-lgcp61bae908',
    title: 'Extract vocal and instrumental stems with Stem Splitter',
    description: 'Separating a mixed audio file into vocal, drum, bass and other stems.',
    keywords: [
      'stem splitter',
      'stem',
      'stems',
      'split',
      'separate',
      'vocal',
      'instrumental',
      'acapella',
    ],
  },
  {
    path: 'match-eq-overview-lgcef1edbfbe',
    title: 'Match EQ overview',
    description: 'Copying the tonal balance of a reference track onto your own audio.',
    keywords: ['match eq', 'match', 'eq', 'reference', 'reference track', 'tonal balance'],
  },
  {
    path: 'smart-tempo-overview-lgcp9281e70c',
    title: 'Smart Tempo overview',
    description: 'Detecting and following the tempo of recordings and imported audio.',
    keywords: ['smart tempo', 'tempo', 'bpm', 'beat detection', 'tempo map'],
  },
  {
    path: 'edit-pitch-and-timing-with-flex-pitch-lgcpc53e6bef',
    title: 'Edit pitch and timing with Flex Pitch',
    description: 'Correcting the pitch of individual notes in a monophonic recording.',
    keywords: ['flex pitch', 'pitch', 'tune', 'tuning', 'autotune', 'pitch correction', 'vocal'],
  },
  {
    path: 'bounce-a-project-to-an-audio-file-lgcp785a41c3',
    title: 'Bounce a project to an audio file',
    description: 'Rendering the whole mix to a single stereo file such as WAV or AIFF.',
    keywords: ['bounce', 'mixdown', 'render', 'wav', 'aiff', 'mp3', 'export mix', 'mix'],
  },
  {
    path: 'export-tracks-as-audio-files-lgcpb27f70f9',
    title: 'Export tracks as audio files',
    description: 'Writing each track out as its own audio file for stems or another studio.',
    keywords: [
      'export tracks',
      'every track',
      'all tracks',
      'separate audio files',
      'separate files',
      'track stems',
      'export',
    ],
  },
  {
    path: 'freeze-tracks-lgcpf1cbfd51',
    title: 'Freeze tracks',
    description: 'Temporarily rendering heavy tracks to reduce processor load.',
    keywords: ['freeze', 'frozen', 'cpu', 'processor', 'performance', 'unfreeze'],
  },
  {
    path: 'route-audio-via-send-effects-lgcp8ea0091c',
    title: 'Route audio via send effects',
    description: 'Sending signal from channels to a shared aux bus for reverb or delay.',
    keywords: ['send', 'sends', 'aux', 'bus', 'reverb', 'delay', 'send effect', 'return'],
  },
  {
    path: 'create-mix-subgroups-lgcp8e8310ed',
    title: 'Create mix subgroups',
    description: 'Combining several channels into one bus or summing stack for group processing.',
    keywords: ['subgroup', 'subgroups', 'summing stack', 'group bus', 'submix', 'bus'],
  },
  {
    path: 'use-vca-groups-lgcp4d50f425',
    title: 'Use VCA groups',
    description: 'Controlling the level of several channels from one VCA fader.',
    keywords: ['vca', 'vca fader', 'vca group', 'fader group', 'level'],
  },
  {
    path: 'choose-automation-modes-lgcpb1a6ab26',
    title: 'Choose automation modes',
    description: 'How Read, Touch, Latch and Write modes record and play back automation.',
    keywords: ['automation', 'automation mode', 'read', 'touch', 'latch', 'write', 'trim'],
  },
  {
    path: 'loudness-meter-lgce12d9d256',
    title: 'Loudness Meter',
    description: 'Metering integrated, short-term and momentary loudness in LUFS.',
    keywords: ['lufs', 'loudness', 'loudness meter', 'meter', 'integrated', 'lu', 'ebu'],
  },
  {
    path: 'comping-overview-lgcp317d758e',
    title: 'Comping overview',
    description: 'Building one performance from the best parts of several recorded takes.',
    keywords: ['comp', 'comping', 'takes', 'take folder', 'best take', 'quick swipe'],
  },
  {
    path: 'quantize-the-timing-of-notes-lgcpfa6e7f80',
    title: 'Quantize the timing of notes',
    description: 'Snapping MIDI notes to a rhythmic grid.',
    keywords: ['quantize', 'quantise', 'midi', 'notes', 'grid', 'timing', 'snap'],
  },
  {
    path: 'choose-a-session-player-type-and-style-lgcp9cf380ab',
    title: 'Choose a Session Player type and style',
    description: 'Adding a virtual drummer, bassist or keyboard player and picking how it plays.',
    keywords: ['session player', 'drummer', 'bass player', 'keyboard player', 'style', 'genre'],
  },
  {
    path: 'export-a-spatial-audio-project-dolby-atmos-lgcp258ed132',
    title: 'Export a Spatial Audio project for Dolby Atmos',
    description: 'Delivering a Dolby Atmos mix as an ADM BWF master file.',
    keywords: ['dolby atmos', 'atmos', 'adm', 'bwf', 'adm bwf', 'spatial audio', 'immersive'],
  },
  {
    path: 'copy-and-print-key-commands-lgcpeabb4c40',
    title: 'Copy and print key commands',
    description: 'Getting a text or printable list of your key command assignments.',
    keywords: ['key commands', 'shortcuts', 'keyboard shortcuts', 'printable', 'print', 'list'],
  },
  {
    path: 'lgcp68d9ced1',
    title: 'Browse, import and save key commands',
    description: 'Finding key commands and moving custom key command sets between Macs.',
    keywords: ['key commands', 'import', 'save', 'preset', 'key command set', 'shortcuts'],
  },
  {
    path: 'denoiser-overview-lgcef2cbe4bd',
    title: 'Denoiser overview',
    description: 'Reducing steady background noise such as hiss or hum in a recording.',
    keywords: [
      'denoise',
      'denoiser',
      'noise',
      'background noise',
      'hiss',
      'hum',
      'noise reduction',
    ],
  },
] as const
