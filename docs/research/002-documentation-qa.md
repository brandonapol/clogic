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

- [x] Sources: Apple's online Logic Pro User Guide, "What's new" release notes, the Logic Pro Effects and
      Instruments guides. Check what version each covers and how often it updates.
- [x] Terms of use: confirm whether fetching and caching Apple's documentation locally for personal use is
      allowed. If not, design a live-fetch-plus-cite approach instead of a stored index.
- [ ] Retrieval: compare keyword search (BM25) vs. embeddings vs. hybrid on ~20 real questions.
- [x] Freshness: how to detect a doc update (e.g. a Logic release) and re-index.
- [x] Citations: every answer links the exact doc page it came from.
- [x] Key commands: can the default key command list be pulled in as structured data?

## Done when

- A list of 20 test questions with expected source pages
- A prototype `search_logic_docs(query)` that returns the right page in the top 3 for at least 16 / 20
- A written decision on storing an index vs. fetching live, based on the terms of use

## Risks / unknowns

- Apple's doc site structure may change and break scraping
- Version drift between the docs and the user's installed Logic version

## Findings

Researched 2026-10-02 from Linux (no Mac available), using WebSearch / WebFetch and `curl 8.x` against
Apple's public sites. No Apple text is copied into the repo beyond short quotes needed to cite terms.
macOS version: n/a. Logic Pro version: n/a (docs reviewed cover Logic Pro for Mac 12.3; release notes
list 12.4).

**Verdict: partial.** The sources are good and well structured, but Apple's website terms appear to
forbid the automated fetching and local copying that an index or live-fetch RAG would need. Until
SPIKE-011 rules on that, the safe design is "answer from a link-only topic map and cite the page", with
a user-local index as an opt-in follow-up. The `search_logic_docs` prototype and the 16 / 20 retrieval
benchmark were **not built**, because building them means scraping the guide (see Terms below).

### Sources (checked 2026-10-02)

| Source                          | Where                                                                                                                                                                                                                                                                                                               | Version / freshness                                                                 | Notes                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logic Pro User Guide (online)   | <https://support.apple.com/guide/logicpro/welcome/mac>                                                                                                                                                                                                                                                              | Version selector tops out at "Logic Pro for Mac 12.3", back to Logic Pro X 10.5     | Server-rendered HTML (no JS needed): a topic page is ~2.4 MB and embeds the full TOC. `curl -sL https://support.apple.com/guide/logicpro/toc` returned 200 and ~1,938 unique topic slugs.                                                                                                   |
| Effects and Instruments content | Same guide, e.g. `/guide/logicpro/compressor-lgce44b18080`, `/guide/logicpro/match-eq-overview-lgcef1edbfbe`                                                                                                                                                                                                        | Same as the User Guide                                                              | Separate `support.apple.com/guide/logicpro-effects/...` and `.../logicpro-instruments/...` return 404. Effects and instruments topics now sit inside the `logicpro` guide (topic ID prefixes `lgce*` and `lgsi*`, user guide topics `lgcp*`; inferred from slugs, not documented by Apple). |
| PDFs                            | Linked from the guide's welcome page: `help.apple.com/pdf/logicpromac/en_US/logic-pro-mac-user-guide.pdf` (48 MB, `Last-Modified: 2026-07-07`), `...logicpromac-effects/...` (12 MB, 2026-06-30), `...logicpromac-instruments/...` (21.6 MB, 2026-06-30), `...logicpromac-css/...` (Control Surfaces Support Guide) | Last-Modified matches the 12.3 release window                                       | Old `help.apple.com/pdf/logicpro*/...` URLs 302 to the `logicpromac*` names, so URLs have already changed once.                                                                                                                                                                             |
| Control Surfaces Support Guide  | <https://support.apple.com/guide/logicpro-css/welcome/mac>                                                                                                                                                                                                                                                          | 200                                                                                 | Relevant to SPIKE-004.                                                                                                                                                                                                                                                                      |
| Apple Books                     | e.g. "Logic Pro Effects" <https://books.apple.com/book/id960808317>                                                                                                                                                                                                                                                 | Store page says the guide "is no longer being updated in Apple Books"               | Do not rely on Books editions for current versions.                                                                                                                                                                                                                                         |
| Release notes                   | <https://support.apple.com/109503> ("Logic Pro for Mac release notes")                                                                                                                                                                                                                                              | Page published 2026-09-29; lists 12.4, 12.3.1, 12.3, 12.2, 12.0.1, 12.0, 11.2, 10.8 | No per-release dates on the page. Third-party coverage: 12.3 shipped July 2026 ([Synth Anatomy](https://synthanatomy.com/2026/06/apple-logic-pro-12.html), [TidBITS 12.3.1](https://tidbits.com/watchlist/logic-pro-12-3-1/)).                                                              |
| Legacy help                     | `help.apple.com/logicpro/mac/10.1/en.lproj/<topic>.html` (still served, seen in search results)                                                                                                                                                                                                                     | Logic Pro X 10.1                                                                    | Same topic IDs as today (e.g. `lgcpeabb4c40`), so topic IDs are stable across versions.                                                                                                                                                                                                     |

