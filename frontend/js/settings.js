// Display settings, and the library maintenance panel (backups, trash,
// duplicates) that lives in the same dialog.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

// ---------- Display settings ----------

// Which display profile the settings dialog is editing: 'song' or 'bible'.
let settingsTarget = 'song';

// The settings object the dialog's controls currently read/write. Bible verses
// only use their own profile once the user turns on "separate"; until then the
// Bible target is a locked, read-only view of the song settings.
function targetSettings() {
    if (settingsTarget === 'bible' && state.settings.bible.separate) {
        return state.settings.bible;
    }
    return state.settings;
}

// Alignment is always per-profile (see DEFAULT_SETTINGS.bible), so it reads
// and writes the Bible's own typography even while the rest mirrors songs.
function alignmentSettings() {
    return settingsTarget === 'bible' ? state.settings.bible.typography : state.settings.typography;
}

function bibleIsLocked() {
    return settingsTarget === 'bible' && !state.settings.bible.separate;
}

// Deep-copy the song display fields (everything except the logo, which stays
// shared) so the Bible profile can start life identical to the songs.
function songDisplaySlice() {
    const s = state.settings;
    return JSON.parse(JSON.stringify({
        typography: s.typography, background: s.background,
        layout: s.layout, transition: s.transition
    }));
}

// Copy the song look onto the Bible profile, keeping scripture's own alignment.
function copySongDisplayToBible() {
    const alignment = state.settings.bible.typography.alignment;
    Object.assign(state.settings.bible, songDisplaySlice());
    state.settings.bible.typography.alignment = alignment;
}

// Reflect the current edit target in the target-row controls and lock the
// display panels while Bible mirrors the song settings.
function syncTargetRow() {
    elements.setDisplayTarget.querySelectorAll('button').forEach(b =>
        b.classList.toggle('active', b.dataset.value === settingsTarget));
    const onBible = settingsTarget === 'bible';
    elements.bibleTargetOptions.classList.toggle('hidden', !onBible);
    elements.setBibleSameAsSongs.checked = !state.settings.bible.separate;
    elements.bibleMatchSongBtn.classList.toggle('hidden', !onBible || !state.settings.bible.separate);
    // The logo is a shared holding slide, not a per-profile option.
    elements.setLogoGroup.classList.toggle('hidden', onBible);
    elements.settingsContent.classList.toggle('display-locked', bibleIsLocked());
}

function mergeSettings(saved) {
    const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (saved && typeof saved === 'object') {
        if (saved.typography) Object.assign(out.typography, saved.typography);
        if (saved.background) {
            const savedGrad = saved.background.gradient;
            const savedImage = saved.background.image;
            Object.assign(out.background, saved.background);
            if (savedGrad) Object.assign(out.background.gradient, savedGrad);
            if (savedImage) Object.assign(out.background.image, savedImage);
        }
        if (saved.layout) Object.assign(out.layout, saved.layout);
        if (saved.transition) Object.assign(out.transition, saved.transition);
        if (saved.logo) Object.assign(out.logo, saved.logo);
        if (saved.bible && typeof saved.bible === 'object') {
            const sb = saved.bible;
            out.bible.separate = !!sb.separate;
            out.bible.initialized = !!sb.initialized;
            if (sb.typography) Object.assign(out.bible.typography, sb.typography);
            if (sb.background) {
                const g = sb.background.gradient, im = sb.background.image;
                Object.assign(out.bible.background, sb.background);
                if (g) Object.assign(out.bible.background.gradient, g);
                if (im) Object.assign(out.bible.background.image, im);
            }
            if (sb.layout) Object.assign(out.bible.layout, sb.layout);
            if (sb.transition) Object.assign(out.bible.transition, sb.transition);
        }
    }
    return out;
}

async function loadSettings() {
    try {
        const res = await fetch(`${API_URL}/settings`);
        if (!res.ok) throw new Error('Failed to load settings');
        state.settings = mergeSettings(await res.json());
    } catch (e) {
        console.warn('Settings load failed, using defaults', e);
        state.settings = mergeSettings(null);
    }
    // Iframe may have booted and asked for state already — push now that we
    // have settings to send. Safe to call repeatedly.
    pushSettingsToPreview();
    updatePreview();
}

