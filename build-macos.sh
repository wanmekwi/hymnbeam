#!/usr/bin/env bash
#
# Build, ad-hoc sign, and package Song Rays as a universal macOS app.
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
cargo tauri build --target "$TARGET"

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

echo
echo "Build complete."
echo "  App: ${APP_PATH}"
[[ -n "${DMG_PATH:-}" ]] && echo "  DMG: ${DMG_PATH}"
echo
echo "The app is ad-hoc signed, not notarized. After downloading, users must"
echo "clear the Gatekeeper quarantine flag once:"
echo
echo "  xattr -dr com.apple.quarantine \"/Applications/Song Rays.app\""
echo
echo "or right-click the app -> Open the first time."
