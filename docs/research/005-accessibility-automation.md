# SPIKE-005: macOS Accessibility and key commands

Issue: [#5](https://github.com/brandonapol/clogic/issues/5)

## Question

What can we do through the macOS Accessibility (AX) API and Logic key commands that a control surface
cannot, and how fragile is it?

## Why it matters

Things like triggering a bounce, exporting all tracks as stems, opening Mastering Assistant, or reading
a plugin window are not exposed by control surface protocols.

## Timebox

2 days

## Investigate

Ticked items have desk-research findings below (2026-10-02, no Mac). Every ticked item still has Mac
checks listed in the Findings; unticked items need a Mac to answer at all.

- [ ] AX tree inspection of Logic (Accessibility Inspector): how much of the main window, mixer, and
      plugin windows is exposed, and whether elements have stable identifiers. (Desk evidence and
      prior art below; Mac checks A4, A5.)
- [x] Driving it from Node: JXA / `osascript`, a small Swift helper binary, or a native Node addon.
- [x] Key commands: send key events to trigger documented commands. Can we ship a custom key command set?
- [ ] Automate "Export All Tracks as Audio Files" and "Bounce Project or Section" end to end, so SPIKE-001
      can run without manual bouncing. (Design and scripts below; Mac checks A6, A7.)
- [x] Read-back: confirm an action happened (e.g. a file appeared, a window opened).
- [x] Permissions UX: which process needs Accessibility permission when launched from an MCP client.
- [ ] Fragility: compare AX paths across two Logic versions if available. (Mac check A8, A10.)

## Done when

- A demo that bounces stems of the current project into a chosen folder with no clicks
- A list of actions ranked by reliability
- A verdict: use for a few high-value actions only, or broadly

## Risks / unknowns

- UI changes in Logic updates can silently break automation
- Localised UIs (non-English) may break label-based lookups
- Automation while the user is also using the mouse

## Findings

Researched 2026-10-02 from Linux with WebSearch, WebFetch, `curl` (Logic Pro User Guide, newest
version shown: Logic Pro for Mac 12.3) and Apple's DocC JSON. No Mac and no Logic Pro: macOS version
n/a, Logic Pro version n/a. Every source, with its date and how it was read, is in
[notes/005-sources-2026-10-02.md](./notes/005-sources-2026-10-02.md). Scripts for the Mac checks are in
[`research/005-accessibility/`](../../research/005-accessibility/README.md); none has been run yet.
Anything marked **Mac check** is untested and must not be relied on until someone runs it.

**Verdict: partial.** Use Accessibility for a few high-value actions only (open the Export / Bounce
dialogs, read whether a dialog or file appeared, read a small amount of mixer state), never for broad UI
driving. Prefer two cheaper, sturdier routes for triggering commands: control surfaces (SPIKE-004) for
mixer values, and **MIDI messages assigned to Logic key commands**, which Logic documents and which
needs no Accessibility permission. All AX and key event code must live in a non-sandboxed helper owned
by the companion (SPIKE-003), never in the plugin. The "no clicks" stems demo is **not done**: it needs a
Mac, and filling Logic's export dialog is the most fragile step in the whole chain. A one-click
version (we open the dialog with the right settings described in chat, the user clicks Save, we detect
the files) is realistic now and keeps the user in control.

### What the platform allows

| Mechanism                                        | Permission (TCC)                                                                                                                                                                     | Works from a sandboxed process?                                                                                        | Source                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AX read / write (`AXUIElement*`)                 | Accessibility; check with `AXIsProcessTrustedWithOptions`                                                                                                                            | **No.** "It is not possible to use the accessibility API from a sandboxed app ... even if the user manually grants it" | Apple staff, forum 749494 (Apr 2024); App Sandbox doc lists "Use of accessibility APIs in assistive apps" as forbidden |
| Key events (`CGEvent.postToPid`, `CGEvent.post`) | Post Event (`CGPreflightPostEventAccess` / `CGRequestPostEventAccess`, macOS 10.15+); forums describe it as a TCC service separate from Accessibility (secondary, **Mac check A13**) | Reported to be allowed with user approval since 10.15 (forum summaries, secondary)                                     | Apple doc JSON (API exists, no discussion text); forums 789896, 724603                                                 |
| Apple events to Logic                            | Automation; needs `NSAppleEventsUsageDescription` and, under Hardened Runtime, `com.apple.security.automation.apple-events`                                                          | "Sending Apple Events to arbitrary apps" is forbidden in the sandbox                                                   | Apple docs (entitlement, Info.plist key, App Sandbox)                                                                  |
| System Events UI scripting (`osascript`)         | Accessibility for the responsible process, plus Automation (→ System Events)                                                                                                         | No                                                                                                                     | Follows from the two rows above                                                                                        |
| Driving Open / Save panels                       | as above                                                                                                                                                                             | "Simulating user input in Open and Save dialogs" is forbidden in the sandbox                                           | App Sandbox doc                                                                                                        |
| MIDI → key command                               | None beyond CoreMIDI                                                                                                                                                                 | n/a (a CoreMIDI client)                                                                                                | Logic Pro User Guide, _Assign controller buttons to key commands_                                                      |

Consequences:

- **The plugin cannot do any of this.** The AUv3 is a sandboxed extension (SPIKE-003). An AUv2 runs in
  Logic's process, and "in-process plug-ins inherit the entitlements of their host executable" (Apple,
  Hardened Runtime), so TCC would attribute access to Logic Pro; the prompt would ask the user to give
  _Logic Pro_ Accessibility, which is wrong and alarming.
