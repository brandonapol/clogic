# Mac checklist

One runbook for every check the spikes could not run without a Mac, Logic Pro and real API keys. It
de-duplicates the per-spike lists (SPIKE-001 Loudness Meter comparison, SPIKE-002 Help bundle, SPIKE-003
checks 1 to 9, SPIKE-004 steps 1 to 11, SPIKE-005 A1 to A15, SPIKE-006 P1 to P7, SPIKE-007 M1 to M14,
SPIKE-008 steps 1 to 6, SPIKE-009 end-to-end run, SPIKE-010 human steps) and orders them so the checks
that block the architecture come first.

Compiled 2026-10-02 from the spike files on `saddle/integration`. Nothing in this file has been run. The
expected results are what the spikes predict from desk research, not facts; a result that disagrees is
the most useful outcome. Each check names the spike section its result feeds. Do not edit spike files
from this runbook alone: record results in the GitHub issue first, then update the Findings in a PR.

## Before you start

**Hardware and software.** An Apple silicon Mac on macOS 15.6 or later (Logic Pro's minimum, per
SPIKE-010), Logic Pro 12.x, Xcode, Node 22 (`.nvmrc`), `ffmpeg` / `ffprobe` on `PATH` (any build is fine
for checks; the shipped build is MAC-39), Python 3. Phase 1 to 2 also need one API key each for
Anthropic, OpenAI and xAI. Phase 3 needs a paid Apple Developer Program membership with Developer ID
Application and Developer ID Installer certificates.

**Safety rules (AGENTS.md rule 8).**

- Use throwaway scratch projects or **copies** of projects. Never run a check on real work.
- Several checks change Logic settings (Control Surfaces > Setup, Key Commands, Plug-in Manager, the
  app language). Export your key commands (Key Commands window > Save As) and note your control surface
  setup before you start, and undo each change when the check is done.
- Never paste an API key on a command line. The commands below read keys from the clipboard via stdin.

**Repo setup.**

```sh
git clone https://github.com/brandonapol/clogic.git && cd clogic
npm install && npm run build
sw_vers; xcodebuild -version; node --version; ffmpeg -version | head -1
```

Node 22 needs `--experimental-strip-types` to run the `.ts` research scripts; Node 23.6 and later do not.
The commands below include the flag so they work on both.

**Recording results.** For every check, post a comment on its GitHub issue (label `mac-check`) with:

```text
MAC-NN | date | macOS <sw_vers -productVersion> (<build>) | Logic Pro <version (build)> | Xcode <version>
Result: pass / fail / partial / could not run (why)
Evidence: commands run, output (trim, redact track names and keys), screenshots
```

Then open a PR that moves the result into the spike's Findings section named under **Feeds**, with the
same versions and date (docs/research/README.md, workflow step 3).

### MIDI helper for MCU and key command checks

SPIKE-004 and SPIKE-005 checks need to send and capture raw MIDI on IAC buses. Any MIDI tool that can
do that works (for example Snoize MIDI Monitor to capture). For exact, repeatable bytes, this throwaway
script uses `@julusian/midi` (MIT, prebuilt arm64; see SPIKE-004). Install it in a scratch folder
**outside the repo**: it is a tool for the human tester, not a project dependency (AGENTS.md rule 9).

```sh
mkdir -p ~/clogic-mac-checks && cd ~/clogic-mac-checks
npm init -y >/dev/null && npm install @julusian/midi
```

Save as `~/clogic-mac-checks/midi-tool.mjs`:

