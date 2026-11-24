// The message library tab: sermons (and a book) installed from a library file.
// The operator browses by year, goes straight to a message by title, date or
// date code (messages-find.js), or searches for a phrase heard from the
// pulpit; then projects paragraphs from the reader, one at a time.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

const MESSAGE_TAB_FALLBACK = 'Sermons';     // the tab's name until a library names it
const MESSAGE_RECENT_KEY = 'hymnbeam.messages.recent';
const MESSAGE_RECENT_COUNT = 5;
// Messages matching by title, date or code are listed above the phrase
// results. A title used many times would push the phrase results out of sight,
// so only the first few are listed while there are phrase results to show.
const MESSAGE_FINDS_SHOWN = 30;
const MESSAGE_FINDS_ABOVE_PHRASES = 5;
const MESSAGE_SEARCH_LIMIT = 50;
// The phrase search waits for typing to pause: a search for common words can
// take half a second on the full library.
const MESSAGE_SEARCH_DELAY_MS = 300;

const messageState = {
    status: null,         // GET /messages/status ({installed: false} with none)
    catalogue: null,      // prepareCatalogue(GET /messages), once loaded
    byCode: new Map(),
    loadError: null,      // why the library could not be read, for the panel
    openYear: null,       // the year open in the browse list
    query: '',
    workQuery: null,      // parseWorkQuery(query)
    finds: [],            // messages matching the query by title, date or code
    showAllFinds: false,  // the operator asked to see every one of them
    hits: null,           // phrase search results; null until the first arrives
    hitsQuery: null,      // the query those results answer; while it is not the box's, they are stale
    searchFailed: false,
    searchSeq: 0,         // bumped on every keystroke, so a slow reply to an older query is dropped
    searchInFlight: null, // {seq, promise} of the phrase search running now
    openSeq: 0,           // likewise for opening a message
    cursor: -1,           // the keyboard's place in the list; -1 for none
    message: null,        // open in the reader: {work, paragraphs}
    highlighted: null,    // the reader's paragraph ready for Enter, as an index
    hitTarget: null,      // {paragraphId, snippet} of the search result the reader was opened at
    live: null,           // the message on screen: see showMessagePlace
    busy: false,          // the import picker or a copy is running
    importPercent: null,
    importError: null,
};
let messageSearchTimer = null;

const messageEl = (id) => document.getElementById(id);

