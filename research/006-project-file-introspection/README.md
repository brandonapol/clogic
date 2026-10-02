# SPIKE-006 `.logicx` inspector

Throwaway, read-only prototype for [SPIKE-006](../../docs/research/006-project-file-introspection.md).
Not imported by `src/`. Python 3 standard library only (`plistlib`, `hashlib`); no dependencies.

```sh
python3 -B research/006-project-file-introspection/inspect_logicx.py "/path/to/Song.logicx"
cd research/006-project-file-introspection && python3 -B -m unittest -v test_inspect_logicx
```

It prints JSON with:

- `Resources/ProjectInformation.plist`: `LastSavedFrom`, `BundleVersion`, `VariantNames`.
- For each `Alternatives/NNN/`: the known `MetaData.plist` keys (tempo, sample rate, track count, key,
  time signature), basenames of the file lists (audio, Sampler, impulse responses), and any keys it
  does not recognise.
- For each `ProjectData`: size, whether it starts with `23 47 c0 ab`, counts of reversed four-character
  tags (`karT`, `qeSM`, ...), Audio Unit `type/subtype/manufacturer` triples found by the anchor
  heuristic, and a raw count of the `GAME` stock plug-in anchor.

It never opens anything for writing. It hashes every file in the bundle (size, mtime, SHA-256) before
and after reading and exits 1 with `"readOnlyCheck": "CHANGED"` if anything differs. Close the project
in Logic first; Logic may write to the bundle while it is open.

The tests build a synthetic bundle in a temp directory. No Logic project files are committed. The
heuristics come from published community notes, cited in the spike, not from any copied code.
