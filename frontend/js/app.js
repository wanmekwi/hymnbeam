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
    showLogo: false,
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
    layout: { showTitleBar: true, showMetaBar: true, showVerseLabel: false, autoBreakLines: true, safeAreaPct: 5 },
    transition: { style: 'fade-up', durationMs: 400 },
    logo: { image: null },
    // Bible display overrides. While `separate` is false the projector uses the
    // song settings above for Bible verses too; when turned on, these fields
    // (seeded from the song settings the first time) drive Bible verses instead.
    bible: {
        separate: false,
        initialized: false,
        typography: { fontFamily: 'Montserrat', fontWeight: 600, alignment: 'center' },
        background: {
            kind: 'solid',
            color: '#000000',
            gradient: { from: '#000000', to: '#1a1a2e', angle: 180 },
            image: { filename: null, dim: 0.4 }
        },
        layout: { showTitleBar: true, showMetaBar: true, showVerseLabel: false, autoBreakLines: true, safeAreaPct: 5 },
        transition: { style: 'fade-up', durationMs: 400 }
    }
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
    bibleDisplay: document.getElementById('bibleDisplay'),
    bibleVerseGrid: document.getElementById('bibleVerseGrid'),
    bibleDisplayTitle: document.getElementById('bibleDisplayTitle'),
    bibleDisplaySubtitle: document.getElementById('bibleDisplaySubtitle'),
    biblePreviewFrame: document.getElementById('biblePreviewFrame'),
    displayTitle: document.getElementById('displayTitle'),
    displayAuthor: document.getElementById('displayAuthor'),
    displaySource: document.getElementById('displaySource'),
    lyricsScroll: document.getElementById('lyricsScroll'),
    previewFrame: document.getElementById('previewFrame'),
    previewWindow: document.getElementById('previewWindow'),
    nextPreviewFrame: document.getElementById('nextPreviewFrame'),
    nextPreviewWindow: document.getElementById('nextPreviewWindow'),
    nextPreviewEmpty: document.getElementById('nextPreviewEmpty'),
    previewContainer: document.getElementById('previewContainer'),
    previewLayoutToggle: document.getElementById('previewLayoutToggle'),
    biblePreviewContainer: document.getElementById('biblePreviewContainer'),
    biblePreviewToggle: document.getElementById('biblePreviewToggle'),
    importBtn: document.getElementById('importBtn'),
    projectorBtn: document.getElementById('projectorBtn'),
    alertBtn: document.getElementById('alertBtn'),
    alertPopover: document.getElementById('alertPopover'),
    alertInput: document.getElementById('alertInput'),
    alertRecents: document.getElementById('alertRecents'),
    alertAutoClear: document.getElementById('alertAutoClear'),
    alertShowBtn: document.getElementById('alertShowBtn'),
    alertClearBtn: document.getElementById('alertClearBtn'),
    alertLiveDot: document.getElementById('alertLiveDot'),
    blankBtn: document.getElementById('blankBtn'),
    logoBtn: document.getElementById('logoBtn'),
    importModal: document.getElementById('importModal'),
    closeModal: document.getElementById('closeModal'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    replaceLibraryCheck: document.getElementById('replaceLibraryCheck'),
    openDbImportBtn: document.getElementById('openDbImportBtn'),
    dbImportModal: document.getElementById('dbImportModal'),
    closeDbImportModal: document.getElementById('closeDbImportModal'),
    dbDropZone: document.getElementById('dbDropZone'),
    dbFileInput: document.getElementById('dbFileInput'),
    dbBrowser: document.getElementById('dbBrowser'),
    dbSourceInfo: document.getElementById('dbSourceInfo'),
    dbChangeFileBtn: document.getElementById('dbChangeFileBtn'),
    dbSearchInput: document.getElementById('dbSearchInput'),
    dbSelectAll: document.getElementById('dbSelectAll'),
    dbSelectAllLabel: document.getElementById('dbSelectAllLabel'),
    dbSelectedCount: document.getElementById('dbSelectedCount'),
    dbSongList: document.getElementById('dbSongList'),
    dbImportFooter: document.getElementById('dbImportFooter'),
    dbSourceInput: document.getElementById('dbSourceInput'),
    dbCancelBtn: document.getElementById('dbCancelBtn'),
    dbImportSelectedBtn: document.getElementById('dbImportSelectedBtn'),
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
    songSourceInput: document.getElementById('songSourceInput'),
    songPasteInput: document.getElementById('songPasteInput'),
    quickNav: document.getElementById('quickNav'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    backupNowBtn: document.getElementById('backupNowBtn'),
    backupList: document.getElementById('backupList'),
    trashList: document.getElementById('trashList'),
    scanDuplicatesBtn: document.getElementById('scanDuplicatesBtn'),
    duplicateList: document.getElementById('duplicateList'),
    batchSourceInput: document.getElementById('batchSourceInput'),
    batchSourceUntagged: document.getElementById('batchSourceUntagged'),
    applySourceBtn: document.getElementById('applySourceBtn'),
    confirmModal: document.getElementById('confirmModal'),
    confirmTitle: document.getElementById('confirmTitle'),
    confirmMessage: document.getElementById('confirmMessage'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    exportBtn: document.getElementById('exportBtn'),
    exportMenu: document.getElementById('exportMenu'),
    aboutBtn: document.getElementById('aboutBtn'),
    aboutModal: document.getElementById('aboutModal'),
    closeAboutModal: document.getElementById('closeAboutModal'),
    aboutVersion: document.getElementById('aboutVersion'),
    checkUpdateBtn: document.getElementById('checkUpdateBtn'),
    updateStatus: document.getElementById('updateStatus'),
    updateAction: document.getElementById('updateAction'),
    shortcutsModal: document.getElementById('shortcutsModal'),
    closeShortcutsModal: document.getElementById('closeShortcutsModal'),
    shortcutsGroups: document.getElementById('shortcutsGroups'),
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
    setLogoImageThumb: document.getElementById('setLogoImageThumb'),
    setLogoImageBrowseBtn: document.getElementById('setLogoImageBrowseBtn'),
    setLogoImageRemoveBtn: document.getElementById('setLogoImageRemoveBtn'),
    setLogoImageInput: document.getElementById('setLogoImageInput'),
    setBgImageDim: document.getElementById('setBgImageDim'),
    setBgImageDimValue: document.getElementById('setBgImageDimValue'),
    setShowTitleBar: document.getElementById('setShowTitleBar'),
    setShowMetaBar: document.getElementById('setShowMetaBar'),
    setShowVerseLabel: document.getElementById('setShowVerseLabel'),
    setAutoBreakLines: document.getElementById('setAutoBreakLines'),
    setSafeArea: document.getElementById('setSafeArea'),
    setSafeAreaValue: document.getElementById('setSafeAreaValue'),
    setTransStyle: document.getElementById('setTransStyle'),
    setTransDuration: document.getElementById('setTransDuration'),
    setTransDurationValue: document.getElementById('setTransDurationValue'),
    settingsPreview: document.getElementById('settingsPreview'),
    settingsPreviewText: document.querySelector('.settings-preview-text'),
    settingsTargetRow: document.getElementById('settingsTargetRow'),
    setDisplayTarget: document.getElementById('setDisplayTarget'),
    bibleTargetOptions: document.getElementById('bibleTargetOptions'),
    setBibleSameAsSongs: document.getElementById('setBibleSameAsSongs'),
    bibleMatchSongBtn: document.getElementById('bibleMatchSongBtn'),
    setLogoGroup: document.getElementById('setLogoGroup'),
    settingsContent: document.querySelector('.settings-content'),
    collectionEmptyState: document.getElementById('collectionEmptyState'),
    collectionSongsEmptyState: document.getElementById('collectionSongsEmptyState'),
    collectionBibleInput: document.getElementById('collectionBibleInput'),
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


function setContentView(view) {
    elements.contentPlaceholder.hidden = view !== 'placeholder';
    elements.songDisplay.hidden = view !== 'song';
    elements.bibleDisplay.hidden = view !== 'bible';
    // A preview pane only has layout once its view is shown; rescale now so the
    // just-revealed pane (esp. the Bible preview) fills its slot instead of
    // rendering at the fallback scale(0.1) in the top-left corner.
    if (typeof syncPreviewScale === 'function') syncPreviewScale();
}

function renderSongDisplay() {
    if (!state.currentSong) {
        setContentView('placeholder');
        return;
    }

    setContentView('song');

    const num = state.currentSong.song_number;
    elements.displayTitle.textContent = num
        ? `#${num}  ${state.currentSong.title}`
        : state.currentSong.title;
    elements.displayAuthor.textContent = state.currentSong.author || '';

    const source = state.currentSong.source;
    elements.displaySource.textContent = source ? `Source: ${source}` : '';
    elements.displaySource.hidden = !source;

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

// Payload for the slide the *next* advance will project — i.e. the verse at
// navPosition + 1 in the navigation order. Returns null at the end of the song
// (nothing queued) or when no song is loaded. Blanking the live screen doesn't
// change what's queued, so isBlank is ignored here.
function buildNextPreviewPayload() {
    if (!state.currentSong) return null;
    const nextNavPos = state.navPosition + 1;
    if (nextNavPos >= state.navigationOrder.length) return null;
    const idx = state.navigationOrder[nextNavPos];
    const verse = state.currentSong.verses[idx];
    if (!verse) return null;
    return {
        text: verse.text || '',
        label: verse.label || '',
        isBlank: false,
        title: state.currentSong.title,
        author: state.currentSong.author,
        musical_key: state.currentSong.musical_key,
        songId: state.currentSong.id,
        songNumber: state.currentSong.song_number || null,
        verses: state.currentSong.verses.map(v => v.text),
        hasPrev: true,
        hasNext: nextNavPos < state.navigationOrder.length - 1
    };
}

const BLANK_PREVIEW_MSG = { type: 'update-lyrics', text: '', label: '', isBlank: true,
    verses: [], hasPrev: false, hasNext: false };

// Sync the "Next" preview iframe with what the next advance will show. Shows an
// "End of song" placeholder when nothing is queued, and nothing when no song is
// loaded.
function updateNextPreview() {
    const frame = elements.nextPreviewFrame;
    const empty = elements.nextPreviewEmpty;
    if (!frame || !frame.contentWindow) return;
    const payload = buildNextPreviewPayload();
    if (!payload) {
        const atEnd = !!state.currentSong;
        empty.textContent = atEnd ? 'End of song' : '';
        empty.classList.toggle('visible', atEnd);
        frame.contentWindow.postMessage(BLANK_PREVIEW_MSG, '*');
        return;
    }
    empty.classList.remove('visible');
    frame.contentWindow.postMessage({ type: 'update-lyrics', ...payload }, '*');
}

// Sync the preview iframe. Always safe to call — no-op if the iframe isn't
// loaded yet or there's no current song. `updatePreview()` accepts an
// optional text arg for callers that still pass one; the arg is ignored
// because the iframe pulls everything from buildProjectorPayload(). The single
// choke point for both preview panes, so the Next pane updates in lockstep.
function updatePreview(_text) {
    if (!previewsEnabled()) return;   // previews are off — don't feed them
    const frame = elements.previewFrame;
    if (frame && frame.contentWindow) {
        const payload = buildProjectorPayload();
        frame.contentWindow.postMessage(
            payload ? { type: 'update-lyrics', ...payload } : BLANK_PREVIEW_MSG, '*');
    }
    updateNextPreview();
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


// Single source of truth for the header button's label and icon, so the four
// places that can change projector state (open, close, the browser fallback,
// and the projector-closed event) can never disagree about what it says.
function setProjectorButton(open) {
    elements.projectorBtn.innerHTML = open
        ? `
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M5 5l10 10M15 5L5 15"/>
            </svg>
            Close Projector
        `
        : `
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="4" width="16" height="10" rx="1"/>
                <path d="M6 17h8"/>
                <path d="M10 14v3"/>
            </svg>
            Open Projector
        `;
}


async function toggleProjector() {
    try {
        if (window.__TAURI__) {
            if (state.projectorOpen) {
                await window.__TAURI__.core.invoke('close_projector_window');
                state.projectorOpen = false;
                setProjectorButton(false);
            } else {
                await window.__TAURI__.core.invoke('open_projector_window');
                state.projectorOpen = true;
                setProjectorButton(true);
                setTimeout(() => {
                    sendToProjector();
                    pushSettingsToProjector();
                    sendLogoState();
                    resendAlertState();
                }, 500);
            }
        } else if (state.projectorOpen && window.projectorWindow) {
            // Browser fallback (dev only — the shipped app always has Tauri).
            // This branch used to open unconditionally, so the toggle was
            // one-way outside Tauri.
            window.projectorWindow.close();
            window.projectorWindow = null;
            state.projectorOpen = false;
            setProjectorButton(false);
        } else {
            const projectorWindow = window.open('projector.html', 'projector',
                'width=1280,height=720,menubar=no,toolbar=no');
            if (projectorWindow) {
                state.projectorOpen = true;
                window.projectorWindow = projectorWindow;
                setProjectorButton(true);
            }
        }
    } catch (error) {
        console.error('Error toggling projector:', error);
    }
}


function toggleBlank() {
    state.isBlank = !state.isBlank;
    // Blank and logo are mutually exclusive projector states.
    if (state.isBlank && state.showLogo) state.showLogo = false;
    syncScreenStateButtons();
    updatePreview(state.currentSong?.verses[state.currentVerseIndex]?.text || '');
    sendToProjector();
    sendLogoState();
}

function toggleLogo() {
    state.showLogo = !state.showLogo;
    if (state.showLogo && state.isBlank) state.isBlank = false;
    syncScreenStateButtons();
    updatePreview();
    sendToProjector();
    sendLogoState();
}

function syncScreenStateButtons() {
    elements.blankBtn.classList.toggle('active', state.isBlank);
    elements.logoBtn.classList.toggle('active', state.showLogo);
}

// Logo is an independent overlay, sent on its own channel so it works with no
// song loaded (pre-service). Mirrors sendToProjector's live-preview + projector
// + browser-fallback fan-out, but only to the live preview (the Next pane keeps
// showing the queued verse).
function sendLogoState() {
    const image = state.settings?.logo?.image || null;
    const msg = { type: 'show-logo', show: state.showLogo, image };
    if (elements.previewFrame?.contentWindow) {
        elements.previewFrame.contentWindow.postMessage(msg, '*');
    }
    if (window.__TAURI__) {
        if (state.projectorOpen) {
            window.__TAURI__.core.invoke('send_to_projector', {
                event: 'show-logo',
                payload: JSON.stringify({ show: state.showLogo, image })
            }).catch(err => console.error('Failed to send logo state:', err));
        }
    } else if (window.projectorWindow) {
        window.projectorWindow.postMessage(msg, '*');
    }
}


// ----- Projector alert banner -----

const ALERT_RECENTS_KEY = 'hymnbeam.alertRecents';
let alertActive = false;
let alertTimer = null;
let currentAlertText = '';

// Re-assert the current alert to a freshly-opened projector / preview so it
// isn't lost when a window opens after the alert was raised.
function resendAlertState() {
    if (alertActive && currentAlertText) {
        sendAlert('show-alert', { text: currentAlertText });
    }
}

// Fan an alert event out to the live preview + real projector + browser
// fallback (same channels as the lyrics/logo transports).
function sendAlert(event, payload) {
    const msg = { type: event, ...payload };
    if (elements.previewFrame?.contentWindow) {
        elements.previewFrame.contentWindow.postMessage(msg, '*');
    }
    if (window.__TAURI__) {
        if (state.projectorOpen) {
            window.__TAURI__.core.invoke('send_to_projector', {
                event, payload: JSON.stringify(payload)
            }).catch(err => console.error('Failed to send alert:', err));
        }
    } else if (window.projectorWindow) {
        window.projectorWindow.postMessage(msg, '*');
    }
}

function updateAlertIndicator() {
    elements.alertBtn.classList.toggle('active', alertActive);
    elements.alertLiveDot.classList.toggle('visible', alertActive);
}

function showAlert() {
    const text = elements.alertInput.value.trim();
    if (!text) {
        elements.alertInput.focus();
        return;
    }
    clearTimeout(alertTimer);
    alertActive = true;
    currentAlertText = text;
    updateAlertIndicator();
    sendAlert('show-alert', { text });
    saveAlertRecent(text);

    // The operator owns the auto-clear timer so its "live" indicator stays
    // authoritative; when it fires it sends clear-alert to the projector.
    const seconds = parseInt(elements.alertAutoClear.value, 10) || 0;
    if (seconds > 0) {
        alertTimer = setTimeout(() => clearAlert(), seconds * 1000);
    }
    closeAlertPopover();
}

function clearAlert() {
    clearTimeout(alertTimer);
    alertTimer = null;
    if (!alertActive) return;
    alertActive = false;
    currentAlertText = '';
    updateAlertIndicator();
    sendAlert('clear-alert', {});
}

function toggleAlertPopover() {
    const open = elements.alertPopover.classList.toggle('open');
    if (open) {
        renderAlertRecents();
        elements.alertInput.focus();
    }
}

function closeAlertPopover() {
    elements.alertPopover.classList.remove('open');
}

function loadAlertRecents() {
    try {
        const raw = localStorage.getItem(ALERT_RECENTS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(s => typeof s === 'string') : [];
    } catch (e) {
        return [];
    }
}

function saveAlertRecent(text) {
    // Most-recent-first, de-duplicated, capped at 6. Nursery alerts repeat.
    const recents = [text, ...loadAlertRecents().filter(t => t !== text)].slice(0, 6);
    try { localStorage.setItem(ALERT_RECENTS_KEY, JSON.stringify(recents)); }
    catch (e) { /* storage full/blocked — non-fatal */ }
    renderAlertRecents();
}

function renderAlertRecents() {
    const recents = loadAlertRecents();
    elements.alertRecents.innerHTML = recents
        .map(t => `<option value="${t.replace(/"/g, '&quot;')}"></option>`).join('');
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


let toastTimer = null;
function updateStatus(message, action = null) {
    // "connected" is just an internal signal that the backend handshake
    // succeeded — no need to surface it to the user.
    if (!message || message === 'connected') return;

    const toast = elements.toast;
    toast.textContent = message;
    if (action) {
        const btn = document.createElement('button');
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            clearTimeout(toastTimer);
            toast.classList.remove('visible');
            action.onClick();
        });
        toast.appendChild(btn);
    }
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    // Leave actionable toasts up longer — they invite a click.
    toastTimer = setTimeout(() => toast.classList.remove('visible'), action ? 6000 : 2500);
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
    elements.songSourceInput.value = song?.source || '';

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
        source: elements.songSourceInput.value.trim() || null,
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


// The confirm modal is shared: whoever opens it supplies the action to run
// when the destructive button is pressed.
let confirmHandler = null;

function openConfirm({ title, message, confirmLabel, onConfirm }) {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmDeleteBtn.textContent = confirmLabel;
    confirmHandler = onConfirm;
    elements.confirmModal.classList.add('active');
}


function openDeleteConfirm() {
    if (!state.currentSong) return;
    openConfirm({
        title: 'Delete Song',
        message: `Are you sure you want to delete "${state.currentSong.title}"?`,
        confirmLabel: 'Delete',
        onConfirm: deleteSong,
    });
}


function closeDeleteConfirm() {
    confirmHandler = null;
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
        const deletedId = state.currentSong.id;
        state.currentSong = null;
        state.currentVerseIndex = 0;

        closeDeleteConfirm();
        renderSongDisplay();
        await fetchSongs();
        fetchCollections();
        updateStatus(`Deleted "${title}"`, {
            label: 'Undo',
            onClick: () => undoDelete(deletedId, title),
        });
    } catch (error) {
        console.error('Error deleting song:', error);
        updateStatus('Failed to delete song');
    }
}


async function undoDelete(songId, title) {
    try {
        const response = await fetch(`${API_URL}/songs/${songId}/restore`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to restore song');
        await fetchSongs();
        fetchCollections();
        updateStatus(`Restored "${title}"`);
    } catch (error) {
        console.error('Error restoring song:', error);
        updateStatus('Failed to restore song');
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
    // Reset the update panel each time the modal opens.
    elements.updateStatus.textContent = '';
    elements.updateStatus.classList.remove('update-available');
    elements.updateAction.innerHTML = '';
    elements.aboutModal.classList.add('active');
}


function closeAboutModal() {
    elements.aboutModal.classList.remove('active');
}


// ----- Keyboard shortcuts reference -----

// Modifier glyphs. macOS gets the symbols people expect on that platform;
// everywhere else spells them out. The chords themselves come from the native
// menu, which registers them as CmdOrCtrl — so the same table describes both.
const KEY_GLYPHS = navigator.userAgent.includes('Mac')
    ? { mod: '⌘', shift: '⇧', ctrl: '⌃', backspace: '⌫' }
    : { mod: 'Ctrl+', shift: 'Shift+', ctrl: 'Ctrl+', backspace: 'Backspace' };

// Every key in a `keys` entry renders as its own <kbd>; a `/` between two of
// them renders as a plain separator ("this or that"). `{mod}` and friends are
// substituted from KEY_GLYPHS above.
const SHORTCUT_GROUPS = [
    {
        title: 'During the service',
        items: [
            { keys: ['→', '/', '←'], action: 'Next / previous verse' },
            { keys: ['1'], action: 'Jump to verse 1–9' , label: '1–9' },
            { keys: ['0'], action: 'Jump to verse 10' },
            { keys: ['PgDn', '/', 'PgUp'], action: 'Next / previous item in the open collection' },
            { keys: ['.', '/', ','], action: 'Same, without reaching for the page keys' },
            { keys: ['Space'], action: 'Blank / unblank screen' },
            { keys: ['L'], action: 'Show / hide logo slide' },
            { keys: ['Esc'], action: 'Close dialog, clear alert, or clear display' },
        ],
    },
    {
        title: 'Projector',
        items: [
            { keys: ['P'], action: 'Open / close projector' },
            { keys: ['F'], action: 'Open projector (never closes it)' },
            { keys: ['{mod}{shift}P'], action: 'Open / close projector' },
            { keys: ['{mod}B'], action: 'Blank screen' },
            { keys: ['{mod}L'], action: 'Show / hide logo slide' },
        ],
    },
    {
        title: 'Alerts',
        items: [
            { keys: ['A'], action: 'Open the alert box' },
            { keys: ['{shift}A'], action: 'Clear the alert on screen' },
        ],
    },
    {
        title: 'Getting around',
        items: [
            { keys: ['/'], action: 'Search the song library', literalSlash: true },
            { keys: ['{ctrl}1', '/', '{ctrl}2', '/', '{ctrl}3'], action: 'Library / Collections / Bible tab' },
            { keys: ['[', '/', ']'], action: 'Previous / next sidebar tab' },
            { keys: ['?'], action: 'Show this list' },
        ],
    },
    {
        title: 'Library',
        items: [
            { keys: ['{mod}N'], action: 'New song' },
            { keys: ['{mod}E'], action: 'Edit selected song' },
            { keys: ['{mod}{backspace}'], action: 'Delete selected song' },
            { keys: ['{mod}I'], action: 'Import songs' },
            { keys: ['{mod}{shift}I'], action: 'Import from database' },
            { keys: ['{mod},'], action: 'Display settings' },
        ],
    },
];

function formatShortcutKey(key) {
    return key.replace(/\{(\w+)\}/g, (_, name) => KEY_GLYPHS[name] ?? '');
}

function renderShortcutsList() {
    elements.shortcutsGroups.innerHTML = SHORTCUT_GROUPS.map(group => `
        <div class="shortcuts-group">
            <div class="shortcuts-group-title">${group.title}</div>
            ${group.items.map(item => `
                <div class="shortcut-row">
                    <span class="shortcut-action">${escapeHtml(item.action)}</span>
                    <span class="shortcut-keys">${item.keys.map(key =>
                        // A bare "/" separates alternatives, unless the row is
                        // documenting the slash key itself.
                        key === '/' && !item.literalSlash
                            ? '<span class="shortcut-sep">/</span>'
                            : `<kbd>${escapeHtml(item.label ?? formatShortcutKey(key))}</kbd>`
                    ).join('')}</span>
                </div>
            `).join('')}
        </div>
    `).join('');
}

function openShortcutsModal() {
    renderShortcutsList();
    elements.shortcutsModal.classList.add('active');
}


function closeShortcutsModal() {
    elements.shortcutsModal.classList.remove('active');
}


// Which dialogs Escape may dismiss, and how. `editModal` is deliberately absent:
// it holds unsaved lyrics, so Cancel and Save stay the only ways out of it.
// Anything listed here is closed through its own function rather than by
// stripping .active, so per-modal cleanup still runs.
const ESCAPE_CLOSERS = {
    shortcutsModal: () => closeShortcutsModal(),
    settingsModal: () => closeSettingsModal(),
    aboutModal: () => closeAboutModal(),
    confirmModal: () => closeDeleteConfirm(),
    importModal: () => closeImportModal(),
    dbImportModal: () => closeDbImportModal(),
};

// Topmost open dialog, or null. Later in document order wins, which matches the
// stacking the operator sees.
function getOpenModal() {
    const open = document.querySelectorAll('.modal-overlay.active');
    return open.length ? open[open.length - 1] : null;
}

// Escape peels off one layer at a time — dialog, then popover, then the alert
// banner, and only then the projected slide. Clearing the display is the most
// destructive of those, so it must never be what a stray Escape does while
// something else is on screen.
function handleEscape() {
    const modal = getOpenModal();
    if (modal) {
        const close = ESCAPE_CLOSERS[modal.id];
        if (close) close();
        return;
    }
    if (elements.alertPopover.classList.contains('open')) {
        closeAlertPopover();
        return;
    }
    if (alertActive) {
        clearAlert();
        return;
    }
    state.currentSong = null;
    state.currentVerseIndex = 0;
    renderSongDisplay();
    renderSongList();
}


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

// Attempts a true in-place update via the Tauri updater plugin. Returns true
// only if it actually performed the update. When the plugin isn't present or
// isn't configured (no endpoint/pubkey yet), it returns false so the caller
// falls back to opening the release download. See
// docs/plans/auto-update-setup.md for how to activate real auto-update.
async function tryPluginAutoUpdate() {
    const updater = window.__TAURI__ && window.__TAURI__.updater;
    if (!updater || typeof updater.check !== 'function') return false;
    let update;
    try {
        update = await updater.check();
    } catch (e) {
        console.warn('Updater not configured, using download fallback:', e);
        return false;
    }
    if (!update || !update.available) return false;

    elements.updateStatus.textContent = `Downloading version ${update.version}…`;
    await update.downloadAndInstall();
    // Relaunch if the process plugin is available; otherwise ask the user to.
    const proc = window.__TAURI__.process;
    if (proc && typeof proc.relaunch === 'function') {
        await proc.relaunch();
    } else {
        elements.updateStatus.textContent = 'Update installed — please restart HymnBeam.';
    }
    return true;
}

let updateCheckInFlight = false;

async function checkForUpdates() {
    if (updateCheckInFlight) return;
    updateCheckInFlight = true;
    elements.checkUpdateBtn.disabled = true;
    elements.updateStatus.classList.remove('update-available');
    elements.updateAction.innerHTML = '';
    elements.updateStatus.textContent = 'Checking for updates…';

    try {
        const current = await getCurrentVersion();
        let rel;
        try {
            const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
                headers: { 'Accept': 'application/vnd.github+json' }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            rel = await res.json();
        } catch (e) {
            console.error('Update check failed:', e);
            elements.updateStatus.textContent = 'Could not check for updates — check your connection.';
            return;
        }

        const latest = (rel.tag_name || '').replace(/^v/, '');
        if (!latest || !current || !isNewerVersion(latest, current)) {
            elements.updateStatus.textContent = current
                ? `You're up to date (version ${current}).`
                : 'You\'re on the latest version.';
            return;
        }

        elements.updateStatus.textContent = `Version ${latest} is available — you have ${current}.`;
        elements.updateStatus.classList.add('update-available');

        const isWin = (navigator.userAgent || '').toLowerCase().includes('windows');
        const assets = rel.assets || [];
        const asset = assets.find(a => isWin ? a.name.endsWith('.exe') : a.name.endsWith('.dmg'));
        const downloadUrl = asset ? asset.browser_download_url : rel.html_url;

        const btn = document.createElement('button');
        btn.className = 'btn btn-primary btn-small';
        btn.textContent = 'Download update';
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            // Prefer a true in-place update when the updater is configured;
            // otherwise open the installer download in the browser.
            if (await tryPluginAutoUpdate()) return;
            await openExternalUrl(downloadUrl);
            elements.updateStatus.textContent = `Opening the download for version ${latest} in your browser…`;
        });
        elements.updateAction.appendChild(btn);
    } finally {
        updateCheckInFlight = false;
        elements.checkUpdateBtn.disabled = false;
    }
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
    if (typeof parseReference === 'function' && !parseReference(reference)) {
        updateStatus(`Couldn't resolve "${reference}"`);
        return;
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
    text.style.textAlign = s.typography.alignment;
}

function syncSettingsForm() {
    syncTargetRow();
    const s = targetSettings();
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
            Object.assign(state.settings.bible, songDisplaySlice());
            state.settings.bible.initialized = true;
        }
        syncSettingsForm();
        onSettingsChanged();
    });
    elements.bibleMatchSongBtn.addEventListener('click', () => {
        Object.assign(state.settings.bible, songDisplaySlice());
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
            targetSettings().typography.alignment = b.dataset.value;
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
    elements.checkUpdateBtn.addEventListener('click', checkForUpdates);
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

    // Close pickers when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.add-to-collection-wrapper')) {
            document.getElementById('collectionPicker').classList.remove('open');
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
});
