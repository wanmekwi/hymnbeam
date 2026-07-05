## Install

### macOS — Homebrew (recommended)

```bash
brew tap wanmekwi/hymnbeam
brew trust --cask wanmekwi/hymnbeam/hymnbeam
brew install --cask hymnbeam
```

Already tapped? Just run `brew upgrade --cask hymnbeam`. The cask strips the
Gatekeeper quarantine flag automatically — no extra steps needed.

### macOS — direct download

1. Download **HymnBeam_{VERSION}_universal.dmg** from the assets below (universal binary — Apple Silicon and Intel).
2. Open the DMG and drag **HymnBeam** to `/Applications`, then eject.
3. **First launch only** — macOS blocks the app because it is not notarized. Either right-click **HymnBeam.app** → **Open** → confirm, or run once in Terminal:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/HymnBeam.app"
   ```

### Windows

1. Download **HymnBeam_{VERSION}_x64-setup.exe** from the assets below.
2. Run the installer. Because the app is not code-signed, Microsoft Defender SmartScreen will warn on first run — click **More info** → **Run anyway**.
