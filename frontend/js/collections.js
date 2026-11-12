// Collections (orders of service) and the sidebar tabs that hold them.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

function sameCollectionId(a, b) {
    return a != null && b != null && Number(a) === Number(b);
}


/** Collection GETs must bypass WebView cache or the sidebar stays stale until restart. */
function collectionApiUrl(path) {
    const sep = path.includes('?') ? '&' : '?';
    return `${API_URL}${path}${sep}_=${Date.now()}`;
}


async function fetchCollections() {
    try {
        const response = await fetch(collectionApiUrl('/collections'), { cache: 'no-store' });
        if (!response.ok) throw new Error('Failed');
        state.collections = await response.json();
        renderCollectionList();
    } catch (e) {
        console.error('fetchCollections:', e);
    }
}


// Where the song on screen sits in the open collection, or -1. Readings and
// logo slides carry no song_id at all, so with no song selected a bare
// `entry.song_id === state.currentSong?.id` is `undefined === undefined` and
// picks the first of them — the service would then start from the wrong item.
function collectionPositionOfCurrentSong() {
    const songId = state.currentSong?.id;
    if (songId == null || !state.openCollection) return -1;
    return state.openCollection.songs.findIndex(s => s.song_id === songId);
}


async function openCollectionDetail(collectionId, { showView = true } = {}) {
    try {
        const response = await fetch(collectionApiUrl(`/collections/${collectionId}`), {
            cache: 'no-store'
        });
        if (!response.ok) throw new Error('Failed');
        state.openCollection = await response.json();
        if (
            showView ||
            state.collectionPosition < 0 ||
            state.collectionPosition >= state.openCollection.songs.length
        ) {
            state.collectionPosition = collectionPositionOfCurrentSong();
        }
        renderCollectionDetail();
        if (showView) {
            document.getElementById('collectionsListView').classList.add('hidden');
            document.getElementById('collectionDetailView').classList.remove('hidden');
        }
    } catch (e) {
        console.error('openCollectionDetail:', e);
    }
}


function appendSongToOpenCollection(collectionId, entryId) {
    if (!state.openCollection || !state.currentSong) return;
    if (!sameCollectionId(state.openCollection.id, collectionId)) return;
    const songs = state.openCollection.songs;
    if (songs.some(s => s.song_id === state.currentSong.id)) return;
    songs.push({
        id: entryId,
        song_id: state.currentSong.id,
        title: state.currentSong.title,
        author: state.currentSong.author || null,
        position: songs.length + 1
    });
    state.collectionPosition = songs.length - 1;
    renderCollectionDetail();
}


function closeCollectionDetail() {
    state.openCollection = null;
    state.collectionPosition = -1;
    document.getElementById('collectionDetailView').classList.add('hidden');
    document.getElementById('collectionsListView').classList.remove('hidden');
    fetchCollections();
}


