# SPIKE-007: Audio Unit chat plugin shell

Issue: [#7](https://github.com/brandonapol/clogic/issues/7)

## Question

Can we ship an Audio Unit that loads in Logic, shows a chat UI, and streams live metering to the
companion service?

## Why it matters

This is the product's front door: the user inserts "clogic" from Logic's plugin menu like any other
plugin, chats with it, and it can also measure the audio passing through it in real time.

## Timebox

3 days

## Investigate

- [x] Framework: JUCE (C++) vs. native AUv3 (Swift / C++) app extension. Licensing for JUCE.
- [x] Effect vs. MIDI FX vs. both: which plugin type(s) Logic lets you insert on audio tracks, the stereo
      out, and buses. (Desk evidence; Mac check M3.)
- [x] Chat UI in a web view (JUCE 8 WebView UI or `WKWebView`) so the UI can be written in TypeScript.
      Check keyboard focus and text input inside Logic's plugin windows (Logic can swallow key presses
      for its own key commands). (Desk evidence; Mac checks M6 to M9.)
- [ ] Build, sign and validate with `auval`; load it in Logic on Apple Silicon. (Needs a Mac: M1, M2.)
- [x] Host info available to the plugin: transport position, tempo, track name (if any), sample rate.
      (Desk evidence; Mac check M11.)
- [x] IPC from the plugin to the companion service (SPIKE-003). Sandboxing rules for AUv3 extensions.
- [x] Multiple instances: one per track, with identification so the assistant knows which is which. One
      shared conversation, or one per instance?
- [x] Real-time safety: no allocations or blocking I/O on the audio thread; lock-free queue to a sender
      thread for metering data.
- [x] Persist chat history and settings in the plugin state so they save with the Logic project.
      (Desk evidence; Mac check M12.)
- [x] Reuse: can the analysis core from SPIKE-001 be shared (e.g. compiled to WASM), or must the live
      metering be reimplemented in C++?

## Done when

- A plugin on the stereo out shows a web view chat box that echoes messages through the companion
  service, and streams momentary LUFS and band energies at ~10 Hz
- Typing in the chat box works without triggering Logic key commands
- An estimate of the effort to productionise it

## Risks / unknowns

- C++ / Swift toolchain is a big jump from the rest of the TS codebase
- Logic's handling of keyboard input in plugin windows

## Findings

Researched 2026-10-02 from Linux with WebSearch and WebFetch. No Mac, no Xcode, no Logic Pro: macOS
version n/a, Logic Pro version n/a, nothing was built or loaded. Every source, with its date and how it
was read, is in [notes/007-sources-2026-10-02.md](./notes/007-sources-2026-10-02.md). Anything marked
**Mac check** (M1 to M14) is an untested inference; the exact steps for a human with a Mac are in
[`research/007-audio-unit-chat-plugin/README.md`](../../research/007-audio-unit-chat-plugin/README.md).
Forum posts by third-party developers are reports, not Apple statements, and are labelled as such.

**Verdict: partial go (desk research only).** Nothing found blocks a native AUv3 Audio Effect with a
`WKWebView` chat UI inside Logic. Apple ships an Xcode template whose Effect type is literally a
pass-through, and the window, state and host-info APIs exist. The one real product risk is keyboard
input: there are reports going back to 2007 and as recent as September 2026 of Logic and macOS routing
key presses to Logic instead of a plugin's text field, including a 2022 to 2023 Apple Silicon bug where
focus is lost for good after resizing an out-of-process plugin. No source shows it is unsolvable, and
none shows a reliable fix. The "Done when" criteria (echo through the companion, 10 Hz meters, typing
without triggering key commands) cannot be met without a Mac, so this spike stays open for M1 to M14.

### Recommendation

| Decision        | Recommendation                                                                                                                                       | Main reason                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Format          | **AUv3** app extension inside `clogic.app`                                                                                                           | Matches SPIKE-003 (own sandbox and entitlements, out of process) and SPIKE-010 (one app bundle, `.dmg`, Sparkle)                |
| Framework       | **Native**: Swift `AUAudioUnit` + C++ DSP kernel (Apple template), no JUCE                                                                           | JUCE licence forces AGPL or bars copyleft and needs a licence per builder (SPIKE-011); we do not need JUCE's cross-format reach |
| Plugin type     | **Audio Effect (`aufx`) only**. No MIDI FX, no Music Effect                                                                                          | Logic's Audio Effect slots exist on audio, instrument, aux and output channel strips; MIDI FX slots only on instrument strips   |
| UI              | `AUViewController` whose view is a `WKWebView` (AppKit), HTML / CSS / TypeScript from [docs/design](../design/README.md); SwiftUI only for the shell | The design is already HTML and CSS; a web view keeps the chat in TypeScript next to the rest of the code                        |
| Audio           | Bit-transparent pass-through, `tailTime` 0, latency 0; meters computed in C++ on the render thread, sent by a sender thread                          | Users must be able to leave it on the stereo out without changing the sound                                                     |
| Live metering   | Reimplement momentary LUFS and band energies in C++; share golden test vectors with `src/analysis`, not code                                         | TypeScript / WASM cannot run on the render thread under Apple's real-time rules                                                 |
| Fallback for UI | If M7 to M9 show typing cannot be made reliable: a "pop out" chat window owned by `clogic.app`, with the plugin as a compact meter and status view   | Keeps the product usable if the in-plugin text field is the problem; it is a fallback, not the plan                             |

