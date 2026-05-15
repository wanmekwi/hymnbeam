# HymnBeam — Distribution Plan

Goal: turn HymnBeam into an independent macOS app that can be downloaded from a
website and installed via Homebrew.

## Current state

Tauri 2 shell + Python FastAPI sidecar (PyInstaller, 16 MB) + SQLite + vanilla-JS
frontend. Functionally complete: song CRUD, FTS5 search, JSON/CSV/text import,
export, collections, dual-window projector, keyboard nav, multi-monitor routing.

The app has never been successfully packaged — no `src-tauri/target/` exists and
several blockers guarantee a bundled `.app` would be broken.

## Critical blockers

1. **`externalBin` not declared** in `tauri.conf.json` — the sidecar binary is
   never bundled into the `.app`.
2. **Sidecar can't be spawned** — `capabilities/default.json` only grants
   `shell:allow-open`, not `shell:allow-execute`.
3. **DB path unwritable in a bundle** — `database.py` writes to a path inside the
   read-only `.app`. The packaged app cannot save songs. Must move to
   `~/Library/Application Support/HymnBeam/`.
4. **Startup race** — frontend hits hardcoded port 8765 immediately; no readiness
   check, no retry, dead if the port is taken.
5. **Not a git repo** — releases, Homebrew tap, and CI need version control.
6. **Gatekeeper** — unsigned downloads show "damaged / can't be opened". No Apple
   Developer account yet → ad-hoc signing + documented quarantine bypass, with
   notarization as the recommended upgrade.

Lesser issues: `beforeDevCommand` leaks an orphan Python process, no LICENSE file,
CORS `*`, single-arch sidecar (no Intel support), no version/About UI, no
auto-update.

## Architecture decision: port the backend to Rust

The Python sidecar is the main distribution friction. Porting the ~6 small
backend files to Rust (`axum` + `rusqlite`, FTS5 supported):

- Eliminates blockers #1, #2, #4 and makes #3 trivial.
- One binary = one signature. PyInstaller ships dozens of dylibs that each need
  consistent signing + hardened runtime — far harder without a Developer account.
- App size drops from ~20 MB+ to ~8 MB.
- ~1–2 days of porting; the backend is small and stable.

The Rust server keeps a localhost HTTP API with identical routes/JSON shapes, so
the frontend is untouched. Fallback under time pressure: "fix the sidecar"
(declare `externalBin`, add `shell:allow-execute`, fix DB path, add readiness
poll, build both arches) — viable but leaves signing fragile.

---

## Phases

### Phase 0 — Repo & hygiene
- `git init`, baseline commit.
- Add `LICENSE` (MIT). Update `.gitignore`.
- Remove stray artifacts: `backend/dist/`, `backend/build/`, `__pycache__/`,
  `.DS_Store` files.
- Decide fate of `251123_Hymns.json` (1.1 MB) — seed data → `songs/`; user library
  → remove from repo.

### Phase 1 — Port backend to Rust
- Add `axum` (or `tiny_http`) localhost server in `src-tauri`, started in
  `setup()`. Same routes/JSON shapes as `main.py`:
  `/songs`, `/songs/search`, `/songs/{id}` CRUD; `/import`, `/export`;
  `/collections/*`.
- Port `database.py` → `rusqlite`, same schema + FTS5 virtual tables. DB path →
  `~/Library/Application Support/HymnBeam/songs.db` via `app_data_dir()`. Keep
  idempotent migrations.
- Port `importer.py` and `export_songs.py`.
- Bind `127.0.0.1:0` (OS-assigned port); pass port to frontend.
- Delete `backend/`, `build-sidecar.sh`, `song_rays_backend.spec` after parity is
  verified.

### Phase 2 — App lifecycle & robustness
- Replace hardcoded `API_URL` with injected port.
- Startup readiness retry loop instead of one-shot failure.
- Clean shutdown — no orphan threads/connections.
- Tighten CORS to the Tauri origin (or drop it via same-origin custom protocol).
- Add minimal About dialog showing version.

### Phase 3 — Build & packaging (macOS)
- Universal binary: `cargo tauri build --target universal-apple-darwin`.
- Verify `.dmg` / `.app` in `src-tauri/target/.../bundle/`.
- Ad-hoc sign: `codesign --deep --force --sign -`. Document for users:
  `xattr -dr com.apple.quarantine "/Applications/HymnBeam.app"` or
  right-click → Open.
- Upgrade path note: with a Developer ID, switch to signed + hardened runtime +
  `notarytool` + `stapler` to remove all Gatekeeper friction. Recommended
  follow-up.

### Phase 4 — Distribution: website + Homebrew
- Push to GitHub, cut `v0.1.0` release with the universal DMG attached.
- Optional GitHub Pages landing page: screenshots, download button, quarantine
  instructions.
- Homebrew tap repo (`homebrew-hymnbeam`) with `Casks/hymnbeam.rb` — `url` →
  release DMG, `sha256`, `app "HymnBeam.app"`, `postflight` to strip quarantine.
  Install: `brew tap <you>/hymnbeam && brew install --cask hymnbeam`.
- GitHub Actions: on tag, build universal binary, ad-hoc sign, attach DMG, bump
  cask `sha256`.

### Phase 5 — Polish (post-launch)
- Wire Tauri updater plugin (pair with notarization).
- Rewrite `README.md` for end users; move dev setup to `CONTRIBUTING.md`.
- Settings panel (font/size/transition).

## Sequencing

Phases 0 → 1 → 2 are prerequisites before packaging. Phase 3 produces a working
unsigned DMG. Phase 4 makes it downloadable + brew-installable. Phase 5 is
iterative.
