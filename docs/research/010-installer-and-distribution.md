# SPIKE-010: Installer, ffmpeg bundling and distribution

Issue: [#10](https://github.com/brandonapol/clogic/issues/10)

## Question

Can we ship a single installer that puts the plugin where Logic finds it, installs the companion service
and ffmpeg, and needs no terminal or Homebrew?

## Why it matters

It should install like any other Logic plugin. The user should never need to know ffmpeg exists.

## Timebox

1.5 days

## Investigate

- [x] Installer format: signed `.pkg` installing the AU component to `/Library/Audio/Plug-Ins/Components`
      (or the user Library), plus the companion service and its `launchd` agent.
- [ ] Logic's plugin scan: confirm Logic picks up the new AU after install and that it passes validation
      in the Plug-in Manager.
- [x] Companion runtime: ship Node as a single executable (Node SEA or Bun compile) so the user does not
      need Node installed. Check the size.
- [x] ffmpeg: bundle a static universal (arm64 + x86_64) binary inside the app bundle. Check the licence:
      an LGPL-only build is safer to redistribute than a GPL build. List the codecs actually needed
      (WAV, AIFF, CAF, MP3, AAC, FLAC for reference tracks).
- [x] Code signing and notarisation for the AU, the companion binary, and the bundled ffmpeg (every
      Mach-O binary must be signed). Requires an Apple Developer account.
- [ ] First-run flow: permissions (Accessibility, MIDI), API key prompt (SPIKE-009), control surface
      registration (SPIKE-004) if that can be automated.
- [x] Updates: an auto-update mechanism (e.g. Sparkle) vs. manual reinstall.
- [x] Uninstaller.
- [x] CI: build and notarise on a macOS GitHub Actions runner.

## Done when

- A signed and notarised `.pkg` installs on a clean Mac, Logic finds the plugin, and the companion can
  run the bundled ffmpeg
- A licence note for every bundled third-party binary
- An estimate of the installer size

## Risks / unknowns

- Notarisation and Gatekeeper rejections for unsigned nested binaries
- ffmpeg licensing if GPL components are needed

## Findings

Researched 2026-10-02 on Linux (no Mac, no Apple Developer account), using WebSearch / WebFetch, `curl`
against Apple's documentation JSON (`developer.apple.com/tutorials/data/documentation/<path>.json`, the
data behind the JS-rendered pages), and two reproducible scripts in
[`research/010-installer-and-distribution/`](../../research/010-installer-and-distribution/). macOS
version: n/a. Logic Pro version: n/a. Nothing here has been signed, notarised or installed. Every step
marked **Mac check** still needs a Mac.

**Verdict: partial (go on paper).** Apple's documented tooling covers everything we need: a Developer ID
signed and notarised flat `.pkg` (or a `.dmg` if the plugin is AUv3 only), a bundled companion, and a
bundled ffmpeg. Nothing we found blocks a no-terminal, no-Homebrew install. The "Done when" criteria are
**not met**: there is no signed `.pkg` yet, because that needs a Mac, a $99 / year Apple Developer
Program membership, and the AU from SPIKE-007. Three findings change the plan:

1. **Logic Pro needs Apple silicon and macOS 15.6 or later**, so we can ship arm64 only and skip
   universal binaries. That roughly halves the installer.
2. **No prebuilt macOS ffmpeg we found is LGPL.** All of them are GPL builds. We have to build our own.
   A minimal audio-only LGPL build is about 5 MB.
3. **The AU format decides the installer format.** An AUv2 `.component` must go into a
   `Plug-Ins/Components` folder, so it needs a `.pkg` (or a manual copy). An AUv3 extension ships inside
   an app and registers itself the first time that app runs, so a drag-to-Applications `.dmg` would do.
   That choice belongs to SPIKE-007.

### Platform baseline (checked 2026-10-02)

