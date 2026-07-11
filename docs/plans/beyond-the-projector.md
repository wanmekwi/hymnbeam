# Plan: "Beyond the Projector" features

Standalone implementation plan for four features that extend HymnBeam past the single-machine projector setup. These are larger architectural commitments than the items in `docs/plans/during-the-service.md` — read that file's **Architecture primer** section first; everything there (custom-protocol axum router, two-window event flow, SQLite schema, FTS5 warnings, Mutex connection, test setup) applies here and is not repeated.

Recommended order: 4 (PDF) → 3 (translations) → 1 (remote) → 2 (livestream). PDF and translations are self-contained; remote and livestream both open network/architectural surface area and deserve their own release cycles.

---

## 1. Remote control from a phone / tablet

**Goal**: next/previous verse, song selection from the active collection, and blank/logo toggles from a browser on the same LAN.

**The architectural catch**: the axum router currently rides Tauri's custom URI scheme — there is deliberately **no TCP listener**. Remote control requires opening a real port. Treat this as opt-in and security-relevant.

Implementation sketch:
1. **Opt-in TCP server**: a toggle in settings ("Enable remote control"). When enabled, spawn a second axum server (tokio task) bound to `0.0.0.0:<port>` (fixed default, e.g. 8790, configurable). It must serve only a *remote-scoped* router — do NOT expose the full library/import/backup API on the network. Routes: `GET /remote` (the control page), `GET /remote/state`, `POST /remote/nav {direction}`, `POST /remote/goto {entry}`, `POST /remote/blank`, `POST /remote/logo`.
2. **Pairing**: on enable, generate a 6-digit PIN, show it in settings alongside a `http://<lan-ip>:<port>/remote` URL and a QR code (a QR can be generated client-side in the operator with a tiny embedded JS lib — keep it dependency-light, or render server-side with the `qrcode` crate). The phone enters the PIN once; issue a session token (random, in-memory) checked on every request. Rate-limit PIN attempts.
3. **State flow**: the remote must *drive the operator*, not the projector directly, so the operator UI stays truthful. Bridge: remote POST → Rust emits a Tauri event to the operator window (`remote-nav` etc.) → `app.js` listens and calls the same `navigateVerse` / `toggleBlank` functions the keyboard uses. For `/remote/state`, the operator pushes its current state (song title, verse index/count, collection entries) to Rust after every change (small Tauri command, store in a `Mutex<RemoteState>`), and the remote page polls every 1–2 s (polling is fine at this scale; skip websockets in v1).
4. **Remote page**: one self-contained HTML file (embed with `include_str!`), phone-sized: big Prev/Next buttons, current/next verse text, the collection list, blank/logo toggles. No external assets.
5. **Security notes**: token required on every route except the PIN exchange; server binds only while the toggle is on; firewall prompts on macOS/Windows are expected — document that in the README. Never serve the operator's full API surface.
6. **Tests**: Rust tests for PIN → token exchange and auth rejection; manual LAN test from a phone.

## 2. Livestream output (lower-thirds for OBS)

**Goal**: a chromakey-friendly or transparent rendering of the current verse that OBS can capture, so in-room projection and stream graphics come from one operator.

Two delivery options — implement (a), leave (b) as a follow-up:

**(a) Browser-source page (recommended v1)**: OBS's Browser Source can load a URL. Reuse the remote-control TCP server (feature 1) — this is another reason to build that first. Add `GET /stream/lower-third`: a page with a transparent background (`body { background: transparent }`; OBS browser sources support alpha) rendering the current verse as a lower-third band. It polls `/remote/state` (or shares the remote's poll endpoint) for text. Styling: separate, simpler than the projector — configurable font size, band position (lower third vs centered), text-only. Auth: allow a long random token in the query string (`?key=...`) shown in settings, since OBS can't do an interactive PIN exchange.

**(b) Native window capture (follow-up)**: a third Tauri window with a green/transparent background for capture via window-capture — only worth it if browser-source latency proves a problem. NDI output is out of scope (heavy native dependency).

Implementation steps for (a):
1. Extend the remote state bridge to include the full current-verse text and blank/logo state (blank/logo → the lower-third hides).
2. New route on the opt-in TCP server + a `stream.html` embedded asset. Keep it dependency-free.
3. Settings additions: enable toggle (implied by remote server), copyable URL with key, font-size and position controls (store in the settings JSON blob under a `stream` section).
4. Verify with actual OBS: add a Browser Source, confirm alpha transparency, verse changes, and hide-on-blank behavior.

