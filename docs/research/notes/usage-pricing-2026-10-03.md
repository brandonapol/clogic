# Usage pricing sources (2026-10-03)

Related: [SPIKE-009](../009-llm-providers-and-keys.md) (cost visibility). Code: `src/usage/prices.ts`.

Prices for the three default models in `src/llm/providers.ts`, read from each provider's official pricing
page on 2026-10-03 with WebFetch from Linux. No API calls were made and no invoice was checked against
these numbers. All prices are USD per million tokens, standard (non-batch, non-priority) tier, global
routing.

| Provider  | Model               | Input | Cached input | Output | Long-context tier                                  | Source                                                     |
| --------- | ------------------- | ----- | ------------ | ------ | -------------------------------------------------- | ---------------------------------------------------------- |
| Anthropic | `claude-sonnet-5-5` | 2.00  | 0.20         | 10.00  | none: 1M context at standard pricing               | <https://platform.claude.com/docs/en/about-claude/pricing> |
| OpenAI    | `gpt-6.1-sol`       | 2.00  | 0.10         | 10.00  | over 272K input tokens: 4.00 / 0.20 / 15.00        | <https://developers.openai.com/api/docs/pricing>           |
| xAI       | `grok-4.7`          | 2.00  | 0.50         | 6.00   | prompt of 200k tokens or more: 4.00 / 1.00 / 12.00 | <https://docs.x.ai/docs/models>                            |

## What the pages say

- **Anthropic.** Model pricing table row "Claude Sonnet 5.5": base input $2 / MTok, 5m cache writes
  $2.50, 1h cache writes $4, cache hits and refreshes $0.20, output $10. "Claude 4.6 and later models ...
  include the full 1M token context window at standard pricing." US-only inference
  (`inference_geo: "us"`) is 1.1x on every category; clogic does not set it.
- **OpenAI.** gpt-6.1-sol standard tier: short context input $2.00, cached input $0.10, output $10.00;
  long context input $4.00, cached input $0.20, output $15.00. "Short context: ≤272K input tokens. Long
  context: >272K input tokens." Matches doc 009's "$2 / $10 per M tokens".
- **xAI.** grok-4.7: under 200k tokens input $2.00, cached input $0.50, output $6.00; 200k or more input
  $4.00, cached $1.00, output $12.00. "Requests whose prompt reaches the listed token threshold are
  billed at the higher rate for all tokens in the request."

## How the code uses this

- `estimateCost` prices one call. The long-context tier is chosen per call from that call's prompt size
  (uncached plus cached input), because both OpenAI and xAI apply the higher rate to the whole request.
  Session totals cannot pick the tier, so the ledger sums per-call estimates.
- Model ids match exactly. A model not in the table (a snapshot id, a cheaper model picked in settings)
  gives `unknown_model`; the UI shows "cost unknown" or "at least $X" rather than a guessed price.
- `TokenUsage.inputTokens` means uncached input. Mapping from provider usage fields, for when the
  adapters parse cached counts (they do not yet; `src/llm` `Usage` has only input and output):
  - Anthropic: `input_tokens` already excludes cache reads; `cache_read_input_tokens` is cached input.
  - OpenAI and xAI Responses: `input_tokens` includes `input_tokens_details.cached_tokens`, so subtract
    it to get uncached input.
- Not modelled: Anthropic cache writes (clogic does not send `cache_control`), batch, flex, priority and
  fast tiers, data-residency multipliers, server-side tool fees (web search), and reasoning tokens beyond
  what the providers already count in output tokens.

## Open questions

- Whether OpenAI's "272K" means 272,000 or 278,528 tokens. The table uses 272,000 (long context from
  272,001); the difference only matters for prompts in that narrow band.
- Prices change. Re-check these three pages when defaults change or before a release, and update
  `retrievedOn` in `src/usage/prices.ts`.