let saveSettingsTimer = null;
function scheduleSaveSettings() {
    clearTimeout(saveSettingsTimer);
    saveSettingsTimer = setTimeout(async () => {
        try {
            await fetch(`${API_URL}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.settings)
            });
        } catch (e) {
            console.error('Settings save failed', e);
        }
    }, 250);
}

function pushSettingsToPreview() {
    if (!state.settings || !previewsEnabled()) return;
    const msg = { type: 'apply-settings', settings: state.settings };
    for (const frame of [elements.previewFrame, elements.nextPreviewFrame, elements.biblePreviewFrame]) {
        if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*');
    }
}

function pushSettingsToProjector() {
    pushSettingsToPreview();
    if (!window.__TAURI__ || !state.projectorOpen) return;
    window.__TAURI__.core.invoke('send_to_projector', {
        event: 'apply-settings',
        payload: JSON.stringify(state.settings)
    }).catch(err => console.error('Failed to push settings:', err));
}

function bgCssForSettings(s) {
    const bg = s.background;
    if (bg.kind === 'gradient') {
        return `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to})`;
    }
    if (bg.kind === 'image' && bg.image.filename) {
        const url = `${API_URL}/backgrounds/${encodeURIComponent(bg.image.filename)}`;
        const dim = Math.max(0, Math.min(1, bg.image.dim));
        return `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url('${url}') center/cover no-repeat`;
    }
    return bg.color;
}

function updateSettingsPreview() {
    const s = targetSettings();
    elements.settingsPreview.style.background = bgCssForSettings(s);
    const text = elements.settingsPreviewText;
    text.style.fontFamily = FONT_STACKS[s.typography.fontFamily] || FONT_STACKS['Montserrat'];
    text.style.fontWeight = s.typography.fontWeight;
    text.style.textAlign = alignmentSettings().alignment;
}

function syncSettingsForm() {
    syncTargetRow();
    const s = targetSettings();
    elements.setFontFamily.value = s.typography.fontFamily;
    elements.setFontWeight.value = s.typography.fontWeight;
    elements.setFontWeightValue.textContent = s.typography.fontWeight;
    elements.setAlignment.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.value === alignmentSettings().alignment);
    });

    elements.setBgKind.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.value === s.background.kind);
    });
    elements.setBgSolidGroup.classList.toggle('hidden', s.background.kind !== 'solid');
    elements.setBgGradientGroup.classList.toggle('hidden', s.background.kind !== 'gradient');
    elements.setBgImageGroup.classList.toggle('hidden', s.background.kind !== 'image');
    elements.setBgColor.value = s.background.color;
    elements.setBgGradFrom.value = s.background.gradient.from;
    elements.setBgGradTo.value = s.background.gradient.to;
    elements.setBgGradAngle.value = s.background.gradient.angle;
    elements.setBgGradAngleValue.textContent = `${s.background.gradient.angle}°`;
    syncBgImageThumb();
    syncLogoImageThumb();
    const dimPct = Math.round(s.background.image.dim * 100);
    elements.setBgImageDim.value = dimPct;
    elements.setBgImageDimValue.textContent = `${dimPct}%`;

    elements.setShowTitleBar.checked = s.layout.showTitleBar;
    elements.setShowMetaBar.checked = s.layout.showMetaBar;
    elements.setShowVerseLabel.checked = s.layout.showVerseLabel;
    // Older saved settings predate the flag; missing means enabled.
    elements.setAutoBreakLines.checked = s.layout.autoBreakLines !== false;
    elements.setSafeArea.value = s.layout.safeAreaPct;
    elements.setSafeAreaValue.textContent = `${s.layout.safeAreaPct}%`;

    elements.setTransStyle.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.value === s.transition.style);
    });
    elements.setTransDuration.value = s.transition.durationMs;
    elements.setTransDurationValue.textContent = `${s.transition.durationMs} ms`;
}

function syncBgImageThumb() {
    const fn = targetSettings().background.image.filename;
    if (fn) {
        const url = `${API_URL}/backgrounds/${encodeURIComponent(fn)}`;
        elements.setBgImageThumb.style.backgroundImage = `url('${url}')`;
        elements.setBgImageThumb.innerHTML = '';
    } else {
        elements.setBgImageThumb.style.backgroundImage = '';
        elements.setBgImageThumb.innerHTML = '<span class="image-thumb-placeholder">No image</span>';
    }
}

function syncLogoImageThumb() {
    const fn = state.settings.logo && state.settings.logo.image;
    if (fn) {
        const url = `${API_URL}/backgrounds/${encodeURIComponent(fn)}`;
        elements.setLogoImageThumb.style.backgroundImage = `url('${url}')`;
        elements.setLogoImageThumb.innerHTML = '';
    } else {
        elements.setLogoImageThumb.style.backgroundImage = '';
        elements.setLogoImageThumb.innerHTML = '<span class="image-thumb-placeholder">No image</span>';
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function uploadBackgroundImage(file) {
    if (window.__TAURI__) {
        // Same Windows WebView2 limitation as importFiles: send bytes over
        // IPC rather than a multipart POST to the custom protocol.
        return await window.__TAURI__.core.invoke('save_background_image', {
            filename: file.name,
            dataBase64: await fileToBase64(file),
        });
    }
    const form = new FormData();
    form.append('image', file, file.name);
    const res = await fetch(`${API_URL}/backgrounds`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('upload failed');
    const data = await res.json();
    return data.filename;
}

function onSettingsChanged() {
    // Editing the Bible profile counts as customising it, so it won't be
    // re-seeded from the song settings next time "separate" is toggled on.
    if (settingsTarget === 'bible' && state.settings.bible.separate) {
        state.settings.bible.initialized = true;
    }
    updateSettingsPreview();
    pushSettingsToProjector();
    scheduleSaveSettings();
}

function openSettingsModal() {
    settingsTarget = 'song';
    syncSettingsForm();
    updateSettingsPreview();
    elements.settingsModal.classList.add('active');
}

function closeSettingsModal() {
    elements.settingsModal.classList.remove('active');
}


// ----- Library maintenance (settings > Library tab) -----

function libraryListEmpty(listEl, text) {
    listEl.textContent = '';
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    listEl.appendChild(li);
}

function formatBytes(bytes) {
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Backup filenames look like songs-20260711-101530-manual.db (optionally
// with a -2 uniquifier); surface the label part as the human-readable kind.
function backupLabelFromName(name) {
    const m = name.match(/^songs-\d{8}-\d{6}-(.+?)(?:-\d+)?\.db$/);
    return m ? m[1] : '';
}

function refreshLibraryPanel() {
    renderBackupList();
    renderTrashList();
}

async function renderBackupList() {
    try {
        const res = await fetch(`${API_URL}/backups`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed');
        const backups = await res.json();
        const list = elements.backupList;
        if (backups.length === 0) return libraryListEmpty(list, 'No backups yet');
        list.textContent = '';
        for (const b of backups) {
            const li = document.createElement('li');
            const main = document.createElement('span');
            main.className = 'item-main';
            main.textContent = new Date(b.created_at_ms).toLocaleString();
            const meta = document.createElement('span');
            meta.className = 'item-meta';
            meta.textContent = `${backupLabelFromName(b.name)} · ${formatBytes(b.size_bytes)}`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary btn-small';
            btn.textContent = 'Restore';
            btn.addEventListener('click', () => confirmRestoreBackup(b));
            li.append(main, meta, btn);
            list.appendChild(li);
        }
    } catch (e) {
        console.error('renderBackupList:', e);
    }
}

async function backupNow() {
    try {
        elements.backupNowBtn.disabled = true;
        const res = await fetch(`${API_URL}/backups`, { method: 'POST' });
        if (!res.ok) throw new Error('Backup failed');
        await renderBackupList();
        updateStatus('Backup created');
    } catch (e) {
        console.error('backupNow:', e);
        updateStatus('Failed to create backup');
    } finally {
        elements.backupNowBtn.disabled = false;
    }
}

function confirmRestoreBackup(backup) {
    // Swap modals — same stacking problem as the replace-library confirm.
    closeSettingsModal();
    openConfirm({
        title: 'Restore Backup',
        message: `Replace the current library with the backup from ${new Date(backup.created_at_ms).toLocaleString()}? The current library is backed up first, so this can be undone.`,
        confirmLabel: 'Restore',
        onConfirm: () => restoreBackup(backup.name),
    });
}

async function restoreBackup(name) {
    try {
        const res = await fetch(`${API_URL}/backups/${encodeURIComponent(name)}/restore`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error(`Restore failed (${res.status})`);
        // The whole library may have changed — reset anything pointing at it.
        state.currentSong = null;
        state.currentVerseIndex = 0;
        renderSongDisplay();
        await fetchSongs();
        fetchCollections();
        updateStatus('Backup restored');
    } catch (e) {
        console.error('restoreBackup:', e);
        updateStatus('Failed to restore backup');
    }
}

async function renderTrashList() {
    try {
        const res = await fetch(`${API_URL}/trash`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed');
        const songs = await res.json();
        const list = elements.trashList;
        if (songs.length === 0) return libraryListEmpty(list, 'Nothing deleted recently');
        list.textContent = '';
        for (const song of songs) {
            const li = document.createElement('li');
            const main = document.createElement('span');
            main.className = 'item-main';
            main.textContent = song.author ? `${song.title} — ${song.author}` : song.title;
            const meta = document.createElement('span');
            meta.className = 'item-meta';
            // deleted_at is SQLite UTC ("YYYY-MM-DD HH:MM:SS") — mark it so
            // Date parses it correctly before rendering in local time.
            meta.textContent = new Date(`${song.deleted_at.replace(' ', 'T')}Z`).toLocaleString();
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary btn-small';
            btn.textContent = 'Restore';
            btn.addEventListener('click', () => restoreTrashedSong(song));
            li.append(main, meta, btn);
            list.appendChild(li);
        }
    } catch (e) {
        console.error('renderTrashList:', e);
    }
}

async function restoreTrashedSong(song) {
    try {
        const res = await fetch(`${API_URL}/songs/${song.id}/restore`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to restore song');
        await fetchSongs();
        fetchCollections();
        renderTrashList();
        updateStatus(`Restored "${song.title}"`);
    } catch (e) {
        console.error('restoreTrashedSong:', e);
        updateStatus('Failed to restore song');
    }
}

async function scanDuplicates() {
    try {
        elements.scanDuplicatesBtn.disabled = true;
        const res = await fetch(`${API_URL}/duplicates`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed');
        const groups = await res.json();
        const list = elements.duplicateList;
        if (groups.length === 0) return libraryListEmpty(list, 'No duplicates found');
        list.textContent = '';
        for (const group of groups) {
            const header = document.createElement('li');
            header.className = 'group-header';
            header.textContent = `${group.title} (${group.songs.length} copies)`;
            list.appendChild(header);

            const hashCounts = {};
            for (const s of group.songs) {
                hashCounts[s.content_hash] = (hashCounts[s.content_hash] || 0) + 1;
            }

            for (const song of group.songs) {
                const li = document.createElement('li');
                const main = document.createElement('span');
                main.className = 'item-main';
                main.textContent = song.title;
                const meta = document.createElement('span');
                meta.className = 'item-meta';
                meta.textContent = [
                    song.author,
                    song.song_number ? `#${song.song_number}` : null,
                    `${song.verse_count} verse${song.verse_count !== 1 ? 's' : ''}`,
                ].filter(Boolean).join(' · ');
                li.append(main, meta);
                if (hashCounts[song.content_hash] > 1) {
                    const badge = document.createElement('span');
                    badge.className = 'badge-identical';
                    badge.textContent = 'identical lyrics';
                    li.appendChild(badge);
                }
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-danger btn-small';
                btn.textContent = 'Delete';
                btn.addEventListener('click', () => deleteDuplicate(song));
                li.appendChild(btn);
                list.appendChild(li);
            }
        }
    } catch (e) {
        console.error('scanDuplicates:', e);
    } finally {
        elements.scanDuplicatesBtn.disabled = false;
    }
}

