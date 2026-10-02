# clogic

An AI assistant that lives inside Logic Pro as a plugin. Insert it like any other plugin, paste in a
Claude, OpenAI or Grok API key, and chat with it to:

- analyse your mix and stems (loudness, true peak, tonal balance, stereo image, masking between stems)
- get specific mixing and mastering advice, optionally compared against a reference track
- answer "how do I do X in Logic?" with cited links to Apple's documentation
- change session details for you (faders, pan, plugin parameters, bouncing stems) where Logic allows it

## Status

Early investigation. Logic Pro has no public scripting API, so the first phase is a set of time-boxed
spikes to find out what is actually possible. See [docs/spikes](./docs/spikes/README.md).

## Development

Requires Node 22 (see `.nvmrc`).

```sh
npm install
npm run check
npm run build
```

| Script              | What it does                           |
| ------------------- | -------------------------------------- |
| `npm run typecheck` | Type-check with `tsc`                  |
| `npm run lint`      | Lint with ESLint (`typescript-eslint`) |
| `npm run format`    | Format with Prettier                   |
| `npm test`          | Run tests with Vitest                  |
| `npm run check`     | All of the above (what CI runs)        |
| `npm run build`     | Compile `src/` to `dist/`              |

## Layout

```
src/          TypeScript source (companion service, analysis core, tools)
test/         Vitest tests
docs/spikes/  Investigation tickets and findings
fixtures/     Local audio fixtures (git-ignored)
```
