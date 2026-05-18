// The backend is accessible via the tauri-plugin-axum custom protocol.
// On macOS/iOS/Linux: axum://localhost
// On Windows/Android: http://axum.localhost
const API_URL = (() => {
    if (!window.__TAURI_INTERNALS__ && !window.__TAURI__) {
        console.log('[HymnBeam] Not in Tauri, using fallback API URL');
        return 'http://127.0.0.1:8765';
    }
    const isWin = navigator.platform?.toLowerCase().includes('win') ||
                  navigator.userAgent?.toLowerCase().includes('windows');
    const url = isWin ? 'http://axum.localhost' : 'axum://localhost';
    console.log('[HymnBeam] API_URL =', url);
    return url;
})();

const state = {
    songs: [],
    currentSong: null,
    currentVerseIndex: 0,
    navigationOrder: [],
    navPosition: 0,
    isBlank: false,
    projectorOpen: false,
    editingVerse: [],
    editingSongId: null,
    sortBy: 'number',
    searchQuery: '',
    searchResults: null,  // null = not searching, [] = empty results
    collections: [],        // all collection summaries
    openCollection: null,   // currently open collection (full with songs)
    collectionPosition: -1, // index of active song in open collection
    settings: null,         // display settings (typography + background)
};

const DEFAULT_SETTINGS = {
    typography: { fontFamily: 'Montserrat', fontWeight: 600, alignment: 'center' },
    background: {
        kind: 'solid',
        color: '#000000',
        gradient: { from: '#000000', to: '#1a1a2e', angle: 180 },
        image: { filename: null, dim: 0.4 }
    },
    layout: { showTitleBar: true, showMetaBar: true, showVerseLabel: false, safeAreaPct: 5 },
    transition: { style: 'fade-up', durationMs: 400 }
};

const FONT_STACKS = {
    // Bundled (see frontend/fonts/NOTICES.md)
    'Montserrat':       "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
    'Inter':            "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    'Lora':             "'Lora', Georgia, 'Times New Roman', serif",
    'EB Garamond':      "'EB Garamond', Garamond, Georgia, serif",
    'Crimson Pro':      "'Crimson Pro', Georgia, 'Times New Roman', serif",
    'Playfair Display': "'Playfair Display', Georgia, serif",
    // System fallbacks
    'system-sans':      "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    'system-serif':     "Georgia, 'Times New Roman', serif"
};

// The backend server is started before the window opens, so it is normally
// ready immediately. Poll briefly to handle any slow first start.
async function waitForBackend(retries = 20, delayMs = 150) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(`${API_URL}/`);
            if (response.ok) return true;
        } catch (e) {
            // not up yet — keep waiting
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return false;
}