```js
import { createRequire } from 'node:module'
import readline from 'node:readline/promises'

const midi = createRequire(import.meta.url)('@julusian/midi')
const [command, ...args] = process.argv.slice(2)
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')
const findPort = (io, name) => {
  for (let i = 0; i < io.getPortCount(); i++) if (io.getPortName(i).includes(name)) return i
  throw new Error(`no port matching "${name}"`)
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (command === 'ports') {
  const input = new midi.Input()
  const output = new midi.Output()
  for (let i = 0; i < input.getPortCount(); i++) console.log('in ', input.getPortName(i))
  for (let i = 0; i < output.getPortCount(); i++) console.log('out', output.getPortName(i))
} else if (command === 'listen') {
  const input = new midi.Input()
  input.ignoreTypes(false, false, false)
  const start = Date.now()
  input.on('message', (_delta, message) => console.log(`${Date.now() - start}ms ${hex(message)}`))
  input.openPort(findPort(input, args[0]))
  process.stdin.resume()
} else if (command === 'send') {
  const output = new midi.Output()
  output.openPort(findPort(output, args[0]))
  output.sendMessage(args.slice(1).map((h) => parseInt(h, 16)))
  await pause(200)
  output.closePort()
} else if (command === 'sweep') {
  const output = new midi.Output()
  output.openPort(findPort(output, args[0]))
  const touch = args[1] !== 'notouch'
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const positions = [...Array.from({ length: 32 }, (_, k) => k * 512), 16383]
  for (const position of positions) {
    if (touch) output.sendMessage([0x90, 0x68, 0x7f])
    output.sendMessage([0xe0, position & 0x7f, position >> 7])
    if (touch) output.sendMessage([0x90, 0x68, 0x00])
    await rl.question(`position ${position}: record Logic's dB, then press Return `)
  }
  rl.close()
  output.closePort()
} else {
  console.error(
    'usage: midi-tool.mjs ports | listen <port> | send <port> <hex...> | sweep <port> [notouch]',
  )
  process.exit(1)
}
```

`<port>` is matched by substring, so `"MCU to Logic"` matches `IAC Driver MCU to Logic`. Run `node
midi-tool.mjs ports` first and record the exact port names. A button press below means two messages:
`send "MCU to Logic" 90 <id> 7f` then `send "MCU to Logic" 90 <id> 00`. Button IDs come from
`research/004-mcu-protocol/mcu.ts` (`BUTTON`).

### Spike AUv3 for the plugin checks

MAC-02 to MAC-08 and MAC-16 to MAC-23 use one throwaway Audio Unit built from Xcode's template. Follow
**Setup** in [`research/007-audio-unit-chat-plugin/README.md`](../../research/007-audio-unit-chat-plugin/README.md):
product `ClogicSpike`, type Effect, subtype `clgs`, manufacturer `Clgc`, gain replaced by a straight copy,
host app run once, no other copy installed. Keep the Xcode project outside the repo (it is throwaway,
and `research/` holds only what a spike commits).

## Index

Phases run in order. Within a phase, run checks in ID order unless a check says otherwise.

| ID     | Check                                                     | Replaces                                              | Issue | Feeds                   |
| ------ | --------------------------------------------------------- | ----------------------------------------------------- | ----- | ----------------------- |
| MAC-01 | Environment and Logic bundle facts                        | 003 #2, 005 A1 A2 A15, 006 P1, 010 #5, 011 row 5, 002 | G1    | 003, 005, 006, 010, 011 |
| MAC-02 | Spike AUv3 registers and passes `auval`                   | 007 M1, 010 #4 (part)                                 | G1    | 007                     |
| MAC-03 | Logic loads the AUv3 out of process                       | 007 M2, 003 #1                                        | G1    | 007, 003                |
| MAC-04 | `WKWebView` renders inside the extension in Logic         | 007 M6                                                | G1    | 007                     |
| MAC-05 | Typed keys reach the chat field                           | 007 M7                                                | G2    | 007                     |
| MAC-06 | Focus survives resize, reopen, app and track switches     | 007 M8                                                | G2    | 007                     |
| MAC-07 | Unhandled keys still reach Logic                          | 007 M9                                                | G2    | 007                     |
| MAC-08 | Extension connects to a companion socket in the app group | 003 #3                                                | G3    | 003                     |
| MAC-09 | MCU ports, install and first contact capture              | 004 #1 #2 #3                                          | G4    | 004                     |
| MAC-10 | MCU handshake challenge response                          | 004 #4                                                | G4    | 004                     |
| MAC-11 | Track names on the MCU LCD                                | 004 #5                                                | G4    | 004                     |
| MAC-12 | Fader position to dB curve                                | 004 #6                                                | G4    | 004                     |
| MAC-13 | Provider end-to-end with keys in the Keychain             | 009 run #1 #2 #3 #4 #6                                | G5    | 009                     |
| MAC-14 | Keychain item access list and prompts                     | 009 run #5, 003 #9, 010 Keychain check                | G5    | 009, 003, 010           |
| MAC-15 | Loudness and true peak vs Logic's meters                  | 001 #1                                                | G6    | 001                     |
| MAC-16 | Plugin window size                                        | 007 M10                                               | G2    | 007                     |
| MAC-17 | Host info: `contextName`, tempo, transport                | 007 M11, 003 #6                                       | G3    | 007, 003                |
| MAC-18 | When Logic calls render                                   | 007 M5                                                | G3    | 007                     |
| MAC-19 | Which slots offer the plugin                              | 007 M3                                                | G7    | 007                     |
| MAC-20 | Pass-through is bit-transparent                           | 007 M4                                                | G7    | 007                     |
| MAC-21 | Plugin state size that round-trips                        | 007 M12                                               | G7    | 007                     |
| MAC-22 | CPU with 20 instances                                     | 007 M13                                               | G7    | 007                     |
| MAC-23 | Instance IDs on copy, duplicate and Save As               | 007 M14                                               | G7    | 007                     |
| MAC-24 | MCU plug-in parameter read and write                      | 004 #7                                                | G8    | 004                     |
| MAC-25 | Undo history for MCU and AX changes                       | 004 #8, 003 #7, 005 A14                               | G8    | 004, 003, 005           |
| MAC-26 | MCU with Logic in the background and screen locked        | 004 #9                                                | G8    | 004                     |
| MAC-27 | MCU group isolation from real hardware                    | 004 #10                                               | G8    | 004                     |
| MAC-28 | Controller Assignments OSC input                          | 004 #11                                               | G8    | 004                     |
| MAC-29 | MIDI-learned key commands                                 | 005 A12                                               | G9    | 005                     |
| MAC-30 | Key command file and clipboard formats                    | 005 A11, 002 key commands                             | G9    | 005, 002                |
| MAC-31 | Posted keystroke delivery                                 | 005 A13                                               | G9    | 005                     |
| MAC-32 | Menu paths                                                | 005 A3                                                | G10   | 005                     |
| MAC-33 | Main window and mixer AX tree                             | 005 A4                                                | G10   | 005                     |
| MAC-34 | Plug-in window AX tree                                    | 005 A5                                                | G10   | 005                     |
| MAC-35 | Export / Bounce dialogs and file read-back                | 005 A6 A7                                             | G10   | 005                     |
| MAC-36 | Localisation and version drift of the AX paths            | 005 A8 A10                                            | G10   | 005                     |
| MAC-37 | Logic-written CAF decodes in full                         | 001 #2                                                | G6    | 001                     |
| MAC-38 | Stem masking on a real export                             | 001 #3                                                | G6    | 001                     |
| MAC-39 | LGPL ffmpeg build on arm64                                | 010 #1                                                | G12   | 010                     |
| MAC-40 | Signed Node SEA companion and native addon                | 010 #2, 003 #8                                        | G11   | 010, 003                |
| MAC-41 | SMAppService agent registration and restart               | 003 #4                                                | G11   | 003, 010                |
| MAC-42 | TCC prompt names the helper; grant survives an update     | 003 #5, 005 A9                                        | G11   | 003, 005                |
| MAC-43 | Signed `.pkg` installs; Logic sees the plugin             | 010 #3 #4 #6, nested-helper `codesign` check          | G12   | 010                     |
| MAC-44 | `.pkg` size and uninstall                                 | 010 #7                                                | G12   | 010                     |
| MAC-45 | Installed Help bundle                                     | 002 Help bundle                                       | G9    | 002                     |
| MAC-46 | `.logicx` layout, package vs folder                       | 006 P2                                                | G13   | 006                     |
| MAC-47 | `MetaData.plist` coverage                                 | 006 P3                                                | G13   | 006                     |
| MAC-48 | Plug-ins and routing in `ProjectData`                     | 006 P4                                                | G13   | 006                     |
| MAC-49 | Preset files and AAF / XML exports                        | 006 P5 P6                                             | G13   | 006                     |
| MAC-50 | Reading a project that is open in Logic                   | 006 P7                                                | G13   | 006                     |
| MAC-51 | Scripter host globals                                     | 008 #1                                                | G14   | 008                     |
| MAC-52 | Scripter `TargetEvent` scope and write                    | 008 #2 #3                                             | G14   | 008                     |
| MAC-53 | Scripter console thinning                                 | 008 #4                                                | G14   | 008                     |
| MAC-54 | Scripter API drift since 10.4.5                           | 008 #5                                                | G14   | 008                     |
| MAC-55 | Failure rate of generated Scripter scripts                | 008 #6                                                | G14   | 008                     |

Issue groups (one GitHub issue each, label `mac-check`; post results on the group's issue):

| Group | Title                                                  | Checks             | Spike issues             | Issue                                                  |
| ----- | ------------------------------------------------------ | ------------------ | ------------------------ | ------------------------------------------------------ |
| G1    | Environment and spike AUv3 loads in Logic              | MAC-01 to MAC-04   | #7, #3, #5, #6, #10, #11 | [#28](https://github.com/brandonapol/clogic/issues/28) |
| G2    | Keyboard focus and window size in the AU chat window   | MAC-05, 06, 07, 16 | #7                       | [#29](https://github.com/brandonapol/clogic/issues/29) |
| G3    | Plugin to companion socket and host info               | MAC-08, 17, 18     | #3, #7                   | [#30](https://github.com/brandonapol/clogic/issues/30) |
| G4    | MCU round trip: ports, handshake, names, fader curve   | MAC-09 to MAC-12   | #4                       | [#31](https://github.com/brandonapol/clogic/issues/31) |
| G5    | API keys in the Keychain and provider end-to-end       | MAC-13, 14         | #9, #3, #10              | [#32](https://github.com/brandonapol/clogic/issues/32) |
| G6    | Loudness and decoding vs Logic                         | MAC-15, 37, 38     | #1                       | [#33](https://github.com/brandonapol/clogic/issues/33) |
| G7    | Plugin behaviour: slots, null test, state, CPU, copies | MAC-19 to MAC-23   | #7                       | [#34](https://github.com/brandonapol/clogic/issues/34) |
| G8    | MCU plug-in parameters, undo, background, OSC          | MAC-24 to MAC-28   | #4, #3, #5               | [#35](https://github.com/brandonapol/clogic/issues/35) |
| G9    | Key commands and the Help bundle                       | MAC-29, 30, 31, 45 | #5, #2                   | [#36](https://github.com/brandonapol/clogic/issues/36) |
| G10   | Accessibility tree and the export dialog               | MAC-32 to MAC-36   | #5                       | [#37](https://github.com/brandonapol/clogic/issues/37) |
| G11   | Companion signing, launch agent and TCC                | MAC-40, 41, 42     | #10, #3, #5              | [#38](https://github.com/brandonapol/clogic/issues/38) |
| G12   | LGPL ffmpeg and `.pkg` install / uninstall             | MAC-39, 43, 44     | #10                      | [#39](https://github.com/brandonapol/clogic/issues/39) |
| G13   | `.logicx` project file checks                          | MAC-46 to MAC-50   | #6                       | [#40](https://github.com/brandonapol/clogic/issues/40) |
| G14   | Scripter checks                                        | MAC-51 to MAC-55   | #8                       | [#41](https://github.com/brandonapol/clogic/issues/41) |

## Phase 0: environment

### MAC-01 Environment and Logic bundle facts

Read only; takes minutes and answers six spikes' questions at once.

```sh
cd research/005-accessibility
./env.sh > ~/clogic-mac-checks/env.txt
plutil -p "/Applications/Logic Pro.app/Contents/Info.plist" | grep -E 'CFBundleShortVersionString|CFBundleVersion|CFBundleIdentifier'
codesign -d --entitlements - "/Applications/Logic Pro.app" 2>&1 | grep -E 'app-sandbox|disable-library-validation|allow-jit' || echo 'none of the three keys'
```

Then open Logic Pro > About Logic Pro > License (or the licence file `env.sh` lists) and read it.

- **Expected:** bundle ID `com.apple.logic10` (prior art, SPIKE-005); an empty or near-empty `sdef`
  (SPIKE-005 found only `renderpreview` in 2019); `disable-library-validation` present, since Logic loads
  third-party AUv2s (SPIKE-010 inference). Sandbox status is unknown.
- **Record:** `env.txt`; macOS, Logic version and build; whether `com.apple.security.app-sandbox` and
  `com.apple.security.cs.disable-library-validation` are present; the `sdef` output; the licence's date,
  its reverse-engineering clause verbatim, and any clause on automation, key commands, Accessibility or
  third-party control.
- **Feeds:** 005 § Mac checks to run (A1, A2, A15) and § What the platform allows; 003 § Process split
  (AUv2 fallback) and Not done item 2; 010 § Code signing and notarisation (AUv2 row) and human step 5; 006 § Legal
  constraints (P1); 011 § Findings table row 5 and § Apple terms (Logic Pro licence); 002 § Recommendation (item 4, reading the installed version).

## Phase 1: blocking checks

These decide whether the planned architecture works at all: the chat window can take typing inside
Logic, the plugin can talk to the companion, the companion can drive Logic's mixer over MCU, keys live
safely in the Keychain, and the analysis numbers match Logic's own meters.

### MAC-02 Spike AUv3 registers and passes `auval`

Build the spike AUv3 (see [Spike AUv3](#spike-auv3-for-the-plugin-checks)), run its host app once, quit.

```sh
pluginkit -m -v | grep -i clogicspike
auval -a | grep Clgc
auval -v aufx clgs Clgc
```

Then Logic > Settings > Plug-in Manager, select the plugin, Reset & Rescan Selection.

- **Expected:** listed by `pluginkit` and `auval -a`; `auval -v` ends with `AU VALIDATION SUCCEEDED`;
  Plug-in Manager Compatibility column says it is compatible.
- **Record:** full `auval -v` output; Compatibility column text; whether a rescan or
  `killall -9 AudioComponentRegistrar` was needed before Logic listed it.
- **Feeds:** 007 § Mac checks (M1); 010 § Where things install (Plugin scan).

### MAC-03 Logic loads the AUv3 out of process

Insert the spike plugin on an audio track in a scratch project and open its window.

```sh
ps -axo pid,ppid,comm | grep -i -E 'clogicspike|logic pro'
```

Also look in Activity Monitor (search `ClogicSpike`).

- **Expected:** the extension runs as its own process, not inside Logic Pro (Apple's AUv3 docs; a 2023
  forum report says Logic on Apple silicon has no in-process option).
- **Record:** process names, PIDs and parents for the extension and Logic; any other process that
  appears only while the plugin is inserted.
- **Feeds:** 007 § Mac checks (M2); 003 § Process split (first bullet) and Not done item 1.

### MAC-04 `WKWebView` renders inside the extension in Logic

In the spike, replace the SwiftUI view with an `NSView` holding a `WKWebView` that loads a bundled
`index.html` with `loadFileURL(_:allowingReadAccessTo:)` on the bundle's web folder. The page should
contain a `<textarea>` (used by MAC-05). Build twice: without, then with
`com.apple.security.network.client` in the extension's entitlements.

While opening the plugin window, stream errors:

```sh
log stream --style compact --predicate 'process CONTAINS[c] "ClogicSpike" OR process CONTAINS[c] "WebContent"' | tee ~/clogic-mac-checks/mac-04.log
```

- **Expected:** renders only with `network.client` (SPIKE-007 cites a forum answer that WebKit needs it
  in a sandboxed process even for local content).
- **Record:** renders yes / no for each build; sandbox or WebKit errors from the log; final entitlements
  (`codesign -d --entitlements - <path to .appex>`).
- **Feeds:** 007 § Chat UI: web view hosting and § Mac checks (M6).

### MAC-05 Typed keys reach the chat field

With the MAC-04 build in Logic: click the `<textarea>`, then type every letter a to z, digits 0 to 9,
space, Return, Delete, the four arrows, and Cmd-A, Cmd-C, Cmd-V, Cmd-Z.

- **Expected:** unknown; this is the main product risk. Reports since 2007 say Logic takes keys that match
  its key commands.
- **Record:** a table of key → reached the field / triggered a Logic command (name the command, as
  shown in Logic's Key Commands window) / nothing; whether Logic's default key command set was in use.
- **Feeds:** 007 § Keyboard focus and § Mac checks (M7). If many keys are stolen, the pop-out window
  fallback in 007 § Recommendation becomes the plan.

### MAC-06 Focus survives window changes

After MAC-05, for each action, type into the field afterwards: resize the plugin window by its edge;
close and reopen the plugin window; Cmd-Tab to another app and back; select a different track and come
back.

- **Expected:** a 2022 to 2023 report says focus is lost for good after resizing an out-of-process
  plugin on Apple silicon; the reported workaround is to focus a web view and then refocus the field.
- **Record:** pass / fail per action; whether clicking the field again recovers typing.
- **Feeds:** 007 § Keyboard focus and § Mac checks (M8).

### MAC-07 Unhandled keys still reach Logic

With the field **not** focused (click empty page area), press space: does Logic play and stop? Then add
a `WKWebView` subclass whose `keyDown(with:)` forwards events it does not handle to `nextResponder`,
rebuild, and repeat.

- **Expected:** without the override, space may not reach Logic (JUCE forum report, open Sept 2026).
- **Record:** behaviour before and after the override, for space and two other Logic key commands.
- **Feeds:** 007 § Keyboard focus (design point 2) and § Mac checks (M9).

### MAC-08 Extension connects to a companion socket in the app group

Proves the IPC path in SPIKE-003. Uses the spike plugin plus a stand-in companion (`nc`).

1. In Xcode, add the App Groups capability to the extension with the group `<TeamID>.clogic` (your Team
   ID, not `group.…`). Record the Team ID.
2. Add a button to the spike UI that opens a UNIX domain socket (`socket(AF_UNIX, SOCK_STREAM, 0)` +
   `connect`) to `<group container>/c.sock`, where the container comes from
   `FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)`, writes one line
   `{"jsonrpc":"2.0","method":"ping"}` and shows any reply or the `errno` text.
3. In Terminal (not sandboxed, standing in for the companion):

   ```sh
   G="$HOME/Library/Group Containers/<TeamID>.clogic"
   mkdir -p "$G" && rm -f "$G/c.sock"
   nc -lkU "$G/c.sock"
   ```

4. Insert the plugin in Logic, press the button; type a reply line in the `nc` terminal.

- **Expected:** connects with no prompt (App Groups documentation; SPIKE-003 § Plugin to companion IPC).
- **Record:** connect result or `errno`; whether the line arrives and the reply comes back; any prompt
  (exact text, especially "would like to access data from other apps"); the extension's entitlements;
  macOS version. Repeat on macOS 26 if available (SPIKE-003 asks for 15 and 26).
- **Feeds:** 003 § Plugin to companion IPC and Not done item 3; 007 § State, instances and IPC.

### MAC-09 MCU ports, install and first contact capture

1. Audio MIDI Setup > Window > Show MIDI Studio > IAC Driver: tick "Device is online", add two buses
   named `MCU to Logic` and `MCU from Logic`.
2. Start capturing **before** binding: `node ~/clogic-mac-checks/midi-tool.mjs listen "MCU from Logic" | tee mac-09.log`
3. Logic Pro > Control Surfaces > Setup. Note whether Logic auto-detected anything. Then New > Install >
   Mackie Designs > Mackie Control > Add. Output Port `MCU from Logic`, Input Port `MCU to Logic`. In the
   inspector, give it its own Control Surface Group.
4. Open a scratch project with 16 named tracks (MAC-11 names) and let the capture run 10 seconds.

- **Expected:** a device query `f0 00 00 66 14 00 f7` (or model `15`) and a burst of feedback (a third
  party saw 161 packets within seconds, first feedback ~260 ms after the query). Model IDs `14` / `15`
  are from secondary sources only.
- **Record:** `mac-09.log` (first 2 seconds in full); the model byte Logic uses; whether anything worked
  before the manual install; the Setup window settings (screenshot).
- **Feeds:** 004 § Registration and handshake and § Mac checks for a human (1 to 3).

### MAC-10 MCU handshake challenge response

Keep the MAC-09 listener running. In another terminal:

```sh
node ~/clogic-mac-checks/midi-tool.mjs send "MCU to Logic" f0 00 00 66 14 01 43 4c 4f 47 49 43 31 01 02 03 04 f7
```

- **Expected:** if Logic still uses the 2004 algorithm it replies
  `f0 00 00 66 14 02 43 4c 4f 47 49 43 31 05 05 7b 2f f7` (same vector as the prototype test
  `computes the published challenge response`). A third party says Logic does not reliably reply.
- **Record:** Logic's reply bytes, or none within 2 s; repeat with model `15` if `14` got nothing.
- **Feeds:** 004 § Registration and handshake and § Mac checks for a human (4).

### MAC-11 Track names on the MCU LCD

Scratch project with 16 tracks named `Kick`, `Snare`, `Hats`, `Bass`, `Vocals Lead`, `Vocals Double`,
`Gtr L`, `Gtr R`, `Keys`, `Pad`, `FX Riser`, `Drum Bus`, `Vox Bus`, `Reverb`, `Delay`, `Room Mic`. Keep
the listener running and press BANK RIGHT:

```sh
node ~/clogic-mac-checks/midi-tool.mjs send "MCU to Logic" 90 2f 7f
node ~/clogic-mac-checks/midi-tool.mjs send "MCU to Logic" 90 2f 00
```

Decode the LCD sysex (`f0 00 00 66 <model> 12 <offset> <ascii…> f7`) by hand or with `applyLcd` from
`research/004-mcu-protocol/mcu.ts`. Press BANK RIGHT again past the last track. Then set Group settings
V-Pot 5 to "No: Name" and repeat.

- **Expected:** 6 characters plus a space per strip (`Vocals Lead` and `Vocals Double` likely collide);
  output and master strips may appear in the bank; the last bank clamps (third-party report).
- **Record:** the LCD text for each bank; truncations and collisions; whether output / master strips
  appear; the effect of "No: Name"; how non-ASCII names render if you add one.
- **Feeds:** 004 § Reading state, § Navigation and § Mac checks for a human (5); capability matrix rows
  "Track / channel name" and "Full track list".

### MAC-12 Fader position to dB curve

Track 1 at unity. Put the surface in Track Channel view (TRACK `0x28` twice) with NAME/VALUE (`0x34`)
showing values. Keep the listener running so the LCD text is captured, then:

```sh
node ~/clogic-mac-checks/midi-tool.mjs sweep "MCU to Logic"
```

At each prompt, record Logic's dB from the LCD lower row (strip 1) and from the Mixer. Repeat once with
`sweep "MCU to Logic" notouch`.

- **Expected:** no published curve. A free reference point: OPTION + SELECT sets unity (Apple).
- **Record:** a table position → LCD dB → Mixer dB for both runs; the positions nearest 0.0 dB and
  −6.0 dB; the dB step size near 0 dB; whether writes without touch were accepted; whether the fader
  snapped back (motor-fader echo). Attach the listener log.
- **Feeds:** 004 § Writing (Faders, dB mapping) and § Mac checks for a human (6); the "set a fader to
  −6.0 dB" demo in 004 § Demo script; ADR 0004's pending checks; the calibration
  points for `src/mcu/calibration.ts`.

### MAC-13 Provider end-to-end with keys in the Keychain

From the repo root, with each key copied to the clipboard in turn:

```sh
npm run build
pbpaste | node --experimental-strip-types research/009-llm-providers/e2e.ts save anthropic
pbpaste | node --experimental-strip-types research/009-llm-providers/e2e.ts save openai
pbpaste | node --experimental-strip-types research/009-llm-providers/e2e.ts save xai
security find-generic-password -s clogic.llm-api-key -a anthropic
node --experimental-strip-types research/009-llm-providers/e2e.ts run
echo 'sk-bad' | node --experimental-strip-types research/009-llm-providers/e2e.ts save openai
node --experimental-strip-types research/009-llm-providers/e2e.ts remove xai
node --experimental-strip-types research/009-llm-providers/e2e.ts run xai
MODEL=claude-haiku-4-5 node --experimental-strip-types research/009-llm-providers/e2e.ts run anthropic
```

Re-save the xAI key afterwards. For the cheap-model line, also try one cheap model each for OpenAI and
xAI, taken from the model list `save` validated against.

- **Expected:** each `save` succeeds and the item appears in Keychain Access under
  `clogic.llm-api-key`; `run` shows `tool_use` with a `get_loudness` call for `/tmp/mix.wav`, then a
  final answer quoting −9.8 LUFS; the bad key gives the "rejected the API key" message and nothing is
  saved; after `remove xai`, `run xai` says no key is saved.
- **Record:** pass / fail per line; token usage per provider; any HTTP 400 and its message (suspects:
  xAI replay of OpenAI-style items, `store` / `include`, stale default model IDs); whether `ps` or shell
  history shows any key (`history | grep -i -E 'sk-|xai-'` should print nothing).
- **Feeds:** 009 § What a human must still run (1 to 4, 6), § Model choice (defaults still valid).

### MAC-14 Keychain item access list and prompts

After MAC-13: Keychain Access > login > search `clogic.llm-api-key` > open the `anthropic` item >
Access Control. Then run `e2e.ts run anthropic` from a second terminal app (for example iTerm if you
used Terminal).

- **Expected:** `/usr/bin/security` listed as the trusted app (SPIKE-009); no prompt, because the same
  binary reads it.
- **Record:** the Access Control list; any prompt, its text and the binary it names. When MAC-40 /
  MAC-42 produce a signed helper, repeat: (a) the helper reads an item created by `/usr/bin/security`;
  (b) the helper creates its own item, is re-signed as an update, and reads it again. Record prompts for
  both.
- **Feeds:** 009 § Keys in the Keychain (open question) and § What a human must still run (5); 003 §
  Keys and Not done item 9; 010 § Code signing and notarisation (SPIKE-009 Keychain question).

### MAC-15 Loudness and true peak vs Logic's meters

Done-when for SPIKE-001: within ±0.5 LU and ±0.3 dB on at least 3 files.

1. Pick three copies of your own finished mixes with different character (a loud master, a dynamic
   acoustic mix, one under a minute). Bounce each (File > Bounce > Project or Section) as PCM WAV 24-bit
   at the project rate with Normalize **off**. For one of them, also bounce AIFF 24-bit and CAF 32-bit
   float (this also feeds MAC-37).
2. Logic measurement: new empty project at the file's sample rate; import the bounce on one audio track,
   no plug-ins, track and Stereo Out faders at 0 dB. Insert Loudness Meter on Stereo Out, reset it, play
   from the start to the end without stopping. If the Loudness Meter has no true-peak readout, check
   whether Logic's Level Meter plug-in has a true-peak mode and use that; note which plug-in and setting
   you used.
3. Our measurement, for each file:

   ```sh
   node --experimental-strip-types research/001-offline-analysis/analyse.ts mix.wav > mix.report.json
   ffmpeg -hide_banner -nostats -i mix.wav -af ebur128=peak=true:framelog=info -f null - 2>&1 | tail -15
   ```

- **Expected:** integrated LUFS within ±0.5 LU and true peak within ±0.3 dB (the ffmpeg path matches the
  EBU Tech 3341 / 3342 vectors exactly on Linux).
- **Record:** a table per file and format: Logic I / max S / LRA / true peak vs ours (`loudness` in the
  report), and the differences; the bounce settings; the meter plug-in and its settings.
- **Feeds:** 001 § Still needs a Mac with Logic Pro (1), Done when, and § Verdict.

## Phase 2: high-value checks

Run after Phase 1. They shape the design but do not decide whether it is possible.

### MAC-16 Plugin window size

In the spike, set `preferredContentSize` to 440 × 680 and return an empty `IndexSet` from
`supportedViewConfigurations(_:)`. Open the window, drag its edge, close and reopen, save, close and
reopen the project.

- **Expected:** opens at 440 × 680; Logic resizes AUv3s by the window border (forum report).
- **Record:** initial size; whether and how far the user can resize; size after reopen and after
  project reload; any growth or lock-up (reported Logic resize bugs).
- **Feeds:** 007 § Window sizing and § Mac checks (M10).

### MAC-17 Host info: `contextName`, tempo, transport

Log (from a non-render thread, shown in the UI) `contextName`, `musicalContextBlock` and
`transportStateBlock` after `allocateRenderResources`. Rename the track, change tempo, play and stop.

- **Expected:** `contextName` set and updated for Audio FX (Jan 2024 report); the two blocks were `nil`
  in Logic 10.3 (2017); current state unknown.
- **Record:** which are non-`nil`; whether each value updates and how quickly.
- **Feeds:** 007 § Host information (M11); 003 § Session context and Not done item 6.

### MAC-18 When Logic calls render

Count render calls in an atomic counter read by the UI (do not log from the render thread). States:
playing; stopped; stopped with the track selected; record-armed; plugin on Stereo Out; plugin on an
empty bus.

- **Expected:** Logic skips render when nothing needs processing (developer reports quoting Apple).
  Unknown for the Stereo Out.
- **Record:** a table state → render running yes / no.
- **Feeds:** 007 § How a pass-through effect behaves (M5).

### MAC-19 Which slots offer the plugin

Try the Audio FX slots on an audio track, a software instrument track, an aux and Stereo Out, and the
MIDI FX slot on an instrument track.

- **Expected:** in every Audio FX slot under Audio Units > manufacturer; not in MIDI FX.
- **Record:** the menu path in each slot, and where it is missing.
- **Feeds:** 007 § Plugin type and where it can be inserted (M3).

### MAC-20 Pass-through is bit-transparent

Bounce a test file through an audio track twice, with and without the plugin (same settings,
Normalize off), then:

```sh
ffmpeg -i with.wav -i without.wav -filter_complex "[1]volume=-1[n];[0][n]amix=inputs=2:normalize=0,volumedetect" -f null - 2>&1 | grep -E 'mean_volume|max_volume'
```

- **Expected:** silence (`max_volume` at the floor, about −91 dB or lower).
- **Record:** `mean_volume` and `max_volume`.
- **Feeds:** 007 § How a pass-through effect behaves (M4).

### MAC-21 Plugin state size that round-trips

Store 1 KB, 256 KB, 1 MB and 5 MB blobs in `fullState`; save, close, reopen.

- **Expected:** unknown; SPIKE-007 caps the transcript at 256 KB until measured.
- **Record:** largest size that round-trips; save time; any Logic warning; project size growth.
- **Feeds:** 007 § State, instances and IPC (M12).

### MAC-22 CPU with 20 instances

20 instances on 20 playing tracks. Watch Logic's CPU meter and Activity Monitor.

- **Record:** CPU per instance; number of extension processes (one shared or one each).
- **Feeds:** 007 § How a pass-through effect behaves (M13).

### MAC-23 Instance IDs on copy, duplicate and Save As

Store a UUID in `fullState` and show it in the UI. Option-drag the plugin to another track; duplicate
the track; Save As a new project.

- **Expected:** copied in all three cases (inferred), so the companion must re-assign duplicates.
- **Record:** whether the UUID is copied in each case.
- **Feeds:** 007 § State, instances and IPC (M14).

### MAC-24 MCU plug-in parameter read and write

Insert Channel EQ and Compressor on track 1. Press PLUG-IN (`0x2b`), select the slot, page with Cursor
Left / Right (`0x62` / `0x63`) and capture the LCD. Set the Compressor threshold to −20 dB two ways: by
V-Pot steps (strip 1: `send "MCU to Logic" b0 10 01` is one tick clockwise, `b0 10 41` one tick
counter-clockwise) and by FLIP (`0x32`) + a fader write.

Do not press a V-Pot in Plug-in or Instrument views, the EQ button on a strip with no Channel EQ, or
SAVE: 004 § Dangerous controls.

- **Expected:** names and values on the LCD, paged by 8; absolute writes through Flip (Apple guide).
- **Record:** LCD text per page; the threshold reached by each method; whether the plug-in window opens
  or closes on its own.
- **Feeds:** 004 § Plug-in parameters and § Mac checks for a human (7); capability matrix rows "Any
  automatable plug-in" and "Channel EQ bands".

### MAC-25 Undo history for MCU and AX changes

Edit > Undo History, with "Include Parameter Changes From" Mixer and Plug-in enabled (SPIKE-005
cites the User Guide for this option; find where your Logic version puts it). Check it after MAC-12 and MAC-24, and after one fader
change made through Accessibility (Accessibility Inspector or `ax-dump` to find the fader, then an
`osascript` `set value` on it).

- **Expected:** unknown. Until known, Revert re-applies recorded values instead of pressing UNDO.
- **Record:** whether each MCU fader write, MCU plug-in change and AX change appears as an undo step, and
  whether Undo reverts it; the setting's exact location in your Logic version.
- **Feeds:** 004 § Writing (Undo) and § Mac checks (8); 003 § Session change safety and Not done item 7;
  005 § Export stems and bounce (A14).

### MAC-26 MCU with Logic in the background and screen locked

Repeat one fader write from MAC-12 with another app frontmost, then with the screen locked (send from an
SSH session or with `sleep 20; node … send …` before locking).

- **Record:** whether the write lands in each case.
- **Feeds:** 004 § Latency, reliability and coexistence and § Mac checks (9).

### MAC-27 MCU group isolation from real hardware

Only with a real Mackie Control (or compatible) connected in a separate Control Surface Group. Bank the
virtual surface (BANK RIGHT) and watch the hardware.

- **Expected:** separate groups bank independently (Apple guide).
- **Record:** whether the hardware moved; group setup screenshot. Mark "could not run" without hardware.
- **Feeds:** 004 § Latency, reliability and coexistence, § Answers to the risks and § Mac checks (10).

### MAC-28 Controller Assignments OSC input

Logic Pro > Control Surfaces > Controller Assignments > Expert view. Look for how an OSC input is chosen
(port, device list, network setting). Do not capture or analyse Logic Remote traffic (SPIKE-011 #8).

- **Record:** screenshots; whether an OSC port or device can be set and where; any OSC path shown for an
  assignment.
- **Feeds:** 004 § OSC (item 3) and § Mac checks (11).

### MAC-29 MIDI-learned key commands

1. Add an IAC bus `clogic cmd` (as in MAC-09).
2. Key Commands window (Option-K), select "Bounce Project or Section", Learn New Assignment, then:
   `node ~/clogic-mac-checks/midi-tool.mjs send "clogic cmd" bf 66 7f`. Turn Learn off.
3. With Terminal frontmost (Logic in the background), send the same message. Cancel the dialog if it
   opens.
4. Quit and relaunch Logic; send again.
5. Key Commands window > Save As a new set; `grep -a -c 'clogic\|Bounce' <saved file>` and inspect it
   with MAC-30's commands.

- **Expected:** learned and fires in the background (documented Learn; background behaviour unverified).
- **Record:** pass / fail for each step; whether the MIDI assignment is in the saved set. Restore your
  own key command set afterwards.
- **Feeds:** 005 § Logic's scripting and key command surfaces (A12) and § Follow-ups (possible ADR).

### MAC-30 Key command file and clipboard formats

Key Commands window: Save As (note the default folder), and Options > Copy Key Commands to Clipboard.

```sh
ls -la ~/Music/"Audio Music Apps"/"Key Commands"/ ~/Library/"Application Support"/Logic/"Key Commands"/ 2>&1
file "<saved set>"; plutil -p "<saved set>" | head -40
pbpaste > ~/clogic-mac-checks/key-commands-clipboard.txt; head -40 ~/clogic-mac-checks/key-commands-clipboard.txt
```

- **Record:** the folder and extension; whether the file is a plist (and its top-level keys); clipboard
  format (columns, separators) with the first lines; whether MIDI assignments appear in either.
- **Feeds:** 005 § Logic's scripting and key command surfaces (A11); 002 § Key commands.

### MAC-31 Posted keystroke delivery

Grant Terminal the Post Event / Accessibility permission when prompted and note the prompt text. Save as
`~/clogic-mac-checks/post-cmd-b.swift`:

```swift
import AppKit

