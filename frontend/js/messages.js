// The message library tab: sermons (and a book) installed from a library file.
// The operator browses by year, goes straight to a message by title, date or
// date code (messages-find.js), or searches for a phrase heard from the
// pulpit; then projects paragraphs from the reader, one at a time.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

const MESSAGE_TAB_FALLBACK = 'Sermons';     // the tab's name until a library names it
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
    marks: null,          // words highlighted on screen: {code, at: Map(paragraph index → [[from, to], …])}
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

// The tab, and the Display settings target for the same thing, go by the
// library's name, and are shown only once a library is installed: on a
// computer without one, HymnBeam shows nothing of it but the Import button
// under Settings → Library.
function applyMessageTabLabel() {
    const label = messageState.status?.tab_label || MESSAGE_TAB_FALLBACK;
    const installed = !!messageState.status?.installed;
    const tab = messageEl('messagesTabBtn');
    tab.textContent = label;
    tab.classList.toggle('hidden', !installed);
    elements.setDisplayTargetMessage.textContent = label;
    elements.setDisplayTargetMessage.classList.toggle('hidden', !installed);
    if (!installed) {
        if (tab.classList.contains('active')) openLibraryTab();
        if (settingsTarget === 'message') {
            settingsTarget = 'song';
            syncSettingsForm();
            updateSettingsPreview();
        }
    }
    renderMessageLibrarySettings();
}

