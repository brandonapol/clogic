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

- [ ] Framework: JUCE (C++) vs. native AUv3 (Swift / C++) app extension. Licensing for JUCE.
- [ ] Effect vs. MIDI FX vs. both: which plugin type(s) Logic lets you insert on audio tracks, the stereo
      out, and buses.
- [ ] Chat UI in a web view (JUCE 8 WebView UI or `WKWebView`) so the UI can be written in TypeScript.
      Check keyboard focus and text input inside Logic's plugin windows (Logic can swallow key presses
      for its own key commands).
- [ ] Build, sign and validate with `auval`; load it in Logic on Apple Silicon.
- [ ] Host info available to the plugin: transport position, tempo, track name (if any), sample rate.
- [ ] IPC from the plugin to the companion service (SPIKE-003). Sandboxing rules for AUv3 extensions.
- [ ] Multiple instances: one per track, with identification so the assistant knows which is which. One
      shared conversation, or one per instance?
- [ ] Real-time safety: no allocations or blocking I/O on the audio thread; lock-free queue to a sender
      thread for metering data.
- [ ] Persist chat history and settings in the plugin state so they save with the Logic project.
- [ ] Reuse: can the analysis core from SPIKE-001 be shared (e.g. compiled to WASM), or must the live
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

_TBD_
