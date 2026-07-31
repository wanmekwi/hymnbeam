<div align="center">
  <img src="Hymn.png" width="140" alt="HymnBeam">
  <h1>HymnBeam</h1>
  <p>Church song-lyrics projector for macOS and Windows — dual-window operator/projector layout, KJV Bible integration, and a portable song library.</p>

  [![Latest Release](https://img.shields.io/github/v/release/wanmekwi/hymnbeam?label=download&color=4f6ef7)](https://github.com/wanmekwi/hymnbeam/releases/latest)
  [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
  [![Platform: macOS | Windows](https://img.shields.io/badge/platform-macOS%2010.15%2B%20%7C%20Windows%2010%2B-lightgrey)]()

  **[hymnbeam.mekwi.net](https://hymnbeam.mekwi.net)**
</div>

---

## Install

### macOS — Homebrew (recommended)

```bash
brew tap wanmekwi/hymnbeam
brew trust --cask wanmekwi/hymnbeam/hymnbeam
brew install --cask hymnbeam
```

Recent versions of Homebrew refuse to install casks from third-party taps until
you explicitly trust them, hence the `brew trust` step. The Homebrew cask then
strips the Gatekeeper quarantine flag automatically — no extra steps needed.

### macOS — Direct download

1. Go to the [latest release](https://github.com/wanmekwi/hymnbeam/releases/latest) and download **HymnBeam\_x.x.x\_universal.dmg**.
2. Open the DMG and drag **HymnBeam** to `/Applications`.
3. Eject the DMG.
4. **First launch only** — macOS will block the app because it is not notarized. Choose one of:
   - Right-click **HymnBeam.app** → **Open** → confirm in the dialog, **or**
   - Run this once in Terminal to clear the quarantine flag:
     ```bash
     xattr -dr com.apple.quarantine "/Applications/HymnBeam.app"
     ```

The DMG is a **universal binary** — runs natively on Apple Silicon and Intel Macs.

### Windows

Windows installers ship with releases from **v0.1.5** onwards.

1. Go to the [latest release](https://github.com/wanmekwi/hymnbeam/releases/latest) and download **HymnBeam\_x.x.x\_x64-setup.exe**.
2. Run the installer. Because the app is not code-signed, Microsoft Defender SmartScreen will warn on first run — click **More info** → **Run anyway**.

---

## Screenshots

| Operator window | Projector output |
|---|---|
| ![Operator panel](docs/operator.png) | ![Projector view](docs/projector.png) |

---

## Features

- **Dual-window layout** — operator control panel on one screen, full-screen projector output on another.
- **Multi-monitor routing** — automatically sends the projector window to a secondary display.
- **KJV Bible integration** — browse books, chapters, and verses; project any passage with the same keyboard-first workflow as songs. Translator-added words shown in italics.
- **Reference lookup** — type any common abbreviation or variation (`Ecc 9:11`, `ec 9 11`, `ecclesiastes 9:11`) and HymnBeam resolves it to the right verse.
- **Order of service** — build a collection from songs, Bible passages, and logo slides in one ordered list, then drive the whole service through it with a single keystroke.
- **Next-slide preview** — the operator always sees what the next advance will project, alongside what's on screen now.
- **Logo / holding slide** — show the church logo (or a plain themed slide) for pre-service and transitions, separate from blanking.
- **Announcement banner** — flash a one-line alert (e.g. a nursery call) over whatever is projected, with optional auto-clear.
- **Full-text search** — search songs by title, author, or lyrics; search the entire KJV by keyword.
- **Song import / export** — JSON, CSV, and plain-text formats. Imports can add to the current library or replace it entirely (with confirmation).
- **Background images** — upload custom backgrounds per-song or as a global default.
- **Portable library** — single SQLite database in `~/Library/Application Support/HymnBeam/`.
- **Data protection** — automatic daily backups (plus before any library replace or restore) with one-click restore; deleted songs recoverable for 30 days with instant undo; duplicate-song finder. All under Settings → Library.
- **Keyboard-first** — every action reachable without a mouse (see shortcuts below).

---

## Song Database Conversion

The companion website **[vsb.bibeltroen.no](https://vsb.bibeltroen.no)** lets you convert song databases between different formats online. Use it to migrate an existing library into one of the formats HymnBeam can import (JSON, CSV, plain text), or to convert a HymnBeam export for use in another application.

---

## Keyboard Shortcuts

Press `?` in the operator window (or **View → Keyboard Shortcuts**) for this list
without leaving the app. On Windows, `⌘` below is `Ctrl`.

**During the service**

| Key | Action |
|-----|--------|
| `→` / `←` | Next / previous verse |
| `1`–`9` | Jump to verse 1–9 |
| `0` | Jump to verse 10 |
| `PgDn` / `PgUp` | Next / previous item in the open collection |
| `.` / `,` | Same, without reaching for the page keys |
| `Space` | Blank / unblank screen |
| `L` | Show / hide logo slide |
| `Escape` | Close dialog, clear alert, or clear display — in that order |

**Projector**

| Key | Action |
|-----|--------|
| `P` | Open / close projector |
| `F` | Open projector (never closes it, so a stray press can't kill the output) |
| `⌘⇧P` | Open / close projector |
| `⌘B` | Blank screen |
| `⌘L` | Show / hide logo slide |

**Alerts**

| Key | Action |
|-----|--------|
| `A` | Open the alert box |
| `⇧A` | Clear the alert on screen |

**Getting around**

| Key | Action |
|-----|--------|
| `/` | Search the song library |
| `⌃1` / `⌃2` / `⌃3` | Library / Collections / Bible tab |
| `[` / `]` | Previous / next sidebar tab |
| `?` | Show the shortcut list |

**Library**

| Key | Action |
|-----|--------|
| `⌘N` | New song |
| `⌘E` | Edit selected song |
| `⌘⌫` | Delete selected song |
| `⌘I` | Import songs |
| `⌘⇧I` | Import from database |
| `⌘,` | Display settings |

Single-key shortcuts are ignored while you are typing in a search or text field.

---

## Song File Formats

### JSON

```json
{
  "title": "Song Title",
  "author": "Author Name",
  "verses": [
    { "label": "Verse 1", "text": "Lyrics here..." },
    { "label": "Chorus",  "text": "More lyrics..." }
  ]
}
```

### CSV

```csv
title,author,verse_label,verse_text
Song Title,Author,Verse 1,"Lyrics here..."
Song Title,Author,Chorus,"More lyrics..."
```

### Plain Text

```
Song Title
Author Name

[Verse 1]
Lyrics here...

[Chorus]
More lyrics...
```

---

## Development

**Requirements:** a Rust toolchain ([rustup.rs](https://rustup.rs)) and the Tauri CLI.

```bash
cargo install tauri-cli
cargo tauri dev
```

The embedded `axum` HTTP server starts on an OS-assigned port before the operator window opens. The frontend reads the port via the `get_api_port` Tauri command — there is no separate backend process.

Song library and uploaded backgrounds are stored in `~/Library/Application Support/HymnBeam/`.

---

## Project Structure

```
hymnbeam/
├── src-tauri/            # Tauri (Rust) shell + embedded HTTP server
│   ├── src/main.rs       # Window management, IPC, native menus
│   ├── src/api.rs        # axum routes (songs, collections, settings, …)
│   ├── src/db.rs         # SQLite setup, FTS5 tables, migrations
│   ├── src/songs.rs      # Song CRUD
│   ├── src/collections.rs# Collections CRUD
│   ├── src/import.rs     # JSON / CSV / text parsers
│   ├── src/export.rs     # JSON / CSV / text exporters
│   ├── src/settings.rs   # Display settings (single-row JSON blob)
│   ├── src/backgrounds.rs# Background image upload + serving
│   ├── src/bible.rs      # KJV Bible lookup + FTS5 search
│   └── tauri.conf.json   # Bundle config
├── frontend/             # Web UI loaded by the Tauri webview
│   ├── index.html        # Operator window
│   ├── projector.html    # Projector display
│   ├── css/              # Stylesheets
│   ├── js/               # Application logic
│   ├── fonts/            # Bundled WOFF2 fonts (SIL OFL)
│   └── img/              # In-app logo art
├── src-tauri/icons/      # App icon variants (.icns / .ico / png)
├── songs/                # Sample song files
├── docs/                 # Screenshots for README
└── build-macos.sh        # Universal-binary build + ad-hoc sign
```

---

## Building for Distribution

### macOS

Build a universal (Apple Silicon + Intel) `.app` and `.dmg`, ad-hoc signed:

```bash
./build-macos.sh
```

Output lands in `src-tauri/target/universal-apple-darwin/release/bundle/`.

For a single-arch local build: `cargo tauri build` from inside `src-tauri/`.

### Windows

On a Windows machine: `cargo tauri build --bundles nsis` produces the installer under `src-tauri\target\release\bundle\nsis\`. Releases are built automatically by the [Release workflow](.github/workflows/release.yml) on GitHub Actions — pushing a `v*` tag attaches both the macOS DMG and the Windows installer to the release.

### Notarization (optional upgrade)

The distributed binary is ad-hoc signed. With an Apple Developer ID you can notarize it with `notarytool` + `stapler` to remove all Gatekeeper prompts for end users. See [Apple's notarization guide](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) for details.

---

## License

MIT — see [LICENSE](LICENSE).
