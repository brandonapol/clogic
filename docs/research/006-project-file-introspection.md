# SPIKE-006: Logic project file introspection

Issue: [#6](https://github.com/brandonapol/clogic/issues/6)

## Question

Can we read anything useful from a `.logicx` project bundle without opening Logic: track list, plugins
per channel, routing, tempo, sample rate?

## Why it matters

Knowing the session layout (which plugins are on the vocal, what is bussed where) lets the assistant
give advice in context, even if we can never write to the file.

## Timebox

1 day

## Investigate

- [x] Bundle layout: `Alternatives/`, `Resources/`, `MetaData.plist`, `ProjectData`, audio file references.
- [x] What `MetaData.plist` exposes (tempo, key, sample rate, track count, ...).
- [x] `ProjectData` binary format: is anything readable (strings, plugin identifiers, channel strip
      names)? Check for existing community reverse-engineering work and its licence.
- [x] Channel strip settings (`.cst`) and plugin presets (`.aupreset`, `.pst`): readable formats?
      (`.aupreset` yes; `.cst` / `.pst` not checked on real files, see Mac check P5)
- [x] Read-only guarantee: never write to project files.
- [x] Export alternatives (AAF, Final Cut Pro XML, MIDI, stems) as a documented route to session info.
- [x] Legal constraints (building on SPIKE-011).

## Done when

- A script that prints whatever metadata can be extracted from a sample project
- A verdict: useful context source, or dead end

## Risks / unknowns

- Undocumented binary format may change between versions
- Possible licence or terms issues around reverse engineering

## Findings

Researched 2026-10-02 from Linux with WebSearch, WebFetch, `gh` and `curl`. No Mac and no Logic Pro:
macOS version n/a, Logic Pro version n/a. Two public sample bundles (Logic Pro X 10.0.3 and Logic Pro
12.3.1) were downloaded to `/tmp`, read with Python 3.14.7 `plistlib` and the spike script, and not
committed. Every source, with its date, licence and how it was read, is in
[notes/006-sources-2026-10-02.md](./notes/006-sources-2026-10-02.md). The script is in
[`research/006-project-file-introspection/`](../../research/006-project-file-introspection/README.md).
Anything marked **Mac check** is untested and must not be relied on until someone runs it.

**Verdict: partial.**

- **Go for the plists.** `Alternatives/NNN/MetaData.plist` and `Resources/ProjectInformation.plist`
  are ordinary Apple property lists. In a Logic 12.3.1 save they give tempo, sample rate, track count,
  key, time signature, the Logic version that saved the project, and the names of referenced audio,
  Sampler and impulse response files. That is cheap, low-risk context for the assistant ("120 BPM,
  44.1 kHz, C major, 24 tracks"). Older saves have fewer keys: the Logic Pro X 10.0.3 sample has no
  tempo, sample rate or track count.
- **Not yet for `ProjectData`.** It is an undocumented binary format. At least eight community
  projects (all created on GitHub in 2026) parse parts of it: track names, plug-ins per track, regions,
  MIDI. Only one, logicxkit (created September 2026, supports Logic 12.3.1 / 12.4 saves), claims to
  read sends, routing and plug-in settings; the others list routing and plug-in state as unknown. Their
  own docs say the format may change with any Logic release. So the data we want most (what is on the
  vocal, what is bussed where) has not been reliably decoded for the range of Logic versions users run.
  Do not build our own parser for v1. Read live mixer state through the control surface /
  Accessibility routes (SPIKE-004 / 005) instead, and revisit `ProjectData` after v1 for an offline,
  best-effort plug-in list.
- **Exports are a documented but manual alternative.** AAF and Final Cut Pro XML carry regions,
  positions and volume (and, for XML, other) automation but, per Apple's docs, no plug-in chains.
  Stems ("All Tracks as Audio Files") feed SPIKE-001 directly. None of them shows routing or plug-ins.

Done-when status: the script prints all the metadata named above from a sample project (run against
both samples, output below). The verdict is above.

### Bundle layout

A `.logicx` is a macOS package (a folder Finder shows as one file). Observed in the Logic Pro X 10.0.3
sample (`gh api .../git/trees`) and described the same way in lpx-explorer's format notes (Logic 11)
and the Library of Congress format description (updated 2025-02-04):

| Path                                       | Contents                                                                                      | Evidence                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Contents/PkgInfo`                         | 8 bytes: `BNDLband`                                                                           | 10.0.3 sample                                               |
| `Resources/ProjectInformation.plist`       | Binary plist: `LastSavedFrom`, `BundleVersion`, `VariantNames` (alternative names), flags     | Both samples                                                |
| `Alternatives/000/`, `001/`, ...           | One folder per project alternative (zero-padded index)                                        | Both samples; lpx-explorer                                  |
| `Alternatives/NNN/ProjectData`             | The project itself: undocumented binary                                                       | Both samples                                                |
| `Alternatives/NNN/MetaData.plist`          | Binary plist of project-level facts (below)                                                   | Both samples                                                |
| `Alternatives/NNN/DisplayState.plist`      | Window / screenset state (`screensetDictArray`, `docPreferences`, ...)                        | 10.0.3 sample; 12.3.1 corpus also has `DisplayStateArchive` |
| `Alternatives/NNN/WindowImage.jpg`         | Screenshot of the last-saved window                                                           | 10.0.3 sample                                               |
| `Alternatives/NNN/Project File Backups/NN` | Earlier saves, each with its own `ProjectData` and `MetaData.plist` (`00`–`09` in the sample) | 10.0.3 sample; Wit PR #64 calls it a ring buffer            |
| `Alternatives/NNN/Autosave/`               | Autosave folder (empty in the sample)                                                         | 10.0.3 sample                                               |
| `Alternatives/NNN/Undo Data.nosync`        | Undo history                                                                                  | lpx-explorer notes (Logic 11); not seen in samples          |
| `Media/Audio Files/` (and other `Media/`)  | Copied audio, when assets are kept in the package                                             | LoC; lpx-explorer                                           |

Projects saved as a folder keep audio in a sibling `Audio Files` folder next to the `.logicx`
(logic2ableton README; `HasProjectFolder` in `ProjectInformation.plist`). **Mac check P2.**

### `MetaData.plist` and `ProjectInformation.plist`

Read with the spike script (keys it does not know are listed, not dropped):

| Key                                                                          | Logic Pro X 10.0.3 sample             | Logic Pro 12.3.1 sample                      |
| ---------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| `BeatsPerMinute`                                                             | absent                                | `120.0`                                      |
| `SampleRate`                                                                 | absent                                | `44100`                                      |
| `NumberOfTracks`                                                             | absent                                | `1`                                          |
| `SongKey`, `SongGenderKey`                                                   | absent                                | `C`, `major`                                 |
| `SongSignatureNumerator`, `SongSignatureDenominator`                         | absent                                | `4`, `4`                                     |
| `HasARAPlugins`, `isTimeCodeBased`, `HasGrid`                                | absent                                | `False`, `False`, `False`                    |
| `SurroundFormatIndex`, `SurroundModeIndex`, `FrameRateIndex`, `SignatureKey` | absent                                | `5`, `0`, `1`, `7` (meaning not established) |
| `AudioFiles`, `UnusedAudioFiles`, `PlaybackFiles`, `VideoFiles`              | present, empty                        | present, empty                               |
| `SamplerInstrumentsFiles`, `ImpulsResponsesFiles`                            | 6 `.exs` and 5 `.SDIR` absolute paths | present, empty                               |
| `QuicksamplerFiles`                                                          | absent                                | present, empty                               |
| `Version`                                                                    | `3`                                   | `3`                                          |
| `LastSavedFrom` (ProjectInformation)                                         | `Logic Pro X 10.0.3 (2911.58)`        | `Logic Pro 12.3.1 (6682)`                    |
| `BundleVersion` (ProjectInformation)                                         | `1.0`                                 | `2.0`                                        |

- The keys match those named by Wit PR #64 (2026-09-30), lpx-explorer and logicx-analyzer. Wit reports
  `BeatsPerMinute` "matches ... on every save". It is the project's **starting** tempo; tempo changes
  live in `ProjectData` (logic2ableton: "Logic's tempo track is not decoded").
- Which Logic version added the tempo / sample rate keys is unknown (somewhere between 10.0.3 and 11).
  **Mac check P3.** The assistant must treat every key as optional.
- File lists hold **absolute paths** (e.g. `/Library/Audio/Impulse Responses/Apple/...`); user audio
  paths will contain the macOS user name. Send basenames only to an LLM provider (SPIKE-011 privacy).
  The script already reduces them to basenames.
- These plists are what Logic writes on save. Unsaved changes in an open session are not in them.

### `ProjectData`

Observed in both samples (`od`, Python byte counts):

- Both start with bytes `23 47 c0 ab`, in saves from Logic 10.0.3 (2013 era) and 12.3.1.
  logicx-analyzer reports the same magic. A second copy of the magic appears within the first 64 bytes.
- The file is a sequence of chunks tagged with four-character codes stored reversed: `gnoS` (Song),
  `karT` (Track), `qeSM`, `qSvE`, `UCuA`, `ivnE`, `tSnI`. Counts in the 12.3.1 one-track sample:
  `karT` 23, `UCuA` 16, `qeSM` 14. logicx-analyzer and lpx-explorer describe the same tags and say
  numbers are mostly big-endian with exceptions; jonkubis/LogicProFormatWriter calls it little-endian.
  The disagreement itself shows how provisional public knowledge is.
- Plain `strings` already show useful text: Apple plug-in names (`Channel EQ`, `Compressor`,
  `Multipressor`, `Linear EQ`, `Limiter`, `EXS24`, `Klopfgeist`), default strip names (`Audio 1`,
  `Inst 1`, `Aux 1`, `Bus 1` ... `Output 1`), patch names (`Steinway Grand Piano`), and embedded
  `bplist00` / `NSKeyedArchiver` blobs holding Smart Controls mappings. Strings alone cannot say which
  plug-in is on which channel, or whether a strip exists or is just a name in a template table (the
  10.0.3 sample lists `Audio 1` ... `Audio 56+` and `Bus 1` ... `Bus 14+`).
- lpx-explorer's notes: third-party Audio Units are stored as a reversed `manufacturer / type /
subtype` 4CC triple (type `umua`, `xfua`, `fmua`, `imua`); Apple's stock plug-ins are not, and sit in
  slot records anchored on `GAME`. The spike script implements the triple scan from that description
  (no code copied). Neither sample has a third-party plug-in, so the triple scan returned nothing on
  real data; `GAME` occurs 88 times (10.0.3) and 20 times (12.3.1). **Mac check P4.**
- No sign of encryption or compression: the plists and archived blobs are in the clear and printable
  strings are dense. This matters for SPIKE-011 (no technical protection measure seen). Not proven.

### Existing open-source readers

| Project                                               | Licence    | Reads                                                                                   | Claimed coverage                                                                                                      | Usable by us?                                                                  |
| ----------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| geoffmyers/logicx-analyzer                            | GPL-3.0    | Plists; plug-ins, Session Players presets, generic track / region names, chunk stats    | "about 60%" decoded; custom track names, MIDI notes, automation, mixer strips, third-party state unknown; Logic 10–11 | **No code** (GPL, AGENTS.md rule 9). Facts in its docs are fine to cite.       |
| rhydlewis/lpx-explorer                                | GPL-3.0    | Tempo, time sig, sample rate, key; tracks with kind, user names, insert chains; AU list | Sends / buses not covered; "Bus signatures are deliberately not in the whitelist"; Logic 11                           | **No code** (GPL). Its `docs/logicx-format.md` is the best public description. |
| Evilander/logic2ableton                               | MIT        | Tempo, time sig, track names and colours, MIDI regions, audio region placement, markers | Not: tempo track, automation, bus / send routing, plug-in parameters; Logic 10.6 and 11                               | Possible, with credit. Python. Not plug-ins or routing.                        |
| phierceweb/logicxkit                                  | Apache-2.0 | Tracks, regions, mixer, plug-in settings, MIDI; **also writes projects** (to a copy)    | "Logic Pro 12.3.1 or 12.4", reads an 11.2 project; one internal format version (2513)                                 | Possible, readers only, with credit and NOTICE. Very new (2 stars).            |
| terryTM/amt-logic-companion                           | MIT        | Note regions, tempo, key, meter                                                         | Logic 10.7 and 12.0                                                                                                   | Narrow (MIDI). Has an opt-in experimental write mode we would not use.         |
| sep-lab/Wit                                           | Apache-2.0 | MetaData.plist, audio file list, region records, backups                                | "never reads Logic's tempo/meter map"                                                                                 | Reference only.                                                                |
| MongLong0214/logic-pro-mcp                            | MIT        | Saved project metadata as fallback; live state via MCU, AX, AppleScript, Scripter, MIDI | Not documented in detail                                                                                              | Prior art for SPIKE-003/004/005 more than for this spike.                      |
| jonkubis/LogicProFormatWriter, audiohacking/daw2logic | MIT / none | Write synthetic `ProjectData`                                                           | n/a                                                                                                                   | Not relevant (writers). daw2logic has no licence: do not use.                  |

All of these repositories were created between January and September 2026 (`created_at`) and most
have a handful of stars. None is maintained by a company, none promises compatibility with future Logic
versions, and each was checked against a small corpus. Treat their claims as leads, not facts, until checked on our own
projects (**Mac check P4**).

### Channel strip settings and presets

- `.aupreset`: a property list using AudioToolbox keys (`kAUPresetVersionKey` = `version`,
  `kAUPresetTypeKey` = `type`, `kAUPresetDataKey` = `data`, plus subtype / manufacturer / name).
  Readable with `plistlib`; `data` is the plug-in's own opaque state.
- `.pst` (Logic plug-in setting; folder reported as `~/Library/Application Support/Logic/Plug-In
Settings/` or under `~/Music/Audio Music Apps/` depending on version, unverified): binary,
  undocumented. A 2017 blog reverse-engineered the ES M synth's `.pst` by diffing (28-byte
  fixed header, then one value per 8 bytes). One plug-in, eight years ago.
- `.cst` (channel strip setting, `~/Music/Audio Music Apps/Channel Strip Settings/<type>/` per Apple's
  Logic 9 / 10.1 guides and Apple Community): format not found anywhere. The string `#default.pst`
  appears in both `ProjectData` samples, suggesting embedded plug-in settings, unverified. **Mac check P5.**
- These files only describe presets the user saved, not the current session. Low value for SPIKE-006.

### Export alternatives

All are user-initiated (or driven via SPIKE-005) and documented by Apple:

| Export (File > Export)                     | What Apple says it contains                                                                                                               | Gives routing / plug-ins? | Use                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| Project as AAF File                        | "all used regions, inclusive of track and position references, and volume automation" (10.1 guide), audio as WAVE/AIFF                    | No                        | Track names and layout; needs an AAF reader (none chosen, licence check needed) |
| Project to Final Cut Pro XML               | Audio tracks, region positions and names, "supports automation data"; software instruments bounced, "MIDI tracks are ignored"             | No (not documented)       | Track names and layout from documented XML                                      |
| Selection as MIDI File                     | MIDI regions as Standard MIDI File                                                                                                        | No                        | Arrangement / notes                                                             |
| All Tracks as Audio Files / Track as Audio | One file per audio, software instrument and Drummer track; options "Bypass Effect Plug-ins", "Include Volume/Pan Automation", "Normalize" | No                        | Stems for SPIKE-001 analysis                                                    |

Exporting can be slow (real-time bounces for XML when external instruments are used) and is a user
action, so it suits "analyse my mix" flows, not quick context. Whether current (12.x) AAF / XML exports
include plug-in names or bus routing is not documented. **Mac check P6.**

### Read-only guarantee

- Open files with read-only flags only; never `open(..., 'w')`, never rename or touch.
- Read from a **copy** when possible, or at least check that Logic does not have the project open:
  Logic writes `ProjectData`, backups, autosave and undo data inside the bundle, and logicx-analyzer
  asks users to close the project first.
- Hash the bundle before and after, and refuse to continue on any change. The spike script does this
  (size, mtime, SHA-256 for every file; exit 1 and `"readOnlyCheck": "CHANGED"`); lpx-explorer has an
  equivalent test and a bytes-only parser API, a good pattern for `src/`.
- Never use the writer tools listed above, even on copies, in the product (AGENTS.md rule 8).

### Legal constraints

Building on [SPIKE-011](./011-legal-and-licensing.md) (row 6, "Reverse engineering"); not legal
advice:

- Reading plists Logic writes in a standard Apple format is ordinary file reading. Lowest risk.
- Parsing `ProjectData` by observing the user's own files (create a project, change one thing, diff)
  is black-box study of data, not decompiling Logic. CJEU C-406/10 says data file formats are not
  protected expression; EU Directive 2009/24/EC Art. 5(3) / 6 / 8 protect observation and
  interoperability work. In the US, Logic SLA §2G bans reverse engineering "the Apple Software" with a
  "prohibited by applicable law" carve-out, and §1201(f) is only an anti-circumvention exception. How
  far §2G reaches files the user creates is open (SPIKE-011 lawyer question 4).
- No encryption was seen, so §1201 circumvention does not appear to arise. If a future Logic version
  encrypts or signs `ProjectData`, stop and ask counsel.
- Never disassemble Logic to learn the format. Do not reuse GPL readers' code (rule 9); facts from
  their docs may be cited. MIT / Apache code needs credit (and Apache NOTICE) under rule 10.
- The current Logic Pro 12 licence text is still unread (SPIKE-011 follow-up). **Mac check P1.**

### Script output on the samples

```text
$ python3 -B inspect_logicx.py /tmp/s006/q.logicx      # Logic Pro 12.3.1 (6682)
LastSavedFrom "Logic Pro 12.3.1 (6682)", BundleVersion 2.0
000 metadata: BeatsPerMinute 120.0, SampleRate 44100, NumberOfTracks 1, SongKey C, SongGenderKey major,
    SongSignatureNumerator 4, SongSignatureDenominator 4, HasARAPlugins false, isTimeCodeBased false,
    SurroundFormatIndex 5, Version 3; unrecognised FrameRateIndex, HasGrid, SignatureKey, SurroundModeIndex
000 projectData: 140469 bytes, magicMatches true, first bytes 2347c0abd10903000400000001000800,
    tags gnoS 1 karT 23 qeSM 14 qSvE 14 UCuA 16 tSnI 1 ivnE 12, audioUnitTriples {}, GAME 20
readOnlyCheck "unchanged"

$ python3 -B inspect_logicx.py /tmp/s006/p.logicx      # Logic Pro X 10.0.3 (2911.58)
LastSavedFrom "Logic Pro X 10.0.3 (2911.58)", BundleVersion 1.0
000 metadata: Version 3; SamplerInstrumentsFiles 6 .exs, ImpulsResponsesFiles 5 .SDIR
000 projectData: 650790 bytes, magicMatches true, first bytes 2347c0aba60602000400000001000800,
    tags gnoS 1 karT 38 qeSM 60 qSvE 60 UCuA 146 tSnI 1 ivnE 30, audioUnitTriples {}, GAME 88
readOnlyCheck "unchanged"
```

(JSON condensed by hand; the script prints full JSON.) Tests: `python3 -B -m unittest -v
test_inspect_logicx` in the script folder, 3 tests, synthetic bundle, passing.

### Mac checks (for a human with a Mac and Logic Pro)

Work on **copies** of throwaway projects only. Record macOS version, Logic version
(`LastSavedFrom`) and the script output in this file.

- **P1. Current licence.** Logic Pro > About Logic Pro > License (or the licence file inside
  `/Applications/Logic Pro.app/Contents/Resources/`). Note the reverse engineering clause and its date.
- **P2. Layout.** New empty project, save as package, then `find "Song.logicx" -print` and
  `plutil -p "Song.logicx/Alternatives/000/MetaData.plist"`. Repeat with "Organize my project as a
  folder" and check `HasProjectFolder` and where `Audio Files` goes.
- **P3. MetaData coverage.** In a copy, set 97 BPM, 48 kHz, F# minor, 7/8, add 5 tracks (audio,
  software instrument, aux via a send, Drummer, external MIDI), save, close, run
  `python3 -B research/006-project-file-introspection/inspect_logicx.py Song.logicx`. Check every value.
  Add a tempo change at bar 9, save, re-run: confirm `BeatsPerMinute` stays the start tempo. If an
  older Logic 10.x is to hand, save there too and note which keys exist.
- **P4. Plug-ins and routing in `ProjectData`.** Copy the P3 project. Insert one third-party AU
  (e.g. any free AU), save copy A. Add Channel EQ on track 1, save copy B. Add a send from track 1 to
  Bus 1, save copy C. Rename track 1 to `Lead Vox`, save copy D. For each, run the script and
  `cmp -l A/Alternatives/000/ProjectData B/Alternatives/000/ProjectData | wc -l`. Record whether the
  AU triple appears (compare with `auval -l`), whether `GAME` count changes with Channel EQ, and whether
  `Lead Vox` appears in `strings`. Optionally run logic2ableton / lpx-explorer (as separate tools, not
  linked into our code) on the same copies and note what each reports.
- **P5. `.cst` / `.pst`.** Save a channel strip setting and a Channel EQ setting from the P4 project,
  then `file` and `plutil -p` (or `xxd | head`) each. Note whether either is a plist.
- **P6. Exports.** From the P4 project export AAF and Final Cut Pro XML. `grep -i -E "eq|bus|send|plug"`
  the XML; note whether plug-in names, sends or bus names appear.
- **P7. Open-project safety.** With the project open in Logic, run the script twice a minute apart
  while editing. Confirm `readOnlyCheck` stays `unchanged` across the run itself, and note which files
  Logic changes on its own (autosave, undo) so the product knows when a read may be inconsistent.

### Open questions

1. How does the companion learn which project is open? Candidates: the Logic window title via
   Accessibility (SPIKE-005), the most recent document, or the user picking the file. Reading a file
   the user did not pick also needs the right macOS file access (Full Disk Access or a user-chosen
   security-scoped bookmark; SPIKE-003 / 010).
2. Is there a stable version marker inside `ProjectData` (logicxkit refers to format version 2513)
   that a reader could check before trusting anything?
3. Does the product want an offline plug-in list badly enough to adopt an MIT / Apache reader (with
   credit) after v1, or is live state via SPIKE-004 / 005 enough?
