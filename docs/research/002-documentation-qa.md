# SPIKE-002: Logic Pro documentation Q&A

Issue: [#2](https://github.com/brandonapol/clogic/issues/2)

## Question

What is the best way to answer "how do I do X in Logic Pro?" with accurate, cited answers for the current
Logic version?

## Why it matters

Half the battle in learning to mix is knowing where a feature lives (sidechain routing, Mastering
Assistant, Stem Splitter, Match EQ, Smart Tempo, ...). Wrong answers from model memory are worse than no
answer.

## Timebox

1 day

## Investigate

- [ ] Sources: Apple's online Logic Pro User Guide, "What's new" release notes, the Logic Pro Effects and
      Instruments guides. Check what version each covers and how often it updates.
- [ ] Terms of use: confirm whether fetching and caching Apple's documentation locally for personal use is
      allowed. If not, design a live-fetch-plus-cite approach instead of a stored index.
- [ ] Retrieval: compare keyword search (BM25) vs. embeddings vs. hybrid on ~20 real questions.
- [ ] Freshness: how to detect a doc update (e.g. a Logic release) and re-index.
- [ ] Citations: every answer links the exact doc page it came from.
- [ ] Key commands: can the default key command list be pulled in as structured data?

## Done when

- A list of 20 test questions with expected source pages
- A prototype `search_logic_docs(query)` that returns the right page in the top 3 for at least 16 / 20
- A written decision on storing an index vs. fetching live, based on the terms of use

## Risks / unknowns

- Apple's doc site structure may change and break scraping
- Version drift between the docs and the user's installed Logic version

## Findings

_TBD_
