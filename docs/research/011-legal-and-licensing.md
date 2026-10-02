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

### Naming and trademarks

- [ ] Apple's trademark guidelines for "Logic Pro" and "Logic": can the product name, plugin name, or
      marketing reference Logic, and in what form ("for Logic Pro" vs. "Logic ...")? Assess the name
      "clogic".
- [ ] "Mackie Control" and "HUI" trademarks when describing control surface emulation (SPIKE-004).
- [ ] Provider trademarks (Claude, OpenAI / Codex, Grok) when naming supported providers in the UI.

### Apple terms

- [ ] Logic Pro licence agreement: anything restricting automation, UI scripting, or third-party control.
- [ ] Apple Developer Program License Agreement: requirements for signing, notarisation and
      distributing outside the Mac App Store.
- [ ] Audio Unit SDK / AUv3 terms.
- [ ] Apple website and documentation terms of use for fetching, caching or indexing the Logic Pro User
      Guide (SPIKE-002).

### Reverse engineering

- [ ] Legality and terms risk of parsing `.logicx` project data (SPIKE-006) and of Logic's control
      surface / OSC protocols (SPIKE-004), including differences between the US (DMCA interoperability
      exemption) and EU (Software Directive Art. 6) if distributing in both.

### Third-party licences

- [ ] ffmpeg: LGPL vs. GPL build options and the obligations for each when bundling a binary (source
      offer, notices, dynamic vs. static linking). Pick a build configuration.
- [ ] JUCE: licence tiers (AGPL vs. commercial) and what our choice forces on the rest of the code
      (SPIKE-007).
- [ ] All npm dependencies: automated licence audit in CI, with an allow list.
- [ ] Choose this repository's own licence (MIT, Apache-2.0, proprietary, ...), considering the above.

### AI providers

- [ ] Anthropic, OpenAI and xAI terms for bring-your-own-key apps: are we allowed to ship a client that
      uses the user's own key? Any branding, attribution or usage policy requirements?
- [ ] Data handling: what each provider retains or trains on when we send prompts, analysis reports or
      audio. What we must disclose to users.
- [ ] Copyright and ownership of AI-generated suggestions, presets or scripts (generally low risk, but
      document the position).

### Privacy and data protection

- [ ] What user data leaves the machine (prompts, track names, analysis data, audio clips) and to whom.
- [ ] Privacy policy requirement for distribution, and GDPR / UK GDPR / CCPA obligations if distributed
      to users in those regions (even for a free product).
- [ ] Secure storage of API keys (Keychain) and no telemetry without opt-in consent.

### Distribution and export

- [ ] US export control (EAR) classification of software that uses standard encryption (HTTPS) when
      distributed publicly.
- [ ] End user licence agreement and warranty disclaimer for the installer (e.g. "the assistant may
      change your session; keep backups").
- [ ] Liability position for an AI that changes a user's project (undo, confirmations, backups).

### AI-assisted ("vibe coded") development

- [ ] Provenance of AI-generated code: policy for checking that generated code does not copy licensed
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

_TBD_
