# Plan: "During the Service" features

Standalone implementation plan for four operator-facing features that make HymnBeam more robust while a service is running. Each feature is independent — implement and ship them one at a time, in the order listed (roughly easiest first).

## Architecture primer (read first)

- **Stack**: Tauri v2 desktop app. Backend is Rust (`src-tauri/src/`), frontend is vanilla JS/HTML/CSS (`frontend/`), no framework, no build step.
- **API**: an axum `Router` (`src-tauri/src/api.rs`) is mounted on a Tauri custom URI scheme via `tauri-plugin-axum` — requests go over IPC, there is **no TCP server**. The frontend talks to it with `fetch(API_URL + ...)`; `API_URL` is resolved at the top of `frontend/js/app.js`.
- **Windows caveat**: on Windows, WebView2 never delivers `File`/`Blob` fetch bodies to the custom protocol, so file uploads go through Tauri IPC commands instead (see `import_songs_from_content` in `src-tauri/src/main.rs`). JSON bodies are fine.
- **Two windows**: "operator" (`frontend/index.html` + `js/app.js`) and "projector" (`frontend/projector.html` + `js/projector.js`). The operator pushes state to the projector via the `send_to_projector` Tauri command (`main.rs`), which emits a window event; `projector.js` subscribes with `window.__TAURI__.event.listen('update-lyrics' | 'apply-settings', ...)`. Payloads are JSON strings. In the non-Tauri browser fallback, `postMessage` on `window.projectorWindow` is used instead — keep both paths working.
- **Data**: SQLite at `~/Library/Application Support/HymnBeam/songs.db` (`src-tauri/src/db.rs`). Tables: `songs` (with `deleted_at` soft-delete column), `verses`, `tags`, `song_tags`, `setlists`, `setlist_songs`, `app_settings` (single-row JSON blob), `bible_verses`, plus external-content FTS5 tables `songs_fts`, `verses_fts`, `bible_fts`.
- **FTS5 warning**: the FTS tables are external-content. Never DELETE an FTS row twice and never DELETE when the content row is missing — it corrupts the index ("database disk image is malformed"). See `delete_song` in `songs.rs` for the guard pattern; `clear_all_songs` uses the `'delete-all'` command.
- **DB access**: one global `Mutex<Connection>` (`db.rs::get_connection`). It is NOT re-entrant — never call a helper that takes the lock while you hold the guard.
- **Migrations**: idempotent, run in `db.rs::init_db()` via `CREATE TABLE IF NOT EXISTS` + `add_column_if_missing`.
- **Settings**: one JSON blob, GET/PUT `/settings`, shape defined by `state.settings` in `app.js` (`typography`, `background`, `layout`, `transition` sections). The settings modal (`index.html` `#settingsModal`) has tabs wired generically by `data-tab`/`data-panel`; the "library" tab hides the preview pane via the `library-mode` class.
- **Confirm dialog**: reuse `openConfirm({ title, message, confirmLabel, onConfirm })` in `app.js`. Toasts: `updateStatus(message, { label, onClick }?)`.
- **Tests**: Rust unit tests share one DB per process — always use `crate::db::test_util::setup_temp_db()` which serializes tests and clears the library. Run with `cargo test` in `src-tauri/`.
- **Verification**: `.claude/launch.json` has a `frontend-static` server for browser-based UI checks (no backend — stub `fetch` for data). Backend behavior is verified with `cargo test`.

---

## 1. Next-verse preview on the operator screen

**Goal**: while projecting, the operator always sees what the *next* advance will show, so they can confirm it before pressing the key.

Current state: the operator has a live preview of the current slide (`#previewFrame`/`updatePreview()` in `app.js`). Navigation state lives in `state.currentVerseIndex`, `state.navigationOrder`, `state.navPosition`; advancing happens in `navigateVerse(direction)`.

Implementation:
1. In `index.html`, next to the existing preview, add a smaller "Next" pane (same aspect ratio, e.g. 40% scale, label "Next"). Keep it inside the existing preview column so the layout doesn't reflow.
2. In `app.js`, extract the payload-for-verse logic from `buildProjectorPayload()` so it can render an arbitrary verse index, then compute `nextIndex = state.navigationOrder[state.navPosition + 1]`. Render its text into the next-pane (reuse the miniature-preview rendering path that `updatePreview()` uses).
3. Update the pane wherever `renderSongDisplay()`/`sendToProjector()` are called — hooking `updatePreview()` itself is the single choke point.
4. Show "end of song" (muted) when there is no next verse; empty when no song is loaded.
5. No backend changes.

Verify: static preview server; load a stub song, step through verses, confirm the next-pane always shows the following verse and end-state.

## 2. Logo / theme slide state

**Goal**: a third projector state besides "lyrics" and "blank": the church logo (or a plain themed slide) for pre-service and transitions.

Current state: blanking is a `toggleBlank()`/`state.isBlank` flag in `app.js` sent to the projector; background images are uploaded via `save_background_image` (Tauri command, base64) or POST `/backgrounds` (browser fallback) and served from GET `/backgrounds/{name}` (`src-tauri/src/backgrounds.rs`).

