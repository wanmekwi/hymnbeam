let API_URL = 'http://127.0.0.1:8765';

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
    sortBy: 'title',
    searchQuery: '',
    collections: [],        // all collection summaries
    openCollection: null,   // currently open collection (full with songs)
    collectionPosition: -1, // index of active song in open collection
};

async function initApiUrl() {
    if (window.__TAURI__) {
        try {
            const port = await window.__TAURI__.core.invoke('get_api_port');
            API_URL = `http://127.0.0.1:${port}`;
        } catch (e) {
            console.warn('Could not get API port from Tauri, using default');
        }
    }
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
    verseTabs: document.getElementById('verseTabs'),
    verseContent: document.getElementById('verseContent'),
    previewText: document.getElementById('previewText'),
    previewWindow: document.getElementById('previewWindow'),
    importBtn: document.getElementById('importBtn'),
    projectorBtn: document.getElementById('projectorBtn'),
    blankBtn: document.getElementById('blankBtn'),
    importModal: document.getElementById('importModal'),
    closeModal: document.getElementById('closeModal'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    status: document.getElementById('status'),
    sortSelect: document.getElementById('sortSelect'),
    newSongBtn: document.getElementById('newSongBtn'),
    editSongBtn: document.getElementById('editSongBtn'),
    deleteSongBtn: document.getElementById('deleteSongBtn'),
    editModal: document.getElementById('editModal'),
    editModalTitle: document.getElementById('editModalTitle'),
    closeEditModal: document.getElementById('closeEditModal'),
    songForm: document.getElementById('songForm'),
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
};


async function fetchSongs() {
    try {
        const url = `${API_URL}/songs?sort=${state.sortBy}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch songs');
        state.songs = await response.json();
        renderSongList();
        updateStatus('connected');
    } catch (error) {
        console.error('Error fetching songs:', error);
        updateStatus('Backend not running. Start with: cd backend && python3 main.py');
    }
}


async function searchSongs(query) {
    state.searchQuery = query;
    try {
        const params = new URLSearchParams({ sort: state.sortBy });
        if (query.trim()) {
            params.set('q', query.trim());
        }
        const url = query.trim()
            ? `${API_URL}/songs/search?${params}`
            : `${API_URL}/songs?${params}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Search failed');
        state.songs = await response.json();
        renderSongList();
    } catch (error) {
        console.error('Error searching songs:', error);
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
    } catch (error) {
        console.error('Error loading song:', error);
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

        if (!isChorus && chorusIndex !== -1) {
            const nextIndex = i + 1;
            const nextVerse = verses[nextIndex];
            const nextIsChorus = nextVerse?.label.toLowerCase().includes('chorus');

            if (!nextIsChorus && nextIndex < verses.length) {
                state.navigationOrder.push(chorusIndex);
            }
        }
    }
}


function renderSongList() {
    elements.songCount.textContent = `${state.songs.length} song${state.songs.length !== 1 ? 's' : ''}`;

    if (state.songs.length === 0) {
        elements.emptyState.style.display = 'flex';
        elements.songList.innerHTML = '';
        elements.songList.appendChild(elements.emptyState);
        return;
    }

    elements.emptyState.style.display = 'none';
    elements.songList.innerHTML = state.songs.map(song => `
        <div class="song-item ${state.currentSong?.id === song.id ? 'active' : ''}"
             data-id="${song.id}">
            <div class="song-item-header">
                <span class="song-item-number">#${song.id}</span>
                <span class="song-item-title">${escapeHtml(song.title)}</span>
                ${song.musical_key ? `<span class="song-item-key">${escapeHtml(song.musical_key)}</span>` : ''}
            </div>
            <div class="song-item-meta">
                ${song.author ? escapeHtml(song.author) + ' · ' : ''}${song.verse_count} verse${song.verse_count !== 1 ? 's' : ''}
            </div>
        </div>
    `).join('');

    elements.songList.querySelectorAll('.song-item').forEach(item => {
        item.addEventListener('click', () => loadSong(parseInt(item.dataset.id)));
    });
}


function renderSongDisplay() {
    if (!state.currentSong) {
        elements.contentPlaceholder.hidden = false;
        elements.songDisplay.hidden = true;
        return;
    }

    elements.contentPlaceholder.hidden = true;
    elements.songDisplay.hidden = false;

    elements.displayTitle.textContent = state.currentSong.title;
    elements.displayAuthor.textContent = state.currentSong.author || '';

    elements.verseTabs.innerHTML = state.currentSong.verses.map((verse, i) => `
        <button class="verse-tab ${i === state.currentVerseIndex ? 'active' : ''}"
                data-index="${i}">
            ${escapeHtml(verse.label)}
        </button>
    `).join('');

    elements.verseTabs.querySelectorAll('.verse-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const index = parseInt(tab.dataset.index);
            state.currentVerseIndex = index;
            const navPos = state.navigationOrder.indexOf(index);
            if (navPos !== -1) {
                state.navPosition = navPos;
            }
            renderSongDisplay();
            sendToProjector();
        });
    });

    renderQuickNav();

    const currentVerse = state.currentSong.verses[state.currentVerseIndex];
    if (currentVerse) {
        elements.verseContent.textContent = currentVerse.text;
        applyTextSizeClass(elements.verseContent, currentVerse.text);
        updatePreview(currentVerse.text);
    }

    renderSongList();
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

    elements.quickNav.querySelectorAll('.nav-flow-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const navPos = parseInt(btn.dataset.navPos);
            state.navPosition = navPos;
            state.currentVerseIndex = state.navigationOrder[navPos];
            renderSongDisplay();
            sendToProjector();
        });
    });
}