- **No Mac App Store build of the helper.** Mac App Store apps must be sandboxed (App Sandbox doc), so
  the AX helper ships only with the Developer ID / notarised build (consistent with SPIKE-011 row 10).
- Logic Pro's own sandbox status is unknown. It matters only for the AUv2 fallback. **Mac check A1:**
  `codesign -d --entitlements - "/Applications/Logic Pro.app"` (in `env.sh`).

### Which process asks for permission

TCC attributes access to the _responsible_ process. A process launched from Terminal (or from any app
that spawns it, such as an MCP client) has that app as its responsible process; one launched by
launchd, Finder or `open` is responsible for itself (Qt blog, 2022-02-04; Apple's algorithm is
undocumented and has changed, forum 731504). The workaround Qt used (`responsibility_spawnattrs_setdisclaim`)
is private SPI and should not be used.

So, building on SPIKE-003's process split:

| Launch path                                                                 | Who the Accessibility prompt names            | Verdict                                                                                                                    |
| --------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Companion started by launchd (`SMAppService` agent), AX helper is its child | the companion bundle (`clogic Helper.app`)    | **Use this**                                                                                                               |
| Node companion runs `osascript` / JXA                                       | the companion (child inherits responsibility) | OK for prototypes only                                                                                                     |
| Companion started by Claude Desktop / Claude Code as an MCP stdio server    | the MCP client app (Claude, Terminal, iTerm)  | Avoid: the user would grant Accessibility to their terminal or AI client, which then lets everything it runs drive the Mac |
| Code inside the AU plugin                                                   | Logic Pro, or blocked by the sandbox          | Never                                                                                                                      |

If an external MCP client is supported (SPIKE-003 suggests read tools only), its stdio server should be
a thin proxy that forwards to the launchd companion over the socket, so the AX grant stays with our
helper bundle. **Mac check A9:** the exact prompt text and app name shown, and whether the grant
survives a re-signed update.

### Driving it from Node

| Option                            | Pros                                                                                                                                        | Cons                                                                                                                                                         | Verdict                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `osascript` (AppleScript / JXA)   | No build step; System Events gives `click menu item`, `UI elements`, `attribute "AXIdentifier"`                                             | Process spawn per call (prior art reports about 200 ms); needs Automation for System Events on top of Accessibility; no AX notifications; errors are strings | Prototypes and Mac checks only (the scripts here use it) |
| **Small Swift helper executable** | Full AX API incl. `AXObserver` notifications and messaging timeouts; `CGEvent`; CoreMIDI; signed inside our bundle; JSON over stdio to Node | Swift toolchain in the build; one more binary to sign and notarise (SPIKE-010)                                                                               | **Recommended**                                          |
| Native Node addon (N-API)         | In-process, fast                                                                                                                            | Ties the companion to Node ABI versions; harder to sign and update; crash takes down the companion                                                           | No                                                       |

