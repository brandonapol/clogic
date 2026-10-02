# 0004: Mackie Control as primary mixer control channel

- Status: accepted
- Date: 2026-10-02
- Related: SPIKE-004

## Context

Logic Pro has no public scripting API. [SPIKE-004](../research/004-control-surface-emulation.md) found
Mackie Control (MCU) is better documented by Apple than HUI or OSC and does more in Logic, and gave a verdict
of go for MCU as the primary mixer channel, pending Mac checks. Logic Remote / OSC is deferred.

## Decision

Mackie Control emulation over MIDI is the primary channel for changing mixer state (faders, pan, mute, solo,
and the other controls SPIKE-004 documents). Every change still needs user confirmation. Logic Remote / OSC is
deferred and not part of this decision.

## Consequences

- Capabilities beyond what MCU exposes need another route and are tracked in other spikes.
- The Mac checks listed in SPIKE-004 still need to pass before implementation depends on specific behaviour.
