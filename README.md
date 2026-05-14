# Song Rays

A cross-platform desktop app for projecting song lyrics to a screen for church congregations. Built with Tauri, Python FastAPI, and SQLite.

## Features

- **Dual-window display**: Operator control panel + full-screen projector output
- **Multi-monitor support**: Automatically sends projector to secondary display
- **Keyboard-first navigation**: Full control without touching a mouse
- **Song import**: Supports JSON, CSV, and plain text formats
- **Full-text search**: Search by title, author, or lyrics
- **Portable library**: Single SQLite database file

## Requirements

- **Rust** (for Tauri): Install via [rustup.rs](https://rustup.rs)
- **Python 3.10+**: For the backend API
- **Node.js 18+**: For development tools (optional)

## Quick Start

### 1. Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### 2. Set up Python backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Start the backend

```bash
cd backend
python3 main.py
```

Backend runs at `http://127.0.0.1:8765`

### 4. Run the Tauri app (development)

```bash
cd src-tauri
cargo tauri dev
```

## Testing Without Tauri

You can test the frontend without compiling Tauri:

```bash
# Start the backend
cd backend && python3 main.py &

# Serve the frontend (use any static server)
cd frontend && python3 -m http.server 5173
```

Open `http://localhost:5173` in your browser.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `→` / `←` | Next / Previous verse |
| `Space` | Blank / Unblank screen |
| `1`-`9` | Jump to verse number |
| `Escape` | Clear display |
| `F` | Toggle projector window |

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
song_rays/
├── src-tauri/          # Tauri/Rust shell
│   ├── src/main.rs     # Window management, IPC
│   └── tauri.conf.json # App configuration
├── frontend/           # Web UI
│   ├── index.html      # Operator window
│   ├── projector.html  # Projector display
│   ├── css/            # Stylesheets
│   └── js/             # Application logic
├── backend/            # Python API
│   ├── main.py         # FastAPI server
│   ├── songs.py        # Song CRUD operations
│   ├── importer.py     # File parsers
│   └── database.py     # SQLite setup
├── songs/              # Sample song files
└── data/               # SQLite database (created on first run)
```

## Building for Production

```bash
cd src-tauri
cargo tauri build
```

Installers are created in `src-tauri/target/release/bundle/`:
- macOS: `.dmg` and `.app`
- Windows: `.exe` and `.msi`

## License

MIT