const elements = {
    searchInput: document.getElementById('searchInput'),
    songList: document.getElementById('songList'),
    songCount: document.getElementById('songCount'),
    emptyState: document.getElementById('emptyState'),
    contentPlaceholder: document.getElementById('contentPlaceholder'),
    songDisplay: document.getElementById('songDisplay'),
    displayTitle: document.getElementById('displayTitle'),
    displayAuthor: document.getElementById('displayAuthor'),
    lyricsScroll: document.getElementById('lyricsScroll'),
    previewFrame: document.getElementById('previewFrame'),
    previewWindow: document.getElementById('previewWindow'),
    importBtn: document.getElementById('importBtn'),
    projectorBtn: document.getElementById('projectorBtn'),
    blankBtn: document.getElementById('blankBtn'),
    importModal: document.getElementById('importModal'),
    closeModal: document.getElementById('closeModal'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    toast: document.getElementById('toast'),
    sortSelect: document.getElementById('sortSelect'),
    newSongBtn: document.getElementById('newSongBtn'),
    editSongBtn: document.getElementById('editSongBtn'),
    deleteSongBtn: document.getElementById('deleteSongBtn'),
    editModal: document.getElementById('editModal'),
    editModalTitle: document.getElementById('editModalTitle'),
    closeEditModal: document.getElementById('closeEditModal'),
    songForm: document.getElementById('songForm'),
    songNumberInput: document.getElementById('songNumberInput'),
    songNumberHint: document.getElementById('songNumberHint'),
    songKeyInput: document.getElementById('songKeyInput'),
    songAuthorInput: document.getElementById('songAuthorInput'),
    songPasteInput: document.getElementById('songPasteInput'),
    quickNav: document.getElementById('quickNav'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    confirmModal: document.getElementById('confirmModal'),
    confirmMessage: document.getElementById('confirmMessage'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    exportBtn: document.getElementById('exportBtn'),
    exportMenu: document.getElementById('exportMenu'),
    aboutBtn: document.getElementById('aboutBtn'),
    aboutModal: document.getElementById('aboutModal'),
    closeAboutModal: document.getElementById('closeAboutModal'),
    aboutVersion: document.getElementById('aboutVersion'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsModal: document.getElementById('closeSettingsModal'),
    settingsDoneBtn: document.getElementById('settingsDoneBtn'),
    settingsResetBtn: document.getElementById('settingsResetBtn'),
    setFontFamily: document.getElementById('setFontFamily'),
    setFontWeight: document.getElementById('setFontWeight'),
    setFontWeightValue: document.getElementById('setFontWeightValue'),
    setAlignment: document.getElementById('setAlignment'),
    setBgKind: document.getElementById('setBgKind'),
    setBgColor: document.getElementById('setBgColor'),
    setBgSolidGroup: document.getElementById('setBgSolidGroup'),
    setBgGradientGroup: document.getElementById('setBgGradientGroup'),
    setBgGradFrom: document.getElementById('setBgGradFrom'),
    setBgGradTo: document.getElementById('setBgGradTo'),
    setBgGradAngle: document.getElementById('setBgGradAngle'),
    setBgGradAngleValue: document.getElementById('setBgGradAngleValue'),
    setBgImageGroup: document.getElementById('setBgImageGroup'),
    setBgImageThumb: document.getElementById('setBgImageThumb'),
    setBgImageBrowseBtn: document.getElementById('setBgImageBrowseBtn'),
    setBgImageRemoveBtn: document.getElementById('setBgImageRemoveBtn'),
    setBgImageInput: document.getElementById('setBgImageInput'),
    setBgImageDim: document.getElementById('setBgImageDim'),
    setBgImageDimValue: document.getElementById('setBgImageDimValue'),
    setShowTitleBar: document.getElementById('setShowTitleBar'),
    setShowMetaBar: document.getElementById('setShowMetaBar'),
    setShowVerseLabel: document.getElementById('setShowVerseLabel'),
    setSafeArea: document.getElementById('setSafeArea'),
    setSafeAreaValue: document.getElementById('setSafeAreaValue'),
    setTransStyle: document.getElementById('setTransStyle'),
    setTransDuration: document.getElementById('setTransDuration'),
    setTransDurationValue: document.getElementById('setTransDurationValue'),
    settingsPreview: document.getElementById('settingsPreview'),
    settingsPreviewText: document.querySelector('.settings-preview-text'),
    collectionEmptyState: document.getElementById('collectionEmptyState'),
    collectionSongsEmptyState: document.getElementById('collectionSongsEmptyState'),
};


async function fetchSongs() {
    try {
        const url = `${API_URL}/songs?sort=${state.sortBy}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch songs');
        state.songs = await response.json();
        state.searchResults = null;
        renderSongList();
        updateStatus('connected');
    } catch (error) {
        console.error('Error fetching songs:', error);
        updateStatus('Backend not responding');
    }
}


// --- Forgiving search ----------------------------------------------------

function normalizeForSearch(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents
        .replace(/[^a-z0-9\s]/g, ' ')                       // strip punctuation
        .replace(/\s+/g, ' ')
        .trim();
}

// Standard Levenshtein, with an early bail-out when lengths differ a lot so
// scoring stays cheap on a library of thousands of songs.
function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    if (Math.abs(a.length - b.length) > 3) return 99;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
        const curr = [i + 1];
        for (let j = 0; j < b.length; j++) {
            const cost = a[i] === b[j] ? 0 : 1;
            curr.push(Math.min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost));
        }
        prev = curr;
    }
    return prev[b.length];
}

function fuzzyScore(rawQuery, song) {
    const q = normalizeForSearch(rawQuery);
    if (!q) return 0;

    const title = normalizeForSearch(song.title);
    const author = normalizeForSearch(song.author || '');
    const number = String(song.song_number || song.id || '');
    const numberNorm = normalizeForSearch(number);

    // Song-number match wins outright — it's how hymnal users page-flip.
    if (numberNorm === q) return 100000;
    if (numberNorm.startsWith(q)) return 50000 - q.length;

    let best = 0;

    if (title === q) best = 20000;
    else if (title.startsWith(q)) best = 12000 - title.length;
    else if (title.includes(q)) {
        best = 8000 - title.indexOf(q) * 5 - title.length;
    }

    if (author === q) best = Math.max(best, 5000);
    else if (author.startsWith(q)) best = Math.max(best, 3000);
    else if (author.includes(q)) best = Math.max(best, 1500);

    // Per-word scoring lets "amazing grace" still rank a song titled
    // "Grace, How Amazing" highly even though the words are reordered.
    const qWords = q.split(' ').filter(Boolean);
    const titleWords = title.split(' ').filter(Boolean);
    if (qWords.length > 0) {
        let wordScore = 0;
        let allMatched = true;
        for (const qw of qWords) {
            let matched = 0;
            for (const tw of titleWords) {
                if (tw === qw) { matched = Math.max(matched, 400); break; }
                if (tw.startsWith(qw)) matched = Math.max(matched, 260);
                else if (tw.includes(qw)) matched = Math.max(matched, 130);
                else if (qw.length >= 4) {
                    const d = levenshtein(qw, tw);
                    if (d === 1) matched = Math.max(matched, 200);
                    else if (d === 2 && qw.length >= 6) matched = Math.max(matched, 110);
                }
            }
            if (matched === 0) allMatched = false;
            wordScore += matched;
        }
        if (allMatched && qWords.length > 1) wordScore += 300;
        best = Math.max(best, wordScore);
    }

    // Whole-title typo tolerance for short single-word typos.
    if (best === 0 && q.length >= 4) {
        const d = levenshtein(q, title);
        if (d <= 2) best = Math.max(best, 400 - d * 120);
    }

    return best;
}

function rankedSearchResults(query) {
    const scored = [];
    for (const song of state.songs) {
        const score = fuzzyScore(query, song);
        if (score > 0) scored.push({ song, score });
    }
    scored.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title));
    return scored.map(r => r.song);
}

// Public entry point — also the listener bound to the search input.
async function searchSongs(query) {
    const trimmed = (query || '').trim();
    state.searchQuery = trimmed;

    if (!trimmed) {
        state.searchResults = null;
        renderSongList();
        return;
    }

    state.searchResults = rankedSearchResults(trimmed);
    renderSongList();

    // If client-side ranking finds nothing in titles/authors/numbers, ask
    // the backend to scan lyrics via FTS5 / LIKE so phrases like "chains
    // are gone" still surface the right song.
    if (state.searchResults.length === 0) {
        try {
            const params = new URLSearchParams({ q: trimmed, sort: state.sortBy });
            const res = await fetch(`${API_URL}/songs/search?${params}`);
            if (!res.ok) return;
            const matches = await res.json();
            if (state.searchQuery !== trimmed) return; // user kept typing
            state.searchResults = matches;
            renderSongList();
        } catch (e) { /* ignore — user just sees empty results */ }
    }
}


async function loadSong(songId) {
    try {
        const response = await fetch(`${API_URL}/songs/${songId}`);
        if (!response.ok) throw new Error('Failed to load song');
        state.currentSong = await response.json();
        state.currentVerseIndex = 0;
        state.navPosition = 0;
        buildNavigationOrder();
        renderSongDisplay();
        sendToProjector();
        return true;
    } catch (error) {
        console.error('Error loading song:', error);
        return false;
    }
}


function buildNavigationOrder() {
    const verses = state.currentSong?.verses || [];
    state.navigationOrder = [];

    const chorusIndex = verses.findIndex(v =>
        v.label.toLowerCase().includes('chorus')
    );

    if (chorusIndex === -1) {
        state.navigationOrder = verses.map((_, i) => i);
        return;
    }

    for (let i = 0; i < verses.length; i++) {
        const verse = verses[i];
        const isChorus = verse.label.toLowerCase().includes('chorus');

        state.navigationOrder.push(i);

        // After every non-chorus verse, insert the chorus — unless the next
        // verse is already the chorus (no need to double it up). This now
        // runs at the end of the song too, so the chorus closes the set.
        if (!isChorus) {
            const nextVerse = verses[i + 1];
            const nextIsChorus = nextVerse?.label.toLowerCase().includes('chorus');
            if (!nextIsChorus) {
                state.navigationOrder.push(chorusIndex);
            }
        }
    }
}


function renderSongList() {
    const searching = state.searchQuery && state.searchResults !== null;
    const list = searching ? state.searchResults : state.songs;

    if (searching) {
        elements.songCount.textContent =
            `${list.length} match${list.length === 1 ? '' : 'es'}`;
    } else {
        elements.songCount.textContent =
            `${list.length} song${list.length === 1 ? '' : 's'}`;
    }

    if (list.length === 0) {
        elements.emptyState.style.display = 'flex';
        elements.songList.innerHTML = '';
        elements.songList.appendChild(elements.emptyState);
        return;
    }

    elements.emptyState.style.display = 'none';
    elements.songList.innerHTML = list.map(song => `
        <div class="song-item ${state.currentSong?.id === song.id ? 'active' : ''}"
             data-id="${song.id}">
            <div class="song-item-header">
                <span class="song-item-number">#${escapeHtml(String(song.song_number || song.id))}</span>
                <span class="song-item-title">${escapeHtml(song.title)}</span>
                ${song.musical_key ? `<span class="song-item-key">${escapeHtml(song.musical_key)}</span>` : ''}
            </div>
            <div class="song-item-meta">
                ${song.author ? escapeHtml(song.author) + ' · ' : ''}${song.verse_count} verse${song.verse_count !== 1 ? 's' : ''}
            </div>
        </div>
    `).join('');

}


function renderSongDisplay() {
    if (!state.currentSong) {
        elements.contentPlaceholder.hidden = false;
        elements.songDisplay.hidden = true;
        return;
    }

    elements.contentPlaceholder.hidden = true;
    elements.songDisplay.hidden = false;

    const num = state.currentSong.song_number;
    elements.displayTitle.textContent = num
        ? `#${num}  ${state.currentSong.title}`
        : state.currentSong.title;
    elements.displayAuthor.textContent = state.currentSong.author || '';

    renderLyrics();
    renderQuickNav();

    const currentVerse = state.currentSong.verses[state.currentVerseIndex];
    if (currentVerse) {
        updatePreview(currentVerse.text);
    }

    renderSongList();
    if (state.openCollection) {
        try { renderCollectionDetail(); }
        catch (e) { console.error('renderCollectionDetail:', e); }
    }
}

function renderLyrics() {
    const verses = state.currentSong?.verses || [];
    elements.lyricsScroll.innerHTML = verses.map((verse, i) => `
        <div class="verse-card ${i === state.currentVerseIndex ? 'active' : ''}"
             data-index="${i}">
            <div class="verse-card-label">${escapeHtml(verse.label)}</div>
            <div class="verse-card-text">${escapeHtml(verse.text)}</div>
        </div>
    `).join('');

    scrollActiveVerseIntoView();
}

function selectVerse(index) {
    if (!state.currentSong) return;
    state.currentVerseIndex = index;
    const navPos = state.navigationOrder.indexOf(index);
    if (navPos !== -1) state.navPosition = navPos;
    renderSongDisplay();
    sendToProjector();
}

function scrollActiveVerseIntoView() {
    const active = elements.lyricsScroll.querySelector('.verse-card.active');
    if (!active) return;
    // Use the scroll container's geometry — `scrollIntoView` would jump the
    // whole window, which feels jarring inside a panel.
    const ct = elements.lyricsScroll.getBoundingClientRect();
    const at = active.getBoundingClientRect();
    if (at.top < ct.top || at.bottom > ct.bottom) {
        const offset = at.top - ct.top + elements.lyricsScroll.scrollTop - 16;
        elements.lyricsScroll.scrollTo({ top: offset, behavior: 'smooth' });
    }
}


function renderQuickNav() {
    const verses = state.currentSong?.verses || [];
    const navOrder = state.navigationOrder;

    if (navOrder.length <= 1) {
        elements.quickNav.innerHTML = '';
        return;
    }

    let html = '<div class="nav-flow">';

    for (let i = 0; i < navOrder.length; i++) {
        const verseIdx = navOrder[i];
        const verse = verses[verseIdx];
        const isChorus = verse.label.toLowerCase().includes('chorus');
        const isActive = i === state.navPosition;

        let shortLabel = verse.label;
        if (isChorus) {
            shortLabel = 'C';
        } else {
            const match = verse.label.match(/\d+/);
            shortLabel = match ? `V${match[0]}` : 'V';
        }

        html += `<button class="nav-flow-btn ${isChorus ? 'chorus' : ''} ${isActive ? 'active' : ''}"
                         data-nav-pos="${i}" title="${verse.label}">${shortLabel}</button>`;

        if (i < navOrder.length - 1) {
            html += '<span class="nav-flow-arrow">→</span>';
        }
    }

    html += '</div>';
    elements.quickNav.innerHTML = html;

}


// Build the projector payload from current operator state. Both the real
// projector window and the in-operator preview iframe consume this — same
// shape, so any future projector-side field shows up in the preview for free.
function buildProjectorPayload() {
    if (!state.currentSong) return null;
    const currentVerse = state.currentSong.verses[state.currentVerseIndex];
    const navLen = state.navigationOrder.length;
    return {
        text: state.isBlank ? '' : (currentVerse?.text || ''),
        label: currentVerse?.label || '',
        isBlank: state.isBlank,
        title: state.currentSong.title,
        author: state.currentSong.author,
        musical_key: state.currentSong.musical_key,
        songId: state.currentSong.id,
        songNumber: state.currentSong.song_number || null,
        verses: state.currentSong.verses.map(v => v.text),
        // Nav-position rather than verse-index so the audience-facing arrow
        // reflects "operator can advance to another slide" (which includes
        // chorus repeats), not just "there's a later verse in the song body".
        hasPrev: navLen > 0 && state.navPosition > 0,
        hasNext: navLen > 0 && state.navPosition < navLen - 1
    };
}

// Sync the preview iframe. Always safe to call — no-op if the iframe isn't
// loaded yet or there's no current song. `updatePreview()` accepts an
// optional text arg for callers that still pass one; the arg is ignored
// because the iframe pulls everything from buildProjectorPayload().
function updatePreview(_text) {
    const frame = elements.previewFrame;
    if (!frame || !frame.contentWindow) return;
    const payload = buildProjectorPayload();
    if (!payload) {
        frame.contentWindow.postMessage(
            { type: 'update-lyrics', text: '', label: '', isBlank: true,
              verses: [], hasPrev: false, hasNext: false }, '*');
        return;
    }
    frame.contentWindow.postMessage({ type: 'update-lyrics', ...payload }, '*');
}

async function sendToProjector() {
    updatePreview();
    if (!state.projectorOpen || !state.currentSong) return;

    const payload = buildProjectorPayload();
    if (!payload) return;

    try {
        if (window.__TAURI__) {
            await window.__TAURI__.core.invoke('send_to_projector', {
                event: 'update-lyrics',
                payload: JSON.stringify(payload)
            });
        }
    } catch (error) {
        console.error('Error sending to projector:', error);
    }

    if (!window.__TAURI__ && window.projectorWindow) {
        window.projectorWindow.postMessage({ type: 'update-lyrics', ...payload }, '*');
    }
}


async function toggleProjector() {
    try {
        if (window.__TAURI__) {
            if (state.projectorOpen) {
                await window.__TAURI__.core.invoke('close_projector_window');
                state.projectorOpen = false;
                elements.projectorBtn.innerHTML = `
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="4" width="16" height="10" rx="1"/>
                        <path d="M6 17h8"/>
                        <path d="M10 14v3"/>
                    </svg>
                    Open Projector
                `;
            } else {
                await window.__TAURI__.core.invoke('open_projector_window');
                state.projectorOpen = true;
                elements.projectorBtn.innerHTML = `
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M5 5l10 10M15 5L5 15"/>
                    </svg>
                    Close Projector
                `;
                setTimeout(() => {
                    sendToProjector();
                    pushSettingsToProjector();
                }, 500);
            }
        } else {
            const projectorWindow = window.open('projector.html', 'projector',
                'width=1280,height=720,menubar=no,toolbar=no');
            if (projectorWindow) {
                state.projectorOpen = true;
                window.projectorWindow = projectorWindow;
            }
        }
    } catch (error) {
        console.error('Error toggling projector:', error);
    }
}


function toggleBlank() {
    state.isBlank = !state.isBlank;
    elements.blankBtn.classList.toggle('active', state.isBlank);
    updatePreview(state.currentSong?.verses[state.currentVerseIndex]?.text || '');
    sendToProjector();
}


function navigateVerse(direction) {
    if (!state.currentSong) return;

    const newNavPos = state.navPosition + direction;
    if (newNavPos >= 0 && newNavPos < state.navigationOrder.length) {
        state.navPosition = newNavPos;
        state.currentVerseIndex = state.navigationOrder[newNavPos];
        renderSongDisplay();
        sendToProjector();
    }
}


function jumpToVerse(index) {
    if (!state.currentSong) return;

    if (index >= 0 && index < state.currentSong.verses.length) {
        state.currentVerseIndex = index;
        const navPos = state.navigationOrder.indexOf(index);
        if (navPos !== -1) {
            state.navPosition = navPos;
        }
        renderSongDisplay();
        sendToProjector();
    }
}


let importInFlight = false;

async function importFiles(files) {
    // Without this guard a double-click on the drop zone (or a second drop
    // while the first is still posting) fires a second POST /import — and
    // before the backend learned to dedupe that produced a doubled library.
    if (importInFlight) return;
    if (!files || files.length === 0) return;
    importInFlight = true;
    elements.dropZone.classList.add('busy');
    elements.dropZone.style.pointerEvents = 'none';
    elements.fileInput.disabled = true;

    const formData = new FormData();
    let importedCount = 0;
    let lastError = '';

    try {
        for (const file of files) {
            formData.set('file', file);
            try {
                const response = await fetch(`${API_URL}/import`, {
                    method: 'POST',
                    body: formData
                });
                if (response.ok) {
                    const result = await response.json();
                    importedCount += result.imported;
                } else {
                    const detail = await response.text().catch(() => '');
                    lastError = detail || `Import failed (${response.status})`;
                    console.error(`Import failed for ${file.name}:`, response.status, detail);
                }
            } catch (error) {
                lastError = 'Could not reach the server — try restarting the app';
                console.error(`Error importing ${file.name}:`, error);
            }
        }

        if (importedCount > 0) {
            updateStatus(`Imported ${importedCount} song${importedCount !== 1 ? 's' : ''}`);
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
    elements.importModal.classList.add('active');
}


function closeImportModal() {
    elements.importModal.classList.remove('active');
}


let toastTimer = null;
function updateStatus(message) {
    // "connected" is just an internal signal that the backend handshake
    // succeeded — no need to surface it to the user.
    if (!message || message === 'connected') return;

    const toast = elements.toast;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
}


function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


function openEditModal(song = null) {
    state.editingSongId = song?.id || null;
    elements.editModalTitle.textContent = song ? 'Edit Song' : 'Add Song';

    elements.songNumberInput.value = song?.song_number || '';
    elements.songNumberHint.textContent = '';
    elements.songNumberHint.classList.remove('form-hint-error');
    elements.songKeyInput.value = song?.musical_key || '';
    elements.songAuthorInput.value = song?.author || '';

    if (song) {
        let pasteText = song.title + '\n\n';

        for (const verse of song.verses) {
            pasteText += verse.label + '\n';
            pasteText += verse.text + '\n\n';
        }
        elements.songPasteInput.value = pasteText.trim();
    } else {
        elements.songPasteInput.value = '';
    }

    elements.editModal.classList.add('active');
    elements.songPasteInput.focus();
}


function closeEditModal() {
    elements.editModal.classList.remove('active');
    state.editingSongId = null;
}


// Returns the other song that already owns `number`, or null. `editingId` is
// excluded so re-saving an unchanged number on its own song is never flagged.
function findSongNumberConflict(number, editingId) {
    const target = String(number).trim();
    if (!target) return null;
    return state.songs.find(s =>
        s.song_number != null &&
        String(s.song_number).trim() === target &&
        s.id !== editingId
    ) || null;
}

function showSongNumberError(msg) {
    elements.songNumberHint.textContent = msg;
    elements.songNumberHint.classList.add('form-hint-error');
}

function clearSongNumberError() {
    elements.songNumberHint.textContent = '';
    elements.songNumberHint.classList.remove('form-hint-error');
}


function parsePastedSong(text) {
    const sectionPattern = /^(Verse\s*\d*|Chorus|CHORUS|Bridge|Intro|Outro|Pre-Chorus|Refrain|Tag|Coda)\s*$/i;

    const paragraphs = text.trim().split(/\n\s*\n+/);
    if (paragraphs.length === 0) return null;

    const firstPara = paragraphs[0].split('\n');
    const title = firstPara[0]?.trim();
    if (!title) return null;

    let startPara = 1;

    const verses = [];
    let verseNum = 1;

    for (let i = startPara; i < paragraphs.length; i++) {
        const para = paragraphs[i].trim();
        if (!para) continue;

        const lines = para.split('\n');
        const firstLine = lines[0].trim();

        if (sectionPattern.test(firstLine)) {
            let label = firstLine.replace(/(\d+)/, ' $1').trim();
            label = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
            const text = lines.slice(1).map(l => l.trim()).join('\n').trim();
            if (text) {
                verses.push({ label, text });
            }
        } else {
            const text = lines.map(l => l.trim()).join('\n').trim();
            if (text) {
                verses.push({ label: `Verse ${verseNum++}`, text });
            }
        }
    }

    return { title, verses };
}


async function saveSong() {
    const pasteText = elements.songPasteInput.value.trim();
    if (!pasteText) {
        elements.songPasteInput.focus();
        updateStatus('Paste song lyrics to continue');
        return;
    }

    const parsed = parsePastedSong(pasteText);
    if (!parsed || !parsed.title) {
        updateStatus('Could not parse song. Check the format.');
        return;
    }

    if (parsed.verses.length === 0) {
        updateStatus('No verses found. Add lyrics after the title.');
        return;
    }

    const numberRaw = elements.songNumberInput.value.trim();
    if (numberRaw) {
        const conflict = findSongNumberConflict(numberRaw, state.editingSongId);
        if (conflict) {
            showSongNumberError(`#${numberRaw} is already used by "${conflict.title}"`);
            elements.songNumberInput.focus();
            return;
        }
    }

    const song = {
        title: parsed.title,
        author: elements.songAuthorInput.value.trim() || null,
        musical_key: elements.songKeyInput.value.trim() || null,
        song_number: numberRaw || null,
        verses: parsed.verses,
        tags: []
    };

    try {
        let response;
        if (state.editingSongId) {
            response = await fetch(`${API_URL}/songs/${state.editingSongId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(song)
            });
        } else {
            response = await fetch(`${API_URL}/songs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(song)
            });
        }

        if (response.status === 409) {
            // Backend safety net for race conditions or direct-API edits.
            showSongNumberError(`#${numberRaw} is already used by another song.`);
            elements.songNumberInput.focus();
            return;
        }

        if (!response.ok) throw new Error('Failed to save song');

        const wasEditing = state.editingSongId;
        closeEditModal();

        if (wasEditing && state.currentSong?.id === wasEditing) {
            await loadSong(wasEditing);
        }

        await fetchSongs();
        updateStatus(wasEditing ? 'Song updated' : 'Song added');
    } catch (error) {
        console.error('Error saving song:', error);
        updateStatus('Failed to save song');
    }
}


function openDeleteConfirm() {
    if (!state.currentSong) return;
    elements.confirmMessage.textContent = `Are you sure you want to delete "${state.currentSong.title}"?`;
    elements.confirmModal.classList.add('active');
}


function closeDeleteConfirm() {
    elements.confirmModal.classList.remove('active');
}


async function deleteSong() {
    if (!state.currentSong) return;

    try {
        const response = await fetch(`${API_URL}/songs/${state.currentSong.id}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete song');

        const title = state.currentSong.title;
        state.currentSong = null;
        state.currentVerseIndex = 0;

        closeDeleteConfirm();
        renderSongDisplay();
        await fetchSongs();
        updateStatus(`Deleted "${title}"`);
    } catch (error) {
        console.error('Error deleting song:', error);
        updateStatus('Failed to delete song');
    }
}


async function exportSongs(format) {
    try {
        const response = await fetch(`${API_URL}/export?format=${format}`);
        if (!response.ok) throw new Error('Export failed');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `songs.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        updateStatus(`Exported as ${format.toUpperCase()}`);
    } catch (error) {
        console.error('Export error:', error);
        updateStatus('Export failed');
    }
}


function toggleExportMenu() {
    elements.exportMenu.classList.toggle('open');
}


function closeExportMenu() {
    elements.exportMenu.classList.remove('open');
}


async function openAboutModal() {
    let version = '';
    if (window.__TAURI__) {
        try {
            version = await window.__TAURI__.core.invoke('get_app_version');
        } catch (e) {
            console.warn('Could not get app version:', e);
        }
    }
    elements.aboutVersion.textContent = version ? `Version ${version}` : '';
    elements.aboutModal.classList.add('active');
}


function closeAboutModal() {
    elements.aboutModal.classList.remove('active');
}


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


async function openCollectionDetail(collectionId, { showView = true } = {}) {
    try {
        const response = await fetch(collectionApiUrl(`/collections/${collectionId}`), {
            cache: 'no-store'
        });
        if (!response.ok) throw new Error('Failed');
        state.openCollection = await response.json();
        if (showView) {
            state.collectionPosition = state.openCollection.songs.findIndex(
                s => s.song_id === state.currentSong?.id
            );
        } else if (
            state.collectionPosition < 0 ||
            state.collectionPosition >= state.openCollection.songs.length
        ) {
            state.collectionPosition = state.openCollection.songs.findIndex(
                s => s.song_id === state.currentSong?.id
            );
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
            return `
                <div class="collection-song-item ${isActive ? 'active-song' : ''}" data-entry-id="${s.id}" data-song-id="${s.song_id}">
                    <span class="collection-song-pos">${idx + 1}</span>
                    <div class="collection-song-info">
                        <div class="collection-song-title">${escapeHtml(s.title)}</div>
                        ${s.author ? `<div class="collection-song-author">${escapeHtml(s.author)}</div>` : ''}
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


async function navigateCollection(direction) {
    if (!state.openCollection) return;
    const songs = state.openCollection.songs;
    const newPos = state.collectionPosition + direction;
    if (newPos < 0 || newPos >= songs.length) return;
    state.collectionPosition = newPos;
    await loadSong(songs[newPos].song_id);
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
    const list = document.getElementById('collectionPickerList');
    if (state.collections.length === 0) {
        list.innerHTML = '<p class="collection-picker-empty">No collections yet — create one below.</p>';
    } else {
        list.innerHTML = state.collections.map(c => `
            <button type="button" class="collection-picker-item" data-id="${c.id}">
                ${escapeHtml(c.name)}
                <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">${c.song_count}</span>
            </button>
        `).join('');
    }
    picker.classList.add('open');
}


// ---------- Display settings ----------

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
    const frame = elements.previewFrame;
    if (!frame || !frame.contentWindow || !state.settings) return;
    frame.contentWindow.postMessage(
        { type: 'apply-settings', settings: state.settings }, '*');
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
    const s = state.settings;
    elements.settingsPreview.style.background = bgCssForSettings(s);
    const text = elements.settingsPreviewText;
    text.style.fontFamily = FONT_STACKS[s.typography.fontFamily] || FONT_STACKS['Montserrat'];
    text.style.fontWeight = s.typography.fontWeight;
    text.style.textAlign = s.typography.alignment;
}

function syncSettingsForm() {
    const s = state.settings;
    elements.setFontFamily.value = s.typography.fontFamily;
    elements.setFontWeight.value = s.typography.fontWeight;
    elements.setFontWeightValue.textContent = s.typography.fontWeight;
    elements.setAlignment.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.value === s.typography.alignment);
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
    const dimPct = Math.round(s.background.image.dim * 100);
    elements.setBgImageDim.value = dimPct;
    elements.setBgImageDimValue.textContent = `${dimPct}%`;

    elements.setShowTitleBar.checked = s.layout.showTitleBar;
    elements.setShowMetaBar.checked = s.layout.showMetaBar;
    elements.setShowVerseLabel.checked = s.layout.showVerseLabel;
    elements.setSafeArea.value = s.layout.safeAreaPct;
    elements.setSafeAreaValue.textContent = `${s.layout.safeAreaPct}%`;

    elements.setTransStyle.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.value === s.transition.style);
    });
    elements.setTransDuration.value = s.transition.durationMs;
    elements.setTransDurationValue.textContent = `${s.transition.durationMs} ms`;
}

function syncBgImageThumb() {
    const fn = state.settings.background.image.filename;
    if (fn) {
        const url = `${API_URL}/backgrounds/${encodeURIComponent(fn)}`;
        elements.setBgImageThumb.style.backgroundImage = `url('${url}')`;
        elements.setBgImageThumb.innerHTML = '';
    } else {
        elements.setBgImageThumb.style.backgroundImage = '';
        elements.setBgImageThumb.innerHTML = '<span class="image-thumb-placeholder">No image</span>';
    }
}

async function uploadBackgroundImage(file) {
    const form = new FormData();
    form.append('image', file, file.name);
    const res = await fetch(`${API_URL}/backgrounds`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('upload failed');
    const data = await res.json();
    return data.filename;
}

function onSettingsChanged() {
    updateSettingsPreview();
    pushSettingsToProjector();
    scheduleSaveSettings();
}

function openSettingsModal() {
    syncSettingsForm();
    updateSettingsPreview();
    elements.settingsModal.classList.add('active');
}

function closeSettingsModal() {
    elements.settingsModal.classList.remove('active');
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
        });
    });

    elements.setFontFamily.addEventListener('change', () => {
        state.settings.typography.fontFamily = elements.setFontFamily.value;
        onSettingsChanged();
    });
    elements.setFontWeight.addEventListener('input', () => {
        state.settings.typography.fontWeight = parseInt(elements.setFontWeight.value, 10);
        elements.setFontWeightValue.textContent = state.settings.typography.fontWeight;
        onSettingsChanged();
    });
    elements.setAlignment.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            state.settings.typography.alignment = b.dataset.value;
            syncSettingsForm();
            onSettingsChanged();
        });
    });

    elements.setBgKind.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            state.settings.background.kind = b.dataset.value;
            syncSettingsForm();
            onSettingsChanged();
        });
    });
    elements.setBgColor.addEventListener('input', () => {
        state.settings.background.color = elements.setBgColor.value;
        onSettingsChanged();
    });
    elements.setBgGradFrom.addEventListener('input', () => {
        state.settings.background.gradient.from = elements.setBgGradFrom.value;
        onSettingsChanged();
    });
    elements.setBgGradTo.addEventListener('input', () => {
        state.settings.background.gradient.to = elements.setBgGradTo.value;
        onSettingsChanged();
    });
    elements.setBgGradAngle.addEventListener('input', () => {
        state.settings.background.gradient.angle = parseInt(elements.setBgGradAngle.value, 10);
        elements.setBgGradAngleValue.textContent = `${state.settings.background.gradient.angle}°`;
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
            state.settings.background.image.filename = filename;
            state.settings.background.kind = 'image';
            syncSettingsForm();
            onSettingsChanged();
        } catch (err) {
            console.error('Image upload failed', err);
            updateStatus('Image upload failed');
        }
    });
    elements.setBgImageRemoveBtn.addEventListener('click', () => {
        state.settings.background.image.filename = null;
        if (state.settings.background.kind === 'image') {
            state.settings.background.kind = 'solid';
        }
        syncSettingsForm();
        onSettingsChanged();
    });
    elements.setBgImageDim.addEventListener('input', () => {
        const pct = parseInt(elements.setBgImageDim.value, 10);
        state.settings.background.image.dim = pct / 100;
        elements.setBgImageDimValue.textContent = `${pct}%`;
        onSettingsChanged();
    });

    // Layout
    const wireToggle = (el, path) => {
        el.addEventListener('change', () => {
            state.settings.layout[path] = el.checked;
            onSettingsChanged();
        });
    };
    wireToggle(elements.setShowTitleBar, 'showTitleBar');
    wireToggle(elements.setShowMetaBar, 'showMetaBar');
    wireToggle(elements.setShowVerseLabel, 'showVerseLabel');
    elements.setSafeArea.addEventListener('input', () => {
        const pct = parseInt(elements.setSafeArea.value, 10);
        state.settings.layout.safeAreaPct = pct;
        elements.setSafeAreaValue.textContent = `${pct}%`;
        onSettingsChanged();
    });

    // Transitions
    elements.setTransStyle.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            state.settings.transition.style = b.dataset.value;
            syncSettingsForm();
            onSettingsChanged();
        });
    });
    elements.setTransDuration.addEventListener('input', () => {
        const ms = parseInt(elements.setTransDuration.value, 10);
        state.settings.transition.durationMs = ms;
        elements.setTransDurationValue.textContent = `${ms} ms`;
        onSettingsChanged();
    });

    elements.settingsResetBtn.addEventListener('click', () => {
        state.settings = mergeSettings(null);
        syncSettingsForm();
        onSettingsChanged();
    });
}

// Map native menu items to existing UI actions.
function initMenuEvents() {
    if (!window.__TAURI__) return;
    const on = (name, fn) => window.__TAURI__.event.listen(name, fn);

    on('menu-new-song', () => openEditModal());
    on('menu-import', () => openImportModal());
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
    on('projector-closed', () => {
        state.projectorOpen = false;
        elements.projectorBtn.innerHTML = `
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="4" width="16" height="10" rx="1"/>
                <path d="M6 17h8"/>
                <path d="M10 14v3"/>
            </svg>
            Open Projector
        `;
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
    elements.closeAboutModal.addEventListener('click', closeAboutModal);
    elements.aboutModal.addEventListener('click', (e) => {
        if (e.target === elements.aboutModal) closeAboutModal();
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

    elements.projectorBtn.addEventListener('click', toggleProjector);
    elements.blankBtn.addEventListener('click', toggleBlank);

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
    elements.confirmDeleteBtn.addEventListener('click', deleteSong);
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

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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
            case 'Escape':
                state.currentSong = null;
                state.currentVerseIndex = 0;
                renderSongDisplay();
                renderSongList();
                break;
            case '1': case '2': case '3': case '4': case '5':
            case '6': case '7': case '8': case '9':
                jumpToVerse(parseInt(e.key) - 1);
                break;
            case '0':
                // 0 jumps to the 10th verse, matching the common tab-switcher convention.
                jumpToVerse(9);
                break;
            case 'f':
            case 'F':
                if (!state.projectorOpen) toggleProjector();
                break;
        }
    });

    // Sidebar tabs
    document.getElementById('libraryTabBtn').addEventListener('click', openLibraryTab);
    document.getElementById('collectionsTabBtn').addEventListener('click', async () => {
        openCollectionsTab();
        await fetchCollections();
        if (state.openCollection?.id != null) {
            await openCollectionDetail(state.openCollection.id, { showView: false });
        }
    });

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

    // Close pickers when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.add-to-collection-wrapper')) {
            document.getElementById('collectionPicker').classList.remove('open');
        }
        if (!e.target.closest('#exportBtn') && !e.target.closest('#exportMenu')) {
            closeExportMenu();
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
        const songId = parseInt(item.dataset.songId);
        const entryId = parseInt(item.dataset.entryId);
        state.collectionPosition = state.openCollection.songs.findIndex(s => s.id === entryId);
        loadSong(songId);
        scrollActiveCollectionSongIntoView();
    });

    document.getElementById('collectionPickerList').addEventListener('click', (e) => {
        const btn = e.target.closest('.collection-picker-item');
        if (btn) {
            e.stopPropagation();
            addToCollection(parseInt(btn.dataset.id));
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
    }
});

// Keep the preview iframe's CSS scale in sync with the slot it lives in.
// The iframe always renders at 1920×1080 internally so projector.js computes
// fonts against the same viewport as the real projector — we just shrink the
// whole rendered output via transform: scale to fit the preview window.
const PREVIEW_VIRTUAL_W = 1920;
function syncPreviewScale() {
    const win = elements.previewWindow;
    const frame = elements.previewFrame;
    if (!win || !frame) return;
    const w = win.clientWidth;
    if (!w) return;
    frame.style.setProperty('--preview-scale', w / PREVIEW_VIRTUAL_W);
}
window.addEventListener('resize', syncPreviewScale);

document.addEventListener('DOMContentLoaded', async () => {
    initEventListeners();
    initBibleListeners();
    initSettingsDialog();
    initMenuEvents();

    // Set the preview scale once we have layout, and again on any size change.
    syncPreviewScale();
    if (elements.previewWindow && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(syncPreviewScale).observe(elements.previewWindow);
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
});