async function createCollection(name, { switchTab = false, openDetail = false } = {}) {
    try {
        console.log('[Collections] Creating collection:', name);
        const response = await fetch(`${API_URL}/collections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!response.ok) {
            const text = await response.text();
            console.error('[Collections] Create failed:', response.status, text);
            throw new Error('Failed');
        }
        const { id } = await response.json();
        console.log('[Collections] Created collection with id:', id);
        await fetchCollections();
        if (switchTab) {
            openCollectionsTab();
            if (openDetail) await openCollectionDetail(id);
        }
        updateStatus('Collection created');
        return id;
    } catch (e) {
        console.error('createCollection:', e);
        updateStatus('Could not create collection');
        return null;
    }
}


async function renameCollection(collectionId, name) {
    try {
        await fetch(`${API_URL}/collections/${collectionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (state.openCollection) state.openCollection.name = name;
        const idx = state.collections.findIndex(c => sameCollectionId(c.id, collectionId));
        if (idx !== -1) {
            state.collections[idx].name = name;
            renderCollectionList();
        }
    } catch (e) {
        console.error('renameCollection:', e);
    }
}


async function deleteOpenCollection() {
    if (!state.openCollection) return;
    try {
        await fetch(`${API_URL}/collections/${state.openCollection.id}`, { method: 'DELETE' });
        closeCollectionDetail();
    } catch (e) {
        console.error('deleteCollection:', e);
    }
}


async function addToCollection(collectionId) {
    if (!state.currentSong) {
        console.warn('[Collections] addToCollection called but no song selected');
        updateStatus('Select a song first');
        return;
    }
    try {
        console.log('[Collections] Adding song', state.currentSong.id, 'to collection', collectionId);
        const response = await fetch(`${API_URL}/collections/${collectionId}/songs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ song_id: state.currentSong.id })
        });
        if (!response.ok) {
            const text = await response.text();
            console.error('[Collections] Add failed:', response.status, text);
            throw new Error('Failed');
        }
        const result = await response.json();
        document.getElementById('collectionPicker').classList.remove('open');
        appendSongToOpenCollection(collectionId, result.entry_id);
        await fetchCollections();
        updateStatus('Added to collection');
    } catch (e) {
        console.error('addToCollection:', e);
        updateStatus('Could not add song to collection');
    }
}


async function removeFromCollection(entryId) {
    if (!state.openCollection) return;
    try {
        await fetch(`${API_URL}/collections/${state.openCollection.id}/songs/${entryId}`, {
            method: 'DELETE'
        });
        await openCollectionDetail(state.openCollection.id);
    } catch (e) {
        console.error('removeFromCollection:', e);
    }
}


async function moveCollectionSong(entryId, direction) {
    if (!state.openCollection) return;
    const songs = state.openCollection.songs;
    const idx = songs.findIndex(s => s.id === entryId);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= songs.length) return;

    const reordered = [...songs];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    const orderedIds = reordered.map(s => s.id);

    try {
        await fetch(`${API_URL}/collections/${state.openCollection.id}/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: orderedIds })
        });
        await openCollectionDetail(state.openCollection.id);
    } catch (e) {
        console.error('moveCollectionSong:', e);
    }
}