## 3. Multiple Bible translations + dual-language slides

**Goal**: congregations that don't use the KJV — or that project two languages side by side — are currently locked out.

Current state: `bible_verses` (`db.rs`) has no translation column; `src-tauri/kjv.json` is loaded once by `bible::ensure_bible_loaded`; routes are `/bible/books`, `/bible/{book}/{chapter}`, `/bible/search`; `frontend/js/bible.js` drives the UI and reference resolution.

Implementation:
1. **Schema migration**: add `translation TEXT NOT NULL DEFAULT 'KJV'` to `bible_verses` via `add_column_if_missing`; extend the `idx_bible_bk_ch` index to `(translation, book, chapter)` (create a new index, drop the old). `bible_fts` stays one index; store translation on the content row and filter after match (same join pattern `search_songs` uses for `deleted_at`).
2. **Import format**: accept the same JSON shape as `kjv.json` plus a `translation` code, via a new "Import translation…" action (settings Library tab is a natural home). Delivery must use the Tauri IPC command path for the file body (Windows multipart caveat). Validate: known books, non-empty verses; reject rather than partially import — follow the parse-first-then-write pattern `replace_library` uses in `import.rs`.
3. **API**: add `?translation=` to the three bible routes (default KJV). New route `GET /bible/translations` listing installed codes. Deleting a translation: `DELETE /bible/translations/{code}` (guard: cannot delete the last one).
4. **UI**: translation dropdown in the Bible tab (persist choice in the settings blob). Reference resolution (`Ecc 9:11` shortcuts) is book-name based and shouldn't need changes unless book names are localized — if a translation ships localized book names, map them at import time to the canonical book ids and keep aliases in a lookup table.
5. **Dual-language slides**: a second "secondary translation" dropdown (or per-song secondary lyrics — see note below). When set, the Bible projector payload includes both texts; `projector.js` renders primary on top, secondary beneath in a distinct style (smaller/italic). The auto-line-break sizing logic must measure the combined block.
6. **Dual-language songs** (optional extension): schema-wise, a `verses.secondary_text TEXT` column is the cheapest path; the song editor gains a second textarea per verse. Only attempt after the Bible variant proves the rendering.
7. **Tests**: migration idempotence, per-translation chapter fetch and search filtering, last-translation delete guard, import validation rejects malformed files.

## 4. Setlist print/export (PDF for musicians)

**Goal**: hand the band a one-page order sheet: song titles, keys, numbers, authors, in collection order.

This is self-contained and the easiest item in this file.

Implementation:
1. **Approach**: generate the PDF in the frontend to avoid a Rust PDF dependency. Simplest robust path: a print-ready HTML view + the browser/webview's print-to-PDF. Add a "Print / PDF…" button in the collection detail view that opens a new window (operator-side, `window.open`) with a clean print stylesheet (white background, black text, church/app name header, collection name, date, numbered rows: title — key — #number — author), then calls `window.print()`. On Tauri, `window.print()` works in WKWebView/WebView2 and offers "Save as PDF".
2. **Data**: everything needed is already in GET `/collections/{id}` (`CollectionEntry` has title/key; add `song_number` and `author` to the entry query in `collections.rs` if missing — check `models.rs::CollectionEntry` first).
3. **Optional direct-PDF fallback**: if `window.print()` proves unreliable on either platform, use a Rust-side `printpdf` or `genpdf` generation behind a `GET /collections/{id}/pdf` route with `Content-Disposition: attachment` (mirror `export_songs_handler` in `api.rs`). Only add the dependency if needed.
4. **Verify**: print preview on macOS and Windows; long collections paginate; empty collections show a friendly message instead of printing blank.

---

## Cross-cutting notes

- Features 1 and 2 share the opt-in TCP server; build its enable/disable lifecycle, auth, and settings UI once.
- Nothing here may regress the zero-config offline story: the app must remain fully functional with the network server disabled.
- Every schema change goes through idempotent migrations in `db.rs::init_db()` and needs a `cargo test` covering upgrade-from-old-shape.
- Version bumps and releases follow the tag-driven CI documented in the repo (see README "release" notes / `.github` workflows).