Implementation:
1. **Settings**: add a `logo` section to the settings blob: `{ image: string|null }`. Reuse the existing background image picker UI as a new "Logo" group in the settings modal's Background tab (or a small new tab). Upload via the same dual path as backgrounds (Tauri command on desktop, multipart in browser).
2. **Operator**: add a "Logo" toggle button beside the Blank button (`#blankBtn`) and a `state.showLogo` flag. Blank and Logo are mutually exclusive — turning one on turns the other off. Keyboard: `L` (check the key switch in `app.js` for collisions first).
3. **Projector**: send a `show-logo` event (payload `{ image }`) via `send_to_projector`, mirroring how blank is sent today (find the blank handling in `projector.js` and follow the same pattern). Render the image centered on the themed background; if no logo image is configured, render the plain background only.
4. **Menu**: optionally add a View > Show Logo item in `main.rs` following the `blank_screen` menu-item pattern (emits an action string the operator listens for).

Verify: cargo tests unaffected; drive in browser with stubbed settings; on desktop confirm the projector switches lyrics → logo → lyrics without flicker.

## 3. Alert overlay (nursery / announcement banner)

**Goal**: flash a one-line message over whatever is currently projected ("Parents of child #12, please come to the nursery") without leaving the current song.

Implementation:
1. **Operator UI**: a small input + "Show alert" button (suggested: in the header next to the projector controls, or a compact popover). Buttons: Show, Clear. Optional auto-clear select (30 s / 1 min / 5 min / until cleared).
2. **Transport**: new projector event `show-alert` with payload `{ text, until_ms|null }`, plus `clear-alert`. Send via `send_to_projector` exactly like `update-lyrics`; add the `postMessage` fallback for the browser path.
3. **Projector**: a fixed banner across the bottom (or top) of `projector.html`, styled prominently (high contrast, large type, subtle slide-in). It must overlay lyrics, blank, and logo states alike — keep it in a separate DOM layer with its own z-index, not inside the lyrics container.
4. **Operator state**: show an "alert live" indicator while active so the operator can't forget it's up; clear it on projector close.
5. No backend/database changes. Keep the last few alert texts in `localStorage` for quick re-use (nursery alerts repeat).

Verify: with both windows open on desktop, show/clear an alert over each projector state; confirm auto-clear timing; confirm the alert survives verse navigation (it must not be wiped by `update-lyrics` re-renders).

## 4. Order of service (mixed-item collections)

**Goal**: a collection entry can be a song *or* a Bible passage *or* a logo/blank slide, so a whole service can be driven from one ordered list. This is the largest item — do it last.

Current state: `setlist_songs` (`collections.rs`) references songs only; the collections UI lives in `app.js` (`fetchCollections`, `openCollectionDetail`, `renderCollectionDetail`, reorder/remove handlers). Bible projection already exists (`frontend/js/bible.js`, `src-tauri/src/bible.rs`, routes `/bible/*`) — find how bible.js builds its projector payload and reuse it.

Implementation:
1. **Schema** (in `init_db`, using `add_column_if_missing`): add to `setlist_songs`: `item_type TEXT NOT NULL DEFAULT 'song'`, `reference TEXT` (Bible reference like `"John 3:16-18"`, or `'logo'`), and make `song_id` nullable in practice (SQLite: the existing NOT NULL constraint can't be dropped in place — either create a sentinel song_id convention or do a table rebuild migration: `CREATE TABLE setlist_items AS SELECT ...`, drop, rename. Prefer the rebuild; it's a one-time migration guarded by a PRAGMA table_info check, same pattern as `add_column_if_missing`).
2. **Models/queries** (`collections.rs`, `models.rs`): `CollectionEntry` gains `item_type` and `reference`; `get_collection` LEFT JOINs songs (keep the existing `deleted_at IS NULL` filter for song rows). `add_song_to_collection` gets a sibling `add_item_to_collection(collection_id, item_type, song_id|reference)`.
3. **API** (`api.rs`): extend POST `/collections/{id}/songs` body to `{ song_id? , item_type?, reference? }` (default `song` keeps backward compatibility). Reorder/remove endpoints work unchanged (they key on entry id).
4. **Operator UI**: in the collection detail view, an "Add…" control with three choices: Song (existing picker), Bible passage (text input piped through the existing reference-resolution endpoint used by bible.js), Logo slide. Entries render with a type icon. Advancing through the collection (`state.collectionPosition` logic) must dispatch on `item_type`: songs load as today; Bible entries fetch the passage and send the Bible projector payload; logo entries trigger the logo state (feature 2 — if not built yet, omit logo entries).
5. **Deletion semantics**: Bible/logo entries have no song row; ensure the `deleted_at` collection filter only applies to song-type rows so mixed entries don't vanish.
6. **Tests**: rust tests for the migration (old-shape table upgrades cleanly), mixed-entry CRUD and ordering; keep `setup_temp_db`.

Verify: build a collection with song + passage + logo, step through it end-to-end on desktop with the projector open; export/import and library replace must leave mixed collections consistent (song entries survive via cascade rules, reference entries untouched).

---

## Out of scope for this plan

Remote control, livestream output, translations, and PDF export are covered in `docs/plans/beyond-the-projector.md`. CCLI/usage logging is not planned yet.