function scrollActiveCollectionSongIntoView() {
    requestAnimationFrame(() => {
        const active = document.querySelector('#collectionSongItems .collection-song-item.active-song');
        active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
}


function renderCollectionList() {
    const items = document.getElementById('collectionItems');
    const empty = elements.collectionEmptyState;
    const count = document.getElementById('collectionCount');
    const openId = state.openCollection?.id;

    count.textContent = `${state.collections.length} collection${state.collections.length !== 1 ? 's' : ''}`;

    if (state.collections.length === 0) {
        items.innerHTML = '';
        items.appendChild(empty);
        empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';
    items.innerHTML = state.collections.map(c => `
        <div class="collection-item ${openId != null && sameCollectionId(openId, c.id) ? 'active' : ''}" data-id="${c.id}">
            <div class="collection-item-info">
                <div class="collection-item-name">${escapeHtml(c.name)}</div>
                <div class="collection-item-meta">${c.song_count} song${c.song_count !== 1 ? 's' : ''}</div>
            </div>
            <svg class="collection-item-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M6 3l5 5-5 5"/>
            </svg>
        </div>
    `).join('');

}


function renderCollectionDetail() {
    if (!state.openCollection) return;

    const nameInput = document.getElementById('collectionNameInput');
    if (document.activeElement !== nameInput) {
        nameInput.value = state.openCollection.name;
    }

    const addCurrentBtn = document.getElementById('addCurrentSongToCollectionBtn');
    if (addCurrentBtn) {
        const canAdd = Boolean(state.currentSong);
        addCurrentBtn.classList.toggle('hidden', !canAdd);
        addCurrentBtn.disabled = !canAdd;
    }

    const container = document.getElementById('collectionSongItems');
    const empty = elements.collectionSongsEmptyState;
    const songs = state.openCollection.songs;

    if (songs.length === 0) {
        container.innerHTML = '';
        container.appendChild(empty);
        empty.style.display = 'flex';
    } else {
        empty.style.display = 'none';
        container.innerHTML = songs.map((s, idx) => {
            const isActive = idx === state.collectionPosition;
            const type = s.item_type || 'song';
            const subtitle = type === 'song' ? (s.author || '')
                           : type === 'bible' ? 'Bible passage'
                           : 'Holding slide';
            return `
                <div class="collection-song-item ${isActive ? 'active-song' : ''} entry-${type}" data-entry-id="${s.id}">
                    <span class="collection-song-pos">${idx + 1}</span>
                    <span class="collection-entry-icon" title="${type}">${collectionEntryIcon(type)}</span>
                    <div class="collection-song-info">
                        <div class="collection-song-title">${escapeHtml(s.title)}</div>
                        ${subtitle ? `<div class="collection-song-author">${escapeHtml(subtitle)}</div>` : ''}
                    </div>
                    <div class="collection-song-controls">
                        <button type="button" class="collection-song-btn up" data-entry-id="${s.id}" title="Move up" ${idx === 0 ? 'disabled' : ''}>
                            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 8l4-4 4 4"/></svg>
                        </button>
                        <button type="button" class="collection-song-btn down" data-entry-id="${s.id}" title="Move down" ${idx === songs.length - 1 ? 'disabled' : ''}>
                            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 4l4 4 4-4"/></svg>
                        </button>
                        <button type="button" class="collection-song-btn remove" data-entry-id="${s.id}" title="Remove">
                            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 2l8 8M10 2l-8 8"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    }

    const total = songs.length;
    const pos = state.collectionPosition;
    const posEl = document.getElementById('collectionPosition');
    posEl.textContent = total === 0 ? '—' : pos >= 0 ? `${pos + 1} / ${total}` : `— / ${total}`;
    document.getElementById('collectionPrevBtn').disabled = pos <= 0;
    document.getElementById('collectionNextBtn').disabled = pos >= total - 1;

    scrollActiveCollectionSongIntoView();
}


function collectionEntryIcon(type) {
    if (type === 'bible') {
        return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 3h7a2 2 0 0 1 2 2v8H5a2 2 0 0 0-2 2V3z"/><path d="M8 6v4M6 8h4"/></svg>';
    }
    if (type === 'logo') {
        return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="7" r="1.2"/><path d="M3 12l3-3 2.5 2.5L11 9l2 3"/></svg>';
    }
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3v8.5M6 3l7-1v8.5"/><circle cx="4.2" cy="11.5" r="1.8"/><circle cx="11.2" cy="10.5" r="1.8"/></svg>';
}

// Advance the projector to a collection entry, dispatching on its kind:
// song → load lyrics; bible → project the passage; logo → holding slide.
async function activateCollectionEntry(pos) {
    const entry = state.openCollection?.songs[pos];
    if (!entry) return;
    state.collectionPosition = pos;
    const type = entry.item_type || 'song';

    if (type === 'logo') {
        if (!state.showLogo) toggleLogo();
    } else {
        // Song / Bible reveal content, so any holding slide must come down.
        if (state.showLogo) {
            state.showLogo = false;
            syncScreenStateButtons();
            sendLogoState();
        }
        if (type === 'bible') {
            await projectCollectionBible(entry.reference);
        } else {
            await loadSong(entry.song_id);
        }
    }
    renderCollectionDetail();
    scrollActiveCollectionSongIntoView();
}

// Resolve a Bible reference and project it (main preview + projector), reusing
// the Bible module's parser and chapter fetch. Chapter-only refs project v1.
async function projectCollectionBible(reference) {
    if (typeof parseReference !== 'function' || typeof fetchBibleChapter !== 'function') {
        updateStatus('Bible module not ready');
        return;
    }
    try {
        await ensureBibleBooks();
    } catch (e) {
        console.error('projectCollectionBible:', e);
        updateStatus('Could not project passage');
        return;
    }
    const ref = parseReference(reference || '');
    if (!ref) {
        updateStatus(`Couldn't resolve "${reference}"`);
        return;
    }
    const verse = ref.verse || 1;
    try {
        const verses = await fetchBibleChapter(ref.book.code, ref.chapter);
        const row = verses.find(r => r.verse === verse);
        if (!row) {
            updateStatus(`Couldn't find ${reference}`);
            return;
        }
        const payload = {
            text: row.text,
            label: `${ref.chapter}:${verse}`,
            isBlank: false,
            isBible: true,
            title: `${ref.book.name} ${ref.chapter}:${verse}`,
            author: null,
            musical_key: null,
            songId: `bible-${ref.book.code}-${ref.chapter}-${verse}`,
            songNumber: null,
            verses: verses.map(v => v.text),
            hasPrev: false,
            hasNext: false
        };
        const msg = { type: 'update-lyrics', ...payload };
        if (previewsEnabled() && elements.previewFrame?.contentWindow) {
            elements.previewFrame.contentWindow.postMessage(msg, '*');
            clearNextPreview();
        }
        if (window.__TAURI__) {
            if (state.projectorOpen) {
                window.__TAURI__.core.invoke('send_to_projector', {
                    event: 'update-lyrics', payload: JSON.stringify(payload)
                }).catch(e => console.error('bible project error:', e));
            }
        } else if (window.projectorWindow) {
            window.projectorWindow.postMessage(msg, '*');
        }
    } catch (e) {
        console.error('projectCollectionBible:', e);
        updateStatus('Could not project passage');
    }
}

// A bible/logo entry has no "next verse"; blank the Next pane so it doesn't
// show the previously-loaded song's queue.
function clearNextPreview() {
    if (elements.nextPreviewFrame?.contentWindow) {
        elements.nextPreviewFrame.contentWindow.postMessage(BLANK_PREVIEW_MSG, '*');
    }
    if (elements.nextPreviewEmpty) {
        elements.nextPreviewEmpty.textContent = '';
        elements.nextPreviewEmpty.classList.remove('visible');
    }
}

async function addBibleToCollection() {
    if (!state.openCollection) return;
    const reference = elements.collectionBibleInput.value.trim();
    if (!reference) return;
    if (typeof parseReference === 'function') {
        // If the book list can't be loaded, let the reference through rather
        // than rejecting a valid one; it is resolved again when projected.
        const booksLoaded = await ensureBibleBooks().then(() => true, () => false);
        if (booksLoaded && !parseReference(reference)) {
            updateStatus(`Couldn't resolve "${reference}"`);
            return;
        }
    }
    try {
        const res = await fetch(`${API_URL}/collections/${state.openCollection.id}/songs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_type: 'bible', reference })
        });
        if (!res.ok) throw new Error(`Add failed (${res.status})`);
        elements.collectionBibleInput.value = '';
        closeCollectionAddMenu();
        await openCollectionDetail(state.openCollection.id, { showView: false });
    } catch (e) {
        console.error('addBibleToCollection:', e);
        updateStatus('Could not add passage');
    }
}

async function addLogoToCollection() {
    if (!state.openCollection) return;
    try {
        const res = await fetch(`${API_URL}/collections/${state.openCollection.id}/songs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_type: 'logo' })
        });
        if (!res.ok) throw new Error(`Add failed (${res.status})`);
        closeCollectionAddMenu();
        await openCollectionDetail(state.openCollection.id, { showView: false });
    } catch (e) {
        console.error('addLogoToCollection:', e);
        updateStatus('Could not add logo slide');
    }
}

function closeCollectionAddMenu() {
    document.getElementById('collectionAddMenu').classList.remove('open');
}


async function navigateCollection(direction) {
    if (!state.openCollection) return;
    const items = state.openCollection.songs;
    const newPos = state.collectionPosition + direction;
    if (newPos < 0 || newPos >= items.length) return;
    await activateCollectionEntry(newPos);
}


function openLibraryTab() {
    document.getElementById('biblePanel').classList.add('hidden');
    document.getElementById('bibleTabBtn').classList.remove('active');
    document.getElementById('libraryPanel').classList.remove('hidden');
    document.getElementById('collectionsPanel').classList.add('hidden');
    document.getElementById('libraryTabBtn').classList.add('active');
    document.getElementById('collectionsTabBtn').classList.remove('active');
}


function openCollectionsTab() {
    document.getElementById('biblePanel').classList.add('hidden');
    document.getElementById('bibleTabBtn').classList.remove('active');
    document.getElementById('libraryPanel').classList.add('hidden');
    document.getElementById('collectionsPanel').classList.remove('hidden');
    document.getElementById('libraryTabBtn').classList.remove('active');
    document.getElementById('collectionsTabBtn').classList.add('active');
}


// Opening the Collections tab also has to refresh the list and restore whatever
// collection was open. Both the tab button and the keyboard shortcuts go
// through here so they can never drift apart.
async function activateCollectionsTab() {
    openCollectionsTab();
    await fetchCollections();
    if (state.openCollection?.id != null) {
        await openCollectionDetail(state.openCollection.id, { showView: false });
    }
}


// Sidebar tab order, left to right — drives both the direct (Ctrl+1/2/3) and
// the cycling ([ / ]) shortcuts. openBibleTab lives in bible.js, which loads
// after this file; it is only referenced at keypress time so that is fine.
const SIDEBAR_TABS = [
    { id: 'libraryTabBtn', open: () => openLibraryTab() },
    { id: 'collectionsTabBtn', open: () => activateCollectionsTab() },
    { id: 'bibleTabBtn', open: () => openBibleTab() },
];

function selectSidebarTab(index) {
    const tab = SIDEBAR_TABS[index];
    if (tab) tab.open();
}

function cycleSidebarTab(direction) {
    const current = SIDEBAR_TABS.findIndex(
        t => document.getElementById(t.id).classList.contains('active'));
    const from = current === -1 ? 0 : current;
    // Wrap, so [ and ] keep working at either end of the row.
    selectSidebarTab((from + direction + SIDEBAR_TABS.length) % SIDEBAR_TABS.length);
}


async function toggleCollectionPicker() {
    const picker = document.getElementById('collectionPicker');
    const isOpen = picker.classList.contains('open');
    console.log('[Collections] Toggle picker, currently open:', isOpen);
    if (isOpen) {
        picker.classList.remove('open');
        return;
    }
    if (!state.currentSong) {
        updateStatus('Select a song first');
        return;
    }
    await fetchCollections();
    renderCollectionPickerList(document.getElementById('collectionPickerList'));
    picker.classList.add('open');
}


// Shared by the song picker and the Bible picker.
function renderCollectionPickerList(list) {
    if (state.collections.length === 0) {
        list.innerHTML = '<p class="collection-picker-empty">No collections yet — create one below.</p>';
        return;
    }
    list.innerHTML = state.collections.map(c => `
        <button type="button" class="collection-picker-item" data-id="${c.id}">
            ${escapeHtml(c.name)}
            <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">${c.song_count}</span>
        </button>
    `).join('');
}


// ---------- Bible passage → collection ----------

// bible.js is a separate script; guard the same way projectCollectionBible does
// so a load failure degrades to "nothing to add" instead of a ReferenceError.
function bibleReferenceOnScreen() {
    return typeof currentBibleReference === 'function' ? currentBibleReference() : null;
}

// The Bible view gets its own picker rather than borrowing the song view's, so
// neither has to be moved around the DOM when the content view switches.
async function toggleBibleCollectionPicker() {
    const picker = document.getElementById('bibleCollectionPicker');
    if (picker.classList.contains('open')) {
        picker.classList.remove('open');
        return;
    }
    if (!bibleReferenceOnScreen()) {
        updateStatus('Open a passage first');
        return;
    }
    await fetchCollections();
    renderCollectionPickerList(document.getElementById('bibleCollectionPickerList'));
    picker.classList.add('open');
}


// Adds whatever the Bible view is showing — the active verse, or the chapter
// when none is selected. Stored as a reference, matching the passages added
// from the collection panel's own "+ Add" menu.
async function addCurrentPassageToCollection(collectionId) {
    const reference = bibleReferenceOnScreen();
    if (!reference) {
        updateStatus('Open a passage first');
        return;
    }
    try {
        const res = await fetch(`${API_URL}/collections/${collectionId}/songs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_type: 'bible', reference })
        });
        if (!res.ok) throw new Error(`Add failed (${res.status})`);
        document.getElementById('bibleCollectionPicker').classList.remove('open');
        await fetchCollections();
        // Only the open collection's list is on screen; refresh it in place.
        if (state.openCollection && sameCollectionId(state.openCollection.id, collectionId)) {
            await openCollectionDetail(collectionId, { showView: false });
        }
        updateStatus(`Added ${reference}`);
    } catch (e) {
        console.error('addCurrentPassageToCollection:', e);
        updateStatus('Could not add passage to collection');
    }
}
