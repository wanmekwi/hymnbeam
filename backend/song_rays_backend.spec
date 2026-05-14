# PyInstaller spec for bundling the Song Rays backend as a Tauri sidecar binary.
#
# Usage:
#   cd backend
#   pip install pyinstaller
#   pyinstaller song_rays_backend.spec
#
# The output binary must be placed in src-tauri/binaries/ with the target-triple
# suffix that Tauri expects, e.g.:
#   song-rays-backend-aarch64-apple-darwin   (macOS Apple Silicon)
#   song-rays-backend-x86_64-apple-darwin    (macOS Intel)
#   song-rays-backend-x86_64-pc-windows-msvc.exe  (Windows)
#
# Get your triple with:  rustc -Vv | grep host
#
# After placing the binary, run:  cargo tauri build

import sys

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='song-rays-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
