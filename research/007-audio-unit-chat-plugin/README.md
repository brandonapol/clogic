# SPIKE-007 Mac checks

Steps for a human with a Mac, Xcode and Logic Pro. Not imported by `src/`. See the Findings of
[SPIKE-007](../../docs/research/007-audio-unit-chat-plugin.md) for why each check matters. Nothing here
was run when it was written (2026-10-02, Linux only).

Work on a **copy** of a test project, never on real work (AGENTS.md rule 8). Record each result in the
spike's Findings with the date, macOS version (`sw_vers`), Logic Pro version (Logic Pro > About) and
Xcode version (`xcodebuild -version`).

## Setup

1. Xcode > File > New > Project > Multiplatform > **Audio Unit Extension App**. Product name
   `ClogicSpike`, Audio Unit Type **Effect**, User Interface **Presents User Interface**, subtype
   `clgs`, manufacturer `Clgc` (any four characters not used by another installed vendor). Set your
   Team.
2. In the DSP kernel, replace the gain multiply with a straight copy of input to output.
3. Build and run the macOS host app once (this registers the extension). Quit it.
4. Only this one build of the plugin should be installed (a stale AUv2 or AUv3 copy can mask results).

## Checks

| ID  | Question                                               | Steps                                                                                                                                                                                                                                               | Record                                                               |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| M1  | Does it register and validate?                         | `pluginkit -m -v \| grep -i clogic`; `auval -a \| grep Clgc`; `auval -v aufx clgs Clgc`                                                                                                                                                             | Full `auval` output, pass / fail                                     |
| M2  | Does Logic load it, and out of process?                | Logic > Settings > Plug-in Manager > Reset & Rescan Selection; insert on an audio track; `ps aux \| grep -i ClogicSpike` and Activity Monitor while inserted                                                                                        | Compatibility column; process name / PID of the extension vs. Logic  |
| M3  | Which slots offer it?                                  | Try Audio FX slots on: audio track, software instrument track, aux, stereo out. Try the MIDI FX slot on an instrument track                                                                                                                         | Where it appears in the menu (path) and where it does not            |
| M4  | Is it bit-transparent?                                 | Audio track with a test file, plugin on the track; bounce with and without the plugin; invert one in a new project and sum (or `ffmpeg -i a.wav -i b.wav -filter_complex "[1]volume=-1[n];[0][n]amix=inputs=2:normalize=0,volumedetect" -f null -`) | Peak / RMS of the difference (expect silence)                        |
| M5  | When is render called?                                 | Add `os_signpost` or a counter read by the UI (not logged from the render thread). Test: playing, stopped, stopped + track selected, record-armed, on stereo out, on an empty bus                                                                   | Table of state → render running yes / no                             |
| M6  | Does a `WKWebView` work in the extension inside Logic? | Replace the SwiftUI view with an `NSView` holding a `WKWebView` loading a bundled `index.html` via `loadFileURL(_:allowingReadAccessTo:)`. Try once without and once with `com.apple.security.network.client`                                       | Renders yes / no for each; Console errors (filter by extension name) |
| M7  | Do typed keys reach the field?                         | `<textarea>` in the page. Click it, type every letter, digits, space, Return, Delete, arrows, Cmd-A/C/V/Z                                                                                                                                           | Which keys triggered a Logic key command instead (note the command)  |
| M8  | Does focus survive window changes?                     | After M7: resize the plugin window, then type; close and reopen; switch to another app and back; switch tracks                                                                                                                                      | Pass / fail per action; whether clicking the field again recovers    |
| M9  | Do unhandled keys still reach Logic?                   | Field **not** focused: press space (play / stop), then with a `keyDown:` → `nextResponder` override in a `WKWebView` subclass                                                                                                                       | Behaviour before / after the override                                |
| M10 | Window size                                            | Set `preferredContentSize` to 440 × 680 and return an empty `IndexSet` from `supportedViewConfigurations`. Open, drag the window edge, close / reopen, save / reload the project                                                                    | Initial size; can the user resize; size after reopen and reload      |
| M11 | Host info                                              | Read `contextName`, `musicalContextBlock`, `transportStateBlock` after `allocateRenderResources`; rename the track; change tempo; play / stop                                                                                                       | Which are non-`nil`; whether values update                           |
| M12 | State size                                             | Store 1 KB, 256 KB, 1 MB and 5 MB blobs in `fullState`; save, close, reopen                                                                                                                                                                         | Largest size that round-trips; save time; any Logic warning          |
| M13 | CPU with many instances                                | 20 instances on 20 tracks, playing; Logic CPU meter and Activity Monitor                                                                                                                                                                            | CPU per instance, extension process count                            |
| M14 | Copies and instance IDs                                | Store a UUID in `fullState`; Option-drag the plugin to another track; duplicate the track; Save As a new project                                                                                                                                    | Whether the UUID is copied in each case                              |
