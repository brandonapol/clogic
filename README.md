# clogic

An AI assistant that lives inside Logic Pro as a plugin. Insert it like any other plugin, paste in a
Claude, OpenAI or Grok API key, and chat with it to:

- analyse your mix and stems (loudness, true peak, tonal balance, stereo image, masking between stems)
- get specific mixing and mastering advice, optionally compared against a reference track
- answer "how do I do X in Logic?" with cited links to Apple's documentation
- change session details for you (faders, pan, plugin parameters, bouncing stems) where Logic allows it

## Status

Early investigation. Logic Pro has no public scripting API, so the first phase is a set of time-boxed
spikes to find out what is actually possible. See [docs/research](./docs/research/README.md).

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
docs/research/  Spikes, findings and research notes
docs/decisions/ Architecture decision records
research/       Throwaway spike prototypes
fixtures/     Local audio fixtures (git-ignored)
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). AI agents follow [AGENTS.md](./AGENTS.md).

## License

clogic is licensed under the [Apache License 2.0](./LICENSE). See [NOTICE](./NOTICE). Bundled ffmpeg is an
LGPL-only build with a source offer; see [ADR 0003](./docs/decisions/0003-lgpl-only-ffmpeg-build.md).
