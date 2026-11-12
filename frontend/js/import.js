// Importing songs from files and from another song database.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

let importInFlight = false;

function importFiles(files) {
    if (!files || files.length === 0) return;
    // Copy the FileList: the file input is cleared below, and a replace
    // deferred behind the confirm dialog must still read the files.
    const fileList = Array.from(files);
    // Clear immediately so picking the same file after a cancelled replace
    // still fires the input's change event.
    elements.fileInput.value = '';

    if (elements.replaceLibraryCheck.checked) {
        const what = fileList.length === 1
            ? `"${fileList[0].name}"`
            : `these ${fileList.length} files`;
        // Swap modals — stacking the confirm dialog over the import modal
        // renders both semi-transparent layers on top of each other.
        closeImportModal();
        openConfirm({
            title: 'Replace Library',
            message: `Delete every song in your library and replace it with the contents of ${what}? This cannot be undone.`,
            confirmLabel: 'Replace Library',
            onConfirm: () => performImport(fileList, true),
        });
        return;
    }

    performImport(fileList, false);
}

async function performImport(files, replace) {
    // Without this guard a double-click on the drop zone (or a second drop
    // while the first is still posting) fires a second POST /import — and
    // before the backend learned to dedupe that produced a doubled library.
    if (importInFlight) return;
    importInFlight = true;
    elements.dropZone.classList.add('busy');
    elements.dropZone.style.pointerEvents = 'none';
    elements.fileInput.disabled = true;

    let importedCount = 0;
    let lastError = '';
    // In replace mode only the first file wipes the library; any further
    // files are added on top of the fresh one.
    let replaceNext = replace;

    try {
        for (const file of files) {
            try {
                if (window.__TAURI__) {
                    // File contents go over IPC: on Windows, WebView2 never
                    // delivers File-backed fetch bodies to the axum custom
                    // protocol, so multipart POSTs arrive empty there.
                    const result = await window.__TAURI__.core.invoke('import_songs_from_content', {
                        filename: file.name,
                        content: await file.text(),
                        replace: replaceNext,
                    });
                    importedCount += result.imported;
                    replaceNext = false;
                } else {
                    const formData = new FormData();
                    formData.set('file', file);
                    const response = await fetch(`${API_URL}/import${replaceNext ? '?replace=true' : ''}`, {
                        method: 'POST',
                        body: formData
                    });
                    if (response.ok) {
                        const result = await response.json();
                        importedCount += result.imported;
                        replaceNext = false;
                    } else {
                        const detail = await response.text().catch(() => '');
                        lastError = detail || `Import failed (${response.status})`;
                        console.error(`Import failed for ${file.name}:`, response.status, detail);
                    }
                }
            } catch (error) {
                lastError = typeof error === 'string'
                    ? error
                    : 'Could not reach the server — try restarting the app';
                console.error(`Error importing ${file.name}:`, error);
            }
        }

        const replaced = replace && !replaceNext;
        if (replaced) {
            // The whole old library is gone — drop any state that points at it.
            state.currentSong = null;
            state.currentVerseIndex = 0;
            renderSongDisplay();
            fetchCollections();
            if (state.openCollection?.id != null) {
                openCollectionDetail(state.openCollection.id, { showView: false });
            }
        }

        if (importedCount > 0) {
            updateStatus(replaced
                ? `Library replaced — ${importedCount} song${importedCount !== 1 ? 's' : ''} imported`
                : `Imported ${importedCount} song${importedCount !== 1 ? 's' : ''}`);
            await fetchSongs();
            openLibraryTab();
        } else if (lastError) {
            updateStatus(lastError);
        } else {
            updateStatus('No songs were imported from that file');
        }

        closeImportModal();
    } finally {
        importInFlight = false;
        elements.dropZone.classList.remove('busy');
        elements.dropZone.style.pointerEvents = '';
        elements.fileInput.disabled = false;
        elements.fileInput.value = '';
    }
}


function openImportModal() {
    // Replacing the library is opt-in on every visit — never sticky.
    elements.replaceLibraryCheck.checked = false;
    elements.importModal.classList.add('active');
}


function closeImportModal() {
    elements.importModal.classList.remove('active');
}


// ── Import from another database ─────────────────────────────────────────────
// Opens a second songs database read-only, lets the operator browse it and
// cherry-pick songs to bring into the live library. The database is never
// touched — only the selected songs are copied in.

// Holds the currently-opened database. `songs` is the parsed list exactly as
// returned by the backend; `selected` tracks chosen songs by their index into
// that list, which is stable because the list is never reordered.
let dbImport = { filename: '', songs: [], selected: new Set(), filter: '' };

async function previewDatabase(filename, content) {
    if (window.__TAURI__) {
        return await window.__TAURI__.core.invoke('preview_import_database', {
            filename,
            content,
        });
    }
    const response = await fetch(`${API_URL}/import/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content }),
    });
    if (!response.ok) throw new Error((await response.text().catch(() => '')) || 'Could not read that file');
    return await response.json();
}

async function importSelectedSongs(songs, source) {
    if (window.__TAURI__) {
        return await window.__TAURI__.core.invoke('import_selected_songs', { songs, source });
    }
    const response = await fetch(`${API_URL}/import/selected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songs, source }),
    });
    if (!response.ok) throw new Error((await response.text().catch(() => '')) || 'Import failed');
    return await response.json();
}

function openDbImportModal() {
    resetDbBrowser();
    elements.dbImportModal.classList.add('active');
}

function closeDbImportModal() {
    elements.dbImportModal.classList.remove('active');
}

