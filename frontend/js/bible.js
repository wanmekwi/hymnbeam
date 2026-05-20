const BOOK_ABBR = {
    '01O':'Gen','02O':'Exo','03O':'Lev','04O':'Num','05O':'Deu',
    '06O':'Jos','07O':'Jdg','08O':'Rut','09O':'1Sa','10O':'2Sa',
    '11O':'1Ki','12O':'2Ki','13O':'1Ch','14O':'2Ch','15O':'Ezr',
    '16O':'Neh','17O':'Est','18O':'Job','19O':'Psa','20O':'Pro',
    '21O':'Ecc','22O':'Sng','23O':'Isa','24O':'Jer','25O':'Lam',
    '26O':'Eze','27O':'Dan','28O':'Hos','29O':'Joe','30O':'Amo',
    '31O':'Oba','32O':'Jon','33O':'Mic','34O':'Nah','35O':'Hab',
    '36O':'Zep','37O':'Hag','38O':'Zec','39O':'Mal',
    '40N':'Mat','41N':'Mrk','42N':'Luk','43N':'Jhn','44N':'Act',
    '45N':'Rom','46N':'1Co','47N':'2Co','48N':'Gal','49N':'Eph',
    '50N':'Php','51N':'Col','52N':'1Th','53N':'2Th','54N':'1Ti',
    '55N':'2Ti','56N':'Tit','57N':'Phm','58N':'Heb','59N':'Jas',
    '60N':'1Pe','61N':'2Pe','62N':'1Jn','63N':'2Jn','64N':'3Jn',
    '65N':'Jud','66N':'Rev',
};

// Navigation stack stored at module level — more reliable than DOM properties.
let _bibleNavStack = [];

const bibleState = {
    view: 'books',
    books: [],
    openBook: null,
    openChapter: null,
    verses: [],
    searchResults: [],
    searchQuery: '',
    activeVerse: null,
};

async function fetchBibleBooks() {
    const res = await fetch(`${API_URL}/bible/books`);
    if (!res.ok) throw new Error('Failed to load Bible books');
    bibleState.books = await res.json();
}

async function fetchBibleChapter(bookCode, chapter) {
    const res = await fetch(`${API_URL}/bible/${encodeURIComponent(bookCode)}/${chapter}`);
    if (!res.ok) throw new Error('Failed to load chapter');
    return res.json();
}

async function fetchBibleSearch(q) {
    const res = await fetch(`${API_URL}/bible/search?q=${encodeURIComponent(q)}&limit=60`);
    if (!res.ok) throw new Error('Bible search failed');
    return res.json();
}

function buildBibleVersesArray() {
    return bibleState.verses.map(v => v.text);
}

function sendBiblePayload(payload) {
    const frame = document.getElementById('previewFrame');
    if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'update-lyrics', ...payload }, '*');
    }
    if (state.projectorOpen && window.__TAURI__) {
        window.__TAURI__.core.invoke('send_to_projector', {
            event: 'update-lyrics',
            payload: JSON.stringify(payload),
        }).catch(e => console.error('bible project error:', e));
    }
}

async function openBibleTab() {
    document.getElementById('libraryPanel').classList.add('hidden');
    document.getElementById('collectionsPanel').classList.add('hidden');
    document.getElementById('biblePanel').classList.remove('hidden');
    document.getElementById('libraryTabBtn').classList.remove('active');
    document.getElementById('collectionsTabBtn').classList.remove('active');
    document.getElementById('bibleTabBtn').classList.add('active');
    if (bibleState.books.length === 0) {
        try {
            await fetchBibleBooks();
            renderBibleBooks();
        } catch (e) {
            console.error(e);
        }
    } else {
        renderCurrentBibleView();
    }
}

function renderCurrentBibleView() {
    switch (bibleState.view) {
        case 'books':   renderBibleBooks();    break;
        case 'chapters':renderBibleChapters(); break;
        case 'verses':  renderBibleVerses();   break;
        case 'search':  renderBibleSearch();   break;
    }
}

// segments: [{label, fn}] — each segment is a breadcrumb step; back button
// navigates to the last segment's fn (one level up).
function setBreadcrumb(segments) {
    _bibleNavStack = segments || [];
    const bc = document.getElementById('bibleBreadcrumb');
    const labelEl = document.getElementById('bibleBreadcrumbLabel');
    if (!_bibleNavStack.length) {
        bc.classList.add('hidden');
        return;
    }
    bc.classList.remove('hidden');
    labelEl.innerHTML = _bibleNavStack.map((seg, i) =>
        `<span class="breadcrumb-seg" data-idx="${i}">${escapeHtml(seg.label)}</span>` +
        (i < _bibleNavStack.length - 1 ? '<span class="breadcrumb-sep">›</span>' : '')
    ).join('');
}

