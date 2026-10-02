# SPIKE-004 MCU protocol prototype

Throwaway, dependency-free encoder / decoder for the Mackie Control (MCU) MIDI protocol. It is not
imported by `src/` and opens no MIDI ports. See the Findings of
[SPIKE-004](../../docs/research/004-control-surface-emulation.md).

Byte layouts and test vectors come from Appendix B and C of Apple's _Logic 7: Dedicated Control Surface
Support_ manual (2004, "Logic Control—MIDI Implementation", firmware V1.0). The Mackie Control model
IDs (`0x14`, `0x15`) come from secondary sources and still need checking against a live Logic.

```sh
npx vitest run --root research/004-mcu-protocol
npx tsc -p research/004-mcu-protocol
```

What it covers: sysex header and model IDs, device query and host connection handshake (including the
published challenge-response algorithm), faders (14-bit pitch bend) with touch / release, buttons and
LEDs, V-Pot deltas and LED rings, LCD writes and a 2 x 56 character LCD model, 7-segment time code and
assignment digits, meters, a running-status byte stream splitter, and finding a strip by the name
Logic shows on the LCD.

What it does not cover: the fader-to-dB curve (not published; needs measuring on a Mac), HUI, OSC, and
any I/O.