// escapeHtml (song-editing.js) leaves quotes alone; attribute values need them escaped too.
function escapeMessageAttr(text) {
    return escapeHtml(String(text)).replace(/"/g, '&quot;');
}

async function fetchMessageJson(path) {
    const res = await fetch(`${API_URL}${path}`);
    if (!res.ok) {
        const error = new Error((await res.text()) || `HTTP ${res.status}`);
        error.status = res.status;
        throw error;
    }
    return res.json();
}

// ---- The library ----------------------------------------------------------

async function loadMessageStatus() {
    try {
        messageState.status = await fetchMessageJson('/messages/status');
    } catch (e) {
        console.error('message library status:', e);
        messageState.status = { installed: false };
    }
    applyMessageTabLabel();
}

function applyMessageTabLabel() {
    const label = messageState.status?.tab_label || MESSAGE_TAB_FALLBACK;
    messageEl('messagesTabBtn').textContent = label;
    // The Display settings target for the same thing goes by the same name.
    elements.setDisplayTargetMessage.textContent = label;
}

async function ensureMessageCatalogue() {
    if (!messageState.status) await loadMessageStatus();
    if (!messageState.status.installed || messageState.catalogue) return;
    try {
        messageState.catalogue = prepareCatalogue(await fetchMessageJson('/messages'));
        messageState.byCode = new Map(messageState.catalogue.works.map(w => [w.code, w]));
        messageState.loadError = null;
    } catch (e) {
        console.error('message catalogue:', e);
        messageState.loadError = 'The message library could not be read.';
    }
}

// A library was imported, replaced or removed: everything read from the old
// one is dropped. A paragraph already on screen stays there.
async function messageLibraryChanged(status) {
    messageState.status = status;
    messageState.catalogue = null;
    messageState.byCode = new Map();
    messageState.openYear = null;
    messageState.message = null;
    messageState.highlighted = null;
    messageEl('messageSearchInput').value = '';
    setMessageQuery('');
    if (!elements.messageDisplay.hidden) setContentView('placeholder');
    applyMessageTabLabel();
    await ensureMessageCatalogue();
    renderMessagePanel();
}

async function importMessageLibrary() {
    if (!window.__TAURI__ || messageState.busy) return;
    messageState.busy = true;
    messageState.importError = null;
    renderMessagePanel();
    let unlisten = null;
    try {
        unlisten = await window.__TAURI__.event.listen('message-library-progress', (event) => {
            const { copied, total } = event.payload || {};
            messageState.importPercent = total ? Math.floor((copied * 100) / total) : 0;
            renderMessageImportProgress();
        });
    } catch (e) {
        console.error('import progress:', e);   // progress is a nicety; the import still runs
    }
    try {
        // Opens the system file picker; null if the operator cancels it.
        const status = await window.__TAURI__.core.invoke('import_message_library');
        if (status) {
            await messageLibraryChanged(status);
            updateStatus(`Message library installed: ${messageCountText(status)}`);
        }
    } catch (err) {
        // The backend's messages are written for the operator.
        messageState.importError = String(err?.message || err);
    } finally {
        if (unlisten) unlisten();
        messageState.busy = false;
        messageState.importPercent = null;
        renderMessagePanel();
    }
}

function confirmRemoveMessageLibrary() {
    openConfirm({
        title: 'Remove message library',
        message: 'Remove the installed message library from HymnBeam? It can be imported again at any time.',
        confirmLabel: 'Remove',
        onConfirm: removeMessageLibrary,
    });
}

async function removeMessageLibrary() {
    if (!window.__TAURI__) return;
    try {
        const status = await window.__TAURI__.core.invoke('remove_message_library');
        await messageLibraryChanged(status || { installed: false });
        updateStatus('Message library removed');
    } catch (err) {
        console.error('remove message library:', err);
        updateStatus('Could not remove the message library');
    }
}

function messageCountText(status) {
    const parts = [];
    if (status.message_count) parts.push(`${status.message_count.toLocaleString()} messages`);
    if (status.book_chapter_count) parts.push(`${status.book_chapter_count.toLocaleString()} chapters`);
    return parts.join(' · ');
}

// ---- Labels ---------------------------------------------------------------

function messageBookName(work) {
    return work.collection || messageState.status?.book_collection || 'Book';
}

function messageChapterLabel(work) {
    return work.chapter ? `Chapter ${work.chapter}` : '';
}

// The line under a message's title: when, where and its code; for a book
// chapter, the book and chapter.
function messageMetaLine(work) {
    if (work.kind === 'book') {
        return [messageBookName(work), messageChapterLabel(work)].filter(Boolean).join(' · ');
    }
    const when = messageState.byCode.get(work.code) || work;
    return [messageDateLabel(when), work.location, work.code].filter(Boolean).join(' · ');
}

// ---- The panel ------------------------------------------------------------

function messageSectionHtml(label) {
    return `<div class="bible-section-label">${escapeHtml(label)}</div>`;
}

function messageRowHtml(work) {
    const selected = messageState.message?.work.code === work.code ? ' selected' : '';
    return `
        <div class="message-row message-result${selected}" data-code="${escapeMessageAttr(work.code)}">
            <span class="message-row-title">${escapeHtml(work.title)}</span>
            <span class="message-row-meta">${escapeHtml(messageMetaLine(work))}</span>
        </div>`;
}

// FTS snippets mark the matched words with private-use characters, as the
// text has square brackets of its own. Escape first, then turn the marks into
// highlights.
function messageSnippetHtml(snippet) {
    return escapeHtml(snippet || '')
        .replace(/([^]*)/g, '<mark>$1</mark>')
        .replace(/[]/g, '');
}

function messageHitHtml(hit, stale) {
    const work = messageState.byCode.get(hit.code) || hit;
    const ref = hit.kind === 'book'
        ? [messageBookName(work), [messageChapterLabel(hit), hit.title].filter(Boolean).join(' – ')].join(' · ')
        : [hit.title, hit.code, hit.location].filter(Boolean).join(' · ');
    return `
        <div class="message-hit ${stale ? 'stale' : 'message-result'}" data-code="${escapeMessageAttr(hit.code)}"
             data-paragraph-id="${escapeMessageAttr(hit.paragraph_id)}">
            <span class="message-hit-ref">${escapeHtml(ref)}</span>
            <span class="message-hit-text">${messageSnippetHtml(hit.snippet)}</span>
        </div>`;
}

function messageEmptyHtml() {
    if (messageState.loadError) {
        return `<div class="empty-state"><p>${escapeHtml(messageState.loadError)}</p></div>`;
    }
    const canImport = !!window.__TAURI__;
    const progress = messageState.importPercent != null
        ? `Installing… ${messageState.importPercent}%`
        : (messageState.busy ? 'Choose the library file…' : '');
    return `
        <div class="empty-state message-empty">
            <p>No message library installed</p>
            <span>A message library is one file holding the messages and their text, made for
                HymnBeam. Import it once and it stays installed.</span>
            <button type="button" class="btn btn-primary" id="messageImportBtn"
                    ${canImport && !messageState.busy ? '' : 'disabled'}>Import message library…</button>
            <span class="message-import-progress" id="messageImportProgress">${escapeHtml(progress)}</span>
            ${messageState.importError
                ? `<span class="message-import-error">${escapeHtml(messageState.importError)}</span>` : ''}
        </div>`;
}

// Progress events arrive often; only the progress text is redrawn for them.
function renderMessageImportProgress() {
    const el = messageEl('messageImportProgress');
    if (el && messageState.importPercent != null) el.textContent = `Installing… ${messageState.importPercent}%`;
}

function messageBrowseHtml() {
    const { works } = messageState.catalogue;
    const messages = works.filter(w => w.kind !== 'book' && w.year != null);
    const books = works.filter(w => w.kind === 'book');
    let html = '';

    const recent = loadRecentMessages().map(code => messageState.byCode.get(code)).filter(Boolean);
    if (recent.length) html += messageSectionHtml('Recent') + recent.map(messageRowHtml).join('');

    if (messages.length) {
        const years = new Map();
        for (const w of messages) years.set(w.year, (years.get(w.year) || 0) + 1);
        // A year cell, followed by that year's messages when it is open; the
        // list spans the grid's full width, as the Bible tab's chapter grid does.
        const cells = [...years.keys()].sort((a, b) => a - b).map(year => {
            const open = year === messageState.openYear;
            const cell = `
                <div class="message-year-cell${open ? ' expanded' : ''}" data-year="${year}">
                    <span class="message-year">${year}</span>
                    <span class="message-year-count">${years.get(year)}</span>
                </div>`;
            if (!open) return cell;
            const list = messages.filter(w => w.year === year).map(messageRowHtml).join('');
            return `${cell}<div class="message-year-list">${list}</div>`;
        });
        html += messageSectionHtml('Messages') + `<div class="message-year-grid">${cells.join('')}</div>`;
    }

    if (books.length) html += messageSectionHtml(messageBookName(books[0])) + books.map(messageRowHtml).join('');
    return html;
}

function messageResultsHtml() {
    const { finds, hits, workQuery } = messageState;
    const phrases = !workQueryDateOnly(workQuery);
    let html = '';
    if (finds.length) {
        const shown = messageState.showAllFinds ? finds.length
            : phrases ? MESSAGE_FINDS_ABOVE_PHRASES : MESSAGE_FINDS_SHOWN;
        html += messageSectionHtml('Messages') + finds.slice(0, shown).map(messageRowHtml).join('');
        if (finds.length > shown) {
            html += phrases
                ? `<button type="button" class="message-show-all">Show all ${finds.length} messages</button>`
                : `<div class="song-list-more">${finds.length - shown} more — keep typing to narrow it down</div>`;
        }
    }
    if (!phrases) {
        if (!finds.length) html += '<div class="empty-state"><p>No messages found</p></div>';
        return html;
    }
    // Until the answer to what is in the box arrives, the last results stay up
    // (so the list does not flicker on every keystroke) but dimmed, and the
    // keyboard passes over them.
    const stale = messageState.hitsQuery !== messageState.query;
    html += messageSectionHtml('Paragraphs');
    if (messageState.searchFailed && !stale) {
        html += '<div class="message-note">The search failed.</div>';
    } else if (hits === null || (stale && !hits.length)) {
        html += '<div class="message-note">Searching…</div>';
    } else if (!hits.length) {
        html += '<div class="message-note">No paragraphs found</div>';
    } else {
        if (stale) html += '<div class="message-note">Searching…</div>';
        html += hits.map(hit => messageHitHtml(hit, stale)).join('');
    }
    return html;
}

function renderMessagePanel() {
    const list = messageEl('messageContentList');
    const footer = messageEl('messageLibraryFooter');
    const input = messageEl('messageSearchInput');
    const ready = !!(messageState.status?.installed && messageState.catalogue);

    input.disabled = !ready;
    footer.hidden = !ready;
    if (!ready) {
        list.innerHTML = messageEmptyHtml();
        return;
    }
    footer.innerHTML = messageFooterHtml();
    const scrollTop = list.scrollTop;
    list.innerHTML = messageState.query.trim() ? messageResultsHtml() : messageBrowseHtml();
    list.scrollTop = scrollTop;
    showMessageCursor();
}

// Under the list once a library is installed: its size, and Replace / Remove.
// While a replacement is being chosen or copied, its progress instead.
function messageFooterHtml() {
    if (messageState.busy) {
        const text = messageState.importPercent != null
            ? `Installing… ${messageState.importPercent}%` : 'Choose the library file…';
        return `<span class="message-import-progress" id="messageImportProgress">${escapeHtml(text)}</span>`;
    }
    const tauri = window.__TAURI__ ? '' : 'disabled';
    const error = messageState.importError
        ? `<span class="message-import-error">${escapeHtml(messageState.importError)}</span>` : '';
    return `
        <span class="message-library-count">${escapeHtml(messageCountText(messageState.status))}</span>
        <button type="button" class="btn-link" id="messageReplaceBtn" ${tauri}>Replace…</button>
        <button type="button" class="btn-link" id="messageRemoveBtn" ${tauri}>Remove</button>
        ${error}`;
}

// The open message's row is marked in whichever list is showing.
function markSelectedMessageRow() {
    const code = messageState.message?.work.code;
    for (const row of messageEl('messageContentList').querySelectorAll('.message-row')) {
        row.classList.toggle('selected', row.dataset.code === code);
    }
}

// ---- Typing in the box ----------------------------------------------------

function setMessageQuery(raw) {
    messageState.query = raw;
    messageState.cursor = -1;
    messageState.showAllFinds = false;
    messageState.searchSeq++;            // any reply still on its way is now stale
    clearTimeout(messageSearchTimer);
    messageSearchTimer = null;

    if (!raw.trim() || !messageState.catalogue) {
        messageState.workQuery = null;
        messageState.finds = [];
        messageState.hits = null;
        messageState.hitsQuery = null;
        messageState.searchFailed = false;
        return;
    }
    const q = parseWorkQuery(messageState.catalogue, raw);
    messageState.workQuery = q;
    messageState.finds = findWorks(messageState.catalogue, raw, q);
    if (!workQueryDateOnly(q)) messageSearchTimer = setTimeout(startMessageSearch, MESSAGE_SEARCH_DELAY_MS);
}

// Run the phrase search for what is in the box now, without waiting for the
// pause in typing.
function startMessageSearch() {
    clearTimeout(messageSearchTimer);
    messageSearchTimer = null;
    const seq = messageState.searchSeq;
    const promise = runMessageSearch(messageState.query, messageState.workQuery, seq);
    messageState.searchInFlight = { seq, promise };
    return promise;
}

// The first phrase result for what is in the box, waiting for (or starting)
// its search if the results shown are for something typed earlier. Null if
// there is none, or if the box changes meanwhile.
async function firstFreshMessageHit() {
    const { query, workQuery } = messageState;
    if (!query.trim() || workQueryDateOnly(workQuery)) return null;
    const seq = messageState.searchSeq;
    if (messageState.hitsQuery !== query) {
        const running = messageState.searchInFlight;
        await (running && running.seq === seq ? running.promise : startMessageSearch());
    }
    if (seq !== messageState.searchSeq) return null;
    return messageEl('messageContentList').querySelector('.message-hit.message-result');
}

function onMessageInput(raw) {
    setMessageQuery(raw);
    renderMessagePanel();
    messageEl('messageContentList').scrollTop = 0;   // a new query starts at the top
    // A whole code (61-0312M) opens its message straight away, as a full Bible
    // reference does. Nothing is projected.
    const q = messageState.workQuery;
    const only = messageState.finds.length === 1 ? messageState.finds[0] : null;
    if (only && q?.codePrefix === only.code && messageState.message?.work.code !== only.code) {
        openMessage(only.code);
    }
}

async function runMessageSearch(raw, q, seq) {
    // The words go to the phrase search as typed, unless a year was read out
    // of them; then the rest of the words are searched, within that year. (A
    // month or day alone narrows nothing, and "may" in "you may have 2 coats"
    // must stay in the phrase.)
    const params = new URLSearchParams({
        q: q.year != null ? q.text : raw,
        limit: String(MESSAGE_SEARCH_LIMIT),
    });
    if (q.year != null) {
        params.set('from', String(q.year));
        params.set('to', String(q.year));
    }
    let hits = null;
    let failed = false;
    try {
        hits = await fetchMessageJson(`/messages/search?${params}`);
    } catch (e) {
        console.error('message search:', e);
        failed = true;
    }
    if (seq !== messageState.searchSeq) return;   // the box has changed since
    messageState.hits = hits || [];
    messageState.hitsQuery = raw;
    messageState.searchFailed = failed;
    renderMessagePanel();
}

function messageResults() {
    return [...messageEl('messageContentList').querySelectorAll('.message-result')];
}

function showMessageCursor() {
    const results = messageResults();
    results.forEach((el, i) => el.classList.toggle('cursor', i === messageState.cursor));
    results[messageState.cursor]?.scrollIntoView({ block: 'nearest' });
}

function moveMessageCursor(direction) {
    const count = messageResults().length;
    if (!count) return;
    messageState.cursor = Math.max(0, Math.min(count - 1, messageState.cursor + direction));
    showMessageCursor();
}

// Open a row of the list: a message at its start, or a paragraph hit at that paragraph.
async function openMessageResult(el) {
    if (!el) return false;
    const paragraphId = el.dataset.paragraphId != null ? Number(el.dataset.paragraphId) : null;
    // A phrase result opens at its paragraph, and projecting it starts at the
    // page with the matched words.
    const hit = paragraphId == null ? null : (messageState.hits || []).find(h => h.paragraph_id === paragraphId);
    return openMessage(el.dataset.code, { paragraphId, snippet: hit?.snippet ?? null });
}

// ---- Recent ---------------------------------------------------------------

function loadRecentMessages() {
    try {
        const list = JSON.parse(localStorage.getItem(MESSAGE_RECENT_KEY) || '[]');
        return Array.isArray(list) ? list.filter(c => typeof c === 'string') : [];
    } catch (e) {
        return [];
    }
}

function rememberRecentMessage(code) {
    const list = [code, ...loadRecentMessages().filter(c => c !== code)].slice(0, MESSAGE_RECENT_COUNT);
    try { localStorage.setItem(MESSAGE_RECENT_KEY, JSON.stringify(list)); }
    catch (e) { /* storage full or blocked; not worth bothering the operator */ }
}

// ---- The reader -----------------------------------------------------------

// Show a message in the reader, at its first paragraph or at `paragraphId`.
// Nothing is projected until a paragraph is chosen.
async function openMessage(code, { paragraphId = null, snippet = null } = {}) {
    const seq = ++messageState.openSeq;
    let message;
    try {
        message = await fetchMessageJson(`/messages/${encodeURIComponent(code)}`);
    } catch (e) {
        console.error('open message:', e);
        updateStatus(`Could not open ${code}`);
        return false;
    }
    if (seq !== messageState.openSeq) return false;   // another message was asked for since

    const paragraphs = message.paragraphs || [];
    const work = messageState.byCode.get(code) || message;
    const at = paragraphs.findIndex(p => p.id === paragraphId);
    messageState.message = { work, paragraphs };
    messageState.highlighted = paragraphs.length ? Math.max(0, at) : null;
    messageState.hitTarget = at >= 0 && snippet ? { paragraphId, snippet } : null;
    if (work.kind !== 'book' && work.year != null) messageState.openYear = work.year;
    // Recent and the open year show the next time the browse list is drawn,
    // rather than moving rows under the operator's pointer now.
    rememberRecentMessage(code);

    renderMessageReader();
    setContentView('message');
    markSelectedMessageRow();
    scrollMessageParagraph(messageState.highlighted, 'center');
    return true;
}

function renderMessageReader() {
    const m = messageState.message;
    if (!m) return;
    messageEl('messageDisplayTitle').textContent = m.work.title;
    messageEl('messageDisplaySubtitle').textContent = messageMetaLine(m.work);
    const grid = messageEl('messageParagraphs');
    if (!m.paragraphs.length) {
        grid.innerHTML = '<div class="empty-state"><p>This message has no text in the library.</p></div>';
        return;
    }
    grid.innerHTML = m.paragraphs.map((p, i) => `
        <div class="verse-card bible-verse-card message-paragraph" data-index="${i}">
            <span class="bible-verse-num">${escapeHtml(p.number ?? '')}</span>
            <span class="verse-card-text">${escapeHtml(p.text)}</span>
        </div>`).join('');
    markMessageParagraphs();
}

// `active` marks the paragraphs on screen, `highlighted` the one Enter projects.
function markMessageParagraphs() {
    const m = messageState.message;
    if (!m) return;
    const live = messageState.live?.work.code === m.work.code ? messageState.live : null;
    for (const card of messageEl('messageParagraphs').querySelectorAll('.message-paragraph')) {
        const i = Number(card.dataset.index);
        card.classList.toggle('active', !!live && i >= live.screen.first && i <= live.screen.last);
        card.classList.toggle('highlighted', i === messageState.highlighted);
    }
}

function scrollMessageParagraph(index, block = 'nearest') {
    if (index == null) return;
    messageEl('messageParagraphs').querySelector(`.message-paragraph[data-index="${index}"]`)
        ?.scrollIntoView({ block });
}

// ---- On the projector -------------------------------------------------------
//
// A message is shown as one column of text that scrolls (see
// message-scroll.js). Choosing a paragraph puts it at the top of the screen;
// from there the operator moves the text on or back by lines, into the
// paragraphs after it and before it, with the keys, the mouse wheel over the
// preview, or a click on the line in the reader.

const MESSAGE_STEP_LINES = 3;            // → and ← move the text this many lines
const MESSAGE_WHEEL_PX_PER_LINE = 40;    // wheel or trackpad travel for one line

// The projector's footer: the message's title and code, or for the book, the
// chapter's title and the book's name.
function messageFooter(work) {
    const parts = work.kind === 'book' ? [work.title, messageBookName(work)] : [work.title, work.code];
    return parts.filter(Boolean).join(' · ');
}

function messageMeasureCopy() {
    try {
        return elements.messageMeasureFrame?.contentWindow?.messageMeasure || null;
    } catch (e) {
        console.error('message lines: the measuring copy cannot be reached', e);
        return null;
    }
}

// The layout of the message on screen (see message-scroll.js), measured in
// the hidden copy of the projector page at the projector's size. Lines are
// worked out a paragraph at a time as they are needed, and kept until the
// settings, the size or the message change. Until the copy has loaded, lines
// are guessed at by length.
let messageLayoutCache = null;   // {key, layout}

function messageLayout(work, paragraphs) {
    const measure = messageMeasureCopy();
    const frame = elements.messageMeasureFrame;
    const key = [work.code, !!measure, JSON.stringify(state.settings), frame?.style.width, frame?.style.height].join('|');
    if (messageLayoutCache?.key === key) return messageLayoutCache.layout;
    let layout = null;
    if (measure && state.settings) {
        try {
            const footer = messageFooter(work);
            measure.prepare(state.settings, footer);
            const metrics = measure.metrics();
            if (metrics && metrics.pitch > 0 && metrics.view > 0) {
                const lines = new Map();
                layout = {
                    count: paragraphs.length,
                    pitch: metrics.pitch, gap: metrics.gap || 0, view: metrics.view,
                    starts(i) {
                        if (!lines.has(i)) {
                            measure.prepare(state.settings, footer);
                            const starts = Array.from(measure.lines(paragraphs[i]?.text ?? '') || []);
                            lines.set(i, starts.length ? starts : [0]);
                        }
                        return lines.get(i);
                    },
                };
            }
        } catch (e) {
            console.error('message lines:', e);
            layout = null;
        }
    }
    if (!layout) {
        const lines = new Map();
        layout = {
            count: paragraphs.length, pitch: 1, gap: 0, view: 12,
            starts(i) {
                if (!lines.has(i)) lines.set(i, messageEstimatedStarts(paragraphs[i]?.text ?? ''));
                return lines.get(i);
            },
        };
    }
    messageLayoutCache = { key, layout };
    return layout;
}

// What the projector is sent: the paragraphs from `win.first` to `win.last`
// and the place to show at the top of the screen. `jump` asks it to fade to
// the place as to a new slide, rather than glide there.
function messageSlidePayload(work, paragraphs, win, anchor, jump) {
    return {
        mode: 'message',
        scroll: {
            first: win.first,
            paragraphs: paragraphs.slice(win.first, win.last + 1).map(p => p.text),
            anchor,
            jump,
        },
        footer: messageFooter(work),
        label: '',
        isBlank: false,
        isBible: false,
        title: work.title,
        author: null,
        musical_key: null,
        songId: `message-${work.code}`,
        songNumber: null,
        hasPrev: false,
        hasNext: false,
    };
}

// Show the message with `place` ({paragraph, line}) at the top of the screen,
// or as near as the end of the message allows. The reader's highlight follows
// the paragraph at the top (or goes to `highlight`), unless `followReader` is
// false.
//
// messageState.live: {work, paragraphs, place, offset (where its line starts),
// shown (lines on screen), window (paragraphs sent), screen ({first, last}
// paragraphs on screen)}.
function showMessagePlace(work, paragraphs, place,
    { jump = false, keepBlank = false, followReader = true, highlight = null } = {}) {
    if (!paragraphs.length) return;
    const layout = messageLayout(work, paragraphs);
    const top = messageClampTop(layout, place);
    const shown = messageLinesShown(layout, top);
    const prev = messageState.live;
    const win = !jump && prev?.work.code === work.code && messageWindowCovers(prev.window, layout, top, shown)
        ? prev.window : messageWindowFor(layout, top, shown);
    const anchor = { paragraph: top.paragraph, offset: messageOffsetOf(layout, top) };
    messageState.live = {
        work, paragraphs, place: top, offset: anchor.offset, shown, window: win,
        screen: { first: top.paragraph, last: messageMoveLines(layout, top, shown - 1).paragraph },
    };
    const inReader = followReader && messageState.message?.work.code === work.code;
    if (inReader) messageState.highlighted = highlight ?? top.paragraph;
    sendSlideToProjector('message', messageSlidePayload(work, paragraphs, win, anchor, jump),
        elements.messagePreviewFrame, { keepBlank });
    markMessageParagraphs();
    if (inReader) scrollMessageParagraph(messageState.highlighted);
}

// Project from the reader: from `offset` in the paragraph (where it was
// clicked), or else from its start, or, for the paragraph a search result
// opened, from the line with the matched words.
function projectFromReader(index, offset = null) {
    const { work, paragraphs } = messageState.message;
    const target = messageState.hitTarget;
    let at = offset;
    if (at == null && target && paragraphs[index]?.id === target.paragraphId) {
        at = messageHitOffset(paragraphs[index].text, target.snippet);
    }
    const layout = messageLayout(work, paragraphs);
    showMessagePlace(work, paragraphs, messagePlaceAt(layout, index, at ?? 0), { jump: true, highlight: index });
}

// Move the message on screen `n` lines on (or back), even if the reader has
// since moved on to another message. Like a song's verses, moving leaves a
// blanked screen blank. False when no message is on screen.
function moveLiveMessage(n) {
    const live = messageState.live;
    if (state.liveSlide?.kind !== 'message' || !live) return false;
    const layout = messageLayout(live.work, live.paragraphs);
    // From where its line starts, since the lines may have broken afresh.
    const from = messagePlaceAt(layout, live.place.paragraph, live.offset);
    const to = messageClampTop(layout, messageMoveLines(layout, from, n));
    if (compareMessagePlaces(to, live.place) !== 0) {
        showMessagePlace(live.work, live.paragraphs, to, { keepBlank: true });
    }
    return true;
}

// → / ←: a few lines on or back, or with Shift a screen less a line, so that
// nothing is passed over unseen.
function stepLiveMessage(direction, { screen = false } = {}) {
    const live = messageState.live;
    if (state.liveSlide?.kind !== 'message' || !live) return false;
    const most = Math.max(1, live.shown - 1);
    return moveLiveMessage(direction * (screen ? most : Math.min(MESSAGE_STEP_LINES, most)));
}

// The mouse wheel or trackpad over the preview moves the text a line for
// every MESSAGE_WHEEL_PX_PER_LINE of travel, sent at most once a frame and,
// like Shift and an arrow, at most a screen less a line at a time.
let messageWheelTravel = 0;
let messageWheelLines = 0;
let messageWheelFrame = null;
function onMessageWheel(e) {
    if (state.liveSlide?.kind !== 'message' || !messageState.live) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? MESSAGE_WHEEL_PX_PER_LINE
        : e.deltaMode === 2 ? MESSAGE_WHEEL_PX_PER_LINE * Math.max(1, messageState.live.shown - 1) : 1;
    // A change of direction starts afresh rather than first undoing what was left over.
    if (Math.sign(e.deltaY) !== Math.sign(messageWheelTravel)) messageWheelTravel = 0;
    messageWheelTravel += e.deltaY * scale;
    const lines = Math.trunc(messageWheelTravel / MESSAGE_WHEEL_PX_PER_LINE);
    if (!lines) return;
    messageWheelTravel -= lines * MESSAGE_WHEEL_PX_PER_LINE;
    messageWheelLines += lines;
    if (messageWheelFrame == null) {
        messageWheelFrame = requestAnimationFrame(() => {
            messageWheelFrame = null;
            const most = Math.max(1, (messageState.live?.shown ?? 1) - 1);
            const n = Math.max(-most, Math.min(most, messageWheelLines));
            messageWheelLines = 0;
            moveLiveMessage(n);
        });
    }
}

// Where in a paragraph's text a click in the reader landed, or null if not
// on its text (or the webview cannot say).
function messageClickOffset(e, card) {
    const textEl = card.querySelector('.verse-card-text');
    if (!textEl || !textEl.contains(e.target)) return null;
    let node = null;
    let offset = 0;
    if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range) { node = range.startContainer; offset = range.startOffset; }
    } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) { node = pos.offsetNode; offset = pos.offset; }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || !textEl.contains(node)) return null;
    let at = 0;
    const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n === node) return at + offset;
        at += n.length;
    }
    return null;
}