The helper should expose a fixed allow-list of named operations (`openMenu(path)`, `readWindowTitles`,
`readMixerStrip(i)`, `postKeyCommand(id)` ...) targeted only at the process whose bundle ID is
`com.apple.logic10`, and never a generic "click at x,y" or "type text" tool. Accessibility is a
system-wide grant; narrowing it in code is our only guard. **Mac check A2:** confirm the bundle ID with
`env.sh` (prior art uses `com.apple.logic10`).

### Logic's scripting and key command surfaces

- **AppleScript dictionary: effectively none.** A 2019 forum post found only a `renderpreview` command
  in Logic Pro X's dictionary, and Logic's only built-in scripting is Scripter MIDI FX (SPIKE-008).
  Standard app events (`activate`, `open` a document, `quit`) work for any app; nothing else should be
  assumed. **Mac check A1:** `sdef "/Applications/Logic Pro.app"` and the `NSAppleScriptEnabled` /
  `OSAScriptingDefinition` Info.plist keys (in `env.sh`).
- **Key commands cover almost everything.** "Several functions are only available as key commands" and
  any command can be bound in the Key Commands window (Option-K) (User Guide, _Key commands overview_).
- **Key command sets can be imported and merged.** The Key Commands window has Import Key Commands,
  Import Key Commands to Selection, and **Merge Key Commands** (which only overwrites commands that have
  a custom assignment in the imported set). Save As defaults to `~/Music/Audio Music Apps/Key Commands/`
  in the 12.3 guide; the 10.1 guide used `~/Library/Application Support/Logic/Key Commands`, so the path
  moves between versions. The file format is not documented. **Mac check A11:** export a set, record
  the extension and format (`file`, `plutil -p`), and whether MIDI assignments are included.
- **The user's real key map is readable.** "Copy Key Commands to Clipboard" puts the full list with
  assignments on the clipboard. That is the only documented way to learn what a user's shortcut for,
  say, "Bounce Project or Section" is (commonly Command-B by default, secondary sources only). It
  overwrites the user's clipboard, so it has to be a confirmed, one-off setup step. **Mac check A11:**
  record the clipboard format.
- **MIDI can trigger key commands.** In the Key Commands window, Learn New Assignment binds a received
  MIDI message to any command (_Assign controller buttons to key commands_; _Assign key commands_ says
  the window assigns "control surface messages to particular commands"). The companion already plans a
  virtual MIDI port (SPIKE-004). Binding, for example, one CC per command we need gives a trigger that
  does not depend on focus, keyboard layout, UI language or the user's key map, and needs no
  Accessibility permission at all. **Mac checks A12:** (1) a message from a CoreMIDI virtual source
  can be learned; (2) it fires while another app is frontmost; (3) the assignment survives a restart
  and is saved in an exported key command set, so we can ship a set the user merges once.

Shipping a key command set: possible as a file the user imports with **Merge Key Commands**, after we
show what it changes. We must not write into the user's Key Commands folder or preferences ourselves:
it is user configuration, it can clobber their shortcuts, and Logic's own Import is the documented path.

### Sending key events

`CGEvent.postToPid` exists (macOS 10.11+). Prior art (koltyj/logic-pro-mcp, MIT, Sep 2026) reports that
Logic drops posted key events unless it is frontmost, so it activates Logic before every keystroke, and
that `postToPid` gives no delivery receipt. Problems for us, all **Mac check A13**:

- The user's key map may differ from the defaults; posting Command-B is only right if we read their map
  first (above).
- If our own plugin window is the key window inside Logic, the keystroke may go to our chat text field
  instead of Logic's command handler (SPIKE-007 already flags that Logic and plugin windows compete for
  keys).
- Activating Logic and posting keys while the user is typing can interleave with their input.
- Keyboard layout: key codes are positions, not characters; non-US layouts need a mapping.

Use key events only as a fallback where neither a MIDI-learned command nor a menu item works.

### Accessibility tree: what is likely exposed

- Logic supports VoiceOver and has settings for it: VoiceOver announcements of the playhead, and "Open
  Plug-in windows in Controls view by default ... making plug-in parameters available for use with
  VoiceOver" (User Guide, _Accessibility settings_). So the main window, mixer and Logic's own plug-ins in
  Controls view are expected to be in the AX tree. Third-party plug-in custom GUIs are expected to be
  opaque unless shown in Controls view.
