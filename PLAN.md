# Church Song Projector — Project Plan

## Overview

A cross-platform desktop app (Windows & Mac) that projects song lyrics to a screen for church congregations to sing from. Designed for non-technical operators with a premium UI, full keyboard control, and easy song management via JSON, CSV, or plain text files.

---

## Recommended Stack

| Layer | Technology | Reason |
|---|---|---|
| Desktop shell | Tauri (Rust + WebView) | Lightweight (~5MB installer), cross-platform, multi-window support |
| UI frontend | HTML / CSS / JavaScript | Familiar web tech, flexible for premium design |
| Backend | Python + FastAPI (sidecar) | Song logic, file parsing, search — runs as local HTTP server |
| Database | SQLite | Single portable `.db` file, easy to back up |

> **Why Tauri over Electron?** ~5MB installer vs ~100MB, much lower RAM. Important for older church hardware.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     UI Layer                        │
│  Operator Window  │  Projector Window  │  Keyboard  │
│  (song list,      │  (full-screen      │  handler   │
│   controls,       │   lyrics display)  │            │
│   preview)        │                    │            │
└────────────────────────────┬────────────────────────┘
                             │ IPC
┌────────────────────────────▼────────────────────────┐
│           Tauri App Shell (Rust + WebView)           │
│   Window management · Multi-screen routing · IPC    │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP (localhost)
┌──────────────────▼──────────┐  ┌──────────────────────┐
│   Python sidecar (FastAPI)  │  │    Song importer      │
│   Song logic, search        │  │  JSON / CSV / text    │
└──────────────────┬──────────┘  └──────────┬───────────┘
                   │                         │
┌──────────────────▼─────────────────────────▼──────────┐
│                  SQLite song library                   │
│          Songs · Verses · Metadata · Tags             │
└────────────────────────────────────────────────────────┘
```

---

## Build Phases

### Phase 1 — Core Foundation
- Set up Tauri + Python sidecar project skeleton
- Launch two windows: operator window and projector window
- Send projector window full-screen to second monitor/projector
- Establish IPC bridge between JS frontend and Python FastAPI backend

### Phase 2 — Song Library
- Design SQLite schema: songs, verses, tags, metadata
- Write Python parsers for JSON, CSV, and plain text file imports
- Add drag-and-drop import UI in the operator window
- Song search (title, lyrics, tags)

### Phase 3 — Projector Display
- Full-screen lyrics view on projector screen
- Typography system: large, high-contrast text
- Configurable font size and style
- Smooth slide transitions between verses

### Phase 4 — Operator Controls
- Song search and list panel
- Live preview (miniature mirror of projector output)
- Keyboard navigation:
  - `→` / `←` — next / previous verse
  - `Space` — blank/unblank screen
  - `Escape` — clear display
  - `1–9` — jump to verse number
  - `F` — toggle full-screen

### Phase 5 — Polish
- Background image or colour themes (per song or global)
- Settings panel: font, size, transition style
- Package as `.exe` (Windows) and `.dmg` (Mac)
- Auto-update support

---

## Song File Formats

### JSON
```json
{
  "title": "Amazing Grace",
  "author": "John Newton",
  "verses": [
    { "label": "Verse 1", "text": "Amazing grace, how sweet the sound..." },
    { "label": "Chorus",  "text": "My chains are gone, I've been set free..." }
  ]
}
```

### CSV
```
title,author,verse_label,verse_text
Amazing Grace,John Newton,Verse 1,"Amazing grace, how sweet the sound..."
Amazing Grace,John Newton,Chorus,"My chains are gone..."
```

### Plain text
```
Amazing Grace
John Newton

[Verse 1]
Amazing grace, how sweet the sound...

[Chorus]
My chains are gone...
```

---

## Key Design Principles

- **Non-technical operators** — UI must be self-explanatory with minimal training needed
- **Keyboard-first** — every action must be reachable without a mouse during a service
- **Reliable** — no crashes mid-service; graceful handling of missing files or import errors
- **Portable** — song library is a single `.db` file that can be copied to a USB stick

---

## Project Structure (planned)

```
song-projector/
├── src-tauri/          # Tauri/Rust shell
├── frontend/           # HTML/CSS/JS operator & projector UI
├── backend/            # Python FastAPI sidecar
│   ├── main.py
│   ├── songs.py        # Song CRUD & search
│   ├── importer.py     # JSON / CSV / text parsers
│   └── database.py     # SQLite setup
├── songs/              # Sample song files
│   ├── example.json
│   ├── example.csv
│   └── example.txt
└── PLAN.md             # This file
```

---

*Plan generated: March 2026*
