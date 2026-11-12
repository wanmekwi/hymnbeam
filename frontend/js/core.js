// Shared foundations: where the backend lives, the app state, default
// settings and the DOM element lookup. Loaded first; everything else builds on it.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

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
    // The one exception is alignment: scripture keeps its own (left by default,
    // as prose reads best flush-left) whether or not the rest is separate.
    bible: {
        separate: false,
        initialized: false,
        typography: { fontFamily: 'Montserrat', fontWeight: 600, alignment: 'left' },
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