- Prior art matches elements by role plus `AXDescription` ("Mixer", "Control Bar", "Tracks header",
  "volume fader", "pan") and says Logic leaves `AXIdentifier` empty on these containers. If true, lookups
  are **label based and localised**, which is the main fragility (risk "Localised UIs").
- Menus are standard macOS menus, addressable by title path (`File > Export > All Tracks as Audio
Files`, `File > Bounce > Project or Section`, `Mix > Mastering Assistant`, from the User Guide). Menu
  titles are localised too.

**Mac checks A3–A5, A8:** run `menu-dump` and `ax-dump` (main window, mixer, Channel EQ window) and
record: roles, whether any `AXIdentifier` is set, depth to reach a fader, and the same dumps with Logic
in a second language.

### Export stems and bounce: proposed flow

For SPIKE-001 the goal is stems in a folder without manual menu work. Proposed flow, each step with its
surface:

1. **Plan (read only).** Companion proposes "Export all tracks as 24-bit WAV to `<folder>`" as a
   `ChangeProposal` (SPIKE-003). Exporting writes new files outside the project, but Logic's export
   dialog has an "Add resulting files to Project Audio Browser" option, which _would_ change the project
   (AGENTS.md rule 8), so the plan states it stays off.
2. **Confirm.** The user approves in the plugin UI.
3. **Open the dialog.** AX press on the menu item, or a MIDI-learned key command for the same command.
4. **Fill the dialog.** _Most fragile step_: pop-ups for format and bit depth, checkboxes, the
   filename pattern, and the save panel's folder. Two options:
   - (a) Leave it to the user: the chat lists the settings to choose; the user clicks Save. One click
     and no fragile automation. **Recommended first.**
   - (b) Automate it with AX on the dialog's controls and the save panel (Command-Shift-G to type a
     path). Only after A6 shows the controls are reachable and stable.
5. **Read back.** Watch the target folder for new audio files whose sizes stop changing
   (`watch-folder.sh`); optionally an `AXObserver` for the dialog closing and the progress window
   disappearing. Then run SPIKE-001 analysis on the files. Filesystem read-back is reliable and does
   not depend on Logic's UI.

**Mac checks A6, A7:** run `open-export-dialog.applescript export` and `... bounce`, dump the dialog
tree, export a test project manually while `watch-folder.sh` runs, and record timings and what the
progress UI looks like in the AX tree.

Undo: Logic's undo covers "virtually any edit, including ... parameter changes" (up to 200 steps), and
mixer and plug-in changes appear in Undo History only when "Include Parameter Changes From" Mixer and
Plug-in are on (User Guide). Exports and bounces write files and are not undo steps. Opening Mastering
Assistant inserts it on the stereo output, which is a session change and needs confirmation like any
other. **Mac check A14:** whether AX-driven changes land in Undo History the same as mouse changes.

### Actions ranked by expected reliability

All rankings are reasoned from the sources above, not measured. Re-rank after the Mac checks.

| Rank | Action                                                                          | Surface                      | Expected reliability       | Why                                                                                                              | Mac check |
| ---- | ------------------------------------------------------------------------------- | ---------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| 1    | Detect exported / bounced files                                                 | Filesystem                   | High                       | No Logic UI involved                                                                                             | A7        |
| 2    | Trigger a command (open Export / Bounce dialog, Mastering Assistant, transport) | MIDI → learned key command   | High, after one-time setup | Documented; language, layout and focus independent; no Accessibility grant                                       | A12       |
| 3    | Open a menu item by title path                                                  | AX (`AXPress` on menu item)  | Medium-high                | Standard menus; breaks on localisation and menu renames between versions                                         | A3, A8    |
| 4    | Detect that a dialog / window opened or closed                                  | AX window list, `AXObserver` | Medium                     | Window titles localised; observers need the helper, not `osascript`                                              | A6        |
| 5    | Read channel strip names, fader, pan, mute / solo                               | AX (`AXDescription` lookups) | Medium-low                 | Label based, no identifiers (per prior art); MCU (SPIKE-004) is the better read path for values                  | A4        |
| 6    | Read Logic plug-in parameters (Controls view)                                   | AX                           | Medium-low                 | Apple says Controls view exposes parameters to VoiceOver; needs the window open                                  | A5        |
| 7    | Trigger a command by keystroke                                                  | `CGEvent`                    | Low-medium                 | Needs Logic frontmost, the user's real key map, no typing collisions                                             | A13       |
| 8    | Set fader / pan / plug-in values                                                | AX value set                 | Low                        | Prefer MCU; AX writes on custom controls often unsupported (`kAXErrorNotImplemented` exists for this)            | A4        |
| 9    | Fill the Export / Bounce dialog and save panel                                  | AX                           | Low                        | Many localised controls, a system save panel, community macros report random failures and breakage after updates | A6        |

