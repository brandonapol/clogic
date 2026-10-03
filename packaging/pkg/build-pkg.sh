#!/usr/bin/env bash
# Skeleton: stage, sign, package, notarise and staple the clogic installer (SPIKE-010).
# UNVERIFIED: no step below has run on a Mac. See packaging/README.md and MAC-39..44 in
# docs/research/mac-checklist.md. Signing identities and the notary profile come from the environment
# only; never write them into this file.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

# shellcheck source=packaging/lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

readonly MACOS_MIN="15.6"
readonly APP_NAME="clogic.app"
readonly COMPONENT_NAME="clogic.component"
readonly APP_INSTALL_LOCATION="/Applications"
readonly COMPONENT_INSTALL_LOCATION="/Library/Audio/Plug-Ins/Components"
readonly COMPANION_ENTITLEMENTS="$SCRIPT_DIR/entitlements/companion.entitlements"
PACKAGING_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly PACKAGING_DIR
readonly FFMPEG_ASSERT="$PACKAGING_DIR/ffmpeg/assert-lgpl.sh"

readonly REQUIRED_SECRETS=(
  CLOGIC_DEVELOPER_ID_APPLICATION
  CLOGIC_DEVELOPER_ID_INSTALLER
  CLOGIC_NOTARY_PROFILE
)
readonly REQUIRED_INPUTS=(
  CLOGIC_PKG_ID_PREFIX
  CLOGIC_VERSION
  CLOGIC_APP
  CLOGIC_COMPANION_BIN
  CLOGIC_FFMPEG_DIR
)

LOG_PREFIX="build-pkg"
DRY_RUN=0
NOTARIZE=1

usage() {
  cat <<EOF
usage: $(basename "$0") [--dry-run] [--skip-notarize] [--help]

UNVERIFIED skeleton. Builds a Developer ID signed, notarised and stapled flat .pkg containing
${APP_NAME} (with the companion and LGPL ffmpeg inside) and, optionally, an AUv2 ${COMPONENT_NAME}.

  --dry-run         print every command without running it; missing variables print as <NAME>
  --skip-notarize   sign and package only (local test builds)
  --help            show this help

Signing (read from the environment, never from this file):
  CLOGIC_DEVELOPER_ID_APPLICATION  codesign identity, "Developer ID Application: <name> (<team id>)"
  CLOGIC_DEVELOPER_ID_INSTALLER    productbuild identity, "Developer ID Installer: <name> (<team id>)"
  CLOGIC_NOTARY_PROFILE            keychain profile saved with: xcrun notarytool store-credentials

Inputs:
  CLOGIC_PKG_ID_PREFIX   reverse-DNS prefix for package identifiers (product name not decided yet)
  CLOGIC_VERSION         version string for the packages
  CLOGIC_APP             path to the built ${APP_NAME}
  CLOGIC_COMPANION_BIN   path to the companion single executable (Node SEA)
  CLOGIC_FFMPEG_DIR      OUT_DIR of packaging/ffmpeg/build-lgpl-ffmpeg.sh
  CLOGIC_COMPONENT       optional path to an AUv2 ${COMPONENT_NAME} (SPIKE-007 fallback)
  WORK                   scratch and output directory (default: a new mktemp -d)
EOF
}

value_of() {
  local name="$1"
  local value="${!name:-}"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '<%s>' "$name"
  fi
}

require_env() {
  local missing=()
  local name
  for name in "${REQUIRED_SECRETS[@]}" "${REQUIRED_INPUTS[@]}"; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    die "missing environment variables: ${missing[*]} (see --help)"
  fi
}

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "needs macOS with Xcode command line tools; use --dry-run elsewhere"
  fi
}

sign_code() {
  local identity="$1"
  shift
  run codesign --sign "$identity" --force --timestamp --options runtime "$@"
}

