# SPIKE-011: Legal, licensing and compliance review

Issue: [#11](https://github.com/brandonapol/clogic/issues/11)

## Question

What legal requirements, licences and terms apply to building and distributing this plugin, and what
must change in the plan to comply?

## Why it matters

The plugin touches Apple's software and trademarks, bundles third-party binaries, sends user data to
third-party AI providers, and may reverse engineer undocumented formats. Any of these can block
distribution if found late.

This spike gathers facts and open questions. It is not legal advice; anything flagged as high risk goes
to a qualified lawyer before release.

## Timebox

1.5 days

## Investigate

Ticked items have research findings below. Unticked items still need an owner decision, a lawyer, or a
Mac.

### Naming and trademarks

- [x] Apple's trademark guidelines for "Logic Pro" and "Logic": can the product name, plugin name, or
      marketing reference Logic, and in what form ("for Logic Pro" vs. "Logic ...")? Assess the name
      "clogic".
- [x] "Mackie Control" and "HUI" trademarks when describing control surface emulation (SPIKE-004).
- [x] Provider trademarks (Claude, OpenAI / Codex, Grok) when naming supported providers in the UI.

### Apple terms

- [x] Logic Pro licence agreement: anything restricting automation, UI scripting, or third-party control.
      (Only the 2013 Logic Pro X SLA is published; the current in-app licence still needs reading on a
      Mac.)
- [x] Apple Developer Program License Agreement: requirements for signing, notarisation and
      distributing outside the Mac App Store.
- [x] Audio Unit SDK / AUv3 terms.
- [x] Apple website and documentation terms of use for fetching, caching or indexing the Logic Pro User
      Guide (SPIKE-002).

### Reverse engineering

- [x] Legality and terms risk of parsing `.logicx` project data (SPIKE-006) and of Logic's control
      surface / OSC protocols (SPIKE-004), including differences between the US (DMCA interoperability
      exemption) and EU (Software Directive Art. 6) if distributing in both.

### Third-party licences

- [ ] ffmpeg: LGPL vs. GPL build options and the obligations for each when bundling a binary (source
      offer, notices, dynamic vs. static linking). Pick a build configuration. (Researched; build
      configuration **proposed**, not decided.)
- [x] JUCE: licence tiers (AGPL vs. commercial) and what our choice forces on the rest of the code
      (SPIKE-007).
- [ ] All npm dependencies: automated licence audit in CI, with an allow list. (Current tree audited
      by hand; CI job proposed, not added, because `.github/workflows/` is out of scope here.)
- [ ] Choose this repository's own licence (MIT, Apache-2.0, proprietary, ...), considering the above.
      (Options and a recommendation below; owner decision.)

### AI providers

- [x] Anthropic, OpenAI and xAI terms for bring-your-own-key apps: are we allowed to ship a client that
      uses the user's own key? Any branding, attribution or usage policy requirements?
- [x] Data handling: what each provider retains or trains on when we send prompts, analysis reports or
      audio. What we must disclose to users.
- [x] Copyright and ownership of AI-generated suggestions, presets or scripts (generally low risk, but
      document the position).

### Privacy and data protection

- [x] What user data leaves the machine (prompts, track names, analysis data, audio clips) and to whom.
- [x] Privacy policy requirement for distribution, and GDPR / UK GDPR / CCPA obligations if distributed
      to users in those regions (even for a free product).
- [x] Secure storage of API keys (Keychain) and no telemetry without opt-in consent.

### Distribution and export

- [x] US export control (EAR) classification of software that uses standard encryption (HTTPS) when
      distributed publicly.
- [x] End user licence agreement and warranty disclaimer for the installer (e.g. "the assistant may
      change your session; keep backups").
- [x] Liability position for an AI that changes a user's project (undo, confirmations, backups).

### AI-assisted ("vibe coded") development

- [x] Provenance of AI-generated code: policy for checking that generated code does not copy licensed
      code verbatim, and recording AI assistance in commits / PRs.

## Done when

- A findings table: each item rated low / medium / high risk with the required action
- A list of required files to add before any public release (LICENSE, THIRD_PARTY_NOTICES, PRIVACY,
  EULA, trademark disclaimer)
- A decision on the product name and the repository licence, or a clear list of questions for a lawyer

## Risks / unknowns

- Terms change; record the date and version of every document reviewed
- Jurisdiction depends on where the product is distributed and where the author lives

## Findings

Researched 2026-10-02 from Linux (no Mac available) with WebSearch, WebFetch, `curl` and `pdftotext`.
macOS version: n/a. Logic Pro version: n/a. Every document reviewed, with its version or date and URL, is
listed in [notes/011-sources-2026-10-02.md](./notes/011-sources-2026-10-02.md).

> **Not legal advice.** These are research notes written by an AI coding agent, not a lawyer. Risk
> ratings are a triage aid for deciding what to take to counsel, not legal conclusions. Nothing here is
> an accepted decision: names, licences and build configurations below are **proposals** for the owner
> (AGENTS.md rules 6 and 9).

**Verdict: partial (go, with conditions).** Nothing found blocks building and distributing the plugin
outside the Mac App Store with bring-your-own-key access to Anthropic, OpenAI and xAI. Two things should
change in the plan before any public release: the name "clogic" (contains Apple's "Logic" mark, and
arguably reads as "Claude + Logic"), and the Logic Remote OSC route in SPIKE-004 (undocumented,
higher reverse engineering risk than MCU / HUI). Everything else is paperwork: notices, a privacy
policy, an EULA, an LGPL-only ffmpeg build with a source offer, and a repository licence.

### Findings table

| #   | Area                                     | Risk       | Finding (short; detail below)                                                                                                                                                                                              | Required action                                                                                                                                                             |
| --- | ---------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Product name "clogic"                    | **High**   | Apple lists "Logic®" and "Logic Pro®" as trademarks and forbids using its marks "in whole or in part" in a product name. "clogic" contains "logic"; also reads as "Claude + Logic".                                        | Owner decision: rename before public release (cheap now). Lawyer: clearance search on the new name.                                                                         |
| 2   | Referring to Logic Pro                   | Low        | Referential phrases ("for", "for use with", "compatible with") are allowed if the Apple mark is less prominent than our name and implies no endorsement.                                                                   | Tagline "for Logic Pro"; trademark disclaimer in README, website, installer, About box.                                                                                     |
| 3   | Provider names in UI                     | Low        | Naming providers to identify which API the key is for is referential use. Anthropic's guidelines require pre-approval for trademark use; OpenAI forbids model names in product names.                                      | Plain-text names only ("Anthropic (Claude)", "OpenAI", "xAI (Grok)"); no logos; no provider names in our product name. Ask Anthropic (`marketing@anthropic.com`) if unsure. |
| 4   | "Mackie Control" / "HUI"                 | Low        | Mackie marks are owned by LOUD Audio. Implementing a protocol is a method of operation (17 U.S.C. §102(b); CJEU C-406/10). Registration status of "Mackie Control" / "HUI" not verified.                                   | Describe as "uses the Mackie Control protocol"; disclaimer. Do not use Mackie logos.                                                                                        |
| 5   | Logic Pro licence (automation, AX, keys) | Low        | The published Logic Pro X SLA (2013) has no clause against automation, key commands or third-party control. It forbids reverse engineering "the Apple Software" except where law prohibits that restriction.               | Read the in-app licence of the current Logic Pro on a Mac (SPIKE-005 / 006) and confirm.                                                                                    |
| 6   | `.logicx` parsing (SPIKE-006)            | Medium     | Reading a user's own project data is not decompiling Logic, and data formats are not protected expression (C-406/10). Risk rises if any part is encrypted or if Logic binaries are disassembled.                           | Black-box only: study files we create ourselves; never disassemble Logic, never decrypt. Read only (AGENTS.md rule 8). Lawyer if any TPM is found.                          |
| 7   | MCU / HUI emulation (SPIKE-004)          | Low        | Logic supports these surfaces as a feature; we would act as a surface over MIDI, the documented way.                                                                                                                       | None beyond #4.                                                                                                                                                             |
| 8   | Logic Remote / OSC (SPIKE-004)           | **Medium** | Undocumented; would need network traffic analysis of an Apple app and possibly bypassing pairing. DMCA §1201(f) and EU Art. 6 interoperability exceptions are narrow and conditional.                                      | Do not pursue without a lawyer. Prefer MCU / HUI and Accessibility.                                                                                                         |
| 9   | Apple docs fetching (SPIKE-002)          | **Medium** | Apple Website Terms (2009) forbid copying/republishing and any "robot, spider" or "page-scrape" access. The Logic SLA also counts accompanying "documentation" as licensed Apple Software.                                 | Link-only topic map, built by hand or with permission; no shipped index of Apple text. Lawyer / Apple for questions listed below.                                           |
| 10  | Developer ID + notarisation              | Low        | ADPLA (Aug 18, 2026) §5.3: notarisation is by upload; Apple may revoke tickets; do not claim Apple reviewed the app. Program requirements in §3.3 are scoped to App Store / TestFlight / Ad Hoc / Custom App.              | Enrol, sign every binary (AU, companion, ffmpeg), notarise. Use only documented APIs anyway.                                                                                |
| 11  | Audio Unit SDK                           | Low        | `apple/AudioUnitSDK` is Apache-2.0. AUv3 is built from system frameworks under the Xcode / ADPLA terms.                                                                                                                    | If AUv2 SDK sources are used, keep their licence and NOTICE in THIRD_PARTY_NOTICES.                                                                                         |
| 12  | ffmpeg                                   | Medium     | Default build is LGPL-2.1+; `--enable-gpl` makes the whole build GPL-2.0+; `--enable-nonfree` is not redistributable. All GPL-only parts are video filters / x86 asm; audio analysis filters are LGPL.                     | Proposal: own LGPL-only build, invoked as a separate executable, shipped with licence text, configure line and corresponding source on our download host.                   |
| 13  | JUCE                                     | Medium     | JUCE 9 is AGPLv3 or the JUCE licence (Starter free to $20k revenue / funding). The JUCE licence forbids combining JUCE with code under licences that would force JUCE's source disclosure.                                 | Feeds SPIKE-007: native AUv3 avoids this. If JUCE: AGPL forces the whole plugin to AGPL; JUCE licence constrains our repo licence. Owner decision.                          |
| 14  | npm dependencies                         | Low        | 132 installed packages: MIT 99, Apache-2.0 15, BSD-2 6, ISC 6, MPL-2.0 3 (`lightningcss`, dev only), BSD-3 2, BlueOak-1.0.0 1. No GPL / AGPL.                                                                              | Add a CI licence check with an allow list (proposal below).                                                                                                                 |
| 15  | Repository licence                       | Medium     | No LICENSE file today and `package.json` is `"private": true`: the code is "all rights reserved" by default, so contributors' rights are unclear.                                                                          | Owner decision before accepting outside contributions (options below).                                                                                                      |
| 16  | BYO API keys                             | Low        | Each provider's terms bind the key owner (the user) as Customer. None forbids using a third-party client. OpenAI forbids buying / selling / transferring keys; Anthropic forbids consumer-plan OAuth in third-party tools. | API keys only, never consumer-plan OAuth. Keys stay on the user's Mac. Never ship or share a key of ours.                                                                   |
| 17  | Provider data handling                   | Medium     | No training on API data by default (all three). Retention: Anthropic 30 days (2 years if flagged), OpenAI up to 30 days abuse logs, xAI 30 days. ZDR needs a separate agreement.                                           | Disclose per provider in the privacy policy and in-app before first send.                                                                                                   |
| 18  | Ownership of AI output                   | Low        | All three assign output rights to the Customer (the user). Purely AI-generated output may have no copyright at all (US Copyright Office, Jan 2025; Thaler v. Perlmutter, Mar 2025).                                        | State in EULA: suggestions are provided as is; the user owns what they make.                                                                                                |
| 19  | Privacy law (GDPR / UK GDPR / CCPA)      | Medium     | If data flows only from the user's Mac to the provider under the user's key, we may not be a controller at all. Any telemetry, crash reports, website analytics or a hosted proxy changes that.                            | No telemetry by default; opt-in only. Privacy policy anyway. Lawyer: confirm controller analysis.                                                                           |
| 20  | EU AI Act Art. 50                        | Low        | From 2 Aug 2026, providers of AI systems that interact with people must inform them they are interacting with AI, unless obvious.                                                                                          | Label the chat as AI in the UI. Lawyer: are we a "provider" under the Act?                                                                                                  |
| 21  | Export control (EAR)                     | Low        | HTTPS-only, mass market, publicly available software: self-classify 5D992.c; since March 2021 most mass market items need no report. Notarisation upload clause references export authorisations.                          | Record a self-classification note in the repo; do not distribute to embargoed destinations. Lawyer: confirm.                                                                |
| 22  | Liability for session changes            | **Medium** | An assistant that changes a session can cause loss. The control surfaces used act like a human pressing controls, so Logic's undo applies, but that is not guaranteed for every action.                                    | Confirm every change, show a diff, never write project files, prompt to save a backup, EULA disclaimer and limitation of liability.                                         |
| 23  | AI-assisted code provenance              | Low        | Rule 10 forbids copied code; PR template asks for AI disclosure. No tooling checks for verbatim copies.                                                                                                                    | Keep disclosure; add a note to CONTRIBUTING; consider a snippet / licence scanner later.                                                                                    |

### Naming and trademarks

**Apple.** Apple's "Guidelines for Using Apple Trademarks and Copyrights" (no date on page, fetched
2026-10-02) say third parties "may not use or register, in whole or in part, Apple, iPod, iTunes,
Macintosh, iMac, or any other Apple trademark ... as or as part of a company name, trade name, product
name, or service name except as specifically noted". Compatibility references are allowed in phrases
such as "runs on", "for use with", "for" or "compatible with", provided the Apple mark is not part of
the product name, is less prominent than it, and does not suggest endorsement. Apple's trademark list
includes "Logic®" and "Logic Pro®" (both "application program"). The ADPLA §2.6 binds developers to
these guidelines.

"clogic" contains "logic" as a part. "Logic" is also a common English word, and Apple's mark is for an
application program, which is exactly our field. Whether "clogic" is confusingly similar is a legal
question, but it fails the plain reading of "in whole or in part", and the project is marketed as a
Logic plugin, which makes the association deliberate. Separately, "c" + "logic" may read as "Claude +
Logic", which touches Anthropic's mark too.

Proposal (owner decision): pick a new name that contains no Apple or provider mark and describe the
product as "an AI mixing assistant for Logic Pro". A quick web search found no "CLOGIC" software mark
but did find "C-LOGIC" (USPTO serial 88811774, eyewear) and "3CLOGIC" (serial 90557813, telephony
software), so any new name also needs a clearance search. The Audio Unit name and manufacturer strings
shown in Logic's plugin menu must also avoid "Logic".

**Providers.** Anthropic's Trademark Guidelines (effective 1 August 2024) say its marks may be used
"only as specifically permitted by us and only in materials we approve beforehand", and must not imply
sponsorship. OpenAI's brand guidelines (page blocked to scripted fetch; quoted via search results)
allow "powered by" / "built with" phrasing and do not permit model names in product names. No xAI brand
guidance was found. Naming the provider in a settings menu so the user knows where their key goes is
ordinary referential use; logos and "official" styling are not. Note that xAI's enterprise terms now
name the contracting party "SpaceXAI".

**Mackie / HUI.** LOUD Audio, LLC (formerly LOUD Technologies) owns the Mackie marks. HUI was a joint
Mackie / Digidesign protocol from 1997. I did not confirm USPTO registrations for "Mackie Control" or
"HUI" specifically; a TSDR search is a small follow-up. Either way, describing compatibility in words is
lower risk than using any logo.

### Apple terms

**Logic Pro licence.** The only Logic Pro for Mac licence Apple publishes is the "Logic Pro X Software
License Agreement" dated 5/31/2013. Relevant points:

- §1A: "Apple Software" includes "documentation ... accompanying this License", which matters for the
  in-app Help (SPIKE-002 question 4).
- §2G "No Reverse Engineering": no copying, decompiling, reverse engineering, disassembling, deriving
  source, decrypting, modifying "the Apple Software or any services provided by the Apple Software",
  "except as and only to the extent any foregoing restriction is prohibited by applicable law".
- Nothing in the text restricts automation, key commands, control surfaces or third-party control
  (searched for "automat", "script", "third party").
- The IMPORTANT NOTE limits use to material the user has rights to; that is the user's obligation.

The licence shipped with Logic Pro 12 was not available without a Mac. Reading it (Logic Pro > About,
or the licence in the app bundle) is a follow-up for whoever runs SPIKE-005 / 006.

**Apple Developer Program License Agreement** (PDF footer dated August 18, 2026):

- §5.3 Notarized Applications for macOS: notarisation requires uploading the app for "continuous
  security checking"; Apple may revoke a ticket, after which the app "may no longer run on macOS"; we
  must not "represent that Apple has performed a security check ... or ... reviewed or approved Your
  Application". The same section says not to upload an app that "cannot be exported without prior
  written government authorization ... without first obtaining that authorization" (see Export).
- §3.3 (Program Requirements, including §3.3.1A "must not use or call any private APIs" and §3.3.3
  privacy / consent) is scoped to apps "submitted to the App Store, Custom App Distribution, or
  TestFlight, or ... distributed through Ad Hoc distribution". Developer ID distribution is not listed.
  Whether these still bind a Developer ID app is a question for counsel; we should follow them anyway.
- §2.6 forbids reverse engineering Apple Software and Services provided under the agreement (Xcode,
  SDKs), with the same "prohibited by applicable law" carve-out, and incorporates the trademark
  guidelines.

**Audio Unit SDK.** `github.com/apple/AudioUnitSDK` reports SPDX `Apache-2.0` (checked with
`gh api repos/apple/AudioUnitSDK`, last push 2026-09-25). Use is fine; keep the licence and any NOTICE.
AUv3 uses only system frameworks under the Xcode / ADPLA terms; no separate AU licence was found.

**Apple website terms (SPIKE-002 questions).** The Apple Website Terms of Use ("Updated ... Nov. 20,
2009") prohibit copying, republishing or "mirroring" content and any "'deep-link', 'page-scrape',
'robot', 'spider' or other automatic device ... to access, acquire, copy or monitor any portion of the
Site". My reading of SPIKE-002's open questions, for counsel to confirm:

1. A user-initiated live fetch of one page is still literally an "automatic device ... to access" the
   site. Risk medium; the clause is broad and old. Ask counsel or Apple.
2. A topic map (titles, IDs, URLs) is mostly facts, but building it by script is the scraping the
   terms name. A hand-curated map of a few hundred key topics is lower risk.
3. A user-local index of a PDF the user downloaded is closer to "personal, non-commercial" use, but
   sending excerpts to an LLM provider may be "transmitting". Short excerpts on a user's own request
   are the most defensible form. Counsel.
4. The Logic SLA §1A covers accompanying documentation as "Apple Software", so the SLA (not the website
   terms) likely governs in-app Help. The SLA gives no right to copy or extract it.
5. Free vs. paid matters to the "personal, non-commercial" exception for the user, not for us.
6. No developer or partner channel for documentation permission was found. Apple's legal contact for
   trademark questions is on the guidelines page.

### Reverse engineering

- **US.** 17 U.S.C. §1201(f) lets a person who lawfully obtained a program circumvent a technological
  measure "for the sole purpose" of identifying elements needed for interoperability of an
  independently created program, and share the results only for that purpose. It is an exception to
  anti-circumvention, not to the licence contract: the SLA's §2G restriction still applies unless law
  prohibits it, and US courts often enforce such clauses. 17 U.S.C. §102(b) excludes any "procedure,
  process, system, method of operation" from copyright.
- **EU.** Directive 2009/24/EC Art. 6 permits decompilation without authorisation where "indispensable
  to obtain the information necessary to achieve the interoperability of an independently created
  computer program", limited to the parts necessary, and Art. 8 makes contract terms contrary to Art. 6
  or Art. 5(2)–(3) "null and void". Art. 5(3) lets a lawful user observe, study or test the program to
  determine its underlying ideas. CJEU C-406/10 SAS Institute v World Programming (2 May 2012): neither
  functionality, programming language nor "the format of data files" is a protected form of expression.
  (EUR-Lex refused scripted fetches; text checked via legislation.gov.uk copies and search summaries.)
- **Applied.** `.logicx` parsing of the user's own files by observation (create a project, change one
  thing, diff) is the lowest-risk method. Disassembling Logic to find the format is not needed and
  should be ruled out. OSC / Logic Remote would need protocol analysis of Apple software; if pairing or
  encryption is involved, §1201 applies. Keep it out of scope unless counsel says otherwise.

### Third-party licences

**ffmpeg.** `ffmpeg.org/legal.html` and `LICENSE.md` (master, fetched 2026-10-02): FFmpeg is LGPL-2.1+
by default; `--enable-gpl` switches the whole build to GPL-2.0+; `--enable-nonfree` makes it
unredistributable. Every GPL-only part is a video filter, x86 asm, or a build / test tool. Audio filters
we are likely to use (`ebur128`, `astats`, `volumedetect`, `loudnorm`) are not on the GPL list, so an
LGPL build should suffice for SPIKE-001. External libraries (for example libx264, GPL; LAME, LGPL) change
the picture and should be avoided or listed.

We plan to run ffmpeg as a separate executable, not link its libraries. Shipping an LGPL binary still
counts as distributing it in object form: LGPL-2.1 §4 requires accompanying it with the corresponding
source, or offering equivalent access to the source from the same place as the binary. The FFmpeg
checklist (written for linking) adds: no `--enable-gpl` / `--enable-nonfree`, ship source matching the
binaries exactly plus `changes.diff` and the configure line, host source next to the binary, credit
FFmpeg under LGPLv2.1 on download pages, in the About box and in the EULA, do not claim ownership,
remove reverse engineering bans from the EULA, and spell it "FFmpeg". Also: credit the IJG if the libjpeg
files are included.

Proposal (owner decision, feeds SPIKE-010): build ffmpeg ourselves from a pinned release with the
default LGPL configuration (no `--enable-gpl`, no `--enable-nonfree`, `--disable-network`, minimal audio
decoders and filters, no external libraries), record `ffmpeg -buildconf` in the repo, ship the binary as
a separate signed executable, and publish the source tarball, diff and configure line on the same
release page. Do not ship a third-party prebuilt binary without checking its `-buildconf`, since many
are GPL builds. Patents: FFmpeg's own patent FAQ says it cannot say which algorithms are patented; I
did not research codec patents. Counsel if we decode lossy formats (AAC, MP3) rather than only WAV /
AIFF / FLAC.

**JUCE.** The JUCE `LICENSE.md` (fetched 2026-10-02) says modules are dual-licensed AGPLv3 or the JUCE 9
licence (effective 17 June 2026). Tiers: Starter free up to $20,000 annual revenue or funding; Indie up
to $300,000 ($40/month or $800); Pro unlimited ($175/month or $3,500). No splash screen requirement was
found. The JUCE licence forbids using JUCE in a way that makes it, or software combined or distributed
with it, subject to licences requiring source disclosure, derivative works, or free redistribution.
Consequences:

- AGPL route: the plugin (and anything combined with it) must be AGPL; source must be offered to users.
- JUCE licence route: our own code can be permissive or proprietary, but cannot be copyleft, and every
  contributor or forker who builds the plugin needs their own JUCE licence.
- Native AUv3 (Swift / AudioToolbox, SPIKE-007) avoids both.

**npm.** Hand audit of `node_modules` on 2026-10-02 (Node v26.8.2, npm 11.19.1): 132 packages; MIT 99,
Apache-2.0 15, BSD-2-Clause 6, ISC 6, MPL-2.0 3 (`lightningcss` and two platform binaries, pulled in
by Vitest, dev only), BSD-3-Clause 2, BlueOak-1.0.0 1 (`minimatch`). All are dev dependencies and none
are shipped. Proposal for a CI step (needs a workflow change and a new dev dependency, so owner
approval under rules 9 and 11): `license-checker-rseidelsohn --production --onlyAllow
"MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0"`, with MPL-2.0 allowed for dev only.

**Repository licence (owner decision).** Options:

| Option      | Fits with                            | Notes                                                                                        |
| ----------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Apache-2.0  | Native AU, LGPL ffmpeg, JUCE licence | Explicit patent grant and NOTICE handling. **Recommended** if the project stays public.      |
| MIT         | Same                                 | Simplest; no patent grant.                                                                   |
| AGPL-3.0    | Required if JUCE is used under AGPL  | Strong copyleft; any distributor must offer source.                                          |
| Proprietary | Paid product, JUCE licence           | Then the public repo needs a clear "all rights reserved" notice and a CLA for contributions. |

Until a LICENSE file exists, outside contributions should not be accepted.

### AI providers

All three providers' API terms make the key holder the "Customer". In a bring-your-own-key app the user
is the Customer and we are software they run, not a party to their agreement.

- **Anthropic** Commercial Terms (effective June 17, 2025): "Anthropic may not train models on Customer
  Content from Services"; the Customer owns Outputs; no reselling or building a competing product;
  Customer "is responsible for all activity under its account". Retention (privacy.claude.com, dated
  July 1, 2026): inputs and outputs deleted within 30 days; up to 2 years (and safety scores up to 7
  years) if flagged for Usage Policy violations; ZDR by custom agreement. Since January / February
  2026 Anthropic forbids using Free / Pro / Max OAuth tokens in third-party tools: support API keys only.
- **OpenAI** Services Agreement (`ONLINE v.010126`): Customer owns Output; OpenAI "will not use Customer
  Content to develop or improve the Services" unless the Customer agrees; Customer will not "buy, sell,
  or transfer API keys from, to, or with a third party" or share credentials between users; minors need
  parental consent. API data guide: abuse monitoring logs kept "for up to 30 days"; ZDR and Modified
  Abuse Monitoring for approved customers. `openai.com/policies/*` returned 403 to scripted fetches; the
  PDF at `cdn.openai.com/osa/openai-services-agreement.pdf` was read instead.
- **xAI** Enterprise Terms of Service ("Last Updated: August 14, 2026", contracting party "SpaceXAI"):
  will not use User Content to train models "subject to disclosures to Customer and Customer-controlled
  user settings"; Customer owns Output; content deleted within 30 days, or almost immediately with ZDR;
  Customer must not submit personal data except through the ZDR-enabled API; Customer must not
  "misrepresent that any Output was human-generated".

Implications: never ship our own key; keep the key in the Keychain on the user's Mac and send it only
to the provider's API host; link each provider's terms and privacy pages in settings; tell the user that
their provider account terms apply. The xAI personal-data clause is awkward: track names, notes or
filenames could be personal data. Counsel should look at it, and the UI should say what is sent.

**Ownership of AI output.** All three assign any rights in output to the Customer. In the US, purely
AI-generated material is not copyrightable (Copyright Office report Part 2, January 29, 2025; Thaler v.
Perlmutter, D.C. Cir., March 18, 2025), though human selection and arrangement can be. For mix advice
and parameter values this is low risk; say in the EULA that suggestions carry no warranty and that the
user owns their music and their decisions.

### Privacy and data protection

Data that may leave the Mac, all sent directly to the provider the user chose, under the user's key:

| Data                                    | Likely personal data?                    | Notes                                                        |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Chat prompts                            | Possibly (free text)                     | Whatever the user types.                                     |
| Track, region, project and file names   | Possibly (names of people, artists)      | Often contain names; send only when needed.                  |
| Analysis reports (LUFS, spectra, peaks) | No, on their own                         | Numbers derived from audio.                                  |
| Audio clips (if ever sent)              | Possibly (voices are biometric-adjacent) | Highest sensitivity; require explicit per-send confirmation. |
| Logic documentation excerpts            | No                                       | See SPIKE-002 terms questions.                               |
| API key                                 | Credential                               | Keychain only; never logged; only sent to provider host.     |

GDPR Art. 3(2) applies to controllers outside the EU that offer goods or services to people in the EU,
"irrespective of whether a payment ... is required". A controller is whoever "determines the purposes
and means of the processing" (Art. 4(7)). If clogic runs entirely on the user's Mac and sends data only
to a provider under the user's own account, the developer arguably processes no personal data and is
not a controller; the user is the provider's customer. That reading is plausible but untested, and CJEU
case law on joint controllership for embedded tools (e.g. Fashion ID, C-40/17) is broad. It stops
holding the moment we add telemetry, crash reporting, update checks that log IPs, website analytics, or
a hosted proxy. UK GDPR mirrors this. CCPA applies only to for-profit "businesses" over thresholds
($26,625,000 revenue from 1 January 2025, or 100,000+ consumers' data bought, sold or shared, or 50%
revenue from selling data), so it does not apply to a small free project.

Proposals: no telemetry, crash reporting or analytics by default, and only with opt-in consent; a short
privacy policy anyway (it is cheap, sets expectations, and is needed the day any of the above changes);
in-app notice before the first send to each provider, naming what is sent and linking that provider's
data policy; a visible indicator if audio is ever uploaded (mirrors ADPLA §3.3.3A for recordings);
redaction option for track names.

**EU AI Act.** Art. 50(1), applying from 2 August 2026: "Providers shall ensure that AI systems intended
to interact directly with natural persons are designed and developed in such a way that the natural
persons concerned are informed that they are interacting with an AI system", unless obvious. A chat
window labelled as an AI assistant meets this. Whether a BYO-key client is a "provider" of an AI system
under the Act is a counsel question; the label is cheap either way.

### Distribution and export

**EAR.** BIS guidance: mass market encryption object code that is made "publicly available" (a free app
counts) is not subject to the EAR once classified as 5D992.c, and the March 29, 2021 rule removed the
annual self-classification report for most mass market items. Note BIS also says an item is not publicly
available "merely because it incorporates or calls to publicly available open source code"; the item is
evaluated as a whole. clogic only uses HTTPS from the operating system for authentication and
transport, which is the ordinary mass market case. Proposal: keep a one-page self-classification note
(5D992.c, mass market, publicly available) in `docs/decisions` and confirm with counsel whether any
filing is needed. This also answers the ADPLA §5.3 upload clause.

**EULA and warranty.** A short EULA (or the repository licence plus a disclaimer, if open source) should
cover: as-is, no warranty; limitation of liability; the assistant can change session settings, only
with confirmation, and the user should keep backups; AI output may be wrong; provider terms apply to the
user's key; FFmpeg LGPL notice and no reverse engineering ban (FFmpeg checklist); trademark disclaimer;
export compliance. Consumer law in the EU and UK limits how far liability can be excluded, so the
drafting needs counsel.

**Liability for session changes.** Engineering controls matter more than the EULA: confirmation before
every change, a preview of what will change, read-only project access (AGENTS.md rule 8), changes only
through control surfaces or Accessibility (which Logic's undo history should capture, to verify in
SPIKE-004 / 005), a "save a copy first" prompt, and a log of every action the assistant took.

### AI-assisted development

Rule 10 (no copied code without a compatible licence and credit) and the PR template's AI disclosure
already cover the policy. Gaps: no tooling to detect verbatim copies, and no guidance on what
contributors should do when an assistant emits a long block that looks familiar. Proposals: add a
CONTRIBUTING note ("if generated code looks like it came from a known project, find the source and treat
it as copied code"); keep `Co-Authored-By` / disclosure in PRs; consider a code-snippet licence scanner
before release. Copyright in largely AI-written code may be thin (see Ownership above), which slightly
weakens any licence we choose; this is another reason to keep meaningful human review and edits.

### Files to add before any public release

| File                     | Contents                                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE`                | The chosen repository licence.                                                                                                                                                                                                |
| `NOTICE` (if Apache-2.0) | Project notice.                                                                                                                                                                                                               |
| `THIRD_PARTY_NOTICES.md` | FFmpeg (LGPL-2.1+ text, version, configure line, source link), AudioUnitSDK (Apache-2.0) if used, JUCE if used, runtime npm packages.                                                                                         |
| `PRIVACY.md`             | What is sent, to whom, retention per provider with links, no telemetry by default, Keychain storage, contact.                                                                                                                 |
| `EULA.md` (installer)    | As above. Shown by the `.pkg` installer (SPIKE-010).                                                                                                                                                                          |
| `TRADEMARKS.md`          | "Logic and Logic Pro are trademarks of Apple Inc., registered in the U.S. and other countries. This product is not affiliated with or endorsed by Apple, Anthropic, OpenAI, xAI or LOUD Audio (Mackie)." Plus provider marks. |
| `docs/decisions/`        | ADRs for: product name, repository licence, ffmpeg build configuration, export self-classification, JUCE vs. native AU.                                                                                                       |

### Questions for the owner

1. Rename the product before public release? If yes, the new name (then a clearance search).
2. Free and open source, or paid / closed? This drives the licence, JUCE tier, EULA and CCPA position.
3. Repository licence: Apache-2.0 (recommended), MIT, AGPL-3.0 or proprietary.
4. Native AUv3 or JUCE (SPIKE-007), knowing the licence consequences above.
5. Accept the proposed LGPL-only ffmpeg build and the source-hosting duty that comes with it.
6. Which regions to distribute to (EU / UK / US only, or worldwide).
7. Drop the Logic Remote / OSC route from SPIKE-004 unless counsel clears it.
8. Approve adding a licence-checker dev dependency and CI step.

### Questions for a lawyer

1. Is "clogic" (or the replacement name) likely to infringe Apple's "Logic" mark or Anthropic's
   "Claude" mark? Clearance search for the replacement.
2. Do ADPLA §3.3 program requirements (private APIs, privacy consent) bind an app distributed only with
   Developer ID and notarisation?
3. Is a user-initiated, one-page live fetch of the Logic Pro User Guide an "automatic device" under the
   Apple Website Terms? Can we ship a hand-built topic map of titles and URLs? Can a user-local index of
   a guide the user downloaded send short excerpts to an LLM provider?
4. How enforceable is Logic SLA §2G against black-box analysis of `.logicx` files in the US, and does
   EU Art. 5(3) / 6 cover it?
5. Are we a GDPR controller (alone or jointly) if all processing is user's Mac → provider under the
   user's key, and no data reaches us? What changes with opt-in crash reports?
6. Does the xAI terms' ban on personal data outside the ZDR API mean the app must warn or block users
   who choose xAI and include names in prompts?
7. Are we a "provider" under the EU AI Act, and does Art. 50 need more than a UI label?
8. Is any EAR filing needed for a free, HTTPS-only macOS app, and does it satisfy ADPLA §5.3?
9. EULA drafting: how far can liability be limited for EU / UK consumers for an assistant that changes
   a session?
10. Patent exposure for decoding AAC / MP3 via a bundled FFmpeg, if those formats are supported.