function applyTextSizeClass(element, text) {
    element.classList.remove('long-text', 'very-long-text');
    const lineCount = (text.match(/\n/g) || []).length + 1;
    const charCount = text.length;

    if (lineCount > 8 || charCount > 350) {
        element.classList.add('very-long-text');
    } else if (lineCount > 5 || charCount > 200) {
        element.classList.add('long-text');
    }
}


function updatePreview(text) {
    if (state.isBlank) {
        elements.previewText.textContent = '';
        elements.previewWindow.parentElement.classList.add('blanked');
    } else {
        elements.previewText.textContent = text;
        elements.previewWindow.parentElement.classList.remove('blanked');
    }
}


async function sendToProjector() {
    if (!state.projectorOpen || !state.currentSong) return;

    const currentVerse = state.currentSong.verses[state.currentVerseIndex];
    const payload = {
        text: state.isBlank ? '' : (currentVerse?.text || ''),
        isBlank: state.isBlank,
        title: state.currentSong.title,
        author: state.currentSong.author,
        musical_key: state.currentSong.musical_key,
        songId: state.currentSong.id
    };

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
        window.projectorWindow.postMessage({
            type: 'update-lyrics',
            ...payload
        }, '*');
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
                setTimeout(sendToProjector, 500);
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


async function importFiles(files) {
    const formData = new FormData();
    let importedCount = 0;

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
            }
        } catch (error) {
            console.error(`Error importing ${file.name}:`, error);
        }
    }

    if (importedCount > 0) {
        updateStatus(`Imported ${importedCount} song${importedCount !== 1 ? 's' : ''}`);
        fetchSongs();
    }

    closeImportModal();
}


function openImportModal() {
    elements.importModal.classList.add('active');
}


function closeImportModal() {
    elements.importModal.classList.remove('active');
}


function updateStatus(message) {
    elements.status.textContent = message;
    elements.status.classList.toggle('connected', message === 'connected');
    if (message === 'connected') {
        elements.status.textContent = 'Connected';
    }
}


function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


