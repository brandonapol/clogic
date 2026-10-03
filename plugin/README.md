# clogic AUv3 plugin shell

> **UNVERIFIED scaffold.** Written on Linux on 2026-10-03 without a Mac, Xcode or Logic Pro. It has
> never been built with Xcode, signed, run on macOS or loaded in Logic. Treat every line as a starting
> point for a human with a Mac. Nothing here is evidence about what Logic, Audio Units or macOS do;
> that evidence lives in [SPIKE-007](../docs/research/007-audio-unit-chat-plugin.md),
> [SPIKE-003](../docs/research/003-architecture.md), [SPIKE-010](../docs/research/010-installer-and-distribution.md)
> and the [Mac checklist](../docs/research/mac-checklist.md).

The plugin follows [ADR 0005](../docs/decisions/0005-companion-architecture.md) (Proposed): a sandboxed
AUv3 Audio Effect extension inside `clogic.app` that passes audio through untouched, shows a chat UI in
a `WKWebView`, and talks newline-delimited JSON-RPC to the clogic companion over a UNIX socket in the
app group container. The companion owns the conversation, the LLM calls, the API keys and every
session change.

## What exists

| Path                                      | What it is                                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project.yml`                             | [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec. Generates `Clogic.xcodeproj` (not committed): app, extension, core test bundle, `Clogic` scheme     |
| `Config/Signing.xcconfig`                 | Signing and identity build settings. Team, identity and bundle ID prefix come from `CLOGIC_*` settings, never literals                                      |
| `App/`                                    | `clogic.app`: a minimal SwiftUI container whose only job for now is to register the extension. No entitlements                                              |
| `Extension/Info.plist`                    | `NSExtension` with one `AudioComponents` entry: type `aufx`, subtype `$(CLOGIC_AU_SUBTYPE)`, manufacturer `$(CLOGIC_AU_MANUFACTURER)`                       |
| `Extension/Extension.entitlements`        | App Sandbox, app group `$(TeamIdentifierPrefix)clogic`, `network.client`. Nothing else                                                                      |
| `Extension/PassthroughAudioUnit.swift`    | `AUAudioUnit` subclass: one stereo-capable bus each way, pulls input and hands it to the output untouched; latency and tail 0; instance ID in `fullState`   |
| `Extension/AudioUnitViewController.swift` | `AUViewController` + `AUAudioUnitFactory`; its view is the web view, `preferredContentSize` 440 × 680, empty `supportedViewConfigurations`                  |
| `Extension/ChatWebView.swift`             | `WKWebView` subclass: accepts first mouse; forwards `keyDown` / `keyUp` to `nextResponder` unless a text field in the page has focus                        |
| `Extension/ChatBridge.swift`              | Loads `Web/index.html` with `loadFileURL(_:allowingReadAccessTo:)`, blocks other navigation, maps page messages to RPC calls and RPC traffic to page events |
| `Extension/CompanionConnection.swift`     | Socket client: connect, `session.hello`, request / response matching, notifications, reconnect every 2 s, offline and version-mismatch states               |
| `Extension/UnixSocket.swift`              | Thin POSIX `socket` / `connect` / `read` / `write` wrapper                                                                                                  |
| `Core/`                                   | Pure Swift, no AppKit / WebKit / AudioToolbox: `LineFramer`, JSON-RPC codables for every `src/rpc` method, codec, handshake, bridge message types           |
| `Web/`                                    | Static HTML / CSS / JS chat UI from [docs/design](../docs/design/README.md). No frameworks, no network, CSP `default-src 'none'; connect-src 'none'`        |
| `Tests/`                                  | XCTest for `Core/` (framer, codables, codec, bridge, paths). `Tests/Vectors/rpc-vectors.json` is generated from `test/rpc/fixtures.ts`                      |
| `scripts/test-core-linux.sh`              | Builds `Core/` and `Tests/` as a SwiftPM test target and runs the XCTests with any Swift toolchain, Linux included                                          |

The wire protocol is exactly `src/rpc` (protocol version 1): one JSON object per line, UTF-8, 1 MiB
line limit; `session.hello` first; requests `chat.send`, `chat.cancel`, `change.decide`, `keys.set`,
`keys.status`, `provider.select`, `diagnostics.export` (codable only; the UI has no export button yet); plugin notification `context.changed`; all ten companion
notifications are decoded and rendered. Nullable fields are always sent as explicit `null`, because
the companion's decoders require every key.

### API keys

The key field is an `<input type="password">` in the settings view. On **Save key** the page reads the
value, clears the field, and posts it once to Swift; Swift sends it once as `keys.set` and keeps no
copy. The page never uses `localStorage`, `sessionStorage`, IndexedDB or cookies, the web view uses a
non-persistent data store, and `KeysSetParams` / `UiCommand` redact the key from their descriptions.
Storing it is the companion's job (Keychain, ADR 0005 decision 7).

### Session changes

`change.proposed` opens the confirmation dialog from the design: one checkbox per row, `before → after`,
the count in the title, **Cancel** (Esc) sends `change.decide` with no rows, **Apply N changes** sends
the checked row IDs. Return does nothing in the dialog. Expired proposals cannot be applied.

## What is not here yet

- **Live metering.** No `meter` notifications are sent. SPIKE-007 puts momentary LUFS and band
  energies in a C++ kernel with a lock-free ring and a sender thread; none of that exists.
- **A C++ render kernel.** The pass-through render block is Swift. It avoids allocation and ARC in the
  block, but Swift class property access still goes through runtime exclusivity checks, which SPIKE-007
  (citing Apple) says to keep off the render thread. Replace it with the template's C++ kernel.
- Transcript snapshot and UI preferences in `fullState` (only the instance ID is stored).
- Attach-bounce, suggested follow-ups, revert after apply, the loudness readout tiles and spectrum
  card (analysis results render as a generic card), the pop-out window fallback.
- Launching or bundling the companion (`SMAppService`, the helper app): the plugin only connects.
- Signing for distribution, notarisation, the `.dmg` / `.pkg` (SPIKE-010).

## How it was checked without a Mac

| Check                                                                                         | Result on 2026-10-03                                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm test` (`test/plugin/`): project spec, entitlements, web assets, secrets, field names     | Passes                                                                          |
| `plugin/scripts/test-core-linux.sh`: `Core/` + `Tests/` built and run with Swift 6.4 on Linux | 51 XCTests pass (swift-corelibs-foundation)                                     |
| `Core/` codec over a real UNIX socket against `listen()` from `src/rpc/socket.ts`             | Hello, every request and notification round-trip; no protocol problems reported |
| `Web/` in headless Chromium with a stubbed `webkit.messageHandlers`                           | Renders; HTML in messages is shown as text                                      |