// Lines are measured at the projector's size: it goes fullscreen on whatever
// screen it is given, and a 4:3 screen fits less on a line than the previews'
// 1920×1080, which is used until the projector has said.
function setMessageMeasureSize(size) {
    const data = typeof size === 'string' ? JSON.parse(size) : size;
    const width = Math.round(Number(data?.width));
    const height = Math.round(Number(data?.height));
    if (!(width >= 320 && height >= 240)) return;
    const frame = elements.messageMeasureFrame;
    if (frame.style.width === `${width}px` && frame.style.height === `${height}px`) return;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    messageLayoutCache = null;
    messageDisplayChanged();
}

// The display settings or the projector's size changed, or the measuring copy
// loaded a font: lines may break differently. The message on screen is sent
// again from the line holding the text that was at the top of the screen; the
// reader's highlight stays where the operator left it.
let messageRefreshTimer = null;
function messageDisplayChanged() {
    clearTimeout(messageRefreshTimer);
    messageRefreshTimer = setTimeout(refreshLiveMessage, 150);
}

function refreshLiveMessage() {
    messageRefreshTimer = null;
    messageLayoutCache = null;
    const live = messageState.live;
    if (!live || state.liveSlide?.kind !== 'message') return;
    const layout = messageLayout(live.work, live.paragraphs);
    showMessagePlace(live.work, live.paragraphs, messagePlaceAt(layout, live.place.paragraph, live.offset),
        { keepBlank: true, followReader: false });
}