### Framework: JUCE vs. native

| Option                                         | Licence (SPIKE-011)                                                                                  | AUv3 on macOS                                                                                                                                                         | Web UI                                                                                                                                                                       | Verdict         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Native** (Xcode "Audio Unit Extension App")  | Xcode / Apple frameworks only; no third-party licence                                                | Template has Effect, Music Effect, MIDI Processor, Instrument, Generator types; Swift + SwiftUI UI, C++ DSP, Obj-C bridge (Apple, _Creating an audio unit extension_) | `WKWebView` directly; we write the key handling ourselves                                                                                                                    | **Recommended** |
| JUCE 8 / 9 (`WebBrowserComponent`, WebView UI) | AGPLv3, or JUCE licence (Starter free to $20k, Indie, Pro) that forbids combining with copyleft code | Supported, but a 2026 JUCE forum thread notes few developers ship AUv3 on Mac                                                                                         | Built in; but JUCE forum threads report focus bugs (fixed June 2024 with `acceptsFirstMouse`) and keys not reaching the host (open as of Sept 2026, JUCE team "plans" a fix) | Not recommended |
| AUv2 `.component` (either framework)           | Same as above                                                                                        | n/a: runs inside Logic's process, so Logic's sandbox and entitlements govern the web view and socket (SPIKE-003)                                                      | Same web view, Logic's entitlements                                                                                                                                          | Fallback only   |

The C++ / Swift toolchain jump is the same for JUCE and native: both need Xcode, signing and a C++ DSP
kernel. JUCE's main benefit (VST3, AAX, Windows) does not apply to a Logic-only product.

### Plugin type and where it can be inserted

- Logic's guide: the Audio Effect slot "inserts an audio effect into the channel strip", and the MIDI
  Effect slot "inserts a MIDI effect into the software instrument channel strip" (Apple, _Add, remove,
  move, and copy plug-ins_). Audio Effect slots exist on audio, software instrument, aux and output
  channel strips; MIDI FX only on instrument strips. So an `aufx` Effect can go on any track, any bus
  and the stereo out; a MIDI FX version could not sit on the stereo out or an audio track at all.
- MIDI FX AUv3s use type `aumi` (MIDI Processor) and appear in Logic's MIDI FX slot (developer reports,
  JUCE and Apple forums). We have no MIDI use case; SPIKE-008 covers Scripter separately.
- Music Effect (`aumf`, audio plus MIDI in): a developer reported in March 2023 that in Logic it gets no
  MIDI on an audio track and no audio on an instrument track (Apple forum 99516, no Apple reply). Avoid.
- **Mac check M3:** insert the template Effect on an audio track, a bus, the stereo out and an
  instrument track's Audio FX slot, and confirm it is listed under Audio Units > manufacturer.

### How a pass-through effect behaves in Logic

- The Xcode template's Effect "provides an audio pass-through effect with a signal parameter to adjust
  the gain" (Apple, _Creating an audio unit extension_). Ours is that with the gain removed and meters
  added. Output must equal input sample for sample (null test, **Mac check M4**).
- `tailTime` "reflects the time interval between when the input stream ends ... and when the output
  stream becomes silent" (Apple). A pass-through reports 0.
- **Logic stops calling render when nothing needs processing.** Developers report that Logic does not
  render an insert on an audio track or bus with no active region or input unless the track is
  selected / record-armed, that reporting a huge tail time does not change it, and quote Apple: "Instrument
  and effect plugins are only processed when Logic knows something needs processing" (JUCE forum
  17570, 2016; JUCE forum 60063, Feb 2024). Consequences:
  - Meters freeze when playback stops. The UI must show "no signal / stopped" from a sender-side
    timeout, never assume render is running.
  - Chat, IPC and the companion connection must run on the main / sender threads, never be driven by
    render callbacks.
  - **Mac check M5:** is the stereo out (output channel strip) also suspended when stopped?
