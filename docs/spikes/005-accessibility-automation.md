# SPIKE-005: macOS Accessibility and key commands

## Question

What can we do through the macOS Accessibility (AX) API and Logic key commands that a control surface
cannot, and how fragile is it?

## Why it matters

Things like triggering a bounce, exporting all tracks as stems, opening Mastering Assistant, or reading
a plugin window are not exposed by control surface protocols.

## Timebox

2 days

## Investigate

- [ ] AX tree inspection of Logic (Accessibility Inspector): how much of the main window, mixer, and
      plugin windows is exposed, and whether elements have stable identifiers.
- [ ] Driving it from Node: JXA / `osascript`, a small Swift helper binary, or a native Node addon.
- [ ] Key commands: send key events to trigger documented commands. Can we ship a custom key command set?
- [ ] Automate "Export All Tracks as Audio Files" and "Bounce Project or Section" end to end, so SPIKE-001
      can run without manual bouncing.
- [ ] Read-back: confirm an action happened (e.g. a file appeared, a window opened).
- [ ] Permissions UX: which process needs Accessibility permission when launched from an MCP client.
- [ ] Fragility: compare AX paths across two Logic versions if available.

## Done when

- A demo that bounces stems of the current project into a chosen folder with no clicks
- A list of actions ranked by reliability
- A verdict: use for a few high-value actions only, or broadly

## Risks / unknowns

- UI changes in Logic updates can silently break automation
- Localised UIs (non-English) may break label-based lookups
- Automation while the user is also using the mouse

## Findings

_TBD_
