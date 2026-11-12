# Plan: activate true in-app auto-update

The app already ships a **"Check for updates"** button (About modal + the "Check
for Updates…" app-menu item). Today it queries the GitHub releases API, and when
a newer version exists it opens the correct installer (`.dmg`/`.exe`) in the
browser for a manual install. This document covers upgrading that same button to
a **one-click in-place update** via Tauri's updater plugin.

Read the **Architecture primer** in [during-the-service.md](during-the-service.md)
first — the custom-protocol axum router, the Windows WebView2 upload caveat, and
the tag-driven release CI all matter here.

## How an update reaches a user

The updater has been live since v0.5.0. From the user's side:

1. **Launch check.** A few seconds after start-up the app quietly asks the
   updater plugin whether `latest.json` names a newer version. Nothing is
   downloaded. If there is one, a toast offers it and a dot appears on the logo
   (which opens About). "Check for Updates…" in the app menu and the About
   button run the same check on demand.
2. **Install update.** One click in About downloads the signed payload with a
   percentage, verifies it against the pubkey, swaps it over the installed app
   and relaunches. No browser, no DMG, no dragging to Applications.
3. **Never mid-service.** Installing restarts the app (on Windows the installer
   closes it outright), so if the projector is open the download completes and
   then waits behind a "Restart to finish updating" button, which itself refuses
   while the projector is still open.
4. **Fallbacks.** If the plugin check fails, the GitHub releases API is asked
   instead and the button opens the installer download in the browser. If the
   in-place install fails (app still on the disk image, unwritable folder), the
   panel points at the release page.

All of this lives in `frontend/js/app.js` under "App updates" (`updateFlow`,
`checkForUpdates`, `startUpdateDownload`, `installDownloadedUpdate`).

The payload is still the **whole app** (about 20 MB on macOS, 6 MB on Windows):
Tauri's updater has no delta patches. What the user is spared is the manual
reinstall, not the bytes.

## What's wired

- `tauri-plugin-updater`, `tauri-plugin-opener` and `tauri-plugin-process` are
  dependencies (`src-tauri/Cargo.toml`), all registered in
  `src-tauri/src/main.rs`, with `updater:default`, `opener:default` and
  `process:default` granted in `src-tauri/capabilities/default.json`.
- `src-tauri/tauri.conf.json` has a `plugins.updater` block with the GitHub
  "latest release" endpoint and the pubkey. (An absent `plugins.updater` block
  makes the app panic at startup. An empty pubkey makes `check()` fail, which
  sends the frontend down the browser-download fallback.)
- `.github/workflows/release.yml` and `build-macos.sh` sign updater artifacts
  and publish `latest.json`, with every updater step guarded on the
  `TAURI_SIGNING_PRIVATE_KEY` secret. `createUpdaterArtifacts` is injected by CI
  when signing (not hard-coded in config), so local builds need no key.
- `bundle.macOS.signingIdentity` is `"-"`, so Tauri ad-hoc signs the `.app`
  *before* it packs the DMG and the updater `.app.tar.gz`. Up to v0.5.1 the
  signing happened afterwards in `build-macos.sh`, which fixed up the DMG but
  left the updater payload with only the linker's signature (no sealed
  resources, a different code identifier from the DMG install). `build-macos.sh`
  now verifies the payload's signature and fails the build if it is missing.

## Status: ACTIVATED 2026-07-31

All five steps are done. Steps 1 and 3 were completed on 2026-07-12 (`eeab48c`),
but step 2 was only half-done — `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` went in and
`TAURI_SIGNING_PRIVATE_KEY` did not. Because every updater step is guarded on the
key, that failed silently: v0.2.1 → v0.4.0 shipped with a working pubkey to an
endpoint that returned 404, and each client fell back to the browser download
without complaint. The missing secret was added on 2026-07-31.

To stop that recurring, `.github/workflows/release.yml` has an
`updater-consistency` job that fails the run whenever the pubkey and the signing
secret disagree in either direction. It gates nothing, so a release still ships;
the run just goes red instead of quietly producing a dead updater.

The steps below are kept as a record of what was done, and as the procedure to
follow if the key is ever rotated.

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

- **Clients need the pubkey; they have it since v0.2.1.** To receive an in-place
  update a user must be running a build that carries the pubkey — not one that
  carried updater artifacts. Every release from v0.2.1 onward has it, so the
  first release published with a `latest.json` is immediately self-updatable
  *from* v0.2.1+. (This note previously said activation takes effect "one release
  later"; that was written before the pubkey shipped and no longer applies.)
  Anyone still on v0.2.0 or earlier keeps the browser-download fallback.
- **macOS is ad-hoc signed, not notarized.** The updater fetches the payload
  itself, so the replaced bundle carries no quarantine flag and Gatekeeper does
  not prompt on relaunch. The first install from the DMG still needs the
  quarantine step in the README; notarizing (Apple Developer Program) is what
  removes that — see the 1.0 roadmap.
- **The app must be able to replace itself.** Run straight from the mounted DMG,
  or installed where the user cannot write, the install step fails and the panel
  falls back to the release page.
- **Verify the JS global.** Confirm `window.__TAURI__.updater.check` is defined
  in the built app (with `withGlobalTauri: true` it should be). If it isn't, the
  frontend already falls back to the browser download; expose the updater JS API
  (bundle `@tauri-apps/plugin-updater`) to enable the in-place path.
- **Keep the endpoint and pubkey in sync with the key.** If you ever rotate the
  signing key, every installed client must update before they can verify the new
  signatures — plan key rotation as a breaking change.