let logic = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.logic10").first
guard let pid = logic?.processIdentifier else { fatalError("Logic Pro is not running") }
for down in [true, false] {
    let event = CGEvent(keyboardEventSource: nil, virtualKey: 11, keyDown: down)
    event?.flags = .maskCommand
    event?.postToPid(pid)
}
```

Run `swift ~/clogic-mac-checks/post-cmd-b.swift` with Logic in the background; then
`sleep 5; swift …` and switch to Logic (frontmost); then the same with the MAC-04 plugin window open and
its field focused. Key code 11 is B on an ANSI layout.

- **Expected:** dropped unless Logic is frontmost (prior art); may land in our field when it has focus.
- **Record:** what happened in each case; the prompts and which app they name.
- **Feeds:** 005 § Sending key events (A13).

### MAC-32 to MAC-35 Accessibility dumps and the export dialog

On a copy of a test project, from `research/005-accessibility/` (Terminal will ask for Accessibility and
Automation; note the prompts' wording):

```sh
osascript menu-dump.applescript > ~/clogic-mac-checks/menus.txt               # MAC-32 (A3)
osascript ax-dump.applescript 6 > ~/clogic-mac-checks/ax-main.txt             # MAC-33 (A4)
# open the Mixer (X), then:
osascript ax-dump.applescript 8 > ~/clogic-mac-checks/ax-mixer.txt            # MAC-33 (A4)
# open a Channel EQ window, then; toggle Controls view and repeat; repeat with one third-party plug-in:
osascript ax-dump.applescript 8 > ~/clogic-mac-checks/ax-plugin.txt           # MAC-34 (A5)
mkdir -p ~/Desktop/clogic-005-out
osascript open-export-dialog.applescript export                               # MAC-35 (A6)
osascript ax-dump.applescript 10 > ~/clogic-mac-checks/ax-export-dialog.txt   # MAC-35 (A6)
# in the dialog: untick "Add resulting files to Project Audio Browser", choose ~/Desktop/clogic-005-out,
# click Save yourself; at the same time, in a second terminal:
./watch-folder.sh ~/Desktop/clogic-005-out 900                                # MAC-35 (A7)
osascript open-export-dialog.applescript bounce                               # MAC-35 (A6), then Cancel
```

Accessibility Inspector (Xcode > Open Developer Tool) gives the same tree interactively. If a script
fails, the error is evidence: record it.

- **Expected:** standard menus at `File > Export > All Tracks as Audio Files`, `File > Bounce > Project
or Section`, `Mix > Mastering Assistant`; `AXIdentifier` mostly empty (prior art); Logic plug-ins
  readable in Controls view; third-party custom views opaque.
- **Record:** for MAC-32, the three menu paths; MAC-33, roles, whether any `AXIdentifier` is set, depth
  to a fader; MAC-34, parameters visible in each view; MAC-35, whether the dialog's format, bit depth and
  folder controls are exposed, and `watch-folder.sh` time to stable files. Attach the `.txt` files
  (redact track names if needed).
- **Feeds:** 005 § Accessibility tree, § Export stems and bounce, § Actions ranked by expected
  reliability (re-rank), § Mac checks to run (A3 to A7).

### MAC-36 Localisation and version drift of the AX paths

System Settings > General > Language & Region > Applications: add Logic Pro in German or French,
relaunch Logic, repeat `menu-dump` and `ax-dump 6`, then remove the override. If a second Logic version
is available (for example 11.2), repeat MAC-32 to MAC-35 there and `diff` the dumps.

- **Record:** which titles and `AXDescription` values change with language; the diff between versions.
- **Feeds:** 005 § Answers to the spike's risks and § Mac checks to run (A8, A10).

### MAC-37 Logic-written CAF decodes in full

Bounce the same range from one project as WAV 24-bit and CAF 24-bit PCM, and, if Logic offers ALAC in
a CAF container, as that too (record which containers Logic offers for ALAC).

```sh
for f in range.wav range.caf range-alac.caf; do
  ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample:format=duration -of compact "$f"
  echo "$f decoded bytes: $(ffmpeg -v error -i "$f" -f f32le -ac 2 - | wc -c)"
