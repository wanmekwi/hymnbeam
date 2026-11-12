// The song library: loading and searching songs, the song list, and the
// lyrics / verse display for the selected song.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

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

// Words that carry little meaning in a hymn title. They still help ranking
// when they match, but a query is never rejected because one of them didn't.
const SEARCH_STOPWORDS = new Set([
    'a', 'an', 'the', 'of', 'in', 'on', 'to', 'and', 'is', 'o', 'oh', 'for',
    'at', 'by', 'with', 'my', 'me', 'i',
]);

// Apostrophes are dropped when normalising, so a typed "its" or "im" is
// also tried in full against titles written out as "It Is" / "I Am".
const SEARCH_CONTRACTIONS = {
    its: 'it is', im: 'i am', ive: 'i have', ill: 'i will', id: 'i would',
    hes: 'he is', shes: 'she is', thats: 'that is', theres: 'there is',
    whats: 'what is', youre: 'you are', were: 'we are', theyre: 'they are',
    dont: 'do not', cant: 'can not', wont: 'will not', isnt: 'is not',
};

// Rows rendered for a search. Beyond this the list is noise and only slows
// down every keystroke; the count still reports the full total.
const SEARCH_RENDER_LIMIT = 150;
const LYRIC_SEARCH_DELAY_MS = 250;

function normalizeForSearch(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
        .replace(/['‘’`]/g, '')                   // "Ain't" → "aint"
        .replace(/[^a-z0-9\s]/g, ' ')                       // other punctuation splits words
        .replace(/\s+/g, ' ')
        .trim();
}

// Levenshtein distance, giving up (returning max + 1) as soon as it is clear
// the distance exceeds `max` — only small distances are ever interesting.
function levenshtein(a, b, max = 2) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
        const curr = [i + 1];
        let rowMin = i + 1;
        for (let j = 0; j < b.length; j++) {
            const cost = a[i] === b[j] ? 0 : 1;
            const v = Math.min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost);
            curr.push(v);
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prev = curr;
    }
    return prev[b.length];
}

// Normalising thousands of titles on every keystroke is what made typing
// lag, so it is done once per song list and cached here.
let searchIndex = [];
let searchIndexSource = null;

function getSearchIndex() {
    if (searchIndexSource !== state.songs) {
        searchIndexSource = state.songs;
        searchIndex = state.songs.map(song => {
            const title = normalizeForSearch(song.title);
            const author = normalizeForSearch(song.author || '');
            return {
                song,
                title,
                compact: title.replace(/ /g, ''),
                words: title.split(' ').filter(Boolean),
                authorWords: author.split(' ').filter(Boolean),
                number: normalizeForSearch(song.song_number || song.id),
            };
        });
    }
    return searchIndex;
}

// How well one query word matches the best of `words` (0 = not at all).
// Prefixes count fully so half-typed words match while the user types.
function wordMatchScore(qw, words) {
    let best = 0;
    for (const w of words) {
        if (w === qw) return 100;
        if (w.startsWith(qw)) { best = Math.max(best, 75); continue; }
        if (qw.length >= 3 && w.includes(qw)) { best = Math.max(best, 45); continue; }
        if (qw.length < 4 || best >= 55) continue;
        const max = qw.length >= 7 ? 2 : 1;
        if (levenshtein(qw, w, max) <= max) best = Math.max(best, 55 - 10 * (max - 1));
        // Typo inside a half-typed word: "amazing grse" → "grace".
        else if (w.length > qw.length && levenshtein(qw, w.slice(0, qw.length), 1) <= 1) {
            best = Math.max(best, 40);
        }
    }
    return best;
}

