# Contributing

This repository is largely built with AI coding agents ("vibe coded"). That is fine, as long as a human
stays in charge of what gets merged. These practices keep the codebase healthy.

## Workflow

1. Every change starts from a GitHub issue (spike, feature or bug) using the issue templates.
2. Branch from `main`, keep the change small, open a PR using the PR template.
3. CI must be green: typecheck, lint, format, tests, build, secret scan.
4. A human reviews and merges. Agents do not merge their own PRs.

## Working with AI agents

- **Agents follow [AGENTS.md](./AGENTS.md).** `CLAUDE.md` imports it, so Claude Code, Codex and other
  tools all get the same rules. Update `AGENTS.md` when you notice an agent repeatedly doing the wrong
  thing.
- **Give agents a ticket, not a vibe.** Point the agent at an issue with clear "done when" criteria. Vague
  prompts produce sprawling diffs.
- **Read every diff.** You are responsible for the code, not the agent. If you cannot explain a line, do
  not merge it.
- **Tests are the contract.** Ask for tests first or alongside code. A green test suite that you trust is
  what lets you move fast safely.
- **Keep PRs small.** Large AI-generated diffs hide bugs. Split work into steps that each pass CI.
- **Verify claims.** Agents confidently invent APIs. Anything about Logic Pro, Audio Units, MIDI or macOS
  needs a source or a reproducible test, recorded in `docs/research/`.
- **Commit often, revert freely.** Small commits make it cheap to throw away a bad direction.
- **Record decisions.** When a conversation with an agent settles something, write an ADR in
  `docs/decisions/` so the next session does not relitigate it.
- **Protect secrets.** Never paste API keys into prompts, code, issues or commits.
- **Disclose AI assistance** in the PR template so reviewers know where to look harder.

## Repository settings (owner checklist)

These are configured in GitHub, not in files:

- [ ] Protect `main`: require PRs, require the `ci` checks to pass, block force pushes
- [ ] Enable Dependabot alerts and secret scanning with push protection
- [ ] Squash merge only, auto-delete head branches

## Research

Research tasks and their results live in [`docs/research/`](./docs/research/README.md). Prototype code
for a spike lives in `research/<NNN>-<slug>/` and is never imported by `src/`.