| Fact                                                                                                                                         | Source                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Logic Pro requires macOS 15.6 or later, iPadOS 26 or later, a Mac with Apple silicon, …"                                                    | [apple.com/logic-pro/specs](https://www.apple.com/logic-pro/specs/) FAQ, fetched 2026-10-02 (points to `support.apple.com/125029#specs`)                                                                                      |
| macOS 26 Tahoe is the last major macOS for Intel Macs                                                                                        | Announced at WWDC25 Platforms State of the Union (secondary: [Appleosophy, 2025-06-09](https://appleosophy.com/2025/06/09/here-are-all-the-devices-supported-by-macos-26-tahoe)); not needed if we follow Logic's own minimum |
| Developer ID software built after 2019-06-01 must be notarised to run (macOS 10.15+)                                                         | [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)                                                                             |
| Since macOS 15 users can no longer Control-click past Gatekeeper; they have to approve in System Settings > Privacy & Security               | [Apple Developer News, 2024-08-06](https://developer.apple.com/news/?id=saqachfa)                                                                                                                                             |
| Apple Developer Program: 99 USD / year. Organisations need a D-U-N-S number; an individual enrolment lists the person's legal name as seller | [Program enrollment](https://developer.apple.com/help/account/membership/program-enrollment)                                                                                                                                  |

**Recommendation:** target arm64 only with a deployment target of macOS 15.6 to match Logic Pro. Build
universal (`lipo`) only if we decide to support Logic Pro 11 on Intel Macs. That is an owner decision,
and the size table below shows what it costs.

### Where things install

| Item                                    | Location                                                                                                                                                       | Source                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUv2 `.component`                       | `/Library/Audio/Plug-Ins/Components` (all users, needs admin) or `~/Library/Audio/Plug-Ins/Components` (one user)                                              | [Apple Support 102239](https://support.apple.com/en-us/102239) "Where are third-party Audio Units plug-ins installed on Mac?"                                                                                                                                                                                                                        |
| AUv3 `.appex`                           | Inside the containing app at `Contents/PlugIns/`. Registered with PluginKit on the app's first launch, with no copy into a system folder                       | [Placing content in a bundle](https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle); Apple DTS on the [Developer Forums, Dec 2016](https://developer.apple.com/forums/thread/53268): "simply running the application once should register the extension with pluginkit". **Mac check:** `pluginkit -m`, `auval -al` |
| Companion app                           | `/Applications/<Name>.app`                                                                                                                                     | Convention; `productbuild --component <app> /Applications` in [Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)                                                                                                                                                     |
| Helper tools (companion binary, ffmpeg) | `<App>.app/Contents/Helpers/` (or `Contents/MacOS/`)                                                                                                           | [Placing content in a bundle](https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle) table: "help app, helper tool: `Contents/MacOS/`, `Contents/Helpers/`". Nested code in the wrong place breaks signing                                                                                                           |
| Launch agent plist                      | `<App>.app/Contents/Library/LaunchAgents/<id>.plist`, registered with `SMAppService.agent(plistName:)` (macOS 13+), using `BundleProgram` instead of `Program` | [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice), [Updating helper executables from earlier versions of macOS](https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos)                                                                       |

`SMAppService` is the documented replacement for writing plists into `~/Library/LaunchAgents` or
`/Library/LaunchAgents` from an installer script. It also shows the agent under the app's name in
System Settings > Login Items, where the user can switch it off. The app has to call `register()` itself,
so the companion needs a small native app wrapper (Swift) that owns the agent. A bare Node binary
cannot call it. Architecture belongs to SPIKE-003; this is a constraint it should know about.

**Plugin scan.** Logic's Plug-in Manager shows a Compatibility column ("not compatible" when the scan
finds an issue) and has a "Reset & Rescan Selection" button for plugins installed or moved in the
Finder ([Use the Plug-in Manager, Logic Pro 12.3](https://support.apple.com/guide/logicpro/use-the-plug-in-manager-lgcp9e26ef17/mac)).
macOS caches the list of AU components. Several plugin vendors and the JUCE forum report that a newly
copied component may not appear until `AudioComponentRegistrar` restarts (`killall -9
AudioComponentRegistrar`) or the user logs out
([JUCE forum](https://forum.juce.com/t/installing-new-audio-units-requires-restart-in-high-sierra/26753?page=3)).
This is community knowledge, not Apple documentation. **Mac check:** does Logic see a freshly installed
component without that step, and does it pass `auval -v <type> <subtype> <manu>` and the Plug-in
Manager scan?

### Installer format: `.pkg` vs `.dmg`

| If SPIKE-007 picks | Recommended container                                                                      | Why                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUv2 component     | Flat `.pkg` built with `pkgbuild` + `productbuild`, signed with **Developer ID Installer** | The component has to land in `/Library/Audio/Plug-Ins/Components`, and Installer.app handles the admin prompt. `productbuild --distribution` can show the EULA from SPIKE-011 and install the app plus the component in one go. |
| AUv3 extension     | Signed, notarised `.dmg` with the app (or a `.pkg` putting the app in `/Applications`)     | Everything lives inside the app bundle, so drag-to-install works and Sparkle can update the whole app silently (see Updates).                                                                                                   |

Apple's container guidance ([Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)):

- Sign inside out: code first, then each container that supports signing. A `.dmg` is signed with the
  **Developer ID Application** identity, a `.pkg` with **Developer ID Installer**.
- "If you distribute your product using nested containers, only notarize the outermost container."
  Then staple the ticket to it. `.pkg` and `.dmg` both support stapling. A bare Mach-O binary does not.
- Test fresh installs, upgrades, a duplicate copy elsewhere on disk, and a different user account.

`.pkg` details to carry into the build script:

- `pkgbuild --analyze` and then `--component-plist` with `BundleIsRelocatable` set to `false`. Without
  it, Installer may "upgrade" a copy of the app it finds somewhere else on disk instead of installing
  to `/Applications`
  ([Apple Developer Forums 743964](https://developer.apple.com/forums/thread/743964),
  [Scripting OS X](https://scriptingosx.com/2017/05/relocatable-package-installers-and-quickpkg-update/)).
- A `postinstall` script runs as root. Keep it minimal. A candidate is restarting
  `AudioComponentRegistrar` if the Mac check shows it is needed. Do not install launchd plists from it:
  use `SMAppService` instead.
- Apple's own Installer and `installer` tool replace signed code safely (see Updates). Hand-rolled
  copying does not necessarily.

### Code signing and notarisation

Requirements, quoted from
[Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
and [Resolving common notarization issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues):

- "Enable code-signing for all of the executables you distribute". Sign with a Developer ID
  certificate: **Application** for Mach-O files, bundles, apps and disk images, **Installer** for
  `.pkg`.
- "Enable the Hardened Runtime capability for your app and command line targets" (`codesign -o
runtime`). That includes ffmpeg, ffprobe and the companion binary, because each is a main executable.
- Secure timestamp (`codesign --timestamp`; `productbuild --sign` adds one by default).
- No `com.apple.security.get-task-allow` in shipped builds.
- Entitlements as ASCII XML plists, with no BOM and no binary plist.
- Do not use `codesign --deep` to sign. It applies the same entitlements to every nested item and skips
  code in unexpected places. Sign each item separately, inside out
  ([Creating distribution-signed code for the Mac](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac)).
- Apps can load **quarantined** plug-ins only if they are notarised ("Notarize plug-ins" section). That
  matters for a component copied out of a download.

**What runs with which entitlements.** The [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
page says: "You add entitlements only to executables. Shared libraries, frameworks, and in-process
plug-ins inherit the entitlements of their host executable." So:

| Code                        | Runs in                                                    | Entitlements we control                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AUv2 component              | Logic's process (in-process)                               | None. It inherits Logic's. Library validation means Logic can only load our code if Logic has `com.apple.security.cs.disable-library-validation` ([docs](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation)). It evidently does, since it loads third-party AUs. **Mac check:** `codesign -d --entitlements - "/Applications/Logic Pro.app"` |
| AUv3 extension              | Its own extension process (or in-process if the host asks) | Its own. App extensions are normally sandboxed. **SPIKE-007 to confirm** what the sandbox allows (network, talking to the companion)                                                                                                                                                                                                                                                                               |
| Companion (Node SEA or Bun) | Its own process                                            | V8 and JavaScriptCore JIT need `com.apple.security.cs.allow-jit`. Bun's [codesign guide](https://bun.com/docs/guides/runtime/codesign-macos-executable) lists five entitlements, including `disable-library-validation` and `allow-dyld-environment-variables`. Ship the minimum that works. **Mac check:** start with `allow-jit` only and add others one at a time                                               |
| ffmpeg / ffprobe            | Child processes                                            | None needed. Hardened runtime on, no exceptions                                                                                                                                                                                                                                                                                                                                                                    |

Signing order for the AUv2 + companion layout (needs a Mac and both Developer ID certificates):

```sh
codesign -s "Developer ID Application: <Team>" -f --timestamp -o runtime App.app/Contents/Helpers/ffmpeg
codesign -s "Developer ID Application: <Team>" -f --timestamp -o runtime App.app/Contents/Helpers/ffprobe
codesign -s "Developer ID Application: <Team>" -f --timestamp -o runtime \
  --entitlements companion.entitlements App.app/Contents/Helpers/clogic-companion
codesign -s "Developer ID Application: <Team>" -f --timestamp -o runtime App.app
codesign -s "Developer ID Application: <Team>" -f --timestamp Clogic.component
pkgbuild ... && productbuild --distribution dist.xml --sign "Developer ID Installer: <Team>" clogic.pkg
xcrun notarytool submit clogic.pkg --key AuthKey.p8 --key-id <id> --issuer <uuid> --wait
xcrun stapler staple clogic.pkg
pkgutil --check-signature clogic.pkg   # expect "Developer ID Installer" and a trusted timestamp
spctl -a -vvv -t install clogic.pkg
```

Node SEA steps on macOS, from the [Node docs](https://nodejs.org/api/single-executable-applications.html):
`codesign --remove-signature`, inject the blob with `postject` (segment `NODE_SEA`, sentinel fuse
`NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`), then re-sign. The docs show an ad-hoc signature
(`--sign -`). We replace that with the Developer ID command above. Node 25.5+ also has a built-in
`--build-sea` flag. SEA is at stability 1.1 (active development) as of v26.10.0.

Notarisation limits: most submissions finish in under 15 minutes. Apple asks for at most 75
notarisations a day, fewer files, and non-code files kept out of `Contents/MacOS`
([Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)).
`notarytool` accepts an App Store Connect API key (`--issuer --key-id --key`), which suits CI better than
an Apple ID with an app-specific password
([TN3147](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)).

**Stable signing identity matters for permissions.** macOS records a program's _designated
requirement_ (Team ID + bundle ID for Developer ID code) to recognise it across updates. Ad-hoc signed
code has a DR "tied to that specific version of the code"
([TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)).
So Accessibility grants (SPIKE-005) and Keychain access (SPIKE-009) only survive updates if every
release is Developer ID signed by the same team. Dev builds will re-prompt.

**SPIKE-009 Keychain question.** SPIKE-009 asks who should own the Keychain item. Proposal: the signed
companion app creates and reads the item itself through the Security framework, so its DR goes on the
item's access list, and `/usr/bin/security` stays a dev-only path. **Mac check:** confirm that a
`/usr/bin/security`-created item prompts when the signed app reads it, and that an item the app created
does not prompt after an update.

### Companion runtime size (measured 2026-10-02)

From `research/010-installer-and-distribution/measure-sizes.sh` (downloads official release archives
and measures the binaries with `stat` and `file`):

| Runtime                  | arm64 binary (bytes)    | x86_64 binary (bytes) | Download archive, arm64 |
| ------------------------ | ----------------------- | --------------------- | ----------------------- |
| Node v24.21.0 LTS `node` | 122,129,232 (116.5 MiB) | 125,270,960           | 27.4 MB `.tar.xz`       |
| Bun v1.4.2 `bun`         | 61,884,464 (59.0 MiB)   | 69,333,264            | 25.4 MB `.zip`          |

A SEA or `bun build --compile` binary is the runtime plus our bundled JavaScript. Expect about
120 MiB (Node) or about 60 MiB (Bun) on disk for arm64 only, or roughly double for universal. Both
compress to about 25 to 27 MB. Licensing differs: Node is MIT with bundled third-party notices. Bun is
MIT but **statically links JavaScriptCore / WebKit under LGPL-2**, and its
[licensing page](https://bun.com/docs/project/licensing) says users must be able to relink. That is a
SPIKE-011 question (below). On licence grounds alone, Node SEA is simpler.

### ffmpeg

**Prebuilt macOS builds are all GPL** (checked 2026-10-02):

| Provider                                                             | Arch                                                                                  | Licence / configure                                                                                                                         | Signed / notarised              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [evermeet.cx](https://evermeet.cx/ffmpeg/) (linked from ffmpeg.org)  | x86_64 only ("I do not plan to provide native ffmpeg binaries for Apple Silicon ARM") | `--enable-gpl --enable-version3`, x264, x265 → GPLv3                                                                                        | Not notarised                   |
| [martin-riedl.de](https://ffmpeg.martin-riedl.de/) 9.0.2             | arm64 (Intel releases end January 2027)                                               | Measured `-version`: `--enable-gpl --enable-version3 --enable-openssl --enable-libx264 --enable-libx265 …` → GPLv3. Binary 66,332,880 bytes | Signed. The `.pkg` is notarised |
| [osxexperts.net](https://www.osxexperts.net/)                        | arm64 9.0, x86_64 8.0                                                                 | `--enable-gpl`, "for educational purposes only"                                                                                             | Not notarised                   |
| [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) (npm) | Repackages evermeet + osxexperts                                                      | GPL-3.0                                                                                                                                     | Not notarised                   |

**Our own LGPL build works and is small.** `research/010-installer-and-distribution/build-lgpl-ffmpeg.sh`
builds FFmpeg 9.0.2 from the official release tarball with the default licence (no `--enable-gpl`, no
`--enable-nonfree`, no `--enable-version3`). It uses `--disable-everything --disable-autodetect
--disable-network` plus an allow list of audio components. It needs no external libraries. On Linux
x86_64 (GCC, `--disable-x86asm`) on 2026-10-02:

- `ffmpeg -L` prints "GNU Lesser General Public License … version 2.1 of the License, or (at your
  option) any later version."
- Stripped sizes: `ffmpeg` 4,988,440 bytes, `ffprobe` 4,775,264 bytes.
- Smoke test: `ebur128` on a generated 440 Hz WAV reported `I: -12.9 LUFS`.

Components in that allow list, chosen for the formats the spike asks for:

| Need                      | FFmpeg components (all native FFmpeg code, no external libraries)                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WAV / W64 / AIFF / CAF    | demuxers `wav`, `w64`, `aiff`, `caf`; PCM decoders (s16 / s24 / s32 / f32 / f64, LE and BE)                                                                                         |
| MP3                       | demuxer `mp3`, decoders `mp3`, `mp3float`, parser `mpegaudio`                                                                                                                       |
| AAC / ALAC (`.m4a`)       | demuxer `mov`, decoders `aac`, `aac_latm`, `alac`, parser `aac`                                                                                                                     |
| FLAC                      | demuxer `flac`, decoder `flac`, parser `flac`                                                                                                                                       |
| Ogg Vorbis / Opus (extra) | demuxer `ogg`, decoders `vorbis`, `opus`                                                                                                                                            |
| Analysis                  | filters `ebur128`, `loudnorm`, `astats`, `aspectralstats`, `volumedetect`, `silencedetect`, `aresample`, `aformat`, `atrim`, `pan`, `volume`, `highpass`, `lowpass`, `showwavespic` |
| Output                    | encoders `pcm_s16le`, `pcm_s24le`, `pcm_f32le`; muxers `wav`, `pcm_f32le`, `pcm_s16le`, `null`; protocols `file`, `pipe`                                                            |

SPIKE-001 owns the final list. Grow it as analysis needs grow. Every addition must keep `ffmpeg -L`
saying LGPL, so CI should check that.

**Mac check:** build the same script on an arm64 Mac (clang, with NEON asm enabled), confirm the
licence line and size, sign with hardened runtime, and run it from inside the notarised app. Expect a
binary of roughly the same size. The Linux number is a proxy.

**Alternative worth knowing:** macOS decodes FLAC natively since 10.13 (`kAudioFormatFLAC`), as well as
WAV, AIFF, CAF, MP3, AAC and ALAC, through AudioToolbox
([kAudioFormatFLAC](https://developer.apple.com/documentation/coreaudiotypes/kaudioformatflac)). A Swift
helper using `ExtAudioFile` could decode reference tracks without ffmpeg. It would still need our own
LUFS and true-peak code. That would remove the ffmpeg licence and source-hosting duty. Worth weighing
in SPIKE-001 / SPIKE-003. Not decided here.

### Installer size estimate

| Layout                                                                                                           | Uncompressed on disk | `.pkg` (estimate) |
| ---------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------- |
| arm64 only: Node SEA (~117 MiB) + ffmpeg + ffprobe (~10 MB) + AU + Swift shell (few MB, unknown until SPIKE-007) | ~130 MB              | ~30 to 35 MB      |
| arm64 only with Bun instead of Node                                                                              | ~75 MB               | ~30 MB            |
| Universal with Node SEA                                                                                          | ~265 MB              | ~60 to 70 MB      |

The `.pkg` numbers assume pkg payload compression similar to the official `.tar.xz` / `.zip` archives
(about 4.5 : 1 for the Node binary). **Mac check:** build a real `.pkg` and measure.

### Updates

| Option                               | Fit                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sparkle 2** in the companion app   | MIT (bundles BSD-2 bsdiff, MIT sais-lite, zlib-licensed ed25519; [LICENSE](https://github.com/sparkle-project/Sparkle/blob/2.x/LICENSE)). Updates are signed with EdDSA ([docs](https://sparkle-project.org/documentation/)). Silent updates for app bundles. A good fit if everything lives inside the app (AUv3 case).                                                                                                                              |
| Sparkle with `.pkg` updates          | Supported, but Sparkle says use it only for "very custom installation needs". Downsides: "Installs always require user authorization which also prevents silent automatic installs", no delta updates, no key-rotation fallback ([Package Updates](https://sparkle-project.org/documentation/package-updates/)). This is the AUv2-in-`/Library` case.                                                                                                 |
| App copies the AUv2 component itself | Only workable if the component is installed per user (`~/Library/Audio/Plug-Ins/Components`, no admin needed). Replace it atomically (write a temp file, then `rename`), never in place: Apple warns that in-place writes to signed code cause `Code Signature Invalid` crashes ([Updating Mac Software](https://developer.apple.com/documentation/security/updating-mac-software)). Logic probably needs a restart to load the new AU. **Mac check** |
| Manual reinstall                     | Zero code. Acceptable for the first releases.                                                                                                                                                                                                                                                                                                                                                                                                         |

**Recommendation:** ship manual-reinstall `.pkg` releases first. Add Sparkle 2 to the companion app once
the AU format is settled. If AUv2 stays, prefer per-user component installation so that the app can
update it without an admin prompt. Owner decision once SPIKE-007 lands. Sparkle would be a new
dependency, so ask first (AGENTS.md rule 9).

### Uninstaller

macOS Installer has no uninstall feature. `pkgutil --pkgs` / `--files <id>` lists what a package
installed, and `pkgutil --forget <id>` removes the receipt only (`pkgutil(1)`; **Mac check** for exact
behaviour). Plan: an "Uninstall…" menu item in the companion app (and a signed `uninstall.command` in
the `.dmg` / download page) that:

1. calls `SMAppService.agent(...).unregister()`
2. removes the component from both `Plug-Ins/Components` folders (admin prompt for `/Library`)
3. asks whether to delete the API keys from the Keychain (SPIKE-009 service `clogic.llm-api-key`)
4. removes `~/Library/Application Support/<name>` and caches
5. runs `pkgutil --forget` for our package IDs
6. moves the app to the Trash

It never touches Logic projects or audio (AGENTS.md rule 8).

### First-run flow (outline; details belong to other spikes)

1. Gatekeeper first-launch dialog. Notarisation and stapling make this the normal one, not a block
   (macOS 15+ removed the Control-click bypass, so unsigned builds are not an option for users).
2. Companion asks to register its login item / launch agent (`SMAppService.register()`). If the user
   later disables it in Login Items, call `openSystemSettingsLoginItems()`.
3. API key prompt and Keychain storage: SPIKE-009.
4. Accessibility permission, if SPIKE-005 needs it, and MIDI / control surface setup: SPIKE-004.
   Whether any of these can be automated is out of scope here.
5. A "Logic doesn't show the plugin?" help link explaining Plug-in Manager > Reset & Rescan Selection.

### CI (proposal only; `.github/workflows/` is off limits for this task)

- GitHub-hosted runners: `macos-26` reached general availability on 2026-02-26 and runs on Apple
  silicon ([GitHub changelog](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/)).
  `macos-15-arm64` images were being updated through July 2026. `macos-14` images are deprecated and
  become unsupported on 2026-11-02.
- Import the Developer ID Application and Developer ID Installer `.p12` files from secrets into a
  temporary keychain (`security create-keychain`, `security import … -k`, `security
set-key-partition-list`), as in GitHub's guide
  ([Sign Xcode applications](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)).
  Notarise with an App Store Connect API key (`.p8` in secrets).
- Build ffmpeg with the pinned script and cache by version and configure hash. Fail the job unless
  `ffmpeg -L` says LGPL. Record `ffmpeg -buildconf` as a release artefact.
- Run `codesign --verify --strict --deep`, `pkgutil --check-signature` and `spctl -a -t install` after
  stapling. Check the notary log for warnings even on success.
- Release jobs only. Pull request builds should not sign or notarise (no secrets on forks, 75 / day
  limit).

### Licence note per bundled binary

| Binary                       | Licence                                                                                                                                                            | Obligations (summary; SPIKE-011 owns the detail)                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ffmpeg / ffprobe (own build) | LGPL-2.1-or-later (verified via `ffmpeg -L` on the test build)                                                                                                     | Corresponding source, configure line and licence text from the same place as the binary; FFmpeg checklist items (About box, EULA, no reverse-engineering ban). See SPIKE-011 row 12 |
| Node runtime (SEA)           | MIT, plus ~45 bundled components listed in Node's `LICENSE` (OpenSSL under Apache-2.0, ICU, libuv, V8, zlib, npm, …; checked in the v24.21.0 darwin-arm64 tarball) | Ship Node's `LICENSE` file in `THIRD_PARTY_NOTICES`                                                                                                                                 |
| Bun runtime (if chosen)      | MIT; JavaScriptCore / WebKit LGPL-2, statically linked                                                                                                             | Relinking duty (open question below)                                                                                                                                                |
| Sparkle (if adopted)         | MIT, plus BSD-2 / zlib parts                                                                                                                                       | Notices                                                                                                                                                                             |
| Our npm runtime dependencies | Per SPIKE-011 audit (no GPL / AGPL)                                                                                                                                | Notices                                                                                                                                                                             |
| AU, Swift shell              | Our repository licence (SPIKE-011 Q3)                                                                                                                              | n/a                                                                                                                                                                                 |

### Open questions for SPIKE-011 (not decided here)

1. **ffmpeg as a separate executable inside our signed app bundle.** Does running it as a child process
   (no linking) satisfy LGPL-2.1 with source plus a configure line hosted alongside? Does the user's
   right to replace the binary conflict with the app's code signature? Replacing a file inside a signed
   bundle invalidates the bundle's seal. One option is to document how to re-sign ad hoc, or to load
   ffmpeg from a user-overridable path.
2. **Bun's statically linked JavaScriptCore (LGPL-2).** Would shipping a `bun build --compile` binary
   oblige us to provide object files for relinking? If yes, prefer Node SEA.
3. **AAC / MP3 decoding patents** (SPIKE-011 Q10), especially if decoding goes through FFmpeg rather
   than Apple's AudioToolbox, which is licensed by Apple as part of macOS.
4. **Individual vs organisation Apple Developer enrolment.** An individual enrolment shows the owner's
   legal name as the seller. An organisation needs a legal entity and a D-U-N-S number. This also fixes
   the "Developer ID Application: <name>" string users see.
5. **EULA in the installer.** `productbuild --distribution` can show a licence. Confirm the SPIKE-011
   EULA text is the one to show, and that it has no reverse-engineering ban (FFmpeg checklist item 13).

### What a human must still run (Mac + Developer ID)

1. Build `research/010-installer-and-distribution/build-lgpl-ffmpeg.sh` on an arm64 Mac. Record the size
   and `ffmpeg -L`.
2. Build a Node SEA of the companion, sign it with hardened runtime and `allow-jit` only, and check it
   runs. Add entitlements only if it crashes.
3. Package a stub AUv2 component (or the SPIKE-007 prototype) with the companion app and ffmpeg into a
   `.pkg`. Sign, notarise, staple, then install on a clean macOS 15.6+ user account.
4. Confirm Logic shows the plugin, Plug-in Manager says compatible, and `auval -v` passes, with and
   without `killall -9 AudioComponentRegistrar`.
5. Inspect Logic's entitlements (`codesign -d --entitlements - "/Applications/Logic Pro.app"`).
6. From inside the installed app, spawn the bundled ffmpeg on a WAV and an MP3.
7. Measure the `.pkg` size, run the uninstaller, and confirm nothing is left (`pkgutil --pkgs`, both
   Components folders, Login Items).