// Batch-assign a source to existing songs from the Library settings panel.
async function applyBatchSource() {
    const source = elements.batchSourceInput.value.trim();
    if (!source) {
        elements.batchSourceInput.focus();
        updateStatus('Enter a source name first');
        return;
    }
    const onlyUntagged = elements.batchSourceUntagged.checked;
    const scopeWord = onlyUntagged ? 'untagged songs' : 'ALL songs';
    openConfirm({
        title: 'Set Song Source',
        message: `Set the source of ${scopeWord} in your library to "${source}"?`,
        confirmLabel: 'Set Source',
        onConfirm: async () => {
            try {
                elements.applySourceBtn.disabled = true;
                let updated;
                if (window.__TAURI__) {
                    updated = await window.__TAURI__.core.invoke('set_songs_source', {
                        source,
                        onlyUntagged,
                    });
                } else {
                    const res = await fetch(`${API_URL}/songs/source`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ source, only_untagged: onlyUntagged }),
                    });
                    if (!res.ok) throw new Error('Failed');
                    updated = (await res.json()).updated;
                }
                updateStatus(`Source set on ${updated} song${updated !== 1 ? 's' : ''}`);
                elements.batchSourceInput.value = '';
                await fetchSongs();
                if (state.currentSong?.id != null) await loadSong(state.currentSong.id);
            } catch (e) {
                console.error('applyBatchSource:', e);
                updateStatus('Failed to set source');
            } finally {
                elements.applySourceBtn.disabled = false;
            }
        },
    });
}