function openEditModal(song = null) {
    state.editingSongId = song?.id || null;
    elements.editModalTitle.textContent = song ? 'Edit Song' : 'Add Song';

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

    const song = {
        title: parsed.title,
        author: elements.songAuthorInput.value.trim() || null,
        musical_key: elements.songKeyInput.value.trim() || null,
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


async function fetchCollections() {
    try {
        const response = await fetch(`${API_URL}/collections`);
        if (!response.ok) throw new Error('Failed');
        state.collections = await response.json();
        renderCollectionList();
    } catch (e) {
        console.error('fetchCollections:', e);
    }
}


async function openCollectionDetail(collectionId) {
    try {
        const response = await fetch(`${API_URL}/collections/${collectionId}`);
        if (!response.ok) throw new Error('Failed');
        state.openCollection = await response.json();
        state.collectionPosition = state.openCollection.songs.findIndex(
            s => s.song_id === state.currentSong?.id
        );
        renderCollectionDetail();
        document.getElementById('collectionsListView').classList.add('hidden');
        document.getElementById('collectionDetailView').classList.remove('hidden');
    } catch (e) {
        console.error('openCollectionDetail:', e);
    }
}


function closeCollectionDetail() {
    state.openCollection = null;
    state.collectionPosition = -1;
    document.getElementById('collectionDetailView').classList.add('hidden');
    document.getElementById('collectionsListView').classList.remove('hidden');
    fetchCollections();
}


async function createCollection(name) {
    try {
        const response = await fetch(`${API_URL}/collections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!response.ok) throw new Error('Failed');
        const { id } = await response.json();
        await openCollectionDetail(id);
        openCollectionsTab();
        return id;
    } catch (e) {
        console.error('createCollection:', e);
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
    if (!state.currentSong) return;
    try {
        const response = await fetch(`${API_URL}/collections/${collectionId}/songs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ song_id: state.currentSong.id })
        });
        if (!response.ok) throw new Error('Failed');
        updateStatus('Added to collection');
        if (state.openCollection?.id === collectionId) {
            await openCollectionDetail(collectionId);
        }
        await fetchCollections();
    } catch (e) {
        console.error('addToCollection:', e);
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


function renderCollectionList() {
    const items = document.getElementById('collectionItems');
    const empty = document.getElementById('collectionEmptyState');
    const count = document.getElementById('collectionCount');

    count.textContent = `${state.collections.length} collection${state.collections.length !== 1 ? 's' : ''}`;

    if (state.collections.length === 0) {
        items.innerHTML = '';
        items.appendChild(empty);
        empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';
    items.innerHTML = state.collections.map(c => `
        <div class="collection-item" data-id="${c.id}">
            <div class="collection-item-info">
                <div class="collection-item-name">${escapeHtml(c.name)}</div>
                <div class="collection-item-meta">${c.song_count} song${c.song_count !== 1 ? 's' : ''}</div>
            </div>
            <svg class="collection-item-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M6 3l5 5-5 5"/>
            </svg>
        </div>
    `).join('');

    items.querySelectorAll('.collection-item').forEach(el => {
        el.addEventListener('click', () => openCollectionDetail(parseInt(el.dataset.id)));
    });
}


function renderCollectionDetail() {
    if (!state.openCollection) return;

    document.getElementById('collectionNameInput').value = state.openCollection.name;

    const container = document.getElementById('collectionSongItems');
    const empty = document.getElementById('collectionSongsEmptyState');
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

        container.querySelectorAll('.collection-song-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.collection-song-controls')) return;
                const songId = parseInt(el.dataset.songId);
                const entryId = parseInt(el.dataset.entryId);
                state.collectionPosition = state.openCollection.songs.findIndex(s => s.id === entryId);
                loadSong(songId);
                renderCollectionDetail();
            });
        });

        container.querySelectorAll('.collection-song-btn.up').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                moveCollectionSong(parseInt(btn.dataset.entryId), -1);
            });
        });

        container.querySelectorAll('.collection-song-btn.down').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                moveCollectionSong(parseInt(btn.dataset.entryId), 1);
            });
        });

        container.querySelectorAll('.collection-song-btn.remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFromCollection(parseInt(btn.dataset.entryId));
            });
        });
    }

    const total = songs.length;
    const pos = state.collectionPosition;
    const posEl = document.getElementById('collectionPosition');
    posEl.textContent = total === 0 ? '—' : pos >= 0 ? `${pos + 1} / ${total}` : `— / ${total}`;
    document.getElementById('collectionPrevBtn').disabled = pos <= 0;
    document.getElementById('collectionNextBtn').disabled = pos < 0 || pos >= total - 1;
}


