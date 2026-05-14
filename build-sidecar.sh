#!/usr/bin/env bash
# Builds the Python backend into a standalone sidecar binary for Tauri.
# Run this before `cargo tauri build` to create a fully offline app.
#
# Requirements: Python 3, pip, PyInstaller

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
BINARIES_DIR="$SCRIPT_DIR/src-tauri/binaries"

# Detect target triple (what Tauri expects as the filename suffix).
# Prefer rustc when available; fall back to uname-based detection.
TARGET_TRIPLE=$(rustc -Vv 2>/dev/null | grep '^host:' | awk '{print $2}')
if [ -z "$TARGET_TRIPLE" ]; then
    OS=$(uname -s)
    ARCH=$(uname -m)
    case "$OS-$ARCH" in
        Darwin-arm64)  TARGET_TRIPLE="aarch64-apple-darwin" ;;
        Darwin-x86_64) TARGET_TRIPLE="x86_64-apple-darwin" ;;
        Linux-x86_64)  TARGET_TRIPLE="x86_64-unknown-linux-gnu" ;;
        Linux-aarch64) TARGET_TRIPLE="aarch64-unknown-linux-gnu" ;;
        *)
            echo "Error: unknown platform $OS-$ARCH. Set TARGET_TRIPLE manually."
            exit 1
            ;;
    esac
    echo "rustc not found; inferred triple from uname: $TARGET_TRIPLE"
else
    echo "Target triple: $TARGET_TRIPLE"
fi

# Build the Python backend with PyInstaller
echo ""
echo "Building Python backend..."
cd "$BACKEND_DIR"
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r requirements.txt pyinstaller
pyinstaller song_rays_backend.spec --noconfirm

# Move the binary to src-tauri/binaries/ with the correct suffix
mkdir -p "$BINARIES_DIR"
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    EXE_EXT=".exe"
else
    EXE_EXT=""
fi

SRC="$BACKEND_DIR/dist/song-rays-backend$EXE_EXT"
DEST="$BINARIES_DIR/song-rays-backend-$TARGET_TRIPLE$EXE_EXT"

cp "$SRC" "$DEST"
chmod +x "$DEST"

echo ""
echo "Done. Sidecar binary at:"
echo "  $DEST"
echo ""
echo "Now run:  cargo tauri build"