distribution_xml() {
  local prefix="$1" version="$2" with_component="$3"
  cat <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>clogic</title>
  <options customize="never" require-scripts="false" hostArchitectures="arm64"/>
  <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
  <allowed-os-versions>
    <os-version min="${MACOS_MIN}"/>
  </allowed-os-versions>
  <!-- PLACEHOLDER: EULA from SPIKE-011, e.g. <license file="LICENSE.rtf"/>; must not ban reverse engineering of ffmpeg (ADR 0003). -->
  <choices-outline>
    <line choice="default">
      <line choice="${prefix}.app"/>
EOF
  if [[ "$with_component" -eq 1 ]]; then
    printf '      <line choice="%s.component"/>\n' "$prefix"
  fi
  cat <<EOF
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="${prefix}.app" visible="false">
    <pkg-ref id="${prefix}.app"/>
  </choice>
  <pkg-ref id="${prefix}.app" version="${version}" onConclusion="none">app.pkg</pkg-ref>
EOF
  if [[ "$with_component" -eq 1 ]]; then
    cat <<EOF
  <choice id="${prefix}.component" visible="false">
    <pkg-ref id="${prefix}.component"/>
  </choice>
  <pkg-ref id="${prefix}.component" version="${version}" onConclusion="none">component.pkg</pkg-ref>
EOF
  fi
  echo "</installer-gui-script>"
}

