# HymnBeam

A cross-platform desktop app for projecting song lyrics to a screen for church congregations. Built with Tauri (Rust) + an embedded `axum` HTTP server + SQLite.

## Features

- **Dual-window display**: Operator control panel + full-screen projector output
- **Multi-monitor support**: Automatically sends projector to secondary display
- **Keyboard-first navigation**: Full control without touching a mouse
- **Song import**: Supports JSON, CSV, and plain text formats
- **Full-text search**: Search by title, author, or lyrics
- **Portable library**: Single SQLite database file

## Development

Requirements: a Rust toolchain (install via [rustup.rs](https://rustup.rs)) and
the Tauri CLI (`cargo install tauri-cli`).

```bash
cargo tauri dev
```

The embedded `axum` server is started before the operator window opens, on a
port chosen by the OS, and the frontend reads it via the `get_api_port` Tauri
command. There is no separate backend process.

Song library and uploaded backgrounds live in
`~/Library/Application Support/HymnBeam/`.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `→` / `←` | Next / previous verse |
| `Space` | Blank / unblank screen |
| `1`–`9` | Jump to verse 1–9 |
| `0` | Jump to verse 10 |
| `Escape` | Clear display |
| `F` | Open projector |
| `⌘,` | Display settings |
| `⌘N` | New song |
| `⌘E` | Edit selected song |
| `⌘⌫` | Delete selected song |
| `⌘I` | Import songs |
| `⌘⇧P` | Open / close projector |
| `⌘B` | Blank screen |

## Song File Formats

### JSON

```json
{
  "title": "Song Title",
  "author": "Author Name",
  "verses": [
    { "label": "Verse 1", "text": "Lyrics here..." }
  ]
}
```

### CSV

```csv
title,author,verse_label,verse_text
Song Title,Author,Verse 1,"Lyrics here..."
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
└── build-macos.sh        # Universal-binary build + ad-hoc sign
```

## Building for Distribution (macOS)

Build a universal (Apple Silicon + Intel) `.app` and `.dmg`, ad-hoc signed:

```bash
./build-macos.sh
```

Output lands in `src-tauri/target/universal-apple-darwin/release/bundle/`.

For a single-arch local build you can still run `cd src-tauri && cargo tauri build`.

## Installing (macOS)

The app is ad-hoc signed but not notarized (no Apple Developer ID yet), so
after downloading the `.dmg` macOS Gatekeeper will quarantine it. Drag
**HymnBeam** to `/Applications`, then either:

- Right-click the app → **Open**, and confirm once, **or**
- clear the quarantine flag from a terminal:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/HymnBeam.app"
  ```

This is a one-time step per download.

## License

MIT
