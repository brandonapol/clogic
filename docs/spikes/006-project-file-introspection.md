# SPIKE-006: Logic project file introspection

## Question

Can we read anything useful from a `.logicx` project bundle without opening Logic: track list, plugins
per channel, routing, tempo, sample rate?

## Why it matters

Knowing the session layout (which plugins are on the vocal, what is bussed where) lets the assistant
give advice in context, even if we can never write to the file.

## Timebox

1 day

## Investigate

- [ ] Bundle layout: `Alternatives/`, `Resources/`, `MetaData.plist`, `ProjectData`, audio file references.
- [ ] What `MetaData.plist` exposes (tempo, key, sample rate, track count, ...).
- [ ] `ProjectData` binary format: is anything readable (strings, plugin identifiers, channel strip
      names)? Check for existing community reverse-engineering work and its licence.
- [ ] Channel strip settings (`.cst`) and plugin presets (`.aupreset`, `.pst`): readable formats?
- [ ] Read-only guarantee: never write to project files.

## Done when

- A script that prints whatever metadata can be extracted from a sample project
- A verdict: useful context source, or dead end

## Risks / unknowns

- Undocumented binary format may change between versions
- Possible licence or terms issues around reverse engineering

## Findings

_TBD_