function renderBibleBooks() {
    bibleState.view = 'books';
    setBreadcrumb([]);
    const list = document.getElementById('bibleContentList');
    const ot = bibleState.books.filter(b => b.code.endsWith('O'));
    const nt = bibleState.books.filter(b => b.code.endsWith('N'));
    const section = (title, books) => `
        <div class="bible-section-label">${title}</div>
        <div class="bible-book-grid">
            ${books.map(b => `
                <div class="bible-book-cell" data-code="${escapeHtml(b.code)}" title="${escapeHtml(b.name)}">
                    <span class="bible-book-abbr">${escapeHtml(BOOK_ABBR[b.code] || b.name.slice(0,3))}</span>
                    <span class="bible-book-name">${escapeHtml(b.name)}</span>
                </div>
            `).join('')}
        </div>
    `;
    list.innerHTML = section('Old Testament', ot) + section('New Testament', nt);
}

function renderBibleChapters() {
    if (!bibleState.openBook) { renderBibleBooks(); return; }
    const book = bibleState.openBook;
    bibleState.view = 'chapters';
    setBreadcrumb([
        { label: book.name, fn: () => { bibleState.view = 'books'; renderBibleBooks(); } }
    ]);
    const list = document.getElementById('bibleContentList');
    list.innerHTML = `
        <div class="bible-chapter-grid">
            ${Array.from({ length: book.chapters }, (_, i) => i + 1).map(ch =>
                `<div class="bible-chapter-cell" data-chapter="${ch}">${ch}</div>`
            ).join('')}
        </div>
    `;
}

async function openBibleBook(code) {
    const book = bibleState.books.find(b => b.code === code);
    if (!book) return;
    bibleState.openBook = book;
    renderBibleChapters();
}

async function openBibleChapter(chapter) {
    if (!bibleState.openBook) return;
    bibleState.activeVerse = null;
    bibleState.openChapter = chapter;
    try {
        bibleState.verses = await fetchBibleChapter(bibleState.openBook.code, chapter);
    } catch (e) {
        console.error(e);
        return;
    }
    bibleState.view = 'verses';
    renderBibleVerses();
}

// Convert [word] italic markers to <em>word</em> HTML.
// Escapes all non-bracket content so it is safe to inject via innerHTML.
function bibleTextToHtml(text) {
    // Split on [word] markers, escape surrounding text, wrap markers in <em>
    return text.split(/(\[[^\]]+\])/).map((part, i) => {
        if (i % 2 === 1) {
            // Italic segment: strip the brackets, escape, wrap in <em>
            const inner = escapeHtml(part.slice(1, -1));
            return `<em>${inner}</em>`;
        }
        return escapeHtml(part);
    }).join('');
}

// Strip [word] markers to get plain text (used for measurement and FTS display).
function bibleTextPlain(text) {
    return text.replace(/\[([^\]]+)\]/g, '$1');
}

function renderBibleVerses() {
    const book = bibleState.openBook;
    const ch = bibleState.openChapter;
    setBreadcrumb([
        { label: book.name, fn: () => { bibleState.view = 'books'; renderBibleBooks(); } },
        { label: `${BOOK_ABBR[book.code] || book.name}  ${ch}`, fn: renderBibleChapters },
    ]);
    const list = document.getElementById('bibleContentList');
    list.innerHTML = bibleState.verses.map(v => `
        <div class="bible-verse-item ${bibleState.activeVerse === v.verse ? 'active-verse' : ''}"
             data-verse="${v.verse}">
            <span class="bible-verse-num">${v.verse}</span>
            <span class="bible-verse-text">${bibleTextToHtml(v.text)}</span>
        </div>
    `).join('');
}

function renderBibleSearch() {
    bibleState.view = 'search';
    setBreadcrumb([]);
    const list = document.getElementById('bibleContentList');
    if (bibleState.searchResults.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No results</p></div>';
        return;
    }
    list.innerHTML = bibleState.searchResults.map(h => `
        <div class="bible-search-hit"
             data-book="${escapeHtml(h.book)}" data-chapter="${h.chapter}" data-verse="${h.verse}">
            <span class="bible-search-ref">${escapeHtml(h.reference)}</span>
            <span class="bible-search-text">${bibleTextToHtml(h.text)}</span>
        </div>
    `).join('');
}

function projectBibleVerse(book, bookName, chapter, verse, text) {
    bibleState.activeVerse = verse;

    const songId = `bible-${book}-${chapter}`;
    const title = `${bookName} ${chapter}:${verse}`;

    const payload = {
        text,
        label: `${chapter}:${verse}`,
        isBlank: false,
        isBible: true,
        title,
        author: null,
        musical_key: null,
        songId,
        songNumber: null,
        verses: buildBibleVersesArray(),
        hasPrev: false,
        hasNext: false,
    };

    sendBiblePayload(payload);

    if (bibleState.view === 'verses') renderBibleVerses();
}


