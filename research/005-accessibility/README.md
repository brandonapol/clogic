# SPIKE-005 Mac checks

Throwaway scripts for a human with a Mac and Logic Pro. Not imported by `src/`. See the Findings of
[SPIKE-005](../../docs/research/005-accessibility-automation.md) for what each check answers and where
to record results.

None of these scripts was run when they were written (2026-10-02, Linux only). Treat the first run as
part of the experiment: if a script fails, record the error, it is evidence too.

Work on a **copy** of a test project, never on real work (AGENTS.md rule 8). The scripts only read the
UI, open dialogs after asking, and watch a folder. Nothing here clicks Save, Bounce or OK.

## Setup

1. Duplicate a small test project in Finder and open the copy in Logic Pro.
2. Run from Terminal. macOS will ask to give Terminal Accessibility permission (System Settings >
   Privacy & Security > Accessibility). Grant it for the test, and note that the prompt names
   **Terminal**, not the script: this is the "responsible process" issue described in the Findings.
3. The first System Events call also asks for Automation permission (Terminal to control System
   Events). Note the wording.

## Checks

```sh
cd research/005-accessibility

./env.sh > env.txt                                          # A1, A2, A9: versions, sandbox, sdef, licence
osascript menu-dump.applescript > menus.txt                 # A3: menu paths
osascript ax-dump.applescript 6 > ax-main.txt               # A4: main window tree
# open the Mixer (X), then:
osascript ax-dump.applescript 8 > ax-mixer.txt              # A4
# open a Channel EQ plug-in window, then:
osascript ax-dump.applescript 8 > ax-plugin.txt             # A5
mkdir -p ~/Desktop/clogic-005-out
osascript open-export-dialog.applescript export             # A6: confirm, then the dialog opens
osascript ax-dump.applescript 10 > ax-export-dialog.txt     # A6: dialog controls
# in the dialog: untick "Add resulting files to Project Audio Browser", choose ~/Desktop/clogic-005-out,
# click Save yourself, and at the same time in a second terminal:
./watch-folder.sh ~/Desktop/clogic-005-out 900              # A7: read-back
osascript open-export-dialog.applescript bounce             # A6 for File > Bounce
```

For A8, repeat `ax-dump` and `menu-dump` with Logic running in German or French: System Settings >
General > Language & Region > Applications, add Logic Pro with another language, relaunch Logic, and
remove the override afterwards.

Attach the `.txt` outputs (they contain track names; redact if needed) to the issue, and fill in the
table in the spike's Findings.