function fuzzyScore(q, qCompact, qWords, entry) {
    // Song-number match wins outright — it's how hymnal users page-flip.
    if (entry.number === q) return 100000;
    if (/^\d+$/.test(q) && entry.number.startsWith(q)) return 50000 - entry.number.length;

    const { title } = entry;
    let best = 0;

    if (title === q) best = 3000;
    else if (title.startsWith(q)) best = 2000;
    else if (title.includes(' ' + q)) best = 1600 - title.indexOf(q);
    // Ignoring spaces copes with "Al-le-lu-jah" vs "allelujah" and with
    // words run together or split apart.
    else if (qCompact.length >= 3 && entry.compact.includes(qCompact)) {
        best = 1200 - entry.compact.indexOf(qCompact);
    }

    // Word-by-word: order-independent, typo-tolerant. Every meaningful word
    // has to match something (one may be missed in longer queries), so a
    // single common word no longer drags in hundreds of unrelated titles.
    const content = qWords.filter(w => !SEARCH_STOPWORDS.has(w));
    const required = content.length ? content : qWords;
    const allowedMisses = required.length >= 3 ? 1 : 0;
    let misses = 0;
    let wordScore = 0;
    for (const qw of qWords) {
        const isRequired = required.includes(qw);
        let s = wordMatchScore(qw, entry.words);
        if (!s && isRequired) s = Math.round(wordMatchScore(qw, entry.authorWords) * 0.6);
        if (!s && isRequired && ++misses > allowedMisses) { wordScore = 0; break; }
        wordScore += isRequired ? s : s / 8;
    }
    if (wordScore > 0) {
        wordScore += misses === 0 ? 150 : -60 * misses;
        // People usually type a title from its start.
        if (entry.words[0]?.startsWith(qWords[0])) wordScore += 50;
        best = Math.max(best, wordScore);
    }

    // Whole-title typo tolerance ("amazng grace").
    if (best === 0 && q.length >= 5 && levenshtein(q, title, 2) <= 2) best = 300;

    // Among equally good matches, prefer the shorter (more exact) title.
    return best > 0 ? best - title.length * 0.5 : 0;
}

function rankedSearchResults(query) {
    const q = normalizeForSearch(query);
    if (!q) return [];
    const qCompact = q.replace(/ /g, '');
    const qWords = q.split(' ');
    const expanded = qWords.map(w => SEARCH_CONTRACTIONS[w] || w).join(' ');
    const alt = expanded !== q ? expanded : null;
    const altWords = alt ? alt.split(' ') : null;
    const scored = [];
    for (const entry of getSearchIndex()) {
        let score = fuzzyScore(q, qCompact, qWords, entry);
        if (alt) score = Math.max(score, fuzzyScore(alt, qCompact, altWords, entry));
        if (score > 0) scored.push({ song: entry.song, score });
    }
    scored.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title));
    return scored.map(r => r.song);
}

let lyricSearchTimer = null;

// Public entry point — also the listener bound to the search input.
function searchSongs(query) {
    const trimmed = (query || '').trim();
    state.searchQuery = trimmed;
    clearTimeout(lyricSearchTimer);

    if (!trimmed) {
        state.searchResults = null;
        renderSongList();
        return;
    }

    state.searchResults = rankedSearchResults(trimmed);
    renderSongList();

    // Titles are matched instantly above. Lyrics live in the backend, so ask
    // it once the user pauses typing and add any extra songs underneath —
    // people often know a hymn by its first line rather than its title.
    if (normalizeForSearch(trimmed).length < 3) return;
    lyricSearchTimer = setTimeout(async () => {
        try {
            const params = new URLSearchParams({ q: trimmed, sort: state.sortBy });
            const res = await fetch(`${API_URL}/songs/search?${params}`);
            if (!res.ok) return;
            const matches = await res.json();
            if (state.searchQuery !== trimmed) return; // user kept typing
            const seen = new Set(state.searchResults.map(s => s.id));
            const extra = matches.filter(s => !seen.has(s.id));
            if (extra.length === 0) return;
            state.searchResults = state.searchResults.concat(extra);
            renderSongList();
        } catch (e) { /* ignore — title matches are already shown */ }
    }, LYRIC_SEARCH_DELAY_MS);
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
    const shown = searching ? list.slice(0, SEARCH_RENDER_LIMIT) : list;
    const hidden = list.length - shown.length;
    elements.songList.innerHTML = shown.map(song => `
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
    `).join('') + (hidden > 0
        ? `<div class="song-list-more">${hidden} more — keep typing to narrow it down</div>`
        : '');

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