// Parse a typed reference like "John 3:16", "1 Cor 13:4", "Ps 23:1".
// Returns {book, chapter, verse} or null if the query isn't a reference.
function parseReference(query) {
    const m = query.trim().match(/^(\d?\s*[a-zA-Z][\w ]*?)\s+(\d+):(\d+)\s*$/);
    if (!m) return null;
    const chapter = parseInt(m[2], 10);
    const verse   = parseInt(m[3], 10);
    if (!chapter || !verse) return null;
    const book = findBookByQuery(m[1].trim());
    if (!book) return null;
    return { book, chapter, verse };
}

function findBookByQuery(q) {
    if (!bibleState.books.length) return null;
    const norm = q.toLowerCase().replace(/[\s.]/g, '');
    // 1. Exact abbreviation
    for (const b of bibleState.books) {
        if ((BOOK_ABBR[b.code] || '').toLowerCase() === norm) return b;
    }
    // 2. Exact full name
    for (const b of bibleState.books) {
        if (b.name.toLowerCase().replace(/[\s.]/g, '') === norm) return b;
    }
    // 3. Prefix match on name (min 2 chars)
    if (norm.length >= 2) {
        for (const b of bibleState.books) {
            if (b.name.toLowerCase().replace(/[\s.]/g, '').startsWith(norm)) return b;
        }
    }
    return null;
}

async function lookupAndProjectReference({ book, chapter, verse }) {
    try {
        if (!bibleState.books.length) await fetchBibleBooks();
        bibleState.openBook    = book;
        bibleState.openChapter = chapter;
        bibleState.verses      = await fetchBibleChapter(book.code, chapter);
        const row = bibleState.verses.find(r => r.verse === verse);
        if (!row) return;
        bibleState.view = 'verses';
        renderBibleVerses();
        projectBibleVerse(book.code, book.name, chapter, verse, row.text);
    } catch (e) {
        console.error('Reference lookup failed', e);
    }
}

function initBibleListeners() {
    document.getElementById('bibleTabBtn').addEventListener('click', openBibleTab);

    // Breadcrumb: back button goes one level up (last segment's fn)
    document.getElementById('bibleBreadcrumbBack').addEventListener('click', () => {
        if (_bibleNavStack.length > 0) _bibleNavStack[_bibleNavStack.length - 1].fn();
    });

    // Breadcrumb: clicking a segment navigates to that level
    document.getElementById('bibleBreadcrumbLabel').addEventListener('click', (e) => {
        const seg = e.target.closest('.breadcrumb-seg');
        if (!seg) return;
        const fn = _bibleNavStack[parseInt(seg.dataset.idx, 10)]?.fn;
        if (fn) fn();
    });

    // Main content list — all navigation delegated here
    document.getElementById('bibleContentList').addEventListener('click', async (e) => {
        const bookCell    = e.target.closest('.bible-book-cell');
        const chapterCell = e.target.closest('.bible-chapter-cell');
        const verseItem   = e.target.closest('.bible-verse-item');
        const searchHit   = e.target.closest('.bible-search-hit');

        if (bookCell) {
            await openBibleBook(bookCell.dataset.code);
            return;
        }
        if (chapterCell) {
            await openBibleChapter(parseInt(chapterCell.dataset.chapter, 10));
            return;
        }
        if (verseItem) {
            const v = parseInt(verseItem.dataset.verse, 10);
            const row = bibleState.verses.find(r => r.verse === v);
            if (!row) return;
            projectBibleVerse(
                bibleState.openBook.code,
                bibleState.openBook.name,
                bibleState.openChapter,
                v,
                row.text
            );
            return;
        }
        if (searchHit) {
            const book = bibleState.books.find(b => b.code === searchHit.dataset.book);
            const chapter = parseInt(searchHit.dataset.chapter, 10);
            const verse   = parseInt(searchHit.dataset.verse, 10);
            if (!book) return;
            bibleState.openBook = book;
            await openBibleChapter(chapter);
            const row = bibleState.verses.find(r => r.verse === verse);
            if (row) projectBibleVerse(book.code, book.name, chapter, verse, row.text);
        }
    });

    let searchTimer;
    document.getElementById('bibleSearchInput').addEventListener('input', (e) => {
        const q = e.target.value.trim();
        bibleState.searchQuery = q;
        clearTimeout(searchTimer);
        if (!q) {
            if (bibleState.view === 'search') {
                // Return to wherever the user was before searching
                if (bibleState.openChapter != null) {
                    bibleState.view = 'verses';
                    renderBibleVerses();
                } else if (bibleState.openBook) {
                    bibleState.view = 'chapters';
                    renderBibleChapters();
                } else {
                    renderBibleBooks();
                }
            }
            return;
        }
        const ref = parseReference(q);
        if (ref) {
            searchTimer = setTimeout(() => lookupAndProjectReference(ref), 300);
            return;
        }
        searchTimer = setTimeout(async () => {
            try {
                bibleState.searchResults = await fetchBibleSearch(q);
                renderBibleSearch();
            } catch (err) {
                console.error(err);
            }
        }, 300);
    });

}
