#!/usr/bin/env bash
#
# Build, ad-hoc sign, and package HymnBeam as a universal macOS app.
#
# Produces a universal (Apple Silicon + Intel) .app and .dmg under
# src-tauri/target/universal-apple-darwin/release/bundle/.
#
# Without an Apple Developer ID this uses ad-hoc signing. Downloaded copies
# will still be quarantined by Gatekeeper — see the install notes printed at
# the end (and in README.md) for how users get past that.
#
set -euo pipefail

cd "$(dirname "$0")"

TARGET="universal-apple-darwin"
BUNDLE_DIR="src-tauri/target/${TARGET}/release/bundle"
APP_DIR="${BUNDLE_DIR}/macos"
DMG_DIR="${BUNDLE_DIR}/dmg"

echo "==> Checking Rust targets"
for arch in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! rustup target list --installed | grep -qx "$arch"; then
    echo "    installing $arch"
    rustup target add "$arch"
  fi
done

echo "==> Building universal bundle (this takes a few minutes)"
# When an updater signing key is present (CI with TAURI_SIGNING_PRIVATE_KEY set),
# also emit the signed updater artifact (*.app.tar.gz + .sig). Off by default so
# local and unsigned builds are completely unaffected.
BUILD_ARGS=(--target "$TARGET")
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "    (signing key present — emitting updater artifacts)"
  BUILD_ARGS+=(--config '{"bundle":{"createUpdaterArtifacts":true}}')
fi
cargo tauri build "${BUILD_ARGS[@]}"

APP_PATH="$(find "$APP_DIR" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "${APP_PATH:-}" ]]; then
  echo "ERROR: no .app produced under ${APP_DIR}" >&2
  exit 1
fi

echo "==> Ad-hoc signing ${APP_PATH}"
codesign --deep --force --sign - "$APP_PATH"
codesign --verify --verbose "$APP_PATH"

echo "==> Verifying architectures"
file "${APP_PATH}/Contents/MacOS/"*

DMG_PATH="$(find "$DMG_DIR" -maxdepth 1 -name '*.dmg' -print -quit || true)"

# `cargo tauri build` cuts the DMG *before* any signing, so the app copy inside
# it is unsigned even though the standalone .app above is ad-hoc signed. Swap the
# signed app into the DMG (preserving its styled layout) so distributed copies
# carry the signature too.
if [[ -n "${DMG_PATH:-}" ]]; then
  echo "==> Embedding signed app into ${DMG_PATH}"
  RW_DMG="$(mktemp -u).dmg"
  MNT="$(mktemp -d)"
  cleanup_dmg() {
    hdiutil detach "$MNT" -quiet 2>/dev/null || true
    rm -f "$RW_DMG"
    rmdir "$MNT" 2>/dev/null || true
  }
  trap cleanup_dmg EXIT

  hdiutil convert "$DMG_PATH" -format UDRW -o "$RW_DMG" -quiet
  # Grow the writable image so the larger (signed) app fits.
  hdiutil resize -size 300m "$RW_DMG" -quiet
  hdiutil attach "$RW_DMG" -mountpoint "$MNT" -nobrowse -noverify -quiet
  rm -rf "${MNT}/$(basename "$APP_PATH")"
  ditto "$APP_PATH" "${MNT}/$(basename "$APP_PATH")"
  hdiutil detach "$MNT" -quiet
  rm -f "$DMG_PATH"
  hdiutil convert "$RW_DMG" -format UDZO -o "$DMG_PATH" -quiet
  cleanup_dmg
  trap - EXIT

  echo "==> Verifying signature inside DMG"
  VERIFY_MNT="$(mktemp -d)"
  hdiutil attach "$DMG_PATH" -mountpoint "$VERIFY_MNT" -nobrowse -noverify -quiet
  codesign --verify --verbose "${VERIFY_MNT}/$(basename "$APP_PATH")"
  hdiutil detach "$VERIFY_MNT" -quiet
  rmdir "$VERIFY_MNT" 2>/dev/null || true
fi

echo
echo "Build complete."
echo "  App: ${APP_PATH}"
[[ -n "${DMG_PATH:-}" ]] && echo "  DMG: ${DMG_PATH}"
echo
echo "The app is ad-hoc signed, not notarized. After downloading, users must"
echo "clear the Gatekeeper quarantine flag once:"
echo
echo "  xattr -dr com.apple.quarantine \"/Applications/HymnBeam.app\""
echo
echo "or right-click the app -> Open the first time."