done
```

- **Expected:** equal decoded byte counts. ffmpeg-written ALAC-in-CAF decoded 576 samples short on Linux.
- **Record:** `ffprobe` lines and byte counts; any warnings; extra chunks reported by
  `ffprobe -v debug` if counts differ.
- **Feeds:** 001 § Decoding (Open item) and § Still needs a Mac with Logic Pro (2).

### MAC-38 Stem masking on a real export

On a copy of a real multitrack project (at least 8 tracks, including kick and bass), File > Export > All
Tracks as Audio Files to an empty folder, then:

```sh
time node --experimental-strip-types research/001-offline-analysis/analyse.ts ~/Desktop/stems/ > stems.json
```

- **Expected:** heuristic, no perceptual weighting: expect false positives on dense mixes.
- **Record:** run time and stem count; each reported conflict marked "audible" / "not audible" after
  soloing the pair; obvious conflicts it missed. Suggested threshold changes, if any.
- **Feeds:** 001 § Masking and § Still needs a Mac with Logic Pro (3).

## Phase 3: packaging and signing

Needs Developer ID certificates. These feed SPIKE-010 and the companion design; the product cannot ship
until they pass, but they do not block Phase 1 or 2 decisions.

### MAC-39 LGPL ffmpeg build on arm64

```sh
WORK=~/clogic-mac-checks/ffmpeg research/010-installer-and-distribution/build-lgpl-ffmpeg.sh
```

- **Expected:** `ffmpeg -L` reports LGPL; about 5 MB, similar to the Linux build.
- **Record:** script output, `ffmpeg -L` licence line, stripped sizes, `file` output (arm64).
- **Feeds:** 010 § ffmpeg (Mac check) and § What a human must still run (1); ADR 0003.

### MAC-40 Signed Node SEA companion and native addon

Build a Node single executable of a stub companion (Node SEA docs for your Node version; record the
exact commands). Sign it with hardened runtime and only `com.apple.security.cs.allow-jit`:

```sh
codesign --force --timestamp --options runtime --entitlements jit.plist \
  --sign "Developer ID Application: <name> (<TeamID>)" ./clogic-companion
