// Wiring and start-up: menu events, DOM listeners, keyboard shortcuts,
// preview layout, and the DOMContentLoaded boot sequence. Loaded last.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

// Map native menu items to existing UI actions.
function initMenuEvents() {
    if (!window.__TAURI__) return;
    const on = (name, fn) => window.__TAURI__.event.listen(name, fn);

    on('menu-new-song', () => openEditModal());
    on('menu-import', () => openImportModal());
    on('menu-import-database', () => openDbImportModal());
    on('menu-export-json', () => exportSongs('json'));
    on('menu-export-csv', () => exportSongs('csv'));
    on('menu-export-txt', () => exportSongs('txt'));
    on('menu-edit-song', () => {
        if (state.currentSong) openEditModal(state.currentSong);
        else updateStatus('Select a song first');
    });
    on('menu-delete-song', () => {
        if (state.currentSong) openDeleteConfirm();
        else updateStatus('Select a song first');
    });
    on('menu-toggle-projector', () => toggleProjector());
    on('menu-blank-screen', () => toggleBlank());
    on('menu-toggle-logo', () => toggleLogo());
    on('menu-shortcuts', () => openShortcutsModal());
    on('menu-check-update', () => {
        openAboutModal();
        checkForUpdates();
    });
    on('projector-closed', () => {
        state.projectorOpen = false;
        // The alert died with the projector window — reset the operator's
        // "live" indicator so it doesn't falsely claim an alert is up.
        clearAlert();
        setProjectorButton(false);
    });
}