None of this exercises Apple's Foundation, AppKit, WebKit, AudioToolbox, the sandbox or Logic. The
`Extension/` sources have never been compiled.

## Build on a Mac

Requirements: an Apple silicon Mac on macOS 15.6 or later, Xcode, Homebrew, and an Apple Developer team
for anything that uses the app group (its ID is `<TeamID>.clogic`, per SPIKE-003, so an ad hoc build has no group to join).

```sh
brew install xcodegen
cd plugin
cp Config/Local.xcconfig.example Config/Local.xcconfig
```

Edit `Config/Local.xcconfig` (git-ignored) with your Team ID, signing identity and a bundle ID prefix
you own, or pass the same settings on the command line. Do not commit them.

```sh
xcodegen generate
xcodebuild -project Clogic.xcodeproj -scheme Clogic -configuration Debug \
  -derivedDataPath build \
  CLOGIC_TEAM_ID="$CLOGIC_TEAM_ID" CLOGIC_CODE_SIGN_IDENTITY="Apple Development" build
xcodebuild -project Clogic.xcodeproj -scheme Clogic -derivedDataPath build \
  -destination 'platform=macOS,arch=arm64' test
```

Register the extension by opening the app once, then check it (MAC-02):

```sh
open build/Build/Products/Debug/clogic.app
pluginkit -m -v | grep -i clogic
auval -v aufx clgc Clgc
codesign -d --entitlements - build/Build/Products/Debug/clogic.app/Contents/PlugIns/clogic.appex
```

