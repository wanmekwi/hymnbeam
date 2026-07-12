# Plan: activate true in-app auto-update

The app already ships a **"Check for updates"** button (About modal + the "Check
for Updates…" app-menu item). Today it queries the GitHub releases API, and when
a newer version exists it opens the correct installer (`.dmg`/`.exe`) in the
browser for a manual install. This document covers upgrading that same button to
a **one-click in-place update** via Tauri's updater plugin.

Read the **Architecture primer** in [during-the-service.md](during-the-service.md)
first — the custom-protocol axum router, the Windows WebView2 upload caveat, and
the tag-driven release CI all matter here.

## What's already wired (dormant)

These are committed and safe — they do nothing until you complete the activation
steps below:

- `tauri-plugin-updater` and `tauri-plugin-opener` are dependencies
  (`src-tauri/Cargo.toml`), both registered in `src-tauri/src/main.rs`.
- `updater:default` and `opener:default` are granted in
  `src-tauri/capabilities/default.json`.
- `src-tauri/tauri.conf.json` has a `plugins.updater` block with the GitHub
  "latest release" endpoint and an **empty `pubkey`**. The empty pubkey is the
  dormant marker: the plugin loads, but `check()` fails signature verification,
  so the frontend's `tryPluginAutoUpdate()` catches the error and falls back to
  the browser download. (An absent `plugins.updater` block makes the app panic
  at startup — keep the block, just fill in the pubkey.)
- The frontend (`frontend/js/app.js`, `checkForUpdates` / `tryPluginAutoUpdate`)
  already prefers the plugin when it works and falls back otherwise. **No
  frontend changes are needed to activate** — filling in the pubkey + CI is
  enough.

## Activation steps

### 1. Generate an updater signing key (you do this, once)

Do this on your own machine so the private key is never transmitted:

```sh
# writes the private key to the given path; prompts for a password
cargo tauri signer generate -w ~/.tauri/hymnbeam-updater.key
```

It prints a **public key** (a base64 blob) and writes the **private key** to the
file. Keep the private key and password secret; never commit them.

### 2. Add the private key as CI secrets (you do this)

In the GitHub repo → Settings → Secrets and variables → Actions, add:

- `TAURI_SIGNING_PRIVATE_KEY` — the *contents* of `~/.tauri/hymnbeam-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose

### 3. Put the public key in the config

In `src-tauri/tauri.conf.json`, replace the empty pubkey and turn on updater
artifact generation:

```jsonc
"bundle": {
  "createUpdaterArtifacts": true,   // add this line
  ...
},
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/wanmekwi/hymnbeam/releases/latest/download/latest.json"
    ],
    "pubkey": "<PASTE THE PUBLIC KEY FROM STEP 1>"
  }
}
```

`createUpdaterArtifacts` MUST stay off until the signing secret exists — with it
on and no key, the build fails. So this config change and the CI change (next)
land together with the secret already in place.

### 4. Produce and publish `latest.json` in CI

The release workflow (`.github/workflows/release.yml`) uses custom build steps
(`build-macos.sh`, `cargo tauri build --bundles nsis`) rather than
`tauri-action`, so updater artifacts and the `latest.json` manifest are not
generated automatically. Two options:

**Option A (recommended): switch the build steps to `tauri-apps/tauri-action`.**
It builds, signs the updater artifacts, generates `latest.json`, and attaches
everything to the release in one step. Pass the signing env vars:

```yaml
env:
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

Confirm the universal-macOS build (currently `build-macos.sh`) is reproduced with
tauri-action's `args: --target universal-apple-darwin`.

**Option B: keep the custom scripts, assemble `latest.json` manually.** With
`createUpdaterArtifacts: true`, the builds additionally emit a signed archive per
platform plus a `.sig` file:
- macOS: `*.app.tar.gz` + `*.app.tar.gz.sig`
- Windows NSIS: `*-setup.exe` + `*-setup.exe.sig` (env vars must be set on the
  build step so the `.sig` is produced)

Add a step (after both builds, in `publish-release-notes` or a new job) that
reads the two `.sig` files and writes `latest.json`, then uploads it to the
release:

```json
{
  "version": "0.2.0",
  "notes": "See the release page for details.",
  "pub_date": "2026-08-01T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<contents of .app.tar.gz.sig>", "url": "https://github.com/wanmekwi/hymnbeam/releases/download/v0.2.0/HymnBeam_0.2.0_universal.app.tar.gz" },
    "darwin-x86_64":  { "signature": "<same universal sig>",          "url": "<same universal url>" },
    "windows-x86_64": { "signature": "<contents of -setup.exe.sig>",  "url": "https://github.com/wanmekwi/hymnbeam/releases/download/v0.2.0/HymnBeam_0.2.0_x64-setup.exe" }
  }
}
```

Upload the updater archives (`*.app.tar.gz`, and for Windows the `-setup.exe` is
reused) and `latest.json` to the release alongside the existing DMG/EXE.

### 5. Auto-relaunch after install (optional polish)

After `downloadAndInstall()`, the frontend tries `window.__TAURI__.process.relaunch()`.
That global only exists if the **process plugin** is added:

```toml
# Cargo.toml
tauri-plugin-process = "2"
```
```rust
// main.rs
.plugin(tauri_plugin_process::init())
```
```json
// capabilities/default.json → permissions
"core:default"  // process:default is covered by core:default in v2; verify
```

Without it, the frontend shows "Update installed — please restart HymnBeam."
On Windows the NSIS installer exits and relaunches the app itself, so this
mostly matters for macOS.

## Important caveats

- **Only works from the next release onward.** A user must already be running a
  build that has updater artifacts + the pubkey to receive an update. 0.1.9
  (this release) predates that, so 0.1.9 → 0.2.0 will still use the browser-
  download fallback; 0.2.0 → 0.3.0 is the first true self-update. Ship the
  activation in a normal release and it takes effect one release later.
- **macOS unsigned-app interaction.** The updater replaces `HymnBeam.app` in
  place. Because the app is not yet notarized, the replaced bundle can inherit a
  quarantine flag and hit Gatekeeper on relaunch. Notarizing the app (Apple
  Developer Program) removes this friction and is a prerequisite for a truly
  seamless macOS auto-update — see the 1.0 roadmap.
- **Verify the JS global.** Confirm `window.__TAURI__.updater.check` is defined
  in the built app (with `withGlobalTauri: true` it should be). If it isn't, the
  frontend already falls back to the browser download; expose the updater JS API
  (bundle `@tauri-apps/plugin-updater`) to enable the in-place path.
- **Keep the endpoint and pubkey in sync with the key.** If you ever rotate the
  signing key, every installed client must update before they can verify the new
  signatures — plan key rotation as a breaking change.
