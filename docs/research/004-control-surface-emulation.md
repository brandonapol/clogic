# SPIKE-004: Control surface emulation (Mackie Control / HUI / OSC)

Issue: [#4](https://github.com/brandonapol/clogic/issues/4)

## Question

Can a Node process pretend to be a control surface and reliably **read** and **write** Logic mixer state?

## Why it matters

This is the most likely supported way to change the session from outside: faders, pan, mute / solo,
sends, plugin parameters and transport, plus feedback such as track names and levels.

## Timebox

3 days

## Investigate

Ticked items have desk research findings below (documentation, specs, third-party observations).
Every item still needs a Mac run before it counts as verified; the reproduction steps are in
[Mac checks](#mac-checks-for-a-human).

- [x] Virtual MIDI ports from Node (CoreMIDI virtual source / destination, or the IAC Driver). Evaluate
      Node MIDI libraries for native build pain on Apple Silicon.
- [x] Register as a Mackie Control in Logic (Control Surfaces > Setup) and complete the device handshake.
- [x] Read: track names (LCD sysex), fader positions, pan, mute / solo / record states, selected track,
      bank of 8 channels.
- [ ] Write: set a fader to an exact dB value. Map MCU 14-bit pitch bend to dB and measure accuracy.
      (Encoding known; the dB curve is not published and must be measured on a Mac.)
- [x] Navigation: bank / channel switching to reach any track in a large session.
- [x] Plugin parameters: MCU plugin edit mode. Can we list parameters and set e.g. a Channel EQ band's
      gain or frequency, or a compressor threshold?
- [x] Sends and bus routing: what is readable and writable.
- [x] Compare HUI mode, and Logic's OSC control surface support (as used by Logic Remote and third-party
      surfaces). Is any OSC route documented or usable?
- [x] Controller Assignments (Learn mode) as a fallback for specific parameters.
- [ ] Latency and reliability: dropped messages, feedback loops, behaviour when Logic is in the background.
      (Known risks listed; no measurements without a Mac.)

## Done when

- A demo script that lists the first 16 track names and sets a named track's fader to -6.0 dB
- A capability matrix: read / write / not possible for each mixer and plugin control
- A verdict on whether this is good enough to be the primary control channel

## Risks / unknowns

- MCU plugin parameter names and ordering may be unpredictable across plugins
- The display (LCD) is only 2 x 56 characters; long names get truncated
- Logic may treat a second "surface" differently if the user owns real hardware

## Findings

Researched 2026-10-02 from Linux with WebSearch, WebFetch, `curl`, `pdftotext` and `gh api`. No Mac,
no Logic Pro, no virtual MIDI: macOS version n/a, Logic Pro version n/a. Every source, with its date and
how it was read, is in [notes/004-sources-2026-10-02.md](./notes/004-sources-2026-10-02.md). Claims
are tagged:

- **Apple**: stated in an Apple document (the 2025 Control Surfaces Support Guide, the Logic Pro 12.3
  User Guide, or the 2004 _Logic 7: Dedicated Control Surface Support_ manual, whose Appendix B is the
  Logic Control MIDI implementation).
- **3rd party**: reported by someone else, for example the dated live observations (Logic Pro 12.3,
  macOS 26.3) published by the MIT-licensed `MongLong0214/logic-pro-mcp` project. Plausible, not ours.
- **Mac check**: not verified by anyone we can cite. Reproduction steps are in
  [Mac checks](#mac-checks-for-a-human).

The throwaway prototype in [`research/004-mcu-protocol/`](../../research/004-mcu-protocol/README.md)
encodes and decodes the MCU messages below. Its 26 tests use the byte examples from Apple's Appendix B
as vectors (`npx vitest run --root research/004-mcu-protocol`). It opens no ports.

**Verdict: partial (go for MCU as the primary _mixer_ channel, pending Mac checks; not sufficient on
its own).** Logic documents Mackie Control as a supported surface, the wire protocol is published by
Apple (as Logic Control), and an independent project reports a Node-free implementation working against
Logic Pro 12.3. MCU gives read and write access to volume, pan, mute, solo, arm, select, sends, EQ and
every automatable plug-in parameter, with names and value strings on the LCD. Its limits decide the
design:

1. **Strip-relative, not name-addressed.** We see 8 strips at a time, identified only by a 6 to 7
   character LCD label. Truncated names collide; the tool layer must refuse ambiguous targets.
2. **No absolute dB write.** A fader write is a 14-bit position on an unpublished curve. Exact dB
   needs either a measured calibration table or a closed loop that reads Logic's own value text back
   from the LCD.
3. **Modal and stateful.** The surface has one global mode (Track, Send, Pan, Plug-in, EQ, Instrument;
   Mixer or Channel view; Flip; bank offset). Every operation must set the mode, act, read back, and
   restore. Some mode changes have side effects (see [Dangerous controls](#dangerous-controls)).
4. **Setup is a user action.** Logic must have a Mackie Control installed in Control Surfaces > Setup
   and bound to our ports. That writes to the user's Logic preferences, so the user should do it once,
   guided by the app.

Recommendations: use MCU for mixer and plug-in parameter changes; use Accessibility (SPIKE-005) for
anything name-addressed (track list, full names) and as a cross-check; do not use HUI; do not use the
Logic Remote protocol (SPIKE-011 finding #8); run one Mac experiment on the documented Controller
Assignments OSC paths before ruling OSC in or out.

### What is documented, and where

| Topic                                           | Source                                                       | Notes                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| How Logic maps every MCU control                | Apple, Control Surfaces Support Guide (PDF dated 2025-05-15) | Mixer / Channel views, Send, EQ, Plug-in, Instrument, banks, Flip, utilities |
| MCU wire protocol (sysex, faders, LCD, LEDs...) | Apple, _Logic 7 Dedicated Control Surface Support_, App. B–C | Written for Logic Control (model `0x10` / `0x11`), firmware V1.0, 2004       |
| Mackie Control model IDs `0x14` / `0x15`        | 3rd party (Ardour commits, linux-audio-dev list, MongLong)   | Not in any Apple or Mackie document found                                    |
| Controller Assignments, Learn, MIDI value modes | Apple, Logic Pro User Guide 12.3                             | Any MIDI message; stored in `~/Library/Preferences/com.apple.logic.pro.cs`   |
| Controller Assignments OSC message paths        | Apple, Logic Pro User Guide 12.3                             | UDP / IPv4 only; how an OSC device gets registered is not stated             |
| Control surface plug-ins (MDP) and Lua (MDS)    | Apple, Logic Pro User Guide 12.3                             | Third-party MDPs are Intel only; MDS (Lua) authoring is not documented       |
| Logic Remote protocol                           | None                                                         | Undocumented; out of scope (SPIKE-011 #8)                                    |
| Fader position to dB curve                      | None                                                         | Must be measured                                                             |

### Virtual MIDI from Node

| Option                                        | Licence | State (2026-10-02)                                      | Notes                                                                                                                      |
| --------------------------------------------- | ------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@julusian/midi` 3.8.1 (RtMidi, N-API)        | MIT     | Published 2026-08-10                                    | Ships prebuilds incl. `midi-darwin-arm64/node-napi-v7.node` (checked in the npm tarball); `openVirtualPort(name)` on macOS |
| `easymidi` 3.2.0                              | MIT     | Wraps `@julusian/midi`                                  | Convenience layer only                                                                                                     |
| `midi` 2.0.0 (original node-midi)             | MIT     | Last publish 2022-06-19; `nan`, builds from source      | Avoid: native build on every install                                                                                       |
| `jzz` 1.9.6                                   | MIT     | Uses the `jazz-midi` native plugin                      | Larger API; no reason to prefer it                                                                                         |
| IAC Driver buses (Audio MIDI Setup)           | n/a     | Built into macOS                                        | No virtual port code needed, but the user must create and enable buses by hand (3rd party: `rubenknol/logic-pro-mcp`)      |
| Swift / CoreMIDI shim in the companion bundle | n/a     | `MIDISourceCreate` / `MIDIDestinationCreate` (CoreMIDI) | No npm dependency; another binary to sign. MongLong reports MIDI 2.0 (UMP) decoding pitfalls in its Swift receiver         |

Findings and cautions:

- RtMidi drops sysex by default. The `@julusian/midi` README: `input.ignoreTypes(false, false, false)`
  is needed, otherwise the LCD (all track names) is never seen.
- A virtual port exists only while our process runs. **3rd party:** with no server running, Logic's
  Setup port pop-ups do not offer the name, so the companion must be running before the user binds the
  surface, and Logic shows the binding as missing whenever it is not. A launchd-managed companion
  (SPIKE-003) helps.
- Adding `@julusian/midi` needs owner approval (AGENTS.md rule 9) and a Mac check that its `.node`
  addon loads from a signed, notarised Node SEA (already listed in SPIKE-003). The MIDI code belongs in
  the companion, never in the sandboxed AUv3 (SPIKE-003 process split).

### Registration and handshake

- **Apple:** "Any powered Mackie Control unit connected to your system is automatically detected when
  you open Logic Pro." HUI devices "don't support automatic scanning" and must be added by hand.
- **Apple (Logic Control spec):** the host sends Device Query `<Hdr> 00 F7`; the device answers Host
  Connection Query `<Hdr> 01 <7-byte serial> <4-byte challenge> F7`; the host must reply within 300 ms
  with Host Connection Reply `<Hdr> 02 <serial> <response> F7`, where the response is computed from the
  challenge by a published algorithm; the device answers Confirmation (`03`) or Error (`04`).
  `<Hdr>` is `F0 00 00 66 <model>`. The prototype implements both sides and the algorithm.
- **3rd party (Logic 12.3):** MongLong found that auto-detection was not enough in practice: until a
  "Mackie Control" was installed in Control Surfaces > Setup (New > Install > Mackie Designs / Mackie
  Control, then both ports set), nothing sent on the port had any effect. After installing, SELECT and
  assignment buttons worked. Its code comment says Logic "doesn't reliably emit a discrete Device
  Response", and it treats any inbound traffic as connected. **Mac check:** capture the bytes Logic
  sends to a fresh virtual port and whether it validates a challenge response.
- Installing a surface writes `~/Library/Preferences/com.apple.logic.pro.cs` (**Apple**). That is user
  configuration, not the project, but the same spirit as AGENTS.md rule 8 applies: the app should guide
  the user through the Setup window, not script it (MongLong does script it via Accessibility).

### Reading state

| Data                                   | How                                                                                           | Source                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Channel names for the 8 visible strips | LCD sysex `<Hdr> 12 <offset> <ascii...> F7`; 2 × 56 chars; 7 chars per strip                  | Apple (spec)                                     |
| Name length in practice                | Logic writes 6 characters plus a space: "Absolute Zero" → `AbsZer`, "Studio Grand" → `StdGrn` | 3rd party (Logic 12.3)                           |
| Track numbers on the LCD               | Group settings mode, V-Pot 5: "No: Name" shows track number and name                          | Apple; effect on width: Mac check                |
| Non-ASCII names                        | "8-bit ASCII characters ... are replaced with the best-possible 7-bit ASCII equivalent"       | Apple                                            |
| Which channels are visible             | Upper LCD row follows banking; banks include output and master strips                         | 3rd party (Logic 12.3)                           |
| Fader position                         | Pitch bend `Ei ll hh` echoed by Logic (motor faders)                                          | Apple (spec), 3rd party                          |
| Mute / solo / rec / select             | LED note messages `90 id 7F/01/00` (on / flash / off)                                         | Apple (spec)                                     |
| Pan, send level, plug-in params        | V-Pot LED ring (`B0 3i`, 11 positions, coarse) and the LCD value text (exact, with units)     | Apple (spec, guide), 3rd party                   |
| Levels                                 | Meters `D0 <strip                                                                             | level>`, 13 steps, peaks only; Logic decays them | Apple (spec) |
| Playhead                               | 7-segment time code digits                                                                    | Apple (spec)                                     |
| Selected track                         | SELECT LED of the visible strips only                                                         | Apple (spec); Mac check                          |

The LCD is the strongest readback but it is a terminal-like delta stream: Logic overwrites parts of
it, briefly shows long parameter names while a control moves, and blinks preselected values. The
companion must keep a full 112-character model (prototype: `applyLcd`) and read it after a settle
delay. The spec says LCD writes are ignored for 600 ms after a meter mode change.

### Writing

- **Faders (volume):** pitch bend on channel 0–7, master on channel 8, 14-bit (prototype:
  `encodeFader`). The Logic Control spec says the hardware only sends the top 10 bits. Real surfaces
  send fader touch (`90 68+i 7F`) before moving and release after; the prototype wraps writes that way
  (`encodeFaderMove`). Whether Logic needs touch to accept a write, and how touch interacts with
  automation modes, is a **Mac check**.
- **dB mapping:** not documented anywhere found. Two ways forward, both **Mac check**: (a) measure a
  calibration table (sweep positions 0..16383 in steps, read Logic's dB value text off the LCD in
  Track Channel view, which shows volume on V-Pot 1); (b) closed loop: write, read the LCD value, adjust,
  until it matches the target to 0.1 dB. Do both: (a) gives a fast first guess, (b) makes it exact.
  **Apple:** OPTION + SELECT sets a channel to unity (0 dB), which is a free reference point.
- **Pan, sends, plug-in parameters:** V-Pots are relative encoders (`B0 1i <sign|ticks>`, up to 63
  ticks per message). There is no absolute write; use Flip mode (**Apple:** the fader then controls the
  V-Pot's parameter) for an absolute 14-bit write, or step the V-Pot and read the LCD.
- **Mute / solo / arm / select:** button presses toggle. **3rd party:** MongLong had to read the LED
  state first to turn a "set" request into the right number of toggles, and saw the Rec LED blink.
- **Undo:** the UTILITIES UNDO button (`0x51`) triggers Logic's undo, SHIFT + UNDO redo, OPTION + UNDO
  opens Undo History (**Apple**). Whether surface fader moves create undo steps at all is the open
  question from SPIKE-003; **Mac check**. Until known, Revert must re-apply recorded `before` values
  rather than press UNDO.

### Navigation

- **Apple:** BANK LEFT / RIGHT move 8 strips (or the size of the control surface group); CHANNEL LEFT /
  RIGHT move 1; OPTION + BANK jumps to the first or last bank. The last bank is clamped: with 19 strips,
  BANK RIGHT from 9–16 goes to 12–19, not 17–24.
- **Apple:** in filtered views (Global View: audio, instruments, aux, busses, outputs, ...) Logic
  remembers the bank per view.
- Finding a track by name therefore means walking banks and matching LCD labels, refusing collisions
  (prototype: `findStrip` returns `found`, `not-visible` or `ambiguous`). **3rd party:** MongLong does
  exactly this and reports it works on Logic 12.3, including the clamped last bank.
- Pair with Accessibility (SPIKE-005) for the full track list and full names, and use MCU only after
  the target strip's label is unique in its bank.

### Plug-in parameters

- **Apple:** "Mackie Control can edit all plug-ins that can be automated. The plug-in type (Logic Pro
  native or Audio Units) is irrelevant." Plug-ins that do not provide names show "Control #1", ...
  with values 0–1000.
- **Apple:** in Plug-in Edit view the LCD shows strip name, insert number, plug-in name, page and page
  count, then each parameter's name and value (with units if they fit). Cursor Left / Right page by 8;
  Cursor Up / Down change insert slot 1–15. So we _can_ list parameters page by page and set them.
- **Apple:** EQ Channel view edits frequency, gain, Q and bypass of every Channel EQ band; EQ
  Frequency/Gain Channel view maps band gains to the faders (absolute writes).
- **3rd party (Logic 12.3):** Plug-in assignment remapped the V-Pots and the LCD showed `Cha EQ`; no
  parameter write was verified. **Mac check** for a Channel EQ gain and a Compressor threshold.
- Parameter names are truncated to the 7-character cells in Name mode; full names appear only briefly
  while a control moves (Control Surfaces settings). Matching "Threshold" vs "Thresh" needs a fuzzy
  match against a per-plug-in table, plus a page walk.

### Sends and routing

- **Apple:** Send Mixer view edits one send slot (1–8) for all strips: destination, level, position
  (pre / post), mute. Destination/Level views put send level on the faders (absolute), pre/post on
  SOLO, send mute on MUTE.
- **Apple:** send _destinations_ are chosen by turning a V-Pot (preselect, flashing) and pressing it to
  confirm. That is a routing change; treat it as high risk and out of scope for a first version.
- Output and input assignment are available in Track Mixer view (**Apple**); same caution.

### Dangerous controls

Things a tool must never send, or only behind an explicit confirmation of exactly that action
(**Apple** unless marked):

| Control                                   | Effect                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| SAVE (`0x50`)                             | Saves the project. Never.                                              |
| V-Pot press in Plug-in / Instrument views | Inserts the preselected plug-in; with `--` preselected, **removes** it |
| V-Pot press in Track / Plug-in Edit views | Resets the parameter to its default                                    |
| EQ button → EQ Channel view               | **Inserts a Channel EQ** if the strip has none                         |
| SHIFT + OPTION + SELECT                   | Creates a new track                                                    |
| OPTION + MUTE / SOLO / REC                | Clears mute / solo / arm on _all_ channels                             |
| Automation WRITE (`0x4B`)                 | 3rd party: raises a modal warning dialog in Logic 12.3                 |
| ENTER / CANCEL                            | Confirm or dismiss whatever alert is on screen                         |
| Leaving Plug-in Edit view                 | Closes the plug-in window (side effect on the user's screen)           |

The prototype exports `BUTTON` IDs for all of these; a real executor should use an allow list of
buttons per operation, not a deny list.

### HUI

- **Apple:** HUI must be added by hand; emulations "are not supported by Apple, nor are they guaranteed
  to work". The DSP Edit section shows 4 parameters at a time.
- HUI is a 1997 Mackie / Digidesign protocol with 10-bit faders (Wikipedia, citing Mackie's 1998
  reference guide). It has less Logic-specific mapping than MCU (no EQ / Send / Plug-in views as
  documented for MCU).
- Verdict: no. MCU is better documented by Apple and does more in Logic.

### OSC

There are three different things called "Logic and OSC":

1. **Logic Remote** (iPad / iPhone app). Protocol undocumented. Analysing it means sniffing an Apple
   app's traffic and possibly pairing; SPIKE-011 rates this medium legal risk. **Not pursued.** No
   traffic capture or protocol analysis was done for this spike.
2. **TouchOSC LogicPad / LogicTouch** (Logic 9.1.2+). Hexler: "authorized 3rd party developers can
   create Logic CS plug-ins which can use OSC-based communication", and "It is not possible at this
   time to use customized Layouts or to learn OSC commands." So this is a closed, Apple-authorised
   plug-in for fixed layouts, not an open API. **Not usable.**
3. **Controller Assignments OSC Message Paths** (**Apple**, Logic Pro User Guide 12.3). Expert view
   assignments have OSC paths for value (normally a normalised float 0.0–1.0), touch / release, label
   and value string; "The current OSC implementation in Logic Pro for Mac supports UDP and IPv4 network
   connections only." Feedback for global and control surface group parameters is sent
   non-normalised. This is documented and would give a name-and-value readback per parameter, but the
   page does not say how an OSC device is added or discovered. `koltyj/logic-pro-mcp` lists an OSC
   channel that "requires Logic Pro OSC setup", without details (3rd party, unverified). **Mac check**
   (below); until then, unknown.

Related: third-party control surface plug-ins (MDP) only load on Intel Macs, and Lua MIDI Device
Scripts (MDS) are supported on all Macs (**Apple**: User Guide 12.3 page "Control surfaces supported by
Logic Pro for Mac"). That page says where MDS packages live but I found no Apple documentation for
writing one; a Logic Pro Help forum thread says the same. Neither is a route for us now.

### Controller Assignments (Learn) as a fallback

- **Apple:** "You can assign any controller capable of generating a MIDI message", via Learn in the
  Controller Assignments window; Expert view supports 7- and 14-bit values, signed formats, and Direct,
  Toggle, Scaled, Relative, Rotate and X-OR modes; assignments can target channel strip, plug-in,
  global, automation and key command classes.
- Assignments live in `~/Library/Preferences/com.apple.logic.pro.cs` and are saved on quit. Editing
  that file ourselves would be fragile and is user configuration; do not.
- Use: a user-run Learn for a handful of fixed parameters (for example the master bus limiter ceiling)
  where MCU paging is too slow. Not a general solution: each mapping needs a human in the Learn dialog.

### Latency, reliability and coexistence

Known, from sources:

- Logic sends a burst of feedback right after binding (**3rd party:** 161 packets within seconds,
  first feedback ~260 ms after the handshake query).
- Motor-fader feedback: Logic echoes positions; an emulator must not echo them back or it will fight
  Logic (general MCU practice; Mac check).
- LCD writes are ignored for 600 ms after a meter mode change (**Apple** spec).
- **3rd party:** the Write automation button raises a modal dialog; any MCU action can therefore end
  up waiting on a dialog. Executors must detect modals (Accessibility) and fail closed.
- **Apple:** banking with a control surface group moves by the group's total width. If the user owns a
  real MCU and our virtual one joins its group, our banking moves their faders. Our surface should be
  its own group. **Mac check.**
- Background behaviour: `rubenknol/logic-pro-mcp` claims MCU transport works with Logic in the
  background, unlike key commands (3rd party). **Mac check.**

Not measured: round-trip latency, dropped messages, behaviour under load.

### Capability matrix

R = readable, W = writable, — = not possible via MCU, ? = documented but not verified on a Mac.
"Absolute" means a direct value write; "relative" means steps plus readback.

| Control                   | Read                                 | Write                                | Via                        |
| ------------------------- | ------------------------------------ | ------------------------------------ | -------------------------- |
| Track / channel name      | R? (6–7 chars, 8 at a time)          | —                                    | LCD upper row              |
| Full track list           | — (bank walk gives truncated labels) | —                                    | Use Accessibility          |
| Volume                    | R? (fader echo; dB text on LCD)      | W? absolute 14-bit, dB curve unknown | Fader / Track Channel view |
| Pan                       | R? (ring coarse; LCD text exact)     | W? relative, or absolute via Flip    | V-Pot, Pan view            |
| Mute / solo / rec arm     | R? (LEDs, visible strips)            | W? toggle                            | Buttons                    |
| Selection                 | R? (SELECT LEDs, visible strips)     | W?                                   | SELECT                     |
| Sends 1–8 level           | R? (LCD text)                        | W? absolute on faders in Send views  | Send views                 |
| Send pre/post, mute       | R? (LEDs)                            | W? toggle                            | SOLO / MUTE in Send views  |
| Send destination          | R? (LCD text)                        | W? (high risk; out of scope)         | V-Pot preselect + press    |
| Input / output assignment | R? (LCD text)                        | W? (high risk; out of scope)         | Track Mixer view           |
| Automation mode           | R? (LEDs)                            | W? (Write raises a modal)            | Automation buttons         |
| Channel EQ bands          | R? (LCD text)                        | W? gain absolute, freq / Q relative  | EQ views                   |
| Any automatable plug-in   | R? (name + value text, paged by 8)   | W? relative, absolute via Flip       | Plug-in Edit view          |
| Insert plug-in list       | R? (names per slot, truncated)       | W? (insert / remove; out of scope)   | Plug-in Mixer / Channel    |
| Plug-in presets           | —                                    | —                                    | Not exposed                |
| Meters                    | R? (13-step peaks)                   | —                                    | Channel pressure           |
| Transport, playhead       | R? (time code digits, LEDs)          | W?                                   | Transport buttons, jog     |
| Undo / redo               | —                                    | W? (button)                          | UTILITIES                  |
| Region / note data        | —                                    | —                                    | Not a mixer feature        |

### Mac checks for a human

Needs a Mac with Logic Pro (record the macOS and Logic versions and build), and a scratch project you
can throw away. Never use a real project.

1. **Ports.** Audio MIDI Setup > Window > Show MIDI Studio > IAC Driver: enable "Device is online",
   create two buses `MCU to Logic` and `MCU from Logic`. (Or run a virtual-port script, once the owner
   approves `@julusian/midi`.)
2. **Install.** Logic Pro > Control Surfaces > Setup > New > Install > Mackie Designs > Mackie Control >
   Add. Set Output Port to `MCU from Logic` and Input Port to `MCU to Logic`. Note whether Logic
   auto-detected anything first. In the inspector, give it its own Control Surface Group.
3. **Capture.** Start a MIDI monitor on `MCU from Logic` (for example the free Snoize MIDI Monitor) with
   sysex shown. Record: the first 2 seconds after binding (is there a `F0 00 00 66 14 00 F7` device
   query?), and the LCD sysex for the first bank of a project with 16 named tracks.
4. **Handshake.** Send `F0 00 00 66 14 01 43 4C 4F 47 49 43 31 01 02 03 04 F7` to `MCU to Logic`.
   If Logic replies `... 02 43 4C 4F 47 49 43 31 05 05 7B 2F F7`, it still uses the 2004 algorithm (the
   prototype test `computes the published challenge response` has the same vector).
5. **Names.** Name tracks `Kick`, `Snare`, `Vocals Lead`, `Vocals Double`, ... (16 tracks). Read the
   LCD after BANK RIGHT (`90 2F 7F`, `90 2F 00`). Record truncations, and whether output / master
   strips appear. Repeat with group settings V-Pot 5 = "No: Name".
6. **Fader dB curve.** In Track Channel view (press TRACK twice), with NAME/VALUE set to Value, send
   `90 68 7F`, `E0 ll hh`, `90 68 00` for positions 0, 512, 1024, ... 16383 and record Logic's dB text
   (LCD lower row, strip 1) and the Mixer's dB. Note the position for 0.0 dB and -6.0 dB and the dB step
   size near 0 dB. Repeat once without the touch messages.
7. **Plug-in parameter.** Insert Channel EQ and Compressor on track 1. PLUG-IN, select the slot, read
   pages; set the Compressor threshold to -20 dB by V-Pot steps and by Flip + fader. Record LCD text and
   whether the plug-in window opens / closes.
8. **Undo.** After steps 6 and 7, open Edit > Undo History. Record whether fader and plug-in changes
   appear as undo steps.
9. **Background.** Repeat one fader write with another app frontmost and with the Mac's screen locked.
10. **Real hardware.** If a real MCU is available, connect it in a separate group and check our banking
    does not move it.
11. **OSC (documented path only).** Open Logic Pro > Control Surfaces > Controller Assignments > Expert
    view and record how an OSC input is selected (is there an OSC port or a device list?). Do not
    capture or analyse Logic Remote traffic.

### Demo script

Not done. The "list 16 names and set a named fader to -6.0 dB" demo needs a Mac, a virtual MIDI
library (owner approval under rule 9) and the dB measurements from Mac check 6. The prototype contains
the pure pieces the demo needs (LCD model, strip lookup, fader and button encoding, stream splitting).

### Answers to the risks listed above

- _MCU plugin parameter names and ordering may be unpredictable across plugins._ Partly confirmed:
  Apple says order and names come from the plug-in, and some show only "Control #n" with 0–1000
  values. Needs a per-plug-in name table built from page walks.
- _The display is 2 x 56 characters; long names get truncated._ Confirmed: 7 cells per strip, 6
  characters used in practice; collisions are real on real projects (3rd party).
- _Logic may treat a second surface differently if the user owns real hardware._ Apple documents
  control surface groups; a separate group should isolate us. Mac check 10.

### Questions for the owner

1. Approve `@julusian/midi` (MIT, prebuilt arm64) for the companion, or prefer a small Swift CoreMIDI
   helper?
2. Accept MCU + Accessibility as the session-control design (MCU for values, AX for names and
   cross-checks), pending the Mac checks?
3. Who can run the Mac checks, and on which macOS / Logic versions?
4. Keep send destinations, I/O routing and plug-in insertion out of scope for the first version?

### Legal

Consistent with SPIKE-011: acting as a Mackie Control over MIDI is the documented way to use a Logic
feature (finding #7, low risk). Describe it as "uses the Mackie Control protocol" with no Mackie logos
(finding #4). The Logic Remote protocol is not used (finding #8). Byte layouts come from Apple's
published manual; the prototype is written from that spec, not copied from other projects. The
third-party projects cited (MIT `MongLong0214/logic-pro-mcp`, `rubenknol/logic-pro-mcp` with no licence
file) were read for their published observations only; no code was copied.