function initEventListeners() {
    // Delegation listeners for all dynamically-rendered lists. These are
    // attached once to stable container elements so they survive every
    // innerHTML rebuild — per-element listeners silently stop firing after
    // DOM rebuilds in Tauri's WKWebView on macOS.
    elements.songList.addEventListener('click', (e) => {
        const item = e.target.closest('.song-item');
        if (item) loadSong(parseInt(item.dataset.id));
    });

    elements.lyricsScroll.addEventListener('click', (e) => {
        const card = e.target.closest('.verse-card');
        if (card) selectVerse(parseInt(card.dataset.index, 10));
    });

    elements.quickNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.nav-flow-btn');
        if (!btn) return;
        const navPos = parseInt(btn.dataset.navPos);
        state.navPosition = navPos;
        state.currentVerseIndex = state.navigationOrder[navPos];
        renderSongDisplay();
        sendToProjector();
    });

    elements.searchInput.addEventListener('input', (e) => {
        searchSongs(e.target.value);
    });

    elements.sortSelect.addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        if (state.searchQuery) {
            searchSongs(state.searchQuery);
        } else {
            fetchSongs();
        }
    });

    elements.importBtn.addEventListener('click', openImportModal);
    elements.closeModal.addEventListener('click', closeImportModal);
    elements.importModal.addEventListener('click', (e) => {
        if (e.target === elements.importModal) closeImportModal();
    });

    elements.aboutBtn.addEventListener('click', openAboutModal);
    elements.checkUpdateBtn.addEventListener('click', () => checkForUpdates());
    elements.closeAboutModal.addEventListener('click', closeAboutModal);
    elements.aboutModal.addEventListener('click', (e) => {
        if (e.target === elements.aboutModal) closeAboutModal();
    });

    elements.closeShortcutsModal.addEventListener('click', closeShortcutsModal);
    elements.shortcutsModal.addEventListener('click', (e) => {
        if (e.target === elements.shortcutsModal) closeShortcutsModal();
    });

    elements.dropZone.addEventListener('click', () => elements.fileInput.click());
    elements.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.dropZone.classList.add('dragover');
    });
    elements.dropZone.addEventListener('dragleave', () => {
        elements.dropZone.classList.remove('dragover');
    });
    elements.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.dropZone.classList.remove('dragover');
        importFiles(e.dataTransfer.files);
    });
    elements.fileInput.addEventListener('change', (e) => {
        importFiles(e.target.files);
    });

    // Import-from-database flow.
    elements.openDbImportBtn.addEventListener('click', () => {
        closeImportModal();
        openDbImportModal();
    });
    elements.closeDbImportModal.addEventListener('click', closeDbImportModal);
    elements.dbCancelBtn.addEventListener('click', closeDbImportModal);
    elements.dbImportModal.addEventListener('click', (e) => {
        if (e.target === elements.dbImportModal) closeDbImportModal();
    });
    elements.dbChangeFileBtn.addEventListener('click', resetDbBrowser);
    elements.dbDropZone.addEventListener('click', () => elements.dbFileInput.click());
    elements.dbDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.dbDropZone.classList.add('dragover');
    });
    elements.dbDropZone.addEventListener('dragleave', () => {
        elements.dbDropZone.classList.remove('dragover');
    });
    elements.dbDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.dbDropZone.classList.remove('dragover');
        if (e.dataTransfer.files?.length) openDatabaseFile(e.dataTransfer.files[0]);
    });
    elements.dbFileInput.addEventListener('change', (e) => {
        if (e.target.files?.length) openDatabaseFile(e.target.files[0]);
    });
    elements.dbSearchInput.addEventListener('input', (e) => {
        dbImport.filter = e.target.value;
        renderDbSongList();
    });
    elements.dbSelectAll.addEventListener('change', (e) => {
        const visible = dbVisibleIndices();
        if (e.target.checked) {
            visible.forEach((i) => dbImport.selected.add(i));
        } else {
            visible.forEach((i) => dbImport.selected.delete(i));
        }
        renderDbSongList();
    });
    // Each row is a <label>, so clicking anywhere on it (or the checkbox
    // itself) toggles the checkbox natively and fires `change` — we just read
    // the resulting state. Driving it from `change` keeps the checkbox and our
    // model in sync without fighting the browser's default label behaviour.
    elements.dbSongList.addEventListener('change', (e) => {
        const check = e.target.closest('input[type="checkbox"]');
        const item = e.target.closest('.db-song-item');
        if (!check || !item) return;
        const index = Number(item.dataset.index);
        if (check.checked) {
            dbImport.selected.add(index);
        } else {
            dbImport.selected.delete(index);
        }
        item.classList.toggle('selected', check.checked);
        updateDbSelectionUI();
    });
    elements.dbImportSelectedBtn.addEventListener('click', performDbImport);

    elements.projectorBtn.addEventListener('click', toggleProjector);
    elements.blankBtn.addEventListener('click', toggleBlank);
    elements.logoBtn.addEventListener('click', toggleLogo);

    elements.alertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAlertPopover();
    });
    elements.alertShowBtn.addEventListener('click', showAlert);
    elements.alertClearBtn.addEventListener('click', () => { clearAlert(); closeAlertPopover(); });
    elements.alertInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); showAlert(); }
    });
    renderAlertRecents();

    elements.newSongBtn.addEventListener('click', () => openEditModal());
    elements.editSongBtn.addEventListener('click', () => {
        if (state.currentSong) openEditModal(state.currentSong);
    });
    elements.deleteSongBtn.addEventListener('click', openDeleteConfirm);

    elements.closeEditModal.addEventListener('click', closeEditModal);
    elements.cancelEditBtn.addEventListener('click', closeEditModal);
    elements.editModal.addEventListener('click', (e) => {
        if (e.target === elements.editModal) closeEditModal();
    });
    elements.songForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveSong();
    });
    elements.songNumberInput.addEventListener('input', () => {
        const value = elements.songNumberInput.value.trim();
        if (!value) return clearSongNumberError();
        const conflict = findSongNumberConflict(value, state.editingSongId);
        if (conflict) {
            showSongNumberError(`Already used by "${conflict.title}"`);
        } else {
            clearSongNumberError();
        }
    });

    elements.cancelDeleteBtn.addEventListener('click', closeDeleteConfirm);
    elements.confirmDeleteBtn.addEventListener('click', () => {
        const action = confirmHandler;
        closeDeleteConfirm();
        if (action) action();
    });
    elements.confirmModal.addEventListener('click', (e) => {
        if (e.target === elements.confirmModal) closeDeleteConfirm();
    });

    // Export
    elements.exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExportMenu();
    });
    document.querySelectorAll('.export-option').forEach(btn => {
        btn.addEventListener('click', () => {
            closeExportMenu();
            exportSongs(btn.dataset.format);
        });
    });

    // Global operator shortcuts. Three rules keep this predictable mid-service:
    //
    //   1. Typing always wins — anything aimed at a field bails out early.
    //   2. Modifier chords bail out too, so the native menu accelerators
    //      (⌘⇧P, ⌘B, ⌘L …) stay the sole owners of their combinations and can
    //      never double-fire against a plain key here. Ctrl+digit is the one
    //      deliberate exception and is handled before that check.
    //   3. Escape unwinds one layer at a time rather than always clearing the
    //      display — see handleEscape().
    document.addEventListener('keydown', (e) => {
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            // Escape is the way back out of a field the operator tabbed into.
            if (e.key === 'Escape') {
                target.blur();
                closeAlertPopover();
            }
            return;
        }

        // Ctrl+1/2/3 jump straight to a sidebar tab. Deliberately a chord so it
        // doesn't collide with the bare digits that jump between verses.
        if (e.ctrlKey && !e.metaKey && !e.altKey && ['1', '2', '3'].includes(e.key)) {
            e.preventDefault();
            selectSidebarTab(parseInt(e.key, 10) - 1);
            return;
        }

        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            handleEscape();
            return;
        }

        // A dialog owns the keyboard while it is up; Escape (above) is the only
        // shortcut that reaches past it.
        if (getOpenModal()) return;

        switch (e.key) {
            case 'ArrowRight':
                navigateVerse(1);
                break;
            case 'ArrowLeft':
                navigateVerse(-1);
                break;
            case ' ':
                e.preventDefault();
                toggleBlank();
                break;
            // Order of service: step through the open collection. The page keys
            // are the obvious pairing for a presenter remote, which usually
            // sends PageUp/PageDown; . and , are the same thing under the
            // fingers already resting on the arrow keys.
            case 'PageDown':
            case '.':
                e.preventDefault();
                navigateCollection(1);
                break;
            case 'PageUp':
            case ',':
                e.preventDefault();
                navigateCollection(-1);
                break;
            case '1': case '2': case '3': case '4': case '5':
            case '6': case '7': case '8': case '9':
                jumpToVerse(parseInt(e.key) - 1);
                break;
            case '0':
                // 0 jumps to the 10th verse, matching the common tab-switcher convention.
                jumpToVerse(9);
                break;
            case 'p':
            case 'P':
                toggleProjector();
                break;
            case 'f':
            case 'F':
                // Deliberately open-only: F is the "make sure output is live"
                // key, so a stray press can never kill the projection.
                if (!state.projectorOpen) toggleProjector();
                break;
            case 'l':
            case 'L':
                toggleLogo();
                break;
            case 'a':
                if (!elements.alertPopover.classList.contains('open')) toggleAlertPopover();
                break;
            case 'A':
                // Shift+A — pull a live alert off the screen without hunting
                // for the popover's Clear button.
                clearAlert();
                break;
            case '/':
                e.preventDefault();
                openLibraryTab();
                elements.searchInput.focus();
                elements.searchInput.select();
                break;
            case '?':
                e.preventDefault();
                openShortcutsModal();
                break;
            case '[':
                cycleSidebarTab(-1);
                break;
            case ']':
                cycleSidebarTab(1);
                break;
        }
    });

    // Sidebar tabs
    document.getElementById('libraryTabBtn').addEventListener('click', openLibraryTab);
    document.getElementById('collectionsTabBtn').addEventListener('click', activateCollectionsTab);

    // Collection list - create new collection but stay in library so user can add songs
    document.getElementById('newCollectionBtn').addEventListener('click', async () => {
        const id = await createCollection('New Collection');
        if (id) {
            updateStatus('Collection created — select a song and use "Add to Collection"');
        }
    });

    // Collection detail
    document.getElementById('backToCollectionsBtn').addEventListener('click', closeCollectionDetail);
    document.getElementById('deleteCollectionBtn').addEventListener('click', deleteOpenCollection);
    document.getElementById('goToLibraryBtn')?.addEventListener('click', openLibraryTab);

    let renameTimeout;
    document.getElementById('collectionNameInput').addEventListener('input', (e) => {
        clearTimeout(renameTimeout);
        const value = e.target.value;
        renameTimeout = setTimeout(() => {
            if (state.openCollection) renameCollection(state.openCollection.id, value);
        }, 600);
    });

    // Collection navigation
    document.getElementById('collectionPrevBtn').addEventListener('click', () => navigateCollection(-1));
    document.getElementById('collectionNextBtn').addEventListener('click', () => navigateCollection(1));

    document.getElementById('addCurrentSongToCollectionBtn')?.addEventListener('click', async () => {
        if (!state.openCollection || !state.currentSong) return;
        await addToCollection(state.openCollection.id);
    });

    document.getElementById('collectionAddBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('collectionAddMenu').classList.toggle('open');
    });
    document.getElementById('collectionAddBibleBtn').addEventListener('click', addBibleToCollection);
    elements.collectionBibleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addBibleToCollection(); }
    });
    document.getElementById('collectionAddLogoBtn').addEventListener('click', addLogoToCollection);

    // Add to collection button
    document.getElementById('addToCollectionBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollectionPicker();
    });
    document.getElementById('collectionPickerNew').addEventListener('click', async () => {
        document.getElementById('collectionPicker').classList.remove('open');
        const id = await createCollection('New Collection');
        if (id && state.currentSong) await addToCollection(id);
    });

    // Add the passage on screen in the Bible view to a collection
    document.getElementById('bibleAddToCollectionBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBibleCollectionPicker();
    });
    document.getElementById('bibleCollectionPickerNew')?.addEventListener('click', async () => {
        document.getElementById('bibleCollectionPicker').classList.remove('open');
        const id = await createCollection('New Collection');
        if (id) await addCurrentPassageToCollection(id);
    });

    // Close pickers when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.add-to-collection-wrapper')) {
            document.querySelectorAll('.collection-picker.open')
                .forEach(p => p.classList.remove('open'));
        }
        if (!e.target.closest('#exportBtn') && !e.target.closest('#exportMenu')) {
            closeExportMenu();
        }
        if (!e.target.closest('.alert-wrapper')) {
            closeAlertPopover();
        }
        if (!e.target.closest('.collection-add-wrapper')) {
            closeCollectionAddMenu();
        }
    });

    // All collection click handling via delegation — one stable listener per
    // container survives every innerHTML rebuild. Per-element listeners silently
    // stop firing after DOM rebuilds in Tauri's WKWebView on macOS.

    document.getElementById('collectionItems').addEventListener('click', (e) => {
        const item = e.target.closest('.collection-item');
        if (item) openCollectionDetail(parseInt(item.dataset.id));
    });

    document.getElementById('collectionSongItems').addEventListener('click', (e) => {
        const upBtn = e.target.closest('.collection-song-btn.up');
        if (upBtn) { e.stopPropagation(); moveCollectionSong(parseInt(upBtn.dataset.entryId), -1); return; }

        const downBtn = e.target.closest('.collection-song-btn.down');
        if (downBtn) { e.stopPropagation(); moveCollectionSong(parseInt(downBtn.dataset.entryId), 1); return; }

        const removeBtn = e.target.closest('.collection-song-btn.remove');
        if (removeBtn) { e.stopPropagation(); removeFromCollection(parseInt(removeBtn.dataset.entryId)); return; }

        const item = e.target.closest('.collection-song-item');
        if (!item || !state.openCollection) return;
        const entryId = parseInt(item.dataset.entryId);
        const pos = state.openCollection.songs.findIndex(s => s.id === entryId);
        if (pos >= 0) activateCollectionEntry(pos);
    });

    document.getElementById('collectionPickerList').addEventListener('click', (e) => {
        const btn = e.target.closest('.collection-picker-item');
        if (btn) {
            e.stopPropagation();
            addToCollection(parseInt(btn.dataset.id));
        }
    });

    document.getElementById('bibleCollectionPickerList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.collection-picker-item');
        if (btn) {
            e.stopPropagation();
            addCurrentPassageToCollection(parseInt(btn.dataset.id));
        }
    });
}


