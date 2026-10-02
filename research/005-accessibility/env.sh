#!/bin/sh
# Records the environment for SPIKE-005 findings. Read only: changes nothing.
set -u

app="${LOGIC_APP:-/Applications/Logic Pro.app}"

echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "macOS: $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
echo "arch: $(uname -m)"
echo "Logic app: $app"
echo "Logic version: $(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null)"
echo "Logic bundle id: $(defaults read "$app/Contents/Info" CFBundleIdentifier 2>/dev/null)"
echo "Logic NSAppleScriptEnabled: $(defaults read "$app/Contents/Info" NSAppleScriptEnabled 2>/dev/null || echo unset)"
echo "Logic OSAScriptingDefinition: $(defaults read "$app/Contents/Info" OSAScriptingDefinition 2>/dev/null || echo unset)"
echo "System language order: $(defaults read -g AppleLanguages 2>/dev/null | tr -d '\n ')"

echo
echo "--- Logic entitlements (is it sandboxed? com.apple.security.app-sandbox)"
codesign -d --entitlements - "$app" 2>/dev/null

echo
echo "--- Logic scripting dictionary (sdef); empty or error means none"
sdef "$app" 2>&1 | head -80

echo
echo "--- Licence files in the app bundle (for SPIKE-011 row 5)"
find "$app/Contents/Resources" -maxdepth 2 -iname '*licen*' 2>/dev/null | head -20