function messageReaderShown() {
    return !!messageState.message && !elements.messageDisplay.hidden;
}

// Enter: project the reader's highlighted paragraph.
function projectHighlightedParagraph() {
    if (!messageReaderShown() || messageState.highlighted == null) return false;
    projectFromReader(messageState.highlighted);
    return true;
}

// ↑ / ↓ in the reader: move the highlight without projecting.
function moveParagraphHighlight(direction) {
    if (!messageReaderShown() || messageState.highlighted == null) return false;
    const last = messageState.message.paragraphs.length - 1;
    messageState.highlighted = Math.max(0, Math.min(last, messageState.highlighted + direction));
    markMessageParagraphs();
    scrollMessageParagraph(messageState.highlighted);
    return true;
}

// ---- The tab --------------------------------------------------------------

async function openMessagesTab() {
    showSidebarTab('messagesTabBtn', 'messagesPanel');
    await ensureMessageCatalogue();
    renderMessagePanel();
}

function initMessageListeners() {
    messageEl('messagesTabBtn').addEventListener('click', openMessagesTab);

    const input = messageEl('messageSearchInput');
    input.addEventListener('input', () => onMessageInput(input.value));
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            moveMessageCursor(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const results = messageResults();
            // Enter with nothing highlighted opens the first row; with no
            // rows yet, the first phrase result, once it is in, never one
            // left over from what was typed before.
            let el = results[messageState.cursor] || (messageState.query.trim() ? results[0] : null);
            if (!el) el = await firstFreshMessageHit();
            // Leave the box, so the next Enter projects the paragraph.
            if (await openMessageResult(el)) input.blur();
        }
    });

    messageEl('messageContentList').addEventListener('click', async (e) => {
        if (e.target.closest('#messageImportBtn')) {
            importMessageLibrary();
            return;
        }
        if (e.target.closest('.message-show-all')) {
            messageState.showAllFinds = true;
            renderMessagePanel();
            return;
        }
        const year = e.target.closest('.message-year-cell');
        if (year) {
            const y = Number(year.dataset.year);
            messageState.openYear = messageState.openYear === y ? null : y;
            renderMessagePanel();
            return;
        }
        const result = e.target.closest('.message-row, .message-hit');
        if (result) {
            messageState.cursor = messageResults().indexOf(result);
            await openMessageResult(result);
        }
    });

    messageEl('messageLibraryFooter').addEventListener('click', (e) => {
        if (e.target.closest('#messageReplaceBtn')) importMessageLibrary();
        else if (e.target.closest('#messageRemoveBtn')) confirmRemoveMessageLibrary();
    });

    // A click projects from the line clicked.
    messageEl('messageParagraphs').addEventListener('click', (e) => {
        const card = e.target.closest('.message-paragraph');
        if (!card || !messageState.message) return;
        projectFromReader(Number(card.dataset.index), messageClickOffset(e, card));
    });

    messageEl('messagePreviewSurface').addEventListener('wheel', onMessageWheel, { passive: false });

    // The measuring copy of the projector page has loaded, or loaded a font.
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'message-measure-changed') messageDisplayChanged();
    });
}