write_file() {
  local path="$1"
  local content="$2"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '+ write %s <<EOF\n%s\nEOF\n' "$(quote_arg "$path")" "$content"
  else
    printf '%s\n' "$content" >"$path"
  fi
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --skip-notarize) NOTARIZE=0 ;;
      --help | -h)
        usage
        exit 0
        ;;
      *)
        usage >&2
        exit 2
        ;;
    esac
    shift
  done

  local work
  if [[ "$DRY_RUN" -eq 1 ]]; then
    work="${WORK:-<WORK>}"
  else
    require_macos
    require_env
    work="${WORK:-$(mktemp -d)}"
  fi

  local app_identity installer_identity notary_profile
  app_identity="$(value_of CLOGIC_DEVELOPER_ID_APPLICATION)"
  installer_identity="$(value_of CLOGIC_DEVELOPER_ID_INSTALLER)"
  notary_profile="$(value_of CLOGIC_NOTARY_PROFILE)"

  local prefix version app_src companion_src ffmpeg_dir component_src
  prefix="$(value_of CLOGIC_PKG_ID_PREFIX)"
  version="$(value_of CLOGIC_VERSION)"
  app_src="$(value_of CLOGIC_APP)"
  companion_src="$(value_of CLOGIC_COMPANION_BIN)"
  ffmpeg_dir="$(value_of CLOGIC_FFMPEG_DIR)"
  component_src="${CLOGIC_COMPONENT:-}"

  local with_component=0
  if [[ -n "$component_src" ]]; then
    with_component=1
  fi

  local stage_app="$work/stage/app"
  local stage_component="$work/stage/component"
  local app="$stage_app/$APP_NAME"
  local helpers="$app/Contents/Helpers"
  local notices="$app/Contents/Resources/ThirdParty/FFmpeg"
  local component="$stage_component/$COMPONENT_NAME"
  local pkgs="$work/pkgs"
  local out_pkg="$work/clogic-$version.pkg"

  log "1/8 stage component layout in $work/stage"
  run rm -rf "$work/stage" "$pkgs"
  run mkdir -p "$stage_app" "$pkgs"
  run ditto "$app_src" "$app"
  run mkdir -p "$helpers" "$notices"
  run ditto "$companion_src" "$helpers/clogic-companion"
  run ditto "$ffmpeg_dir/ffmpeg" "$helpers/ffmpeg"
  run ditto "$ffmpeg_dir/ffprobe" "$helpers/ffprobe"
  run ditto "$ffmpeg_dir/COPYING.LGPLv2.1" "$notices/COPYING.LGPLv2.1"
  run ditto "$ffmpeg_dir/SOURCE-OFFER.txt" "$notices/SOURCE-OFFER.txt"
  run ditto "$ffmpeg_dir/ffmpeg-buildconf.txt" "$notices/ffmpeg-buildconf.txt"
  if [[ "$with_component" -eq 1 ]]; then
    run mkdir -p "$stage_component"
    run ditto "$component_src" "$component"
  fi

  log "2/8 check the bundled ffmpeg is LGPL"
  run "$FFMPEG_ASSERT" "$helpers/ffmpeg" "$helpers/ffprobe"

  log "3/8 sign inside out: helpers, then the app, then the component (no --deep)"
  sign_code "$app_identity" "$helpers/ffmpeg"
  sign_code "$app_identity" "$helpers/ffprobe"
  sign_code "$app_identity" --entitlements "$COMPANION_ENTITLEMENTS" "$helpers/clogic-companion"
  sign_code "$app_identity" "$app"
  if [[ "$with_component" -eq 1 ]]; then
    run codesign --sign "$app_identity" --force --timestamp "$component"
  fi

  log "4/8 verify signatures"
  run codesign --verify --strict --deep --verbose=2 "$app"
  run codesign --display --entitlements - "$helpers/clogic-companion"
  if [[ "$with_component" -eq 1 ]]; then
    run codesign --verify --strict --deep --verbose=2 "$component"
  fi

  log "5/8 component packages (BundleIsRelocatable=false)"
  run pkgbuild --analyze --root "$stage_app" "$work/app-components.plist"
  run plutil -replace 0.BundleIsRelocatable -bool NO "$work/app-components.plist"
  run pkgbuild --root "$stage_app" --component-plist "$work/app-components.plist" \
    --identifier "$prefix.app" --version "$version" \
    --install-location "$APP_INSTALL_LOCATION" "$pkgs/app.pkg"
  if [[ "$with_component" -eq 1 ]]; then
    run pkgbuild --analyze --root "$stage_component" "$work/component-components.plist"
    run plutil -replace 0.BundleIsRelocatable -bool NO "$work/component-components.plist"
    run pkgbuild --root "$stage_component" --component-plist "$work/component-components.plist" \
      --identifier "$prefix.component" --version "$version" \
      --install-location "$COMPONENT_INSTALL_LOCATION" "$pkgs/component.pkg"
  fi

  log "6/8 product archive signed with Developer ID Installer"
  write_file "$work/Distribution.xml" "$(distribution_xml "$prefix" "$version" "$with_component")"
  run productbuild --distribution "$work/Distribution.xml" --package-path "$pkgs" \
    --sign "$installer_identity" --timestamp "$out_pkg"
  run pkgutil --check-signature "$out_pkg"

  if [[ "$NOTARIZE" -eq 0 ]]; then
    log "skipping notarisation and stapling (--skip-notarize); this .pkg will not pass Gatekeeper"
    log "built $out_pkg"
    return 0
  fi

  log "7/8 notarise the outermost container only"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '+ %s > %s\n' \
      "$(print_cmd xcrun notarytool submit "$out_pkg" --keychain-profile "$notary_profile" --wait --output-format json)" \
      "$(quote_arg "$work/notary.json")"
    printf '+ require "status":"Accepted" in %s\n' "$(quote_arg "$work/notary.json")"
  else
    xcrun notarytool submit "$out_pkg" --keychain-profile "$notary_profile" --wait \
      --output-format json >"$work/notary.json"
    grep -q '"status" *: *"Accepted"' "$work/notary.json" ||
      die "notarisation not accepted; see $work/notary.json and xcrun notarytool log <id>"
  fi

  log "8/8 staple and assess"
  run xcrun stapler staple "$out_pkg"
  run xcrun stapler validate "$out_pkg"
  run spctl --assess --verbose=4 --type install "$out_pkg"
  log "built $out_pkg"
}

main "$@"
