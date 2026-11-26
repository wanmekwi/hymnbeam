// Checking for, downloading and installing new versions of the app.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

// ----- App updates -----

const UPDATE_REPO = 'wanmekwi/hymnbeam';

function parseVersionParts(v) {
    return String(v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
}

// True when `latest` is a strictly higher version than `current` (x.y.z).
function isNewerVersion(latest, current) {
    const a = parseVersionParts(latest);
    const b = parseVersionParts(current);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x !== y) return x > y;
    }
    return false;
}

async function getCurrentVersion() {
    if (window.__TAURI__) {
        try { return await window.__TAURI__.core.invoke('get_app_version'); }
        catch (e) { console.warn('Could not get app version:', e); }
    }
    return '';
}

async function openExternalUrl(url) {
    if (window.__TAURI__) {
        try { await window.__TAURI__.core.invoke('open_external', { url }); return; }
        catch (e) { console.warn('open_external failed, falling back to window.open:', e); }
    }
    window.open(url, '_blank', 'noopener');
}

// Where the update flow currently stands. `update` is the updater plugin's
// handle once a newer version has been found; `stage` drives the About panel:
//   idle | checking | current | error   — nothing pending
//   available                           — found, one click installs it in place
//   downloading | installing            — busy
//   ready                               — downloaded, waiting for a safe restart
//   manual                              — in-place update unavailable; browser download
const updateFlow = { stage: 'idle', message: '', update: null, manualUrl: '' };

const UPDATE_PENDING_STAGES = ['available', 'ready', 'manual'];
const UPDATE_BUSY_STAGES = ['checking', 'downloading', 'installing'];

function setUpdateStage(stage, message = '') {
    updateFlow.stage = stage;
    updateFlow.message = message;
    renderUpdatePanel();
}

function renderUpdatePanel() {
    const { stage, message } = updateFlow;
    const pending = UPDATE_PENDING_STAGES.includes(stage);
    elements.updateStatus.textContent = message;
    elements.updateStatus.classList.toggle('update-available', pending);
    elements.checkUpdateBtn.disabled = UPDATE_BUSY_STAGES.includes(stage);
    // A dot on the logo keeps a found update discoverable after the toast fades.
    elements.aboutBtn.classList.toggle('has-update', pending);

    elements.updateAction.innerHTML = '';
    const addButton = (label, onClick) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary btn-small';
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        elements.updateAction.appendChild(btn);
    };
    if (stage === 'available') addButton('Install update', startUpdateDownload);
    else if (stage === 'ready') addButton('Restart to finish updating', installDownloadedUpdate);
    else if (stage === 'manual') addButton('Download update', () => openExternalUrl(updateFlow.manualUrl));
}

// Looks for a newer release. Prefers the Tauri updater plugin, which can then
// replace the installed app in place; if that isn't usable (plugin missing,
// manifest unreachable) it falls back to the GitHub releases API and a manual
// installer download. `silent` is the launch-time check: it stays quiet unless
// there is actually something to install.
async function checkForUpdates({ silent = false } = {}) {
    // Never throw away an update that is mid-download or already downloaded.
    if (UPDATE_BUSY_STAGES.includes(updateFlow.stage) || updateFlow.stage === 'ready') return;
    setUpdateStage('checking', silent ? '' : 'Checking for updates…');

    const current = await getCurrentVersion();
    const found = (version) => {
        if (silent) {
            updateStatus(`HymnBeam ${version} is available`,
                { label: 'Update', onClick: openAboutModal });
        }
        return `Version ${version} is available` + (current ? ` — you have ${current}.` : '.');
    };

    const updater = window.__TAURI__ && window.__TAURI__.updater;
    if (updater && typeof updater.check === 'function') {
        try {
            const update = await updater.check();
            if (update && update.available !== false) {
                updateFlow.update = update;
                setUpdateStage('available', found(update.version));
            } else {
                setUpdateStage('current', silent ? '' : (current
                    ? `You're up to date (version ${current}).`
                    : 'You\'re on the latest version.'));
            }
            return;
        } catch (e) {
            console.warn('In-app updater check failed, trying the releases API:', e);
        }
    }

    let rel;
    try {
        const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
            headers: { 'Accept': 'application/vnd.github+json' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        rel = await res.json();
    } catch (e) {
        console.error('Update check failed:', e);
        setUpdateStage('error', silent ? '' : 'Could not check for updates — check your connection.');
        return;
    }

    const latest = (rel.tag_name || '').replace(/^v/, '');
    if (!latest || !current || !isNewerVersion(latest, current)) {
        setUpdateStage('current', silent ? '' : (current
            ? `You're up to date (version ${current}).`
            : 'You\'re on the latest version.'));
        return;
    }

    const isWin = (navigator.userAgent || '').toLowerCase().includes('windows');
    const asset = (rel.assets || []).find(a => isWin ? a.name.endsWith('.exe') : a.name.endsWith('.dmg'));
    updateFlow.manualUrl = asset ? asset.browser_download_url : rel.html_url;
    setUpdateStage('manual', found(latest));
}

// Downloads the update found by checkForUpdates(), with progress. Downloading
// is harmless while a service is running; installing is not (it restarts the
// app, and on Windows the installer closes it outright), so the install step
// only follows automatically when the projector is closed.
async function startUpdateDownload() {
    const update = updateFlow.update;
    if (!update || updateFlow.stage !== 'available') return;
    const version = update.version;
    setUpdateStage('downloading', `Downloading version ${version}…`);

    let total = 0, received = 0, shownPct = -1;
    try {
        await update.download((ev) => {
            if (ev.event === 'Started') {
                total = (ev.data && ev.data.contentLength) || 0;
            } else if (ev.event === 'Progress') {
                received += ev.data.chunkLength;
                const pct = total ? Math.min(100, Math.floor(received / total * 100)) : -1;
                if (pct > shownPct) {
                    shownPct = pct;
                    elements.updateStatus.textContent = `Downloading version ${version}… ${pct}%`;
                }
            }
        });
    } catch (e) {
        console.error('Update download failed:', e);
        updateFlow.update = null;
        setUpdateStage('error', 'The update could not be downloaded — check your connection and try again.');
        return;
    }

    setUpdateStage('ready',
        `Version ${version} is downloaded. Restart HymnBeam once the projector is closed to finish.`);
    if (state.projectorOpen) {
        updateStatus(`Version ${version} is ready — it installs when you restart`);
        return;
    }
    await installDownloadedUpdate();
}

// Swaps the downloaded version in and restarts into it.
async function installDownloadedUpdate() {
    const update = updateFlow.update;
    if (!update || updateFlow.stage !== 'ready') return;
    if (state.projectorOpen) {
        setUpdateStage('ready', 'Close the projector first — finishing the update restarts HymnBeam.');
        return;
    }
    setUpdateStage('installing', `Installing version ${update.version}…`);
    try {
        // On Windows this hands over to the installer, which closes and
        // reopens the app itself, so nothing after this line runs there.
        await update.install();
    } catch (e) {
        // Typically the app is somewhere it can't replace itself: still on the
        // mounted disk image, or in a folder this user can't write to.
        console.error('Update install failed:', e);
        updateFlow.update = null;
        updateFlow.manualUrl = `https://github.com/${UPDATE_REPO}/releases/latest`;
        setUpdateStage('manual',
            'The update could not be installed automatically. Download it from the release page instead.');
        return;
    }
    const proc = window.__TAURI__.process;
    if (proc && typeof proc.relaunch === 'function') {
        await proc.relaunch();
    } else {
        setUpdateStage('current', 'Update installed — please restart HymnBeam.');
    }
}
