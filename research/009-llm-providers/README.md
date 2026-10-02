# SPIKE-009 end-to-end check

Throwaway script for a human with a Mac and real API keys. It is not imported by `src/`.
See the Findings of [SPIKE-009](../../docs/research/009-llm-providers-and-keys.md) for what to record.

```sh
npm run build
pbpaste | node --experimental-strip-types research/009-llm-providers/e2e.ts save anthropic
pbpaste | node --experimental-strip-types research/009-llm-providers/e2e.ts save openai
pbpaste | node --experimental-strip-types research/009-llm-providers/e2e.ts save xai
node --experimental-strip-types research/009-llm-providers/e2e.ts run
MODEL=claude-haiku-4-5 node --experimental-strip-types research/009-llm-providers/e2e.ts run anthropic
node --experimental-strip-types research/009-llm-providers/e2e.ts remove xai
```

`save` reads the key from stdin, validates it with a models-list request, then stores it in the login
keychain under service `clogic.llm-api-key`, account `<provider>`. `run` reads the key back, validates
it, and runs a two-turn `get_loudness` conversation with a fake measurement. Keys are never printed.