async function deleteDuplicate(song) {
    try {
        const res = await fetch(`${API_URL}/songs/${song.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete song');
        if (state.currentSong?.id === song.id) {
            state.currentSong = null;
            state.currentVerseIndex = 0;
            renderSongDisplay();
        }
        await fetchSongs();
        fetchCollections();
        scanDuplicates();
        renderTrashList();
        updateStatus(`Moved "${song.title}" to Recently Deleted`, {
            label: 'Undo',
            onClick: () => undoDelete(song.id, song.title),
        });
    } catch (e) {
        console.error('deleteDuplicate:', e);
        updateStatus('Failed to delete song');
    }
}


function initSettingsDialog() {
    elements.settingsBtn.addEventListener('click', openSettingsModal);
    elements.closeSettingsModal.addEventListener('click', closeSettingsModal);
    elements.settingsDoneBtn.addEventListener('click', closeSettingsModal);
    elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) closeSettingsModal();
    });

    if (window.__TAURI__) {
        window.__TAURI__.event.listen('open-settings', () => openSettingsModal());
    }

    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.querySelector(`.settings-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
            const isLibrary = tab.dataset.tab === 'library';
            document.querySelector('.settings-body').classList.toggle('library-mode', isLibrary);
            // The Songs/Bible target only applies to the display tabs.
            elements.settingsTargetRow.classList.toggle('hidden', isLibrary);
            if (isLibrary) refreshLibraryPanel();
        });
    });

    elements.backupNowBtn.addEventListener('click', backupNow);
    elements.scanDuplicatesBtn.addEventListener('click', scanDuplicates);
    elements.applySourceBtn.addEventListener('click', applyBatchSource);

    // --- Display-profile editing target (Songs / Bible) ---
    elements.setDisplayTarget.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            settingsTarget = b.dataset.value;
            syncSettingsForm();
            updateSettingsPreview();
        });
    });
    elements.setBibleSameAsSongs.addEventListener('change', () => {
        const separate = !elements.setBibleSameAsSongs.checked;
        state.settings.bible.separate = separate;
        // Seed the Bible profile from the current song look the first time it's
        // split off, so "separate" starts out identical to the songs.
        if (separate && !state.settings.bible.initialized) {
            copySongDisplayToBible();
            state.settings.bible.initialized = true;
        }
        syncSettingsForm();
        onSettingsChanged();
    });
    elements.bibleMatchSongBtn.addEventListener('click', () => {
        copySongDisplayToBible();
        syncSettingsForm();
        onSettingsChanged();
    });

    elements.setFontFamily.addEventListener('change', () => {
        targetSettings().typography.fontFamily = elements.setFontFamily.value;
        onSettingsChanged();
    });
    elements.setFontWeight.addEventListener('input', () => {
        const w = parseInt(elements.setFontWeight.value, 10);
        targetSettings().typography.fontWeight = w;
        elements.setFontWeightValue.textContent = w;
        onSettingsChanged();
    });
    elements.setAlignment.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            alignmentSettings().alignment = b.dataset.value;
            syncSettingsForm();
            onSettingsChanged();
        });
    });

    elements.setBgKind.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            targetSettings().background.kind = b.dataset.value;
            syncSettingsForm();
            onSettingsChanged();
        });
    });
    elements.setBgColor.addEventListener('input', () => {
        targetSettings().background.color = elements.setBgColor.value;
        onSettingsChanged();
    });
    elements.setBgGradFrom.addEventListener('input', () => {
        targetSettings().background.gradient.from = elements.setBgGradFrom.value;
        onSettingsChanged();
    });
    elements.setBgGradTo.addEventListener('input', () => {
        targetSettings().background.gradient.to = elements.setBgGradTo.value;
        onSettingsChanged();
    });
    elements.setBgGradAngle.addEventListener('input', () => {
        const a = parseInt(elements.setBgGradAngle.value, 10);
        targetSettings().background.gradient.angle = a;
        elements.setBgGradAngleValue.textContent = `${a}°`;
        onSettingsChanged();
    });

    // Background image
    elements.setBgImageBrowseBtn.addEventListener('click', () => elements.setBgImageInput.click());
    elements.setBgImageInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const filename = await uploadBackgroundImage(file);
            targetSettings().background.image.filename = filename;
            targetSettings().background.kind = 'image';
            syncSettingsForm();
            onSettingsChanged();
        } catch (err) {
            console.error('Image upload failed', err);
            updateStatus('Image upload failed');
        }
    });
    elements.setBgImageRemoveBtn.addEventListener('click', () => {
        const t = targetSettings();
        t.background.image.filename = null;
        if (t.background.kind === 'image') t.background.kind = 'solid';
        syncSettingsForm();
        onSettingsChanged();
    });
    elements.setBgImageDim.addEventListener('input', () => {
        const pct = parseInt(elements.setBgImageDim.value, 10);
        targetSettings().background.image.dim = pct / 100;
        elements.setBgImageDimValue.textContent = `${pct}%`;
        onSettingsChanged();
    });

    elements.setLogoImageBrowseBtn.addEventListener('click', () => elements.setLogoImageInput.click());
    elements.setLogoImageInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const filename = await uploadBackgroundImage(file);
            state.settings.logo.image = filename;
            syncLogoImageThumb();
            onSettingsChanged();
            sendLogoState();  // reflect the new image live if the logo is showing
        } catch (err) {
            console.error('Logo upload failed', err);
            updateStatus('Image upload failed');
        }
    });
    elements.setLogoImageRemoveBtn.addEventListener('click', () => {
        state.settings.logo.image = null;
        syncLogoImageThumb();
        onSettingsChanged();
        sendLogoState();
    });

    // Layout
    const wireToggle = (el, path) => {
        el.addEventListener('change', () => {
            targetSettings().layout[path] = el.checked;
            onSettingsChanged();
        });
    };
    wireToggle(elements.setShowTitleBar, 'showTitleBar');
    wireToggle(elements.setShowMetaBar, 'showMetaBar');
    wireToggle(elements.setShowVerseLabel, 'showVerseLabel');
    wireToggle(elements.setAutoBreakLines, 'autoBreakLines');
    elements.setSafeArea.addEventListener('input', () => {
        const pct = parseInt(elements.setSafeArea.value, 10);
        targetSettings().layout.safeAreaPct = pct;
        elements.setSafeAreaValue.textContent = `${pct}%`;
        onSettingsChanged();
    });

    // Transitions
    elements.setTransStyle.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            targetSettings().transition.style = b.dataset.value;
            syncSettingsForm();
            onSettingsChanged();
        });
    });
    elements.setTransDuration.addEventListener('input', () => {
        const ms = parseInt(elements.setTransDuration.value, 10);
        targetSettings().transition.durationMs = ms;
        elements.setTransDurationValue.textContent = `${ms} ms`;
        onSettingsChanged();
    });

    elements.settingsResetBtn.addEventListener('click', () => {
        state.settings = mergeSettings(null);
        settingsTarget = 'song';
        syncSettingsForm();
        onSettingsChanged();
    });
}