Observed version drift on 2026-10-02: the release notes list 12.4 but the guide's version selector stops
at 12.3. Answers must say which guide version they cite.

Topic URLs: `https://support.apple.com/guide/logicpro/<slug>-<topicId>/mac`, optionally
`/<logicVersion>/mac/<macOSVersion>` (e.g. `.../lgcpeabb4c40/12.3/mac/15.6`). The bare
`/guide/logicpro/<topicId>/mac` form redirects to the slugged canonical URL, so storing only the topic ID
is enough to build a link.

Pages carry `<meta name="robots" content="noindex">` (checked on a topic page and the TOC, both with and
without `/en-us/`). `support.apple.com/robots.txt` has no `/guide/` rule and no AI crawler rules; it
disallows `/docs/product/` and `*/MANUALS/*.pdf`. `www.apple.com/robots.txt` has no rules for these
paths either.

### Installed Help bundle: needs a Mac check

Not verified. What is documented:

- Apple Help books are `.help` bundles registered through `CFBundleHelpBookFolder` and
  `CFBundleHelpBookName` in the app's `Info.plist`, stored under `Contents/Resources` in localized
  `.lproj` folders ([Apple, Registering Your Help Book](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LegacyAppleHelpConcepts/registering_help/registering_help.html)).
- A help book can set `HPDBookRemoteURL` so Help Viewer fetches pages from a server that mirrors the
  bundle's `Resources` folder ([Alastair's Place, 2015](https://alastairs-place.net/blog/2015/01/14/apple-help-in-2015/)).
- "Many, perhaps most, of Apple's Help Books now rely largely on external content, which is fetched
  from help.apple.com" ([Eclectic Light, 2017](https://eclecticlight.co/2017/03/11/help-help-2-what-has-happened-to-help/);
  see also [2023 follow-up](https://eclecticlight.co/2023/05/11/how-help-works-and-how-it-doesnt/)).
  The legacy `help.apple.com/logicpro/mac/10.1/en.lproj/...` URLs match that remote-help layout.

So Logic's in-app Help may be a thin stub that loads help.apple.com, not a full offline copy. To check
on a Mac (record macOS and Logic versions):

```sh
plutil -p "/Applications/Logic Pro.app/Contents/Info.plist" | grep -i helpbook
find "/Applications/Logic Pro.app/Contents/Resources" -maxdepth 2 -name '*.help'
plutil -p ".../<Name>.help/Contents/Info.plist" | grep -iE 'HPDBook|RemoteURL'
du -sh ".../<Name>.help"; ls ".../<Name>.help/Contents/Resources/en.lproj" | head
```

The app name and paths above are guesses to try, not claims.

### Terms of use (for SPIKE-011, not decided here)

Guide pages link in their footer to the Apple Website Terms of Use,
<https://www.apple.com/legal/internet-services/terms/site.html>, which says "Updated by The Apple Legal
Team on Nov. 20, 2009" (fetched 2026-10-02). Relevant clauses (short quotes):

- No content "may be copied, reproduced, republished, uploaded, posted, publicly displayed, encoded,
  translated, transmitted or distributed in any way" without Apple's written consent, except
  downloading information "for your personal, non-commercial informational purpose" without copying or
  posting it "on any networked computer".
- "You may not use any 'deep-link', 'page-scrape', 'robot', 'spider' or other automatic device,
  program, algorithm or methodology ... to access, acquire, copy or monitor any portion of the Site".

Open questions for SPIKE-011 (recorded, not decided):

1. Is a tool that fetches one guide page live when a user asks a question an "automatic device" under
   that clause, even though it is user-initiated and one page at a time?
2. Can we ship a topic map (titles, topic IDs and URLs extracted from the TOC) in the plugin? It is
   metadata, not prose, but it is derived from the site by a script.
3. Does a user-local index of a PDF that the user downloaded themselves (stored only on their Mac, never
   uploaded except as snippets sent to their chosen LLM provider) count as personal, non-commercial use?
   Does sending excerpts to Anthropic / OpenAI / xAI count as "transmitting"?
4. Does the Logic Pro licence agreement, rather than the website terms, govern the in-app Help content,
   and what does it say about documentation?
5. Does it matter whether clogic is free or paid ("non-commercial")?
6. Is there an Apple developer or partner channel for permission?

The `noindex` meta tag is not a legal restriction, but it signals that Apple does not want these pages
indexed by search engines; worth weighing in the same review.

### Options compared

| Option                                                                                                     | Accuracy                                                | Freshness                                          | Offline | Terms risk                        | Effort                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- | ------- | --------------------------------- | ----------------------------------------------------------- |
| A. Cite links only: model answers from memory, a small hand-curated topic map (title + URL) picks the link | Medium: answer text not grounded; link lets user verify | Topic IDs are stable; re-curate per major release  | Yes     | Lowest (open question 2)          | Low                                                         |
| B. Live fetch + search: fetch the TOC and one or two pages per question, ground the answer, cite           | High                                                    | Always current                                     | No      | Highest (open question 1)         | Medium; breaks if markup changes (pages are 2.4 MB of HTML) |
| C. User-local index from the installed Help bundle                                                         | High if the bundle has full content                     | Matches the user's installed Logic version exactly | Yes     | Medium (open questions 3, 4)      | Unknown: may be a remote stub (needs Mac check)             |
| D. User-local index from the PDFs the user downloads                                                       | High                                                    | Per release; user re-downloads                     | Yes     | Medium (open question 3)          | Medium: PDF to sections, map back to topic URLs by heading  |
| E. Maintainer-built index shipped with the app                                                             | High                                                    | Per our release                                    | Yes     | High: redistributes Apple content | Medium                                                      |

E is ruled out: it redistributes Apple text. B should not ship until SPIKE-011 clears it.

### Recommendation

1. **Ship A first.** Keep a small topic map in the repo containing only topic IDs, our own short
   descriptions and keywords, and the URL pattern. No Apple prose. The assistant answers, says it is
   unverified, and links the page. Gate it on SPIKE-011 question 2; if that is refused, curate the map
   by hand from links only.
2. **Add D (or C if the Mac check shows a full local Help book) as opt-in.** The user points clogic at
   a PDF or Help bundle on their Mac; we index it locally (BM25 is enough to start, add embeddings only
   if the benchmark below demands it) and cite the matching topic URL. Nothing leaves the Mac except the
   few snippets sent to the user's own LLM provider, and only if SPIKE-011 says that is acceptable.
3. **B only with SPIKE-011 sign-off.**
4. **Freshness:** check the release notes page (published date and newest version), the PDF
   `Last-Modified` headers, and the guide's version selector. Compare with the user's installed Logic
   version (read from `Info.plist` `CFBundleShortVersionString`, needs Mac check) and say which guide
   version an answer cites.
5. **Citations:** every answer includes `https://support.apple.com/guide/logicpro/<topicId>/mac`
   (redirects to the canonical slug URL), or the versioned form when the user's version is known.

### Key commands

Logic can copy the visible key command assignments to the clipboard as text (Key Commands window,
Options > Copy Key Commands to Clipboard), and export or import key command sets
([Apple: Copy and print key commands](https://support.apple.com/guide/logicpro/lgcpeabb4c40/mac),
[Browse, import and save key commands](https://support.apple.com/guide/logicpro/lgcp68d9ced1/mac)).
That gives us the user's own assignments without touching Apple's site: the user pastes or exports
them and we parse locally. The clipboard text format and export file format still need a Mac check.

### Test questions and expected source pages

Base URL `https://support.apple.com/guide/logicpro/`. Expected topic IDs come from the 2026-10-02 TOC
(12.3). Use these for the retrieval benchmark once an allowed corpus exists (target: right page in top
3 for at least 16 / 20).

| #   | Question                                                 | Expected topic                                            |
| --- | -------------------------------------------------------- | --------------------------------------------------------- |
| 1   | How do I sidechain a compressor to the kick?             | `compressor-side-chain-parameters-lgce0b2501de`           |
| 2   | How do I use Mastering Assistant?                        | `mastering-assistant-overview-lgcp7f94da0b`               |
| 3   | How do I split a song into vocal and instrumental stems? | `extract-vocal-instrumental-stems-stem-lgcp61bae908`      |
| 4   | How do I match the EQ of a reference track?              | `match-eq-overview-lgcef1edbfbe`                          |
| 5   | What does Smart Tempo do?                                | `smart-tempo-overview-lgcp9281e70c`                       |
| 6   | How do I tune vocals with Flex Pitch?                    | `edit-pitch-and-timing-with-flex-pitch-lgcpc53e6bef`      |
| 7   | How do I bounce my mix to a WAV file?                    | `bounce-a-project-to-an-audio-file-lgcp785a41c3`          |
| 8   | How do I export every track as separate audio files?     | `export-tracks-as-audio-files-lgcpb27f70f9`               |
| 9   | How do I freeze tracks to save CPU?                      | `freeze-tracks-lgcpf1cbfd51`                              |
| 10  | How do I set up a reverb on a send?                      | `route-audio-via-send-effects-lgcp8ea0091c`               |
| 11  | How do I make a summing stack / subgroup?                | `create-mix-subgroups-lgcp8e8310ed`                       |
| 12  | How do VCA faders work?                                  | `use-vca-groups-lgcp4d50f425`                             |
| 13  | What is the difference between Read, Touch and Latch?    | `choose-automation-modes-lgcpb1a6ab26`                    |
| 14  | How do I measure LUFS loudness?                          | `loudness-meter-lgce12d9d256`                             |
| 15  | How do I comp the best takes together?                   | `comping-overview-lgcp317d758e`                           |
| 16  | How do I quantize MIDI notes?                            | `quantize-the-timing-of-notes-lgcpfa6e7f80`               |
| 17  | How do I add a Session Player and pick its style?        | `choose-a-session-player-type-and-style-lgcp9cf380ab`     |
| 18  | How do I export a Dolby Atmos ADM BWF?                   | `export-a-spatial-audio-project-dolby-atmos-lgcp258ed132` |
| 19  | Can I get a printable list of key commands?              | `copy-and-print-key-commands-lgcpeabb4c40`                |
| 20  | How do I remove background noise from a recording?       | `denoiser-overview-lgcef2cbe4bd`                          |

### Follow-ups

- SPIKE-011: answer open questions 1 to 6 above.
- Mac check: Help bundle layout and `HPDBookRemoteURL`, key command clipboard / export format, reading
  the installed Logic version.
- After SPIKE-011: build `research/002-docs-search/` with BM25 over an allowed corpus and run the 20
  questions.
