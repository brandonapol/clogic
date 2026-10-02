# SPIKE-004: Control surface emulation (Mackie Control / HUI / OSC)

## Question

Can a Node process pretend to be a control surface and reliably **read** and **write** Logic mixer state?

## Why it matters

This is the most likely supported way to change the session from outside: faders, pan, mute / solo,
sends, plugin parameters and transport, plus feedback such as track names and levels.

## Timebox

3 days

## Investigate

- [ ] Virtual MIDI ports from Node (CoreMIDI virtual source / destination, or the IAC Driver). Evaluate
      Node MIDI libraries for native build pain on Apple Silicon.
- [ ] Register as a Mackie Control in Logic (Control Surfaces > Setup) and complete the device handshake.
- [ ] Read: track names (LCD sysex), fader positions, pan, mute / solo / record states, selected track,
      bank of 8 channels.
- [ ] Write: set a fader to an exact dB value. Map MCU 14-bit pitch bend to dB and measure accuracy.
- [ ] Navigation: bank / channel switching to reach any track in a large session.
- [ ] Plugin parameters: MCU plugin edit mode. Can we list parameters and set e.g. a Channel EQ band's
      gain or frequency, or a compressor threshold?
- [ ] Sends and bus routing: what is readable and writable.
- [ ] Compare HUI mode, and Logic's OSC control surface support (as used by Logic Remote and third-party
      surfaces). Is any OSC route documented or usable?
- [ ] Controller Assignments (Learn mode) as a fallback for specific parameters.
- [ ] Latency and reliability: dropped messages, feedback loops, behaviour when Logic is in the background.

## Done when

- A demo script that lists the first 16 track names and sets a named track's fader to -6.0 dB
- A capability matrix: read / write / not possible for each mixer and plugin control
- A verdict on whether this is good enough to be the primary control channel

## Risks / unknowns

- MCU plugin parameter names and ordering may be unpredictable across plugins
- The display (LCD) is only 2 x 56 characters; long names get truncated
- Logic may treat a second "surface" differently if the user owns real hardware

## Findings

_TBD_