// Settings → Library: import a library, or replace or remove the one installed.
function renderMessageLibrarySettings() {
    const importBtn = messageEl('settingsMessageImportBtn');
    if (!importBtn) return;
    const status = messageState.status;
    const installed = !!status?.installed;
    const canRun = !!window.__TAURI__ && !messageState.busy;
    importBtn.textContent = installed ? 'Replace…' : 'Import…';
    importBtn.disabled = !canRun;
    const removeBtn = messageEl('settingsMessageRemoveBtn');
    removeBtn.classList.toggle('hidden', !installed);
    removeBtn.disabled = !canRun;
    messageEl('settingsMessageLibraryHint').textContent = installed
        ? `${status.tab_label || MESSAGE_TAB_FALLBACK}: ${messageCountText(status)}. It has its own tab in the sidebar.`
        : 'A message library is one file holding the messages and their text, made for HymnBeam. '
          + 'Import it on each computer that needs it; it stays installed through updates. '
          + 'Until then, HymnBeam shows nothing of it.';
    const progress = messageEl('settingsMessageImportProgress');
    const error = !messageState.busy && messageState.importError;
    progress.textContent = messageState.busy
        ? (messageState.importPercent != null ? `Installing… ${messageState.importPercent}%` : 'Choose the library file…')
        : (error || '');
    progress.classList.toggle('message-import-error', !!error);
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
    // A collection's prepared quotes show whether this library has them.
    if (state.openCollection) renderCollectionDetail();
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

// The tab is hidden with no library installed, so this shows only while one
// is being read, or if it cannot be.
function messageEmptyHtml() {
    if (messageState.loadError) {
        return `<div class="empty-state"><p>${escapeHtml(messageState.loadError)}</p></div>`;
    }
    return `
        <div class="empty-state message-empty">
            <p>No message library installed</p>
            <span>Import one under Settings → Library.</span>
        </div>`;
}

// Progress events arrive often; only the progress text is redrawn for them.
function renderMessageImportProgress() {
    if (messageState.importPercent == null) return;
    const text = `Installing… ${messageState.importPercent}%`;
    const el = messageEl('messageImportProgress');
    if (el) el.textContent = text;
    const inSettings = messageEl('settingsMessageImportProgress');
    if (inSettings) inSettings.textContent = text;
}

function messageBrowseHtml() {
    const { works } = messageState.catalogue;
    const messages = works.filter(w => w.kind !== 'book' && w.year != null);
    const books = works.filter(w => w.kind === 'book');
    let html = '';

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
    renderMessageLibrarySettings();
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

// ---- The reader -----------------------------------------------------------

// Show a message in the reader, at its first paragraph or at `paragraphId`.
// Nothing is projected until a paragraph is chosen.
// `wanted`, if given, is asked once the message has come, in case the
// operator has moved on meanwhile (a collection's next item, say).
async function openMessage(code, { paragraphId = null, snippet = null, wanted = null } = {}) {
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
    if (wanted && !wanted()) return false;

    const paragraphs = message.paragraphs || [];
    const work = messageState.byCode.get(code) || message;
    const at = paragraphs.findIndex(p => p.id === paragraphId);
    messageState.message = { work, paragraphs };
    messageState.highlighted = paragraphs.length ? Math.max(0, at) : null;
    messageState.hitTarget = at >= 0 && snippet ? { paragraphId, snippet } : null;
    // The open year shows the next time the browse list is drawn, rather than
    // moving rows under the operator's pointer now.
    if (work.kind !== 'book' && work.year != null) messageState.openYear = work.year;

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
            <span class="verse-card-text">${messageMarkedHtml(p.text, messageMarksOf(m.work.code, i))}</span>
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
// A message is shown as one column of text that rolls like a page (see
// message-scroll.js). Choosing a paragraph puts it at the top of the screen;
// from there the operator rolls the text on or back, into the paragraphs
// after it and before it: with the mouse wheel or trackpad (over the reader,
// the preview or the projector window itself), where it stays wherever it is
// left, or with the arrow keys, which move it by whole lines.

const MESSAGE_STEP_LINES = 3;            // → and ← move the text this many lines; ↓ and ↑ one
const MESSAGE_HOLD_LINE_MS = 80;         // held down, they move it a line this often
const MESSAGE_HOLD_FAST_LINE_MS = 25;    // and with Shift held too, this often
const MESSAGE_WHEEL_PX_PER_SCREEN = 720;  // wheel or trackpad travel, in this window, for a screenful
const MESSAGE_ROLL_STREAM_MS = 60;       // rolls closer together than this are one stream

// The message's details on the projector: its title, date code and place, or
// for the book, the chapter's title and the book's name.
function messageFooter(work) {
    const parts = work.kind === 'book' ? [work.title, messageBookName(work)] : [work.title, work.code, work.location];
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
// the place as to a new slide, rather than glide there; `close`, to keep close
// behind a stream of moves (a turning wheel) rather than glide at its ease.
// `marks` are the highlights in those paragraphs: [paragraph, from, to].
function messageSlidePayload(work, paragraphs, win, anchor, { jump = false, close = false, marks = [] } = {}) {
    const scroll = {
        first: win.first,
        paragraphs: paragraphs.slice(win.first, win.last + 1).map(p => p.text),
        numbers: paragraphs.slice(win.first, win.last + 1).map(p => p.number ?? null),
        anchor,
        jump,
    };
    if (close) scroll.close = true;
    if (marks.length) scroll.marks = marks;
    return {
        mode: 'message',
        scroll,
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
// or as near as the end of the message allows; `part` (0 to 1) of the way on
// to the next line, where the wheel has left it. The reader's highlight
// follows the paragraph at the top (or goes to `highlight`), unless
// `followReader` is false. `roll` says the text is being rolled from where it
// was, so the reader rolls with it (see rollMessageReader); `close` is for the
// projector (see messageSlidePayload).
//
// messageState.live: {work, paragraphs, place, part, offset (where its line
// starts), shown (lines on screen), window (paragraphs sent), screen ({first,
// last} paragraphs on screen)}.
function showMessagePlace(work, paragraphs, place,
    { jump = false, keepBlank = false, followReader = true, highlight = null, part = 0, roll = false, close = false } = {}) {
    if (!paragraphs.length) return;
    // Highlights are for the message on screen, and go when another takes its place.
    if (messageState.marks && messageState.marks.code !== work.code) dropMessageMarks();
    const layout = messageLayout(work, paragraphs);
    // Clamped to the message's ends, where the text rests on a whole line.
    const { place: top, part: partOn } = messageMovePart(layout, messageClampTop(layout, place), part, 0);
    const shown = messageLinesShown(layout, top);
    const prev = messageState.live;
    const sameMessage = !jump && prev?.work.code === work.code;
    const win = sameMessage && messageWindowCovers(prev.window, layout, top, shown)
        ? prev.window : messageWindowFor(layout, top, shown);
    // Part of a line on, part of one more line shows at the foot.
    const screen = { first: top.paragraph, last: messageMoveLines(layout, top, partOn ? shown : shown - 1).paragraph };
    const sameScreen = sameMessage && compareMessagePlaces(prev.place, top) === 0 && prev.screen.last === screen.last;
    const anchor = { paragraph: top.paragraph, offset: messageOffsetOf(layout, top) };
    if (partOn) anchor.part = partOn;
    const inReader = followReader && messageState.message?.work.code === work.code;
    const rollReader = roll && sameMessage && inReader && highlight == null;
    if (rollReader) holdMessageReader(layout);
    messageState.live = { work, paragraphs, place: top, part: partOn, offset: anchor.offset, shown, window: win, screen };
    if (inReader) messageState.highlighted = highlight ?? top.paragraph;
    const marks = messageWindowMarks(work.code, win);
    sendSlideToProjector('message', messageSlidePayload(work, paragraphs, win, anchor, { jump, close, marks }),
        elements.messagePreviewFrame, { keepBlank });
    const sameMarks = sameScreen && highlight == null && prev.screen.first === screen.first;
    if (!sameMarks) markMessageParagraphs();
    if (rollReader) {
        rollMessageReader(layout);
        return;
    }
    messageReaderLead = null;
    if (!sameMarks && inReader) scrollMessageParagraph(messageState.highlighted);
}

// ---- The reader rolls with the screen ----------------------------------------
//
// While the text on screen is rolled, the reader rolls with it: the line at
// the top of the screen is kept at one height in the reader. A paragraph
// takes a different number of lines in the reader and on the screen, so
// heights are matched by the share of the way through each paragraph. (The
// reader's text is smaller, so it moves less far than the screen's does.)

let messageReaderLead = null;     // how far down the reader the top of the screen is kept (px)
let messageReaderSetTop = null;   // where the reader was last rolled to

// How far down the reader's text a line of the screen's starts (px), or null
// if the reader does not show its paragraph.
function messageReaderLineY(layout, place) {
    const grid = messageEl('messageParagraphs');
    const textEl = grid.querySelector(`.message-paragraph[data-index="${place.paragraph}"] .verse-card-text`);
    if (!textEl) return null;
    const box = textEl.getBoundingClientRect();
    const lines = Math.max(1, layout.starts(place.paragraph).length);
    return box.top - grid.getBoundingClientRect().top + grid.scrollTop + box.height * place.line / lines;
}

function messageReaderY(layout, place, part) {
    const here = messageReaderLineY(layout, place);
    if (here == null || !part) return here;
    const next = messageNextLine(layout, place, 1);
    const there = next ? messageReaderLineY(layout, next) : null;
    return there == null ? here : here + part * (there - here);
}

// Before the screen is rolled: note the height in the reader of the top of the
// screen, to keep it there. It is wherever it is as rolling begins, brought
// within the reader's upper half, and is taken afresh if the operator has
// scrolled the reader since.
const MESSAGE_READER_LEAD_MIN = 16;
function holdMessageReader(layout) {
    const live = messageState.live;
    const grid = messageEl('messageParagraphs');
    if (messageReaderLead != null && grid.scrollTop === messageReaderSetTop) return;
    const y = messageReaderY(layout, live.place, live.part);
    messageReaderLead = y == null ? null
        : Math.max(MESSAGE_READER_LEAD_MIN, Math.min(grid.clientHeight / 2, y - grid.scrollTop));
}

// After it is rolled: roll the reader to match.
function rollMessageReader(layout) {
    const live = messageState.live;
    const grid = messageEl('messageParagraphs');
    const y = messageReaderY(layout, live.place, live.part);
    if (y == null) return;
    if (messageReaderLead == null) messageReaderLead = MESSAGE_READER_LEAD_MIN;
    grid.scrollTop = y - messageReaderLead;
    messageReaderSetTop = grid.scrollTop;
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

// Move the message on screen `lines` on (or back), even if the reader has
// since moved on to another message. The keys move by whole lines, from the
// nearest whole line (`whole`); the wheel by parts of a line too, and the text
// stays where it leaves it. Like a song's verses, moving leaves a blanked
// screen blank. False when no message is on screen.
function moveLiveMessage(lines, { whole = false, close = false } = {}) {
    const live = messageState.live;
    if (state.liveSlide?.kind !== 'message' || !live) return false;
    const layout = messageLayout(live.work, live.paragraphs);
    // From where its line starts, since the lines may have broken afresh.
    const from = messagePlaceAt(layout, live.place.paragraph, live.offset);
    const to = messageMovePart(layout, from, whole ? Math.round(live.part) : live.part, lines);
    if (compareMessagePlaces(to.place, live.place) !== 0 || to.part !== live.part) {
        showMessagePlace(live.work, live.paragraphs, to.place, { keepBlank: true, part: to.part, roll: true, close });
    }
    return true;
}

// → / ←: a few lines on or back (↓ / ↑: `lines`, one), or with Shift a screen
// less a line, so that nothing is passed over unseen. Held down (`repeat`),
// the text runs on at a steady pace, by the clock and not by how fast the
// keyboard repeats: a line every MESSAGE_HOLD_LINE_MS, or with Shift every
// MESSAGE_HOLD_FAST_LINE_MS.
let messageHoldAt = null;   // when a held key last moved the text
function stepLiveMessage(direction, { screen = false, repeat = false, lines = MESSAGE_STEP_LINES } = {}) {
    const live = messageState.live;
    if (state.liveSlide?.kind !== 'message' || !live) return false;
    const most = Math.max(1, live.shown - 1);
    if (!repeat) {
        messageHoldAt = null;
        return moveLiveMessage(direction * (screen ? most : Math.min(lines, most)), { whole: true });
    }
    const now = performance.now();
    const every = screen ? MESSAGE_HOLD_FAST_LINE_MS : MESSAGE_HOLD_LINE_MS;
    if (messageHoldAt == null) messageHoldAt = now;   // the press itself has just moved it
    const due = Math.floor((now - messageHoldAt) / every);
    if (due > 0) {
        messageHoldAt += due * every;
        moveLiveMessage(direction * Math.min(due, most), { whole: true });
    }
    return true;
}

// ↓ / ↑ roll the text on screen a line, unless the operator has the reader's
// highlight on something else (another message, or a search result off the
// screen): then they move the highlight, for Enter to project.
function messageReaderElsewhere() {
    if (!messageReaderShown() || messageState.highlighted == null) return false;
    const live = messageState.live;
    const at = messageState.highlighted;
    return !(state.liveSlide?.kind === 'message' && live && messageState.message.work.code === live.work.code
        && at >= live.screen.first && at <= live.screen.last);
}

function rollLiveMessageByKey(direction, { screen = false, repeat = false } = {}) {
    if (messageReaderElsewhere()) return false;
    return stepLiveMessage(direction, { screen, repeat, lines: 1 });
}

// The mouse wheel or trackpad rolls the text as it would a page, and the text
// stays where the wheel leaves it. Travel is counted in px and turned into
// lines once a frame:
//   screen — over the projector window itself: the text moves as far as the
//            wheel does;
//   page   — in this window, over the reader or the preview: the text moves
//            as if the screen were a page here, a screenful for every
//            MESSAGE_WHEEL_PX_PER_SCREEN, whatever the projector's size.
// At most a screen less a line is moved at a time. False when no message is
// on screen.
const messageRoll = { screen: 0, page: 0, frame: null, at: null };
function rollLiveMessage(source, px) {
    if (state.liveSlide?.kind !== 'message' || !messageState.live) return false;
    if (!Number.isFinite(px) || !px) return true;
    messageRoll[source] += px;
    if (messageRoll.frame == null) messageRoll.frame = requestAnimationFrame(sendMessageRoll);
    return true;
}

function sendMessageRoll() {
    const roll = messageRoll;
    const travel = { screen: roll.screen, page: roll.page };
    roll.frame = null;
    roll.screen = roll.page = 0;
    const live = messageState.live;
    if (state.liveSlide?.kind !== 'message' || !live) return;
    const layout = messageLayout(live.work, live.paragraphs);
    const most = Math.max(1, live.shown - 1);
    // (An unmeasured layout counts in lines: a pitch of 1.)
    const lines = travel.screen / (layout.pitch > 2 ? layout.pitch : MESSAGE_WHEEL_PX_PER_SCREEN / layout.view)
        + travel.page * layout.view / (layout.pitch * MESSAGE_WHEEL_PX_PER_SCREEN);
    // A stream of moves (a trackpad, a spinning wheel) is followed closely; a
    // move on its own (one notch of a wheel) glides.
    const now = performance.now();
    const close = roll.at != null && now - roll.at < MESSAGE_ROLL_STREAM_MS;
    roll.at = now;
    moveLiveMessage(Math.max(-most, Math.min(most, lines)), { close });
}

// The wheel's travel in px: some mice report lines or pages instead.
function messageWheelPx(e) {
    if (e.deltaMode === 1) return e.deltaY * 40;
    if (e.deltaMode === 2) return e.deltaY * MESSAGE_WHEEL_PX_PER_SCREEN * 0.8;
    return e.deltaY;
}

function onMessagePreviewWheel(e) {
    if (rollLiveMessage('page', messageWheelPx(e))) e.preventDefault();
}

// Over the reader, the wheel rolls the screen (and the reader with it) while
// the reader is on what the screen shows. With Option (Alt) held, or once the
// highlight is on something else, it scrolls the reader alone, to look ahead.
function onMessageReaderWheel(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (!messageReaderShown() || messageReaderElsewhere()) return;
    if (rollLiveMessage('page', messageWheelPx(e))) e.preventDefault();
}

// The projector window passes on what it is given, so that it need not be
// clicked away from: the wheel rolls the text, and keys are taken as if
// pressed here (see the keydown handler in app.js).
function onProjectorInput(payload) {
    let data = payload;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch (e) { return; }
    if (!data || typeof data !== 'object') return;
    if (data.wheel != null) rollLiveMessage('screen', Number(data.wheel));
    if (typeof data.key === 'string' && data.key && data.key !== 'Escape') {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: data.key, shiftKey: !!data.shift, repeat: !!data.repeat, bubbles: true, cancelable: true,
        }));
    }
}

// ---- Highlights ---------------------------------------------------------------
//
// Words of the message on screen can be highlighted there: the operator drags
// across them in the reader. A highlight is kept as offsets in its paragraph's
// text, whole words at a time; it stays while that message is the one on
// screen, wherever the text is rolled to, until it is clicked (in the reader)
// or Escape takes them all off.

function messageMarksOf(code, index) {
    const marks = messageState.marks;
    return (marks && marks.code === code && marks.at.get(index)) || [];
}

// The highlights in the paragraphs the projector is sent: [paragraph, from, to].
function messageWindowMarks(code, win) {
    const marks = messageState.marks;
    if (!marks || marks.code !== code) return [];
    const out = [];
    for (const index of [...marks.at.keys()].sort((a, b) => a - b)) {
        if (index < win.first || index > win.last) continue;
        for (const [from, to] of marks.at.get(index)) out.push([index, from, to]);
    }
    return out;
}

// A paragraph's text for the reader, with its highlights marked.
function messageMarkedHtml(text, marks) {
    let html = '';
    let at = 0;
    for (const [from, to] of marks) {
        html += `${escapeHtml(text.slice(at, from))}<mark class="message-mark" title="Click to take this highlight off the screen">${escapeHtml(text.slice(from, to))}</mark>`;
        at = to;
    }
    return html + escapeHtml(text.slice(at));
}

// From `from` to `to` in the text, taken out to whole words; null if no word is touched.
function messageWordSpan(text, from, to) {
    let a = Math.max(0, Math.min(text.length, from));
    let b = Math.max(0, Math.min(text.length, to));
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (a >= b) return null;
    while (a > 0 && !/\s/.test(text[a - 1])) a--;
    while (b < text.length && !/\s/.test(text[b])) b++;
    return [a, b];
}

function messageLiveInReader() {
    const live = messageState.live;
    return state.liveSlide?.kind === 'message' && !!live && messageReaderShown()
        && messageState.message.work.code === live.work.code;
}

// How far into a reader paragraph's text a place in it (as a selection gives it) is.
function messageTextOffset(textEl, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(textEl);
    range.setEnd(node, offset);
    return range.toString().length;
}

// Add a highlight to a paragraph, joined to any it overlaps or stands next to.
function addMessageMark(code, index, text, span) {
    if (messageState.marks?.code !== code) messageState.marks = { code, at: new Map() };
    const all = [...(messageState.marks.at.get(index) || []), span].sort((a, b) => a[0] - b[0]);
    const joined = [];
    for (const mark of all) {
        const last = joined[joined.length - 1];
        if (last && !text.slice(last[1], Math.max(last[1], mark[0])).trim()) last[1] = Math.max(last[1], mark[1]);
        else joined.push([mark[0], mark[1]]);
    }
    messageState.marks.at.set(index, joined);
}

// Redraw these paragraphs' highlights in the reader, if it shows that message.
function redrawReaderMarks(code, indices) {
    const m = messageState.message;
    if (!m || m.work.code !== code) return;
    for (const index of indices) {
        const textEl = messageEl('messageParagraphs')
            .querySelector(`.message-paragraph[data-index="${index}"] .verse-card-text`);
        if (textEl && m.paragraphs[index]) {
            textEl.innerHTML = messageMarkedHtml(m.paragraphs[index].text, messageMarksOf(code, index));
        }
    }
}

// The highlights of these paragraphs changed: show it in the reader and on screen.
function messageMarksChanged(code, indices) {
    redrawReaderMarks(code, indices);
    const live = messageState.live;
    if (state.liveSlide?.kind === 'message' && live && live.work.code === code) {
        const layout = messageLayout(live.work, live.paragraphs);
        showMessagePlace(live.work, live.paragraphs, messagePlaceAt(layout, live.place.paragraph, live.offset),
            { keepBlank: true, followReader: false, part: live.part });
    }
}

// Forget the highlights, in the reader too; the screen is the caller's to see to.
function dropMessageMarks() {
    const marks = messageState.marks;
    if (!marks) return null;
    messageState.marks = null;
    const m = messageState.message;
    if (m && m.work.code === marks.code) {
        for (const mark of messageEl('messageParagraphs').querySelectorAll('mark.message-mark')) {
            const textEl = mark.closest('.verse-card-text');
            const index = Number(mark.closest('.message-paragraph')?.dataset.index);
            if (textEl && m.paragraphs[index]) textEl.textContent = m.paragraphs[index].text;
        }
    }
    return marks;
}

// Escape: take every highlight off. False if there were none.
function clearMessageMarks() {
    const marks = dropMessageMarks();
    if (!marks || !marks.at.size) return false;
    messageMarksChanged(marks.code, []);
    return true;
}

// The operator has dragged across words in the reader: highlight them, if the
// reader's message is the one on screen. False if nothing was highlighted.
//
// What was dragged across is what the webview has selected, or failing that
// (a webview may leave a drag unselected) what lies between where the mouse
// went down and where it came up: `from` and `to`, each {index, offset}.
function markMessageSelection(from = null, to = null) {
    if (!messageLiveInReader()) return false;
    const selection = window.getSelection ? window.getSelection() : null;
    const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null;
    const { work, paragraphs } = messageState.message;
    const spans = [];   // [index, from, to] as dragged, before being taken out to whole words
    if (range) {
        for (const card of messageEl('messageParagraphs').querySelectorAll('.message-paragraph')) {
            const textEl = card.querySelector('.verse-card-text');
            if (!textEl || !range.intersectsNode(textEl)) continue;
            const index = Number(card.dataset.index);
            spans.push([index,
                textEl.contains(range.startContainer) ? messageTextOffset(textEl, range.startContainer, range.startOffset) : 0,
                textEl.contains(range.endContainer) ? messageTextOffset(textEl, range.endContainer, range.endOffset)
                    : (paragraphs[index]?.text ?? '').length]);
        }
    } else if (from && to && from.offset != null && to.offset != null) {
        const [a, b] = from.index < to.index || (from.index === to.index && from.offset <= to.offset) ? [from, to] : [to, from];
        for (let index = a.index; index <= b.index; index++) {
            spans.push([index, index === a.index ? a.offset : 0,
                index === b.index ? b.offset : (paragraphs[index]?.text ?? '').length]);
        }
    }
    const touched = [];
    for (const [index, start, end] of spans) {
        const text = paragraphs[index]?.text ?? '';
        const span = messageWordSpan(text, start, end);
        if (!span) continue;
        addMessageMark(work.code, index, text, span);
        touched.push(index);
    }
    if (!touched.length) return false;
    if (selection) selection.removeAllRanges();
    messageMarksChanged(work.code, touched);
    return true;
}

// Where in the reader a mouse event is: its paragraph and how far into its
// text ({index, offset}; the offset null off the text), or null off any paragraph.
function messageReaderPoint(e) {
    const card = e.target.closest ? e.target.closest('.message-paragraph') : null;
    return card ? { index: Number(card.dataset.index), offset: messageClickOffset(e, card) } : null;
}

// A click on a highlight in the reader takes it off. False if `el` is not one.
function removeMessageMark(el) {
    const mark = el.closest ? el.closest('mark.message-mark') : null;
    const textEl = mark?.closest('.verse-card-text');
    const m = messageState.message;
    if (!mark || !textEl || !m || messageState.marks?.code !== m.work.code) return false;
    const index = Number(mark.closest('.message-paragraph').dataset.index);
    const from = messageTextOffset(textEl, mark, 0);
    const list = (messageState.marks.at.get(index) || []).filter(([a]) => a !== from);
    if (list.length) messageState.marks.at.set(index, list);
    else messageState.marks.at.delete(index);
    messageMarksChanged(m.work.code, [index]);
    return true;
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
        { keepBlank: true, followReader: false, part: live.part });
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

// ↑ / ↓ in the reader, when they are not rolling the screen: move the
// highlight without projecting.
function moveParagraphHighlight(direction) {
    if (!messageReaderShown() || messageState.highlighted == null) return false;
    const last = messageState.message.paragraphs.length - 1;
    messageState.highlighted = Math.max(0, Math.min(last, messageState.highlighted + direction));
    markMessageParagraphs();
    scrollMessageParagraph(messageState.highlighted);
    return true;
}

// ---- Prepared quotes -----------------------------------------------------------
//
// A place in a message can be added to a collection, to be projected from
// there with PageDown like a song or a reading. Only a reference is kept,
// never the text (D6): the message's code; the paragraph at the top of the
// screen, by its place in the message (`at`, since a few messages number
// some paragraphs twice) and its number (`n`); where in it the top line starts
// (`offset`); where the screen ended (`end`, the first character not on it;
// none if it reached the end of the message); the highlights, as
// [paragraph, from, to]; and, to tell whether the library has changed since,
// the library's numbering id and a checksum (`sum`) of the paragraphs the
// quote points into. The checksum is a number made from their text, and
// gives none of it away.

const MESSAGE_QUOTE_VERSION = 1;

// FNV-1a, 32 bits, as 8 hex digits.
function messageTextSum(texts) {
    let h = 0x811c9dc5;
    const add = (code) => { h = Math.imul(h ^ code, 0x01000193) >>> 0; };
    for (const text of texts) {
        for (let i = 0; i < text.length; i++) add(text.charCodeAt(i));
        add(10);
    }
    return h.toString(16).padStart(8, '0');
}

function messageQuoteSum(paragraphs, at, marks) {
    const indices = [...new Set([at, ...marks.map(mark => mark[0])])].sort((a, b) => a - b);
    return messageTextSum(indices.map(i => paragraphs[i]?.text ?? ''));
}

// The quote the reader would add now: if its highlight is on what the screen
// shows, the screen as it is, highlights and all; otherwise the highlighted
// paragraph, from its start. Null with no message open.
function messageQuoteNow() {
    const m = messageState.message;
    if (!m || !m.paragraphs.length) return null;
    const live = messageState.live;
    const at0 = messageState.highlighted;
    const onScreen = !!live && live.work.code === m.work.code && at0 != null
        && at0 >= live.screen.first && at0 <= live.screen.last;
    const quote = { v: MESSAGE_QUOTE_VERSION, code: m.work.code };
    let marks = [];
    if (onScreen) {
        const layout = messageLayout(live.work, live.paragraphs);
        quote.at = live.place.paragraph;
        quote.offset = live.offset;
        const lastLine = messageMoveLines(layout, live.place, live.shown - 1);
        const after = messageNextLine(layout, lastLine, 1);
        if (after) quote.end = [after.paragraph, messageOffsetOf(layout, after)];
        marks = messageWindowMarks(m.work.code, { first: 0, last: m.paragraphs.length - 1 });
    } else {
        quote.at = at0 ?? 0;
        quote.offset = 0;
    }
    quote.n = m.paragraphs[quote.at].number ?? null;
    if (marks.length) quote.marks = marks;
    if (messageState.status?.numbering_id) quote.numbering = messageState.status.numbering_id;
    quote.sum = messageQuoteSum(m.paragraphs, quote.at, marks);
    return quote;
}

// A stored reference, read back; null if it is not one.
function parseMessageQuote(reference) {
    let q;
    try { q = JSON.parse(reference); } catch { return null; }
    if (!q || typeof q !== 'object' || typeof q.code !== 'string' || !q.code.trim()) return null;
    const whole = (x) => Number.isInteger(x) && x >= 0;
    return {
        code: q.code.trim(),
        at: whole(q.at) ? q.at : 0,
        n: Number.isInteger(q.n) ? q.n : null,
        offset: whole(q.offset) ? q.offset : 0,
        end: Array.isArray(q.end) && whole(q.end[0]) && whole(q.end[1]) ? [q.end[0], q.end[1]] : null,
        marks: Array.isArray(q.marks)
            ? q.marks.filter(m => Array.isArray(m) && whole(m[0]) && whole(m[1]) && whole(m[2]) && m[1] < m[2])
                .sort((a, b) => a[0] - b[0] || a[1] - b[1])
            : [],
        numbering: typeof q.numbering === 'string' ? q.numbering : null,
        sum: typeof q.sum === 'string' ? q.sum : null,
    };
}

// How a quote stands with the library installed now: 'ok'; 'no-library';
// 'missing' (the library has no such message); or null while the library's
// status is not yet known. Whether its paragraph is still the one meant can
// only be told once the message's text is read (see showMessageQuote).
function messageQuoteStanding(quote) {
    const status = messageState.status;
    if (!status) return null;
    if (!status.installed) return 'no-library';
    if (messageState.catalogue && !messageState.byCode.has(quote.code)) return 'missing';
    return 'ok';
}

// Project a prepared quote: open its message in the reader (so the wheel, the
// keys and highlighting work on it as on any other) and put its place at the
// top of the screen, with its highlights and only those. `wanted` is asked
// after each wait, in case the operator has moved on.
//
// The library may have been rebuilt since the quote was saved. A rebuild
// changes the numbering id whenever any paragraph anywhere is numbered
// differently, so the quote is checked against its own paragraphs instead:
// if the paragraph at its place has its number and their text its checksum,
// it is projected as saved. If the number is not there, or the numbering has
// changed and the text cannot be vouched for, the message is opened at the
// paragraph with its number but not projected, for the operator to check and
// project with Enter. If only the wording has changed, it is projected from
// the start of its paragraph, without its highlights. False if nothing was
// projected.
async function showMessageQuote(quote, wanted = () => true) {
    await ensureMessageCatalogue();
    if (!wanted()) return false;
    const standing = messageQuoteStanding(quote);
    if (standing === 'no-library' || standing === null) {
        updateStatus('The message library is not installed');
        return false;
    }
    if (standing === 'missing') {
        updateStatus(`${quote.code} is not in the message library`);
        return false;
    }
    if (!(await openMessage(quote.code, { wanted }))) return false;
    const { work, paragraphs } = messageState.message;
    if (!paragraphs.length) return false;

    const at = quote.at;
    const placeHolds = !!paragraphs[at] && (quote.n == null || paragraphs[at].number === quote.n);
    const textHolds = placeHolds && quote.sum ? quote.sum === messageQuoteSum(paragraphs, at, quote.marks) : null;
    const status = messageState.status;
    const renumbered = !!(quote.numbering && status?.numbering_id && quote.numbering !== status.numbering_id);
    if (!placeHolds || (renumbered && !textHolds)) {
        const byNumber = quote.n == null ? -1 : paragraphs.findIndex(p => p.number === quote.n);
        messageState.highlighted = byNumber >= 0 ? byNumber : Math.min(at, paragraphs.length - 1);
        markMessageParagraphs();
        scrollMessageParagraph(messageState.highlighted, 'center');
        updateStatus('The library has changed since this quote was saved: check the paragraph, then press Enter to project it');
        return false;
    }

    let { offset, marks, end } = quote;
    if (textHolds === false) {
        offset = 0;
        marks = [];
        end = null;
        updateStatus('The wording has changed since this quote was saved: it is shown from the start of its paragraph, without its highlights');
    }
    // Its highlights take the place of any the message had.
    dropMessageMarks();
    for (const [index, from, to] of marks) {
        const text = paragraphs[index]?.text;
        if (text != null && to <= text.length) addMessageMark(work.code, index, text, [from, to]);
    }
    if (messageState.marks) redrawReaderMarks(work.code, [...messageState.marks.at.keys()]);

    const layout = messageLayout(work, paragraphs);
    let place = messagePlaceAt(layout, at, offset);
    // Its lines may break differently on this screen than where it was saved,
    // so that highlights on screen then would not be now: move on just far
    // enough to show as many of them as will fit, but never past the first.
    const onThen = marks.filter(([index, from]) =>
        (index > at || (index === at && from >= offset)) && (!end || index < end[0] || (index === end[0] && from < end[1])));
    if (onThen.length) {
        const shown = messageLinesShown(layout, place);
        const lastShown = messageMoveLines(layout, place, shown - 1);
        const [lastIndex, , lastTo] = onThen[onThen.length - 1];
        const lastEnd = messagePlaceAt(layout, lastIndex, lastTo - 1);
        if (compareMessagePlaces(lastEnd, lastShown) > 0) {
            const firstStart = messagePlaceAt(layout, onThen[0][0], onThen[0][1]);
            let top = messageMoveLines(layout, lastEnd, -(shown - 1));
            if (compareMessagePlaces(top, firstStart) > 0) top = firstStart;
            if (compareMessagePlaces(top, place) > 0) place = top;
        }
    }
    showMessagePlace(work, paragraphs, place, { jump: true });
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
    messageEl('settingsMessageImportBtn').addEventListener('click', importMessageLibrary);
    messageEl('settingsMessageRemoveBtn').addEventListener('click', () => {
        // The confirmation would open under the settings dialog (as for a backup restore).
        closeSettingsModal();
        confirmRemoveMessageLibrary();
    });

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

    // A click projects from the line clicked. A drag across words of the
    // message on screen highlights them instead, and a click on a highlight
    // takes it off.
    // A press and release more than a few px apart is a drag, and never a click.
    const DRAG_PX = 4;
    let pressed = null;     // where the mouse went down in the reader: {x, y, at}
    let dragged = false;    // the release just made was a drag's
    messageEl('messageParagraphs').addEventListener('mousedown', (e) => {
        dragged = false;
        pressed = e.button === 0 ? { x: e.clientX, y: e.clientY, at: messageReaderPoint(e) } : null;
    });
    document.addEventListener('mouseup', (e) => {
        const from = pressed;
        pressed = null;
        if (!from) return;
        const moved = Math.hypot(e.clientX - from.x, e.clientY - from.y) > DRAG_PX;
        // A selection is the operator's doing only if this press made it: by
        // dragging, by a double click on a word, or with Shift. One left over
        // from before (Select All, say) must not turn a plain click into a
        // highlight.
        if (!moved && e.detail < 2 && !e.shiftKey) return;
        dragged = markMessageSelection(from.at, moved ? messageReaderPoint(e) : null) || moved;
        if (!dragged) return;
        // A drag that highlighted nothing leaves nothing selected either.
        const selection = window.getSelection ? window.getSelection() : null;
        if (selection && !selection.isCollapsed) selection.removeAllRanges();
        // Only the click that this release itself makes is the drag's.
        setTimeout(() => { dragged = false; }, 0);
    });
    messageEl('messageParagraphs').addEventListener('click', (e) => {
        if (dragged) {
            dragged = false;
            return;
        }
        const card = e.target.closest('.message-paragraph');
        if (!card || !messageState.message) return;
        if (removeMessageMark(e.target)) return;
        projectFromReader(Number(card.dataset.index), messageClickOffset(e, card));
    });

    messageEl('messagePreviewSurface').addEventListener('wheel', onMessagePreviewWheel, { passive: false });
    messageEl('messageParagraphs').addEventListener('wheel', onMessageReaderWheel, { passive: false });

    // The measuring copy of the projector page has loaded, or loaded a font.
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'message-measure-changed') messageDisplayChanged();
    });
}