// The preview iframe posts {type:'projector-ready'} after DOMContentLoaded
// — at that moment its message-listener is attached and it's ready for a
// state pump. Settings first, then current verse, so applySettings has
// landed before updateDisplay tries to compute a fit.
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'projector-ready') {
        pushSettingsToPreview();
        updatePreview();
        sendLogoState();
        resendAlertState();
    }
});

// Keep the preview iframe's CSS scale in sync with the slot it lives in.
// The iframe always renders at 1920×1080 internally so projector.js computes
// fonts against the same viewport as the real projector — we just shrink the
// whole rendered output via transform: scale to fit the preview window.
const PREVIEW_VIRTUAL_W = 1920;
function syncPreviewScale() {
    // The Bible tab's preview lives in its own .preview-window (no id), so
    // derive its slot from the frame itself. Without this it stays at the CSS
    // fallback scale(0.1) and the verse renders tiny in the pane's top-left.
    const bibleWindow = elements.biblePreviewFrame?.closest('.preview-window');
    const panes = [
        [elements.previewWindow, elements.previewFrame],
        [elements.nextPreviewWindow, elements.nextPreviewFrame],
        [bibleWindow, elements.biblePreviewFrame]
    ];
    for (const [win, frame] of panes) {
        if (!win || !frame) continue;
        const w = win.clientWidth;
        if (!w) continue;
        frame.style.setProperty('--preview-scale', w / PREVIEW_VIRTUAL_W);
    }
}
window.addEventListener('resize', syncPreviewScale);

