# SPIKE-008: Scripter and MIDI FX

Issue: [#8](https://github.com/brandonapol/clogic/issues/8)

## Question

Is Logic's Scripter (JavaScript MIDI FX) useful for anything in this project?

## Why it matters

Probably not for mixing, since Scripter only processes MIDI. Worth a short check to close the question,
and it may help with MIDI-side tasks (velocity humanising, drum programming tips).

## Timebox

0.5 day

## Investigate

- [x] Scripter API surface: events, parameters, timing info, `Trace()` output.
- [x] Any way to talk to the outside world (network, files, MIDI out to a virtual port)?
- [x] Can the assistant generate Scripter scripts that the user pastes in?

## Done when

- A short write-up and a verdict, likely "generate scripts on request; not an integration surface"

## Findings

Researched 2026-10-02 from Linux; no Mac or Logic Pro available. Every claim below is from Apple's Logic
Pro User Guide unless marked **unverified**. Full source list with how each was read:
[notes/008-sources-2026-10-02.md](./notes/008-sources-2026-10-02.md). The per-function API pages were only
reachable at the Logic Pro X 10.4.5 guide; the live guide (newest version in its selector: Logic Pro for
Mac 12.3) has the Scripter intro. API additions after 10.4.5 were not diffed.

**Verdict: no-go as an integration surface; go for "generate scripts on request" (low priority).**
Scripter only sees and emits MIDI events inside one channel strip. It has no documented path to the
session, mixer, audio, files or network, so it cannot carry session control, analysis, or the chat
channel. It is a useful thing for the assistant to write for the user, as text the user pastes in.

### What Scripter is

- A MIDI FX plug-in that runs user JavaScript on MIDI in real time. It sits in the MIDI FX slot, in series
  before the instrument, with the other bundled MIDI plug-ins (Arpeggiator, Chord Trigger, Modifier,
  Modulator, Note Repeater, Randomizer, Transposer, Velocity Processor). The bundled-list and series
  order come from a search summary of the MIDI plug-ins overview (unverified against the page).
- Needs "Enable Complete Features" in Logic Pro > Settings > Advanced. The JavaScript version is whatever
  JavaScriptCore the installed macOS provides. The script is saved with the project, channel strip
  setting or patch ([Use Scripter](https://support.apple.com/guide/logicpro/lgce728c68f6/mac)).

### API surface (Logic Pro X 10.4.5 guide pages)

| Area      | Documented                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Callbacks | `HandleMIDI(event)`, `ProcessMIDI()` once per process block, `ParameterChanged(index, value)`, `Reset()`                                                                                                                      |
| Events    | `NoteOn`, `NoteOff`, `PolyPressure`, `ControlChange`, `ProgramChange`, `ChannelPressure`, `PitchBend`, `TargetEvent`; methods `send`, `sendAfterMilliseconds`, `sendAtBeat`, `sendAfterBeats`, `trace`, `toString`; `beatPos` |
| Timing    | `GetTimingInfo()` after `var NeedsTimingInfo = true`: `playing`, `blockStartBeat`, `blockEndBeat`, `blockLength`, `tempo`, `meterNumerator`, `meterDenominator`, `cycling`, `leftCycleBeat`, `rightCycleBeat`                 |
| UI        | `var PluginParameters = [...]` with `lin`, `log`, `momentary`, `menu`, text headers, `hidden`; `GetParameter(name)`, `SetParameter`, `UpdatePluginParameters()`                                                               |
| Helpers   | `MIDI.noteNumber`, `noteName`, `ccName`, `allNotesOff`, `normalizeStatus`, `normalizeChannel`, `normalizeData`                                                                                                                |
| Debug     | `Trace(value)` and `event.trace()` print to the Script Editor's Interactive Console. Output is thinned if too much is printed too fast. Errors also show there after Run Script.                                              |

Sources: [Event](https://help.apple.com/logicpro/mac/10.4.5/en.lproj/lgce0d0efc5a.html),
[TimingInfo](https://help.apple.com/logicpro/mac/10.4.5/en.lproj/lgcee186be46.html),
[Trace](https://help.apple.com/logicpro/mac/10.4.5/en.lproj/lgce4135e1fa.html),
[MIDI object](https://help.apple.com/logicpro/mac/10.4.5/en.lproj/lgcebee22a60.html),
[controls](https://help.apple.com/logicpro/mac/10.4.5/en.lproj/lgce9f7063b5.html),
[Script Editor](https://help.apple.com/logicpro/mac/10.4.5/en.lproj/lgcecc16550d.html).

### What it can and cannot touch

| Question                                 | Answer                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read MIDI in, write MIDI out             | Yes, per channel strip, documented.                                                                                                                                                                                                                                                                                                   |
| Read transport, tempo, meter, cycle      | Yes, read-only, via `GetTimingInfo()` (documented).                                                                                                                                                                                                                                                                                   |
| Move other plug-in parameters            | Partly. `TargetEvent` is documented as able to "control plug-in parameters". A search summary says the target can be learned from plug-ins inserted after Scripter in the same channel strip; the page was not read, so that scope is **unverified**. This is automation-like control of one strip, not the mixer.                    |
| Read mixer, track names, other tracks    | No documented API. Nothing in the object list exposes it.                                                                                                                                                                                                                                                                             |
| Read audio                               | No. MIDI plug-in; no audio object in the API.                                                                                                                                                                                                                                                                                         |
| Files, network, sockets, timers          | Not in the documented API. Script Editor docs say the JavaScript version is the system JavaScriptCore, which has no network or file APIs by itself (host must supply them), but whether Logic injects any is **unverified**; an Apple Developer Forums thread on WebSockets in Scripter was found but could not be read. See repro 1. |
| Send MIDI to a virtual port / other apps | No documented way. Output goes to the channel strip's instrument. Reaching a control surface or IAC bus would need Logic's routing, not Scripter. Unverified.                                                                                                                                                                         |
| Talk to the chat plug-in                 | Only indirectly through MIDI events (for example CC values), and the AU would have to be on the same strip. Not worth the coupling.                                                                                                                                                                                                   |

### How it helps or does not help the assistant

- **Not an integration surface.** SPIKE-004 (MCU) already gives mixer read and write
  ([004](./004-control-surface-emulation.md)), and SPIKE-003 puts tools in a companion process
  ([003](./003-architecture.md)). Scripter adds no channel to the session that those do not, and cannot
  move volume, pan, sends or other tracks.
- **Plausible small feature: generate scripts for the user.** Examples the user might ask for: velocity
  humanise (`event.velocity` plus a random offset), swing or note-length tweaks via `sendAtBeat`, chord
  strummer, CC remapper, note filter, drum-pattern generation with `ProcessMIDI`. Apple lists a chord
  strummer, legato processor, harp glissando and algorithmic composer as intended uses. The assistant
  returns code in chat; the user opens the Script Editor, pastes, clicks Run Script, and the script is
  stored in the project.
- **Safety fits the rules.** The assistant never touches the project. The user pastes and runs it
  (rule 8). Generated code should declare `PluginParameters` so the user can undo by bypassing the
  plug-in, and must never emit unbounded events (use `MIDI.normalizeData`, pass note-offs, call
  `MIDI.allNotesOff()` in `Reset`).
- **Reliability risk.** LLM-written JavaScript can have errors, and Run Script reports them only in the
  Interactive Console. The assistant has no way to run it without Logic, so it should say the script is
  untested. A pure-JS stub of the Scripter globals could test generated scripts offline later; not
  built here.
- **Alternatives for MIDI-side tips:** the bundled Velocity Processor, Randomizer, Modifier and Note
  Repeater cover humanising and repeats without code. Documentation Q&A (SPIKE-002) should prefer them
  and offer Scripter only when they cannot do the job.

### Recommendation

1. Do not build an integration on Scripter. No ADR needed.
2. Add "write a Scripter script" as a prompt-level capability once chat exists (no tool, no new code in
   `src/`). Include in the system prompt: the callback list above, `NeedsTimingInfo`, the velocity range
   0 to 127 (velocity 0 on `NoteOn` is a note off), pitch 1 to 127, and "tell the user the script is
   untested".
3. Run the Mac checks below before promising anything about `TargetEvent` scope or network access.

### Mac reproduction steps (unverified; human needed)

Record macOS and Logic Pro versions with every result.

1. **Host globals.** Enable Complete Features. Add Scripter to an instrument track's MIDI FX slot. Open
   the Script Editor, paste
   [`research/008-scripter-midi-fx/probe-globals.scripter.txt`](../../research/008-scripter-midi-fx/probe-globals.scripter.txt),
   click Run Script. Read the Interactive Console: which of `fetch`, `XMLHttpRequest`, `WebSocket`,
   `require`, `setTimeout`, `console`, `process` are present. If any network global is present, repeat
   with a call to `http://127.0.0.1:<port>` against a local listener to see whether it is blocked.
2. **TargetEvent scope.** In the same strip put Scripter above an effect (for example Channel EQ) and
   another effect on a different strip. Use the Target menu's Learn Plug-In Parameter: can it learn
   parameters of the effect below it; of one above it; of the instrument; of a plug-in on another strip?
3. **TargetEvent write.** Send `TargetEvent` with `value` 0.0 to 1.0 from a script and confirm the
   learned parameter moves. Check whether Logic records it as automation in Latch or Touch.
4. **Console behaviour.** Call `Trace` 1000 times in `HandleMIDI` and note the thinning.
5. **API drift.** Open Logic Pro's built-in Scripter presets and the Script Editor on the current
   version; compare with the 10.4.5 table above for new objects (anything for session or mixer access).
6. **Offline test.** Paste three generated scripts (humanise, strummer, CC remap), play MIDI through
   them, and record how many needed fixes. This gives the failure rate for the script-generation
   feature.

### Risks / unknowns

- Post-10.4.5 API changes unchecked.
- `TargetEvent` reach, MIDI port output and host globals are unverified.
- Generated JavaScript quality is untested.

### Sources

See [notes/008-sources-2026-10-02.md](./notes/008-sources-2026-10-02.md).