// Return to the file-picker view, discarding whatever database was open.
function resetDbBrowser() {
    dbImport = { filename: '', songs: [], selected: new Set(), filter: '' };
    elements.dbFileInput.value = '';
    elements.dbSearchInput.value = '';
    elements.dbSourceInput.value = '';
    elements.dbDropZone.hidden = false;
    elements.dbBrowser.hidden = true;
    elements.dbImportFooter.hidden = true;
    elements.dbSongList.innerHTML = '';
}

let dbPreviewInFlight = false;
async function openDatabaseFile(file) {
    if (!file || dbPreviewInFlight) return;
    dbPreviewInFlight = true;
    elements.dbDropZone.classList.add('busy');
    try {
        const content = await file.text();
        const songs = await previewDatabase(file.name, content);
        if (!Array.isArray(songs) || songs.length === 0) {
            updateStatus('No songs found in that file');
            return;
        }
        dbImport = { filename: file.name, songs, selected: new Set(), filter: '' };
        elements.dbSearchInput.value = '';
        elements.dbSourceInfo.innerHTML =
            `<strong>${escapeHtml(file.name)}</strong> — ${songs.length} song${songs.length !== 1 ? 's' : ''}`;
        elements.dbDropZone.hidden = true;
        elements.dbBrowser.hidden = false;
        elements.dbImportFooter.hidden = false;
        renderDbSongList();
    } catch (error) {
        const msg = typeof error === 'string' ? error : (error?.message || 'Could not read that file');
        updateStatus(msg);
        console.error('Database preview failed:', error);
    } finally {
        dbPreviewInFlight = false;
        elements.dbDropZone.classList.remove('busy');
        elements.dbFileInput.value = '';
    }
}

// Indices (into dbImport.songs) that match the current search filter.
function dbVisibleIndices() {
    const q = dbImport.filter.trim().toLowerCase();
    return dbImport.songs
        .map((song, i) => i)
        .filter((i) => {
            if (!q) return true;
            const s = dbImport.songs[i];
            return (
                (s.title || '').toLowerCase().includes(q) ||
                (s.author || '').toLowerCase().includes(q) ||
                String(s.song_number || '').toLowerCase().includes(q)
            );
        });
}

function renderDbSongList() {
    const visible = dbVisibleIndices();

    if (visible.length === 0) {
        elements.dbSongList.innerHTML =
            `<div class="db-browser-empty">No songs match “${escapeHtml(dbImport.filter)}”.</div>`;
        updateDbSelectionUI();
        return;
    }

    elements.dbSongList.innerHTML = visible.map((i) => {
        const s = dbImport.songs[i];
        const number = s.song_number ? `#${escapeHtml(String(s.song_number))}` : '';
        const verseCount = Array.isArray(s.verses) ? s.verses.length : 0;
        const meta = [
            s.author ? escapeHtml(s.author) : '',
            `${verseCount} verse${verseCount !== 1 ? 's' : ''}`,
        ].filter(Boolean).join(' · ');
        const checked = dbImport.selected.has(i) ? 'checked' : '';
        const selectedClass = dbImport.selected.has(i) ? ' selected' : '';
        return `
            <label class="db-song-item${selectedClass}" data-index="${i}">
                <input type="checkbox" ${checked}>
                <span class="db-song-info">
                    <span class="db-song-header">
                        ${number ? `<span class="num">${number}</span>` : ''}
                        <span class="title">${escapeHtml(s.title)}</span>
                        ${s.musical_key ? `<span class="key">${escapeHtml(s.musical_key)}</span>` : ''}
                    </span>
                    <span class="db-song-meta">${meta}</span>
                </span>
            </label>
        `;
    }).join('');

    updateDbSelectionUI();
}

// Sync the select-all checkbox, selected count, and Import button to the
// current selection. Select-all reflects only the visible (filtered) songs.
function updateDbSelectionUI() {
    const visible = dbVisibleIndices();
    const visibleSelected = visible.filter((i) => dbImport.selected.has(i)).length;
    const allVisibleSelected = visible.length > 0 && visibleSelected === visible.length;

    elements.dbSelectAll.checked = allVisibleSelected;
    elements.dbSelectAll.indeterminate = visibleSelected > 0 && !allVisibleSelected;

    const total = dbImport.selected.size;
    elements.dbSelectedCount.textContent = total ? `${total} selected` : '';
    elements.dbImportSelectedBtn.disabled = total === 0;
    elements.dbImportSelectedBtn.textContent = total
        ? `Import ${total} selected`
        : 'Import selected';
}

let dbImportInFlight = false;
async function performDbImport() {
    if (dbImportInFlight || dbImport.selected.size === 0) return;
    dbImportInFlight = true;
    elements.dbImportSelectedBtn.disabled = true;

    // Preserve the database's own order for the songs being imported.
    const chosen = [...dbImport.selected].sort((a, b) => a - b).map((i) => dbImport.songs[i]);
    const source = elements.dbSourceInput.value.trim() || null;
    try {
        const result = await importSelectedSongs(chosen, source);
        const n = result.imported ?? chosen.length;
        updateStatus(`Imported ${n} song${n !== 1 ? 's' : ''}`);
        await fetchSongs();
        openLibraryTab();
        closeDbImportModal();
    } catch (error) {
        const msg = typeof error === 'string' ? error : (error?.message || 'Import failed');
        updateStatus(msg);
        console.error('Selected import failed:', error);
        elements.dbImportSelectedBtn.disabled = false;
    } finally {
        dbImportInFlight = false;
    }
}