codesign -dv --entitlements - ./clogic-companion
./clogic-companion
```

Add entitlements one at a time only if it crashes. Then load the `@julusian/midi` `.node` addon through
`process.dlopen` from the SEA.

- **Record:** final entitlements; crash logs for each failed attempt; whether the addon loads (and
  whether `disable-library-validation` was needed).
- **Feeds:** 010 § Code signing and notarisation and human step 2; 003 § Packaging the TypeScript companion and Not done 8.

### MAC-41 SMAppService agent registration and restart

In a stub `clogic.app`: a plist in `Contents/Library/LaunchAgents/` with `BundleProgram` pointing at the
helper and `KeepAlive` true; call `SMAppService.agent(plistName:).register()` on first launch.

```sh
launchctl print gui/$(id -u)/<label> | head -30
kill -9 <helper pid>; sleep 5; pgrep -fl clogic
```

- **Record:** `register()` result and `status`; whether System Settings > General > Login Items asks
  for approval and the name it shows; whether the helper restarts after `kill -9`.
- **Feeds:** 003 § Launching the companion and Not done item 4; 010 § Where things install (companion, SMAppService).

### MAC-42 TCC prompt names the helper; grant survives an update

From the launchd-started helper (MAC-41), call `AXIsProcessTrustedWithOptions` with the prompt option.

- **Record:** the exact prompt text and app name shown; `codesign -dr - <helper.app>` (designated
  requirement). Bump the version, re-sign with the same Team ID, reinstall, and check the grant is still
  on. Repeat once with a different signing identity (ad hoc) to confirm the grant is lost.
- **Feeds:** 003 § Launching the companion (TCC) and Not done item 5; 005 § Which process asks for
  permission (A9); 010 § Code signing and notarisation.

### MAC-43 Signed `.pkg` installs; Logic sees the plugin

Package the spike plugin (AUv2 stub or the AUv3 in its app), the companion app and the MAC-39 ffmpeg:

```sh
codesign --verify --strict --deep -vv clogic.app
pkgbuild --root <payload> --identifier <id> --version 0.0.1 --install-location /Applications clogic-component.pkg
productbuild --distribution distribution.xml --package-path . --sign "Developer ID Installer: <name> (<TeamID>)" clogic.pkg
xcrun notarytool submit clogic.pkg --keychain-profile <profile> --wait
xcrun stapler staple clogic.pkg
spctl -a -vv -t install clogic.pkg
```

Install on a clean macOS 15.6+ user account. Then MAC-02's `auval` and Plug-in Manager checks, first
without and then with `killall -9 AudioComponentRegistrar`. From inside the installed app, spawn the
bundled ffmpeg on a WAV and an MP3.

- **Record:** each command's result; notarisation log (`xcrun notarytool log <id>`); whether Logic saw
  the plugin without the registrar restart; ffmpeg exit codes from inside the app.
- **Feeds:** 010 § Where things install (placement table, Plugin scan) and human steps 3, 4 and 6.

### MAC-44 `.pkg` size and uninstall

```sh
ls -l clogic.pkg
pkgutil --pkgs | grep -i clogic; pkgutil --files <id>
```

Run the uninstaller, then check `pkgutil --pkgs`, both `Plug-Ins/Components` folders, Login Items and
`~/Library/Group Containers/`.

- **Expected:** about 30 to 35 MB for arm64 with a Node SEA (estimate).
- **Record:** size; what remains after uninstall; what `pkgutil --forget` removes.
- **Feeds:** 010 § Installer size estimate, § Uninstaller and human step 7.

## Phase 4: lower priority

### MAC-45 Installed Help bundle

The names below are guesses from SPIKE-002, not claims.

```sh
plutil -p "/Applications/Logic Pro.app/Contents/Info.plist" | grep -i helpbook
find "/Applications/Logic Pro.app/Contents/Resources" -maxdepth 2 -name '*.help'
plutil -p "<found>.help/Contents/Info.plist" | grep -iE 'HPDBook|RemoteURL'
du -sh "<found>.help"; ls "<found>.help/Contents/Resources/en.lproj" | head
```

- **Expected:** possibly a thin stub that loads help.apple.com (`HPDBookRemoteURL`).
- **Record:** all output; whether full topic pages are on disk.
- **Feeds:** 002 § Installed Help bundle and § Follow-ups (option C vs D).

### MAC-46 `.logicx` layout, package vs folder

New empty project, saved as a package, then again with "Organize my project as a folder".

```sh
find "Song.logicx" -print
plutil -p "Song.logicx/Alternatives/000/MetaData.plist"
plutil -p "Song.logicx/Resources/ProjectInformation.plist"
```

- **Record:** both listings; `HasProjectFolder`; where `Audio Files` goes.
- **Feeds:** 006 § Bundle layout and § Mac checks (P2).

### MAC-47 `MetaData.plist` coverage

In a copy: 97 BPM, 48 kHz, F# minor, 7/8; add audio, software instrument, aux (via a send), Drummer and
external MIDI tracks; save and close.

```sh
python3 -B research/006-project-file-introspection/inspect_logicx.py Song.logicx
```

Add a tempo change at bar 9, save, re-run. If an older Logic 10.x is available, save there too.

- **Expected:** `BeatsPerMinute` stays the start tempo.
- **Record:** script output for each save; any wrong or missing value; keys per Logic version.
- **Feeds:** 006 § `MetaData.plist` and `ProjectInformation.plist` and § Mac checks (P3).

### MAC-48 Plug-ins and routing in `ProjectData`

From the MAC-47 project, make copies: A with one third-party AU inserted; B adds Channel EQ on track 1;
C adds a send from track 1 to Bus 1; D renames track 1 to `Lead Vox`. For each:

```sh
python3 -B research/006-project-file-introspection/inspect_logicx.py X.logicx
cmp -l A.logicx/Alternatives/000/ProjectData B.logicx/Alternatives/000/ProjectData | wc -l
strings D.logicx/Alternatives/000/ProjectData | grep -c 'Lead Vox'
auval -l | grep -i <the AU's manufacturer>
```

- **Record:** whether the AU triple matches `auval -l`; whether the `GAME` count changes with Channel EQ;
  byte differences between copies; whether `Lead Vox` appears. Optionally, what logic2ableton or
  lpx-explorer report when run as separate tools (never linked into our code).
- **Feeds:** 006 § `ProjectData`, § Existing open-source readers and § Mac checks (P4).

### MAC-49 Preset files and AAF / XML exports

Save a channel strip setting and a Channel EQ setting from the MAC-48 project, then `file`, `plutil -p`
(or `xxd | head`) each. Export the project as AAF and as Final Cut Pro XML;
`grep -i -E 'eq|bus|send|plug' <xml>`.

- **Record:** the saved paths, whether either preset is a plist; whether plug-in names, sends or buses
  appear in the XML or AAF.
- **Feeds:** 006 § Channel strip settings and presets (P5) and § Export alternatives (P6).

### MAC-50 Reading a project that is open in Logic

With the project open and being edited, run the inspector twice a minute apart.

- **Expected:** `readOnlyCheck` stays `unchanged` for each run itself.
- **Record:** `readOnlyCheck` for both runs; which files Logic changes on its own (autosave, undo) between
  runs.
- **Feeds:** 006 § Read-only guarantee and § Mac checks (P7).

### MAC-51 to MAC-55 Scripter

Enable Logic Pro > Settings > Advanced > Enable Complete Features. Scripter on a software instrument
track's MIDI FX slot.

- **MAC-51 Host globals.** Paste
  [`research/008-scripter-midi-fx/probe-globals.scripter.txt`](../../research/008-scripter-midi-fx/probe-globals.scripter.txt)
  into the Script Editor, Run Script, read the console. If any network global exists, try
  `http://127.0.0.1:<port>` against `nc -l 127.0.0.1 <port>`. Record which globals exist and whether the
  request arrives.
