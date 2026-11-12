// The status toast, plus adding, editing, deleting and exporting songs.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

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
            // "Verse1" and "Verse 1" both become "Verse 1".
            let label = firstLine.replace(/\s*(\d+)/, ' $1').trim();
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