- Out of process means an IPC hop per render cycle (Apple, _Creating custom audio effects_: "IPC
  communication adds a small amount of overhead to each render cycle"). Fine for one instance on the
  stereo out; measure CPU with 20 instances (**M13**).

### Chat UI: web view hosting

- On macOS the principal class subclasses `AUViewController` (an `NSViewController`) and implements
  `AUAudioUnitFactory` (Apple, _AUViewController_; App Extension Programming Guide, 2017-10-19). Its
  view can host a `WKWebView`; the current Xcode template uses SwiftUI for the UI, so an
  `NSViewRepresentable` around `WKWebView` inside the template's SwiftUI view also works in principle.
  Plain AppKit is simpler for focus handling, so prefer it.
- `WKWebView` needs `com.apple.security.network.client` in a sandboxed process even for local content,
  because WebKit renders out of process (Apple Developer Forums 116359, forum answer). The appex needs
  that entitlement anyway if the localhost IPC fallback from SPIKE-003 is ever used. Load the bundled UI
  with `loadFileURL(_:allowingReadAccessTo:)` on the bundle's web folder, not `load(URLRequest)` with a
  `file://` URL (JUCE forum 43936 reports the latter fails sandboxed). **Mac check M6:** web view
  renders inside Logic with only the group and network-client entitlements.
- Bridge: `WKScriptMessageHandler` (JS → Swift) and `evaluateJavaScript` (Swift → JS) carry the
  JSON-RPC messages from the SPIKE-003 ADR draft. The API key is pasted in the web view and passed
  straight through to the companion; it is never stored in plugin state or logged.
- The plugin UI runs inside an extension whose view is shown in Logic's window through macOS's remote
  view machinery (ViewBridge, per secondary sources); a JUCE thread (44857) reports an AUv3 UI that
  ignored mouse clicks on Catalina until a workaround. Treat any UI weirdness as possibly macOS-side, not Logic-side.

### Window sizing

- macOS: "use the `preferredContentSize` property of the `NSViewController` class to specify the Audio
  Unit app extension main view's preferred size" (Apple, App Extension Programming Guide). Set
  440 × 680 from the design.
- `AUAudioUnit.supportedViewConfigurations(_:)` (macOS 10.13+) lets a host offer sizes; `AUAudioUnitViewConfiguration`
  has `width`, `height`, `hostHasController` (Apple symbol pages, no prose). A JUCE forum thread
  reports that if the AUv3 accepts any of Logic's offered configurations, Logic picks one instead of
  `preferredContentSize`, and that AUv3s in Logic are resized by the host (window border) while AUv2s
  resize themselves. So: return an empty `IndexSet` at first and rely on `preferredContentSize`.
- Developers report Logic-specific resize bugs: limits that lock the window (JUCE forum 43811),
  exponential growth on reopen, and the focus loss after resize below. Make the web layout fluid from
  360 × 480 upwards and clamp inside the page instead of fighting the host. **Mac check M10:** default
  size, user resize, minimum, and size after close / reopen and project reload.

### Keyboard focus (the main risk)

What the sources say:

- Logic routes key presses that match its key commands to Logic while typing in plugin text fields
  (JUCE forum 1741, 2007; Native Instruments community, Kontakt 7 search field, undated) and, per
  developers, offers no host option to give a plugin window the keyboard (unlike some other hosts).
- On Apple Silicon, with AUs hosted out of process, keyboard focus in a plugin text field is lost
  permanently after resizing the plugin window; reproduced with JUCE and non-JUCE plugins on Logic
  10.7.4+, Ventura and Sonoma; still open in Nov 2023; one participant (mfritze) said out-of-process AU
  hosting on Apple Silicon "is all managed by macOS – not Logic" (JUCE forum 51292). Workaround reported: focus a web view,
  then refocus the original control.
- `WKWebView` in plugins: needed a click before any interaction until JUCE enabled `acceptsFirstMouse`
  (June 2024, forum 61542); unhandled keys such as space did not reach Logic or Ableton, worked around by
  forwarding `keyDown:` to `nextResponder` (forum 63987, open Sept 2026).
- Apple AU support advice in 2007: return "not handled" for keys the plugin does not use so the host can
  process them (forum 1741). The AppKit equivalent is passing the event up the responder chain.

Design for it (all to be proven by M7 to M9):

1. The composer is the only text field; clicking it makes it first responder, and the design's focus
   ring shows when keys go to clogic (principle 6 in [docs/design](../design/README.md)).
2. While the composer has focus, consume printable keys, Return, Delete, arrows and Cmd-A/C/V/X/Z in the
   web view; forward everything else (`keyDown:` → `nextResponder`) so space bar and transport still
   reach Logic when the composer is not focused.
3. Escape blurs the composer; the confirmation dialog has no default action on Return (already in the
   design), so a stray key cannot apply a change.
4. If Logic still steals keys (M7), measure which keys and whether `performKeyEquivalent:` or a
   subclassed `WKWebView` helps; if not, ship the pop-out window fallback from the recommendation table.

### Host information

| Item                       | API                                                 | What is known about Logic                                                                                                            |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Track name                 | `AUAudioUnit.contextName`                           | Set and updated for Audio FX AUv3 (developer report, Jan 2024; SPIKE-003). **M11**                                                   |
| Sample rate                | Output bus format at `allocateRenderResources`      | Standard AU behaviour; nothing Logic-specific found                                                                                  |
| Tempo, beat, sig.          | `musicalContextBlock` (`AUHostMusicalContextBlock`) | Was `nil` in Logic 10.3 (2017, JUCE staff: "a known bug in Logic and has been reported to Apple"); no later source found. **M11**    |
| Transport, sample position | `transportStateBlock` (`AUHostTransportStateBlock`) | Same 2017 report; current state unknown. **M11**. If still `nil`, the meter UI cannot show bar positions; nothing else depends on it |
| Project name/path          | None found                                          | SPIKE-003: ask the user or use AX (SPIKE-005)                                                                                        |

### State, instances and IPC

- Per-project state: override `fullState` (or `fullStateForDocument`, "suitable for saving in a user's
  document", bridged to `kAudioUnitProperty_ClassInfoFromDocument`) with `{instanceId, schemaVersion,
transcriptSnapshot, uiPrefs}`. No API key, ever. Logic writes it into the project; we never touch the
  `.logicx` (rule 8). The size limit Logic accepts is unknown: cap the snapshot (for example the last
  200 messages / 256 KB) until **M12** measures it.
- Option-drag copies a plugin (Logic guide), which presumably copies its state, so two instances can
  share an `instanceId`. The companion should detect a duplicate ID on `session.hello` from a second live
  instance and assign a fresh one; the copy keeps the transcript as history. Duplicating a project or a
  track stack has the same effect. **M14.**
- One conversation per instance, as in the SPIKE-003 ADR draft; the companion's instance table (with
  `contextName`) lets the assistant tell them apart.
- IPC, sandbox and launch are settled on paper by SPIKE-003: app group `<TeamID>.clogic`, UNIX socket in
  the group container, newline-delimited JSON-RPC, Swift bridge to the web view. Nothing in this spike
  contradicts it. Its Mac checks 1 and 3 are the same experiment as M1 and M2 here.

### Real-time path and metering

- Apple's sample: "Don't allocate memory, perform file I/O, take locks, or interact with the Swift or
  Objective-C runtimes when rendering audio" (Apple, _Creating custom audio effects_; QA1715). So the
  render block is C++: copy input to output, run K-weighting biquads and a 400 ms momentary window, and
  band filters, then push one fixed-size struct per block into a single-producer single-consumer ring.
- A sender thread (not the main thread) drains the ring, decimates to ~10 Hz and writes `meter`
  notifications to the socket; the web view gets the same values through the bridge.
- Reuse of `src/analysis`: no code sharing on the render thread. JavaScript or WASM would need the
  JavaScriptCore runtime and garbage-collected memory, which those rules exclude. Instead, export
  test vectors (input WAV fixture → expected momentary LUFS series) from the TypeScript implementation
  and assert the C++ kernel matches within 0.1 LU. That keeps the BS.1770 maths consistent without a
  shared runtime.

### Effort estimate to productionise

Assumes one developer new to Swift / AU, a Mac with Logic, the companion from SPIKE-003, and that M7 to
M9 do not force the pop-out fallback. Excludes the companion and installer.

| Piece                                                                    | Estimate          |
| ------------------------------------------------------------------------ | ----------------- |
| Template → pass-through Effect, signing, `auval`, loads in Logic (M1-M5) | 2 to 3 days       |
| `WKWebView` host, bundle loading, JS ↔ Swift bridge                      | 2 days            |
| Keyboard focus work and test matrix (M7-M9)                              | 3 to 5 days       |
| Socket client, reconnect, offline state                                  | 2 days            |
| C++ meters (momentary LUFS, bands), ring buffer, sender, parity tests    | 4 to 5 days       |
| State persistence, instance IDs, duplicate handling                      | 1 to 2 days       |
| Window sizing and resize bugs                                            | 1 to 2 days       |
| Chat UI build from the design (TypeScript, bundled)                      | 5 to 8 days       |
| **Total**                                                                | **~4 to 6 weeks** |

Add 1 to 2 weeks if the pop-out fallback is needed.

### Mac checks

M1 to M14 are listed with exact steps in
[`research/007-audio-unit-chat-plugin/README.md`](../../research/007-audio-unit-chat-plugin/README.md).
Record macOS, Logic Pro and Xcode versions with each result.