- **MAC-52 `TargetEvent` scope and write.** Scripter above Channel EQ on one strip, another effect on a
  second strip. Use the Target menu's Learn Plug-In Parameter on the effect below, one above, the
  instrument and the other strip's plug-in. Then send `TargetEvent` values 0.0 to 1.0 and watch the
  learned parameter; check whether Logic records it as automation in Latch or Touch.
- **MAC-53 Console thinning.** `Trace` 1000 times in `HandleMIDI`; record how many lines appear.
- **MAC-54 API drift.** Open the built-in Scripter presets and the Script Editor; compare with the
  10.4.5 table in SPIKE-008; record any new objects, especially for mixer or session access.
- **MAC-55 Generated scripts.** Ask a model for three scripts (humanise, strummer, CC remap), paste each,
  play MIDI through it, and record how many needed fixes and what broke.
- **Feeds:** 008 § What it can and cannot touch, § Mac reproduction steps and § Risks / unknowns.

## Where each spike's checks went

| Spike | Original checks                                     | Checklist IDs                                                                                                                     |
| ----- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 001   | Still needs a Mac 1, 2, 3                           | MAC-15, 37, 38                                                                                                                    |
| 002   | Help bundle; key command formats; installed version | MAC-45, 30, 01                                                                                                                    |
| 003   | Not done items 1 to 9                               | 1 → 03, 2 → 01, 3 → 08, 4 → 41, 5 → 42, 6 → 17, 7 → 25, 8 → 40, 9 → 14                                                            |
| 004   | Mac checks for a human 1 to 11                      | 1-3 → 09, 4 → 10, 5 → 11, 6 → 12, 7 → 24, 8 → 25, 9 → 26, 10 → 27, 11 → 28                                                        |
| 005   | A1 to A15                                           | A1, A2, A15 → 01; A3 → 32; A4 → 33; A5 → 34; A6, A7 → 35; A8, A10 → 36; A9 → 42; A11 → 30; A12 → 29; A13 → 31; A14 → 25           |
| 006   | P1 to P7                                            | P1 → 01; P2 → 46; P3 → 47; P4 → 48; P5, P6 → 49; P7 → 50                                                                          |
| 007   | M1 to M14                                           | M1 → 02; M2 → 03; M3 → 19; M4 → 20; M5 → 18; M6 → 04; M7 → 05; M8 → 06; M9 → 07; M10 → 16; M11 → 17; M12 → 21; M13 → 22; M14 → 23 |
| 008   | Mac reproduction steps 1 to 6                       | 1 → 51; 2, 3 → 52; 4 → 53; 5 → 54; 6 → 55                                                                                         |
| 009   | What a human must still run 1 to 6                  | 1-4, 6 → 13; 5 → 14                                                                                                               |
| 010   | Human steps 1 to 7; inline Mac checks               | 1 → 39; 2 → 40; 3, 4, 6 → 43; 5 → 01; 7 → 44; Keychain → 14; nested helper → 43; SMAppService → 41                                |
| 011   | Row 5 (current Logic licence)                       | MAC-01                                                                                                                            |
