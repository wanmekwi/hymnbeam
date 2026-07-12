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

- `tauri-plugin-updater`, `tauri-plugin-opener` and `tauri-plugin-process` are
  dependencies (`src-tauri/Cargo.toml`), all registered in
  `src-tauri/src/main.rs`.
- `updater:default`, `opener:default` and `process:default` are granted in
  `src-tauri/capabilities/default.json`.
- `src-tauri/tauri.conf.json` has a `plugins.updater` block with the GitHub
  "latest release" endpoint and an **empty `pubkey`**. The empty pubkey is the
  dormant marker: the plugin loads, but `check()` fails signature verification,
  so the frontend's `tryPluginAutoUpdate()` catches the error and falls back to
  the browser download. (An absent `plugins.updater` block makes the app panic
  at startup — keep the block, just fill in the pubkey.)
- The frontend (`frontend/js/app.js`, `checkForUpdates` / `tryPluginAutoUpdate`)
  already prefers the plugin when it works and falls back otherwise. **No
  frontend changes are needed to activate.**
- **CI is done and dormant (Option B, gated).** `.github/workflows/release.yml`
  and `build-macos.sh` sign updater artifacts and publish `latest.json`, but
  every updater step is guarded on the `TAURI_SIGNING_PRIVATE_KEY` secret. With
  the secret unset the release builds exactly as before; setting it turns the
  whole path on. `createUpdaterArtifacts` is injected by CI when signing (not
  hard-coded in config), so there is no build-break trap.
- **Post-update relaunch is wired** — `tauri-plugin-process` is registered, so
  `tryPluginAutoUpdate()`'s `process.relaunch()` works once the updater is live
  (step 5 below is already done).

## What's left to activate (all yours)

Only three things remain, and all involve the signing key, which must never pass
through anyone else: **(1)** generate the key (step 1), **(2)** add the two CI
secrets (step 2), **(3)** paste the public key into `tauri.conf.json` (step 3).
Steps 4 and 5 are already implemented.

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

In `src-tauri/tauri.conf.json`, replace the empty pubkey with the public key
step 1 printed:

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/wanmekwi/hymnbeam/releases/latest/download/latest.json"
    ],
    "pubkey": "<PASTE THE PUBLIC KEY FROM STEP 1>"
  }
}
```

That is the **only** config change needed. `createUpdaterArtifacts` is *not* set
here — CI injects it via `--config` only when the signing secret is present (see
step 4), so there is no build that fails for lack of a key. The pubkey is public;
committing it is safe. This is the change that flips auto-update on for the *next*
build, so it belongs in the release commit where you also confirm steps 1–2 are
done.

### 4. Produce and publish `latest.json` in CI — DONE

Implemented as **Option B** (kept the custom scripts; `tauri-action` was rejected
because it wouldn't reproduce `build-macos.sh`'s ad-hoc-sign + signed-DMG swap).
Live in `.github/workflows/release.yml` + `build-macos.sh`:

- Both build jobs carry the `TAURI_SIGNING_*` env from repo secrets. When the key
  is set, `build-macos.sh` and the NSIS step add
  `--config '{"bundle":{"createUpdaterArtifacts":true}}'`, producing a signed
  `*.app.tar.gz` (macOS) / reusing `*-setup.exe` (Windows) plus a `.sig` each.
- The macOS `*.app.tar.gz` is uploaded to the release; each `.sig` is stashed as
  a workflow artifact.
- `publish-release-notes` assembles `latest.json` with `jq` (signatures inlined,
  download URLs resolved from the release's own assets) and uploads it.
- **Every updater step is guarded on `env.TAURI_SIGNING_PRIVATE_KEY != ''`.** No
  secret ⇒ no updater artifacts, `latest.json` assembly self-skips, release is
  identical to today. Nothing to break by merging this ahead of the key.

To smoke-test after adding the secrets, run the workflow via `workflow_dispatch`
(it builds without tagging a release).

### 5. Auto-relaunch after install — DONE

`tauri-plugin-process` is a dependency, registered in `main.rs`, with
`process:default` granted in `capabilities/default.json`. So after
`downloadAndInstall()` the frontend's `window.__TAURI__.process.relaunch()`
works once the updater is live. (Without it the frontend would show "Update
installed — please restart HymnBeam.") On Windows the NSIS installer exits and
relaunches the app itself, so relaunch mostly matters for macOS.

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