To give the plugin a companion to talk to, start the TypeScript companion on the group container
socket (the same path MAC-08 uses), from the repo root:

```sh
G="$HOME/Library/Group Containers/$CLOGIC_TEAM_ID.clogic"
mkdir -p "$G" && npm run build && node dist/companion/main.js "$G/c.sock"
```

Work on a copy of a test project, never on real sessions (AGENTS.md rule 8). Record each result with
the macOS, Logic Pro and Xcode versions as the checklist describes.

## Unverified assumptions and the checks that settle them

| Assumption in this scaffold                                                                                                                                                       | Where                                             | Settled by        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------- |
| The XcodeGen spec generates a project that builds, embeds the appex in `Contents/PlugIns` and runs the XCTests                                                                    | `project.yml`, `Config/`                          | Build steps above |
| The `AudioComponents` entry (`factoryFunction` and principal class set to the view controller, `sandboxSafe`, `Effects` tag) registers and passes `auval`                         | `Extension/Info.plist`                            | MAC-02            |
| Logic loads the extension out of process, so these entitlements are the ones that apply                                                                                           | `Extension/Extension.entitlements`                | MAC-03            |
| A `WKWebView` renders the bundled page inside Logic with only the sandbox, group and `network.client` entitlements; the CSP's `'self' file:` sources allow the bundled CSS and JS | `ChatBridge.swift`, `Web/index.html`              | MAC-04            |
| Typing reaches the composer and key field rather than Logic's key commands                                                                                                        | `ChatWebView.swift`, `Web/app.js`                 | MAC-05            |
| Focus survives resize, close / reopen, app and track switches                                                                                                                     | `ChatWebView.swift`                               | MAC-06            |
| Forwarding `keyDown` / `keyUp` to `nextResponder` when no field is focused lets space and other key commands reach Logic                                                          | `ChatWebView.swift`                               | MAC-07            |
| The sandboxed extension can `connect()` to `c.sock` in the `<TeamID>.clogic` group container with no prompt, and the path fits `sun_path`                                         | `CompanionConnection.swift`, `Core/Paths.swift`   | MAC-08            |
| Keys sent with `keys.set` end up in the Keychain without prompts                                                                                                                  | Companion side                                    | MAC-13, MAC-14    |
| `preferredContentSize` 440 × 680 with an empty `supportedViewConfigurations` gives the design's window size; the page layout holds down to 360 × 480                              | `AudioUnitViewController.swift`, `Web/styles.css` | MAC-16            |
| `contextName` is set and its KVO updates fire, so the header chip and `context.changed` follow track renames                                                                      | `ChatBridge.swift`                                | MAC-17            |
| Chat and the socket work while Logic is not calling render (nothing here is driven by render)                                                                                     | `CompanionConnection.swift`                       | MAC-18            |
| The plugin is offered in Audio FX slots on audio, instrument, aux and output strips                                                                                               | `Extension/Info.plist`                            | MAC-19            |
| Pulling input into our buffers and handing them (or a copy) to the output is bit-transparent                                                                                      | `PassthroughAudioUnit.swift`                      | MAC-20            |
| The instance ID round-trips through `fullState`; copies keep the same ID, so the companion must re-assign duplicates                                                              | `PassthroughAudioUnit.swift`                      | MAC-21, MAC-23    |
| Out-of-process CPU cost per instance is acceptable                                                                                                                                | Whole extension                                   | MAC-22            |
| Hardened runtime, the entitlements and the bundle layout survive Developer ID signing and notarisation, and Logic sees the installed plugin                                       | `project.yml`, entitlements                       | MAC-43            |

## Changing the protocol

`Core/RpcMessages.swift` mirrors `src/rpc/messages.ts` field for field. `test/plugin/plugin.test.ts`
fails if a method, notification, enum value or field name drifts, or if `Tests/Vectors/rpc-vectors.json`
no longer equals `test/rpc/fixtures.ts`. After changing the fixtures, regenerate the vectors from the
fixtures (the test prints the expected object) and re-run the XCTests.