### Mac checks to run

Run with the scripts in `research/005-accessibility/` on a **copy** of a test project. Record macOS and
Logic versions (`env.sh`) with every result.

| ID  | Check                                               | How                                                                                                                                                                         |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Logic sandboxed? Any AppleScript dictionary?        | `./env.sh`: entitlements, `sdef`, Info.plist keys                                                                                                                           |
| A2  | Bundle ID                                           | `./env.sh`                                                                                                                                                                  |
| A3  | Menu paths for Export, Bounce, Mastering Assistant  | `osascript menu-dump.applescript`                                                                                                                                           |
| A4  | Main window and mixer tree; identifiers set?        | `osascript ax-dump.applescript 6` with Tracks, then Mixer (X) open; also Accessibility Inspector                                                                            |
| A5  | Plug-in window in Controls view vs. custom view     | Open Channel EQ, dump; toggle Controls view; repeat with one third-party plug-in                                                                                            |
| A6  | Export / Bounce dialogs reachable, controls exposed | `osascript open-export-dialog.applescript export` then `ax-dump 10`; same with `bounce`                                                                                     |
| A7  | Read-back timing                                    | Export manually while `./watch-folder.sh <dir>` runs; record time to stable files                                                                                           |
| A8  | Localisation                                        | Repeat A3–A4 with Logic set to another language (System Settings > Language & Region > Applications)                                                                        |
| A9  | Permission prompts                                  | Note the app named in each prompt; for the helper prototype, re-sign and check the grant survives                                                                           |
| A10 | Version drift                                       | Repeat A3–A6 on a second Logic version (e.g. 11.2 vs 12.x) and diff the dumps                                                                                               |
| A11 | Key command file format and clipboard export        | Key Commands window > Save As / Copy Key Commands to Clipboard; `file`, `plutil -p`; paste into a file                                                                      |
| A12 | MIDI-learned key commands                           | Create an IAC or virtual MIDI source, learn it on "Bounce Project or Section"; test with Logic in the background; restart; export the set and check the assignment is in it |
| A13 | Keystroke delivery                                  | Post Command-B with `postToPid` while Logic is background, frontmost, and while our plugin window is key                                                                    |
| A14 | Undo of AX-driven changes                           | Change a fader via AX, then check Edit > Undo History with Mixer included                                                                                                   |
| A15 | Current Logic licence (SPIKE-011 row 5)             | `env.sh` lists licence files in the bundle; read for automation or scripting clauses                                                                                        |

### Answers to the spike's risks

- **UI changes in updates.** Real; community macros needed fixes after updates. Mitigations: prefer
  MIDI-learned key commands (stable command names, no UI path), keep AX use to a small allow-list with a
  health check at startup that verifies each path still resolves, and disable an action (with a message)
  rather than guess when it does not.
- **Localised UIs.** Real for menus and `AXDescription` lookups if identifiers are empty. Mitigation:
  English-only AX actions at first, detected from the menu bar titles; MIDI-learned commands are
  language independent.
- **Concurrent mouse and keyboard use.** AX `AXPress` and MIDI do not move the pointer or need focus;
  keystrokes do. Every action already needs a confirmation click (SPIKE-003), so the user is not typing
  at that moment.
- **Legal.** The published 2013 Logic Pro X licence has no clause against automation, key commands or
  third-party control (SPIKE-011 row 5); the current in-app licence is still unread (A15).

### Follow-ups

- Mac checks A1–A15 (needs a Mac with Logic Pro; owner or a contributor with one).
- If A12 holds, a small ADR: "Trigger Logic commands through MIDI-learned key commands; Accessibility
  only for read-back and dialogs", and a SPIKE-004 note that the virtual MIDI port carries both MCU and
  command messages.
- Swift helper prototype with the allow-listed operations, built and signed as part of SPIKE-010.