// Preview on/off: turn the operator's WYSIWYG previews (song "On screen now" /
// "Next" and the Bible preview) off entirely — hidden AND no longer fed — from
// a header button in either view. Remembered between sessions. The real
// projector output is unaffected; only these operator-side previews are gated.
const PREVIEW_HIDDEN_KEY = 'hymnbeam.previewHidden';
const SVG_EYE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>';
const SVG_EYE_OFF = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6.3 3.7A6.5 6.5 0 0 1 8 3.5c4.5 0 7 4.5 7 4.5a12 12 0 0 1-2 2.5M3.8 4.9A12 12 0 0 0 1 8s2.5 4.5 7 4.5a6.5 6.5 0 0 0 2.6-.5"/><path d="M2 2l12 12"/></svg>';

let previewsHidden = false;

// Preview iframes are only fed when previews are on, so an "off" preview does no
// rendering work. The projector send paths call this to skip preview posts.
function previewsEnabled() {
    return !previewsHidden;
}

function applyPreviewVisibility(hidden) {
    previewsHidden = hidden;
    elements.previewContainer.classList.toggle('collapsed', hidden);
    if (elements.biblePreviewContainer) {
        elements.biblePreviewContainer.classList.toggle('collapsed', hidden);
    }
    // Both header buttons mirror the shared state; the icon shows the current
    // state and the tooltip names the action.
    for (const btn of [elements.previewLayoutToggle, elements.biblePreviewToggle]) {
        if (!btn) continue;
        btn.innerHTML = hidden ? SVG_EYE_OFF : SVG_EYE;
        btn.title = hidden ? 'Show preview' : 'Hide preview';
    }
    // Turning previews back on: re-fit and repump the iframes, which received no
    // updates while off.
    if (!hidden) {
        syncPreviewScale();
        pushSettingsToPreview();
        updatePreview();
    }
}