function navigateCollection(direction) {
    if (!state.openCollection) return;
    const songs = state.openCollection.songs;
    const newPos = state.collectionPosition + direction;
    if (newPos < 0 || newPos >= songs.length) return;
    state.collectionPosition = newPos;
    loadSong(songs[newPos].song_id);
    renderCollectionDetail();
}


function openLibraryTab() {
    document.getElementById('libraryPanel').classList.remove('hidden');
    document.getElementById('collectionsPanel').classList.add('hidden');
    document.getElementById('libraryTabBtn').classList.add('active');
    document.getElementById('collectionsTabBtn').classList.remove('active');
}


function openCollectionsTab() {
    document.getElementById('libraryPanel').classList.add('hidden');
    document.getElementById('collectionsPanel').classList.remove('hidden');
    document.getElementById('libraryTabBtn').classList.remove('active');
    document.getElementById('collectionsTabBtn').classList.add('active');
}


function toggleCollectionPicker() {
    const picker = document.getElementById('collectionPicker');
    const isOpen = picker.classList.contains('open');
    if (isOpen) {
        picker.classList.remove('open');
        return;
    }
    const list = document.getElementById('collectionPickerList');
    list.innerHTML = state.collections.map(c => `
        <button type="button" class="collection-picker-item" data-id="${c.id}">
            ${escapeHtml(c.name)}
            <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">${c.song_count}</span>
        </button>
    `).join('');
    list.querySelectorAll('.collection-picker-item').forEach(btn => {
        btn.addEventListener('click', () => {
            addToCollection(parseInt(btn.dataset.id));
            picker.classList.remove('open');
        });
    });
    picker.classList.add('open');
}


function initEventListeners() {
    let searchTimeout;
    elements.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchSongs(e.target.value), 200);
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
            case 'f':
            case 'F':
                if (!state.projectorOpen) toggleProjector();
                break;
        }
    });

    // Sidebar tabs
    document.getElementById('libraryTabBtn').addEventListener('click', openLibraryTab);
    document.getElementById('collectionsTabBtn').addEventListener('click', () => {
        openCollectionsTab();
        fetchCollections();
    });

    // Collection list
    document.getElementById('newCollectionBtn').addEventListener('click', () => {
        createCollection('New Collection');
    });

    // Collection detail
    document.getElementById('backToCollectionsBtn').addEventListener('click', closeCollectionDetail);
    document.getElementById('deleteCollectionBtn').addEventListener('click', deleteOpenCollection);

    let renameTimeout;
    document.getElementById('collectionNameInput').addEventListener('input', (e) => {
        clearTimeout(renameTimeout);
        renameTimeout = setTimeout(() => {
            if (state.openCollection) renameCollection(state.openCollection.id, e.target.value);
        }, 600);
    });

    // Collection navigation
    document.getElementById('collectionPrevBtn').addEventListener('click', () => navigateCollection(-1));
    document.getElementById('collectionNextBtn').addEventListener('click', () => navigateCollection(1));

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
        if (!e.target.closest('#addToCollectionBtn') && !e.target.closest('#collectionPicker')) {
            document.getElementById('collectionPicker').classList.remove('open');
        }
        if (!e.target.closest('#exportBtn') && !e.target.closest('#exportMenu')) {
            closeExportMenu();
        }
    });
}


document.addEventListener('DOMContentLoaded', async () => {
    await initApiUrl();
    initEventListeners();
    fetchSongs();
    fetchCollections();
});