function togglePreviewVisibility() {
    const hidden = !previewsHidden;
    try { localStorage.setItem(PREVIEW_HIDDEN_KEY, hidden ? '1' : '0'); } catch (e) { /* non-fatal */ }
    applyPreviewVisibility(hidden);
}

function initPreviewLayout() {
    let hidden = false;
    try { hidden = localStorage.getItem(PREVIEW_HIDDEN_KEY) === '1'; } catch (e) { /* default */ }
    applyPreviewVisibility(hidden);
    elements.previewLayoutToggle.addEventListener('click', togglePreviewVisibility);
    if (elements.biblePreviewToggle) {
        elements.biblePreviewToggle.addEventListener('click', togglePreviewVisibility);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    initEventListeners();
    initBibleListeners();
    initSettingsDialog();
    initMenuEvents();
    initPreviewLayout();

    // Set the preview scale once we have layout, and again on any size change.
    syncPreviewScale();
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(syncPreviewScale);
        if (elements.previewWindow) ro.observe(elements.previewWindow);
        // The Bible pane is display:none until its tab opens, so its window has
        // zero width at startup; observing it re-scales the moment it appears.
        const bibleWindow = elements.biblePreviewFrame?.closest('.preview-window');
        if (bibleWindow) ro.observe(bibleWindow);
    }

    const ready = await waitForBackend();
    if (!ready) {
        updateStatus('Backend not responding');
        return;
    }

    await loadSettings();
    openLibraryTab();
    fetchSongs();
    fetchCollections();

    // Look for a new version shortly after launch, once the UI has settled.
    // Quiet unless one exists; nothing is downloaded until the user says so.
    if (window.__TAURI__) setTimeout(() => checkForUpdates({ silent: true }), 4000);
});
