// Prepared sermon quotes: a place in a message added to a collection from the
// reader, kept by reference only, and projected from the collection with
// PageDown like a song or a reading.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, bible, messageLibrary } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

// Stands in for the measuring copy of the projector page, as in
// messages-tab.test.js: lines of up to 40 characters, 10 px apart with 5 px
// more between paragraphs, in a view `view` px high. At 60 px a screen holds
// six lines within a paragraph. The long fixture message, 61-1231, has a
// one-line paragraph, then a long one (LINES), then a two-line one.
let view = 60;
function lineStarts(text, perLine) {
    const starts = [0];
    let lineStart = 0;
    let lastSpace = -1;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') lastSpace = i;
        if (i - lineStart >= perLine && lastSpace > lineStart) {
            starts.push(lastSpace + 1);
            lineStart = lastSpace + 1;
            lastSpace = -1;
        }
    }
    return starts;
}
const measureCopy = {
    metrics: () => ({ pitch: 10, gap: 5, view }),
    lines: (text, settings) => lineStarts(text, Math.round(180 / settings.message.fontPct)),
};
const LONG_TEXT = messageLibrary.paragraphs['61-1231'][1].text;
const LINES = lineStarts(LONG_TEXT, 40);
const word = (w) => [LONG_TEXT.indexOf(w), LONG_TEXT.indexOf(w) + w.length];

// A stored quote, as the reader writes it.
const quote = (fields) => JSON.stringify({ v: 1, code: '61-1231', at: 1, n: 2, offset: 0, numbering: 'test', ...fields });
// Its checksum, worked out here independently: FNV-1a (32 bits) over the text
// of each paragraph it points into, in order, each followed by a newline.
function checksum(code, indices) {
    let h = 0x811c9dc5;
    const add = (c) => { h = Math.imul(h ^ c, 0x01000193) >>> 0; };
    for (const i of [...new Set(indices)].sort((a, b) => a - b)) {
        for (const ch of messageLibrary.paragraphs[code][i].text) add(ch.charCodeAt(0));
        add(10);
    }
    return h.toString(16).padStart(8, '0');
}
const entry = (id, reference) => ({ id, item_type: 'message', reference, title: '61-1231 ¶2' });

async function boot({ collections = [], messages = messageLibrary, size = 60, ...options } = {}) {
    view = size;
    app = await bootApp({ songs, bible, messages, collections, messageMeasure: measureCopy, ...options });
    await app.openProjector();
}

async function openCollection(id) {
    await app.click('#collectionsTabBtn');
    await app.until(() => app.$(`.collection-item[data-id="${id}"]`), 'the collection list');
    await app.click(`.collection-item[data-id="${id}"]`);
    await app.until(() => app.state('openCollection')?.id === id, 'the collection to open');
}

const next = async () => { await app.press('PageDown'); await app.settle(20); };
const prev = async () => { await app.press('PageUp'); await app.settle(20); };
const top = () => app.onScreen().scroll.anchor;
const marks = () => app.onScreen().scroll.marks;
const paragraphCards = () => app.$$('#messageParagraphs .message-paragraph');
const highlighted = () => app.$('#messageParagraphs .message-paragraph.highlighted')?.dataset.index;
const readerMarks = () => app.$$('#messageParagraphs mark.message-mark').map(m => m.textContent);
const readerText = (i) => paragraphCards()[i].querySelector('.verse-card-text');
const entryLines = () => app.$$('#collectionSongItems .collection-song-item').map(el => ({
    title: el.querySelector('.collection-song-title').textContent,
    subtitle: el.querySelector('.collection-song-author')?.textContent ?? '',
    unavailable: el.classList.contains('entry-unavailable'),
}));

async function openInReader(code, count) {
    await app.click('#messagesTabBtn');
    await app.until(() => app.$('.message-year-cell, .message-row'), 'the message tab');
    await app.type('#messageSearchInput', code);
    await app.until(() => paragraphCards().length === count && app.$('#messageDisplayTitle').textContent, 'the message');
}

// Drag across words in the reader, as messages-tab.test.js does.
const pointIn = (textEl, offset) => {
    const walker = app.document.createTreeWalker(textEl, app.window.NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    for (; node && offset > node.length; node = walker.nextNode()) offset -= node.length;
    return [node, offset];
};
async function drag(card, from, to) {
    const fire = (type) => readerText(card).dispatchEvent(new app.window.MouseEvent(type,
        { bubbles: true, cancelable: true, button: 0, clientX: type === 'mousedown' ? 100 : 140, clientY: 50 }));
    fire('mousedown');
    const range = app.document.createRange();
    range.setStart(...pointIn(readerText(card), from));
    range.setEnd(...pointIn(readerText(card), to));
    app.window.getSelection().removeAllRanges();
    app.window.getSelection().addRange(range);
    fire('mouseup');
    fire('click');
    await app.settle();
}

async function addToCollection(id) {
    await app.click('#messageAddToCollectionBtn');
    await app.until(() => app.$(`#messageCollectionPickerList .collection-picker-item[data-id="${id}"]`), 'the picker');
    await app.click(`#messageCollectionPickerList .collection-picker-item[data-id="${id}"]`);
    await app.until(() => app.sent(`POST /collections/${id}/songs`).length, 'the quote to be added');
    await app.settle(20);
    return app.sent(`POST /collections/${id}/songs`).at(-1);
}

const evening = (songsIn = []) => ({ id: 9, name: 'Evening', songs: songsIn });

// ---- Adding -------------------------------------------------------------------

test('adding from the reader keeps the screen as it stands, highlights and all, by reference only', async () => {
    await boot({ collections: [evening()] });
    await openInReader('61-1231', 3);
    await app.click(paragraphCards()[1]);
    await app.press('ArrowRight');                    // three lines on
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] });
    await drag(1, word('fourth')[0] + 1, word('fourth')[0] + 2);
    assert.deepEqual(marks(), [[1, ...word('fourth')]]);

    const body = await addToCollection(9);
    assert.equal(body.item_type, 'message');
    const saved = JSON.parse(body.reference);
    const { sum, ...rest } = saved;
    assert.equal(sum, checksum('61-1231', [1]));
    assert.deepEqual(rest, {
        v: 1, code: '61-1231', at: 1, n: 2, offset: LINES[3],
        end: [2, 0],                                  // six lines on screen, to the end of the long paragraph
        marks: [[1, ...word('fourth')]],
        numbering: 'test',
    });
    assert.match(sum, /^[0-9a-f]{8}$/);
    assert.doesNotMatch(body.reference, /lantern|fourth/, 'none of the text is kept');
    assert.equal(app.toast(), 'Added ¶2 of Lamps And Lanterns');
    assert.equal(app.$('#messageCollectionPicker').classList.contains('open'), false);
});

test('with the reader on another message, its highlighted paragraph is added from its start', async () => {
    await boot({ collections: [evening()] });
    await openInReader('61-1231', 3);
    await app.click(paragraphCards()[1]);
    await drag(1, word('first')[0], word('first')[1]);
    await openInReader('59-0315', 2);                 // the screen still shows 61-1231
    await app.press('ArrowDown');                     // the highlight to the second paragraph
    assert.equal(highlighted(), '1');

    const saved = JSON.parse((await addToCollection(9)).reference);
    const { sum, ...rest } = saved;
    assert.deepEqual(rest, { v: 1, code: '59-0315', at: 1, n: 2, offset: 0, numbering: 'test' },
        'no screen, and no highlights: those were the other message\'s');
    assert.equal(app.toast(), 'Added ¶2 of Seeds In Winter');
});

test('with no message open there is nothing to add', async () => {
    await boot({ collections: [evening()] });
    assert.equal(app.window.messageQuoteNow(), null);
});

// ---- The collection ---------------------------------------------------------------

test('a collection lists a quote by its message\'s title, with its paragraph and highlights', async () => {
    await boot({ collections: [evening([
        entry(1, quote({ marks: [[1, 4, 17]] })),
        entry(2, quote({ code: '59-0315', at: 0, n: 1 })),
    ])] });
    await openCollection(9);
    await app.until(() => entryLines()[0]?.title === 'Lamps And Lanterns', 'the titles from the library');
    assert.deepEqual(entryLines(), [
        { title: 'Lamps And Lanterns', subtitle: '¶2 · 61-1231 · 1 highlight', unavailable: false },
        { title: 'Seeds In Winter', subtitle: '¶1 · 59-0315', unavailable: false },
    ]);
    assert.ok(app.$('#collectionSongItems .entry-message .collection-entry-icon svg'));
});

// ---- Projecting -----------------------------------------------------------------

test('PageDown runs through a song, two quotes from one sermon, a reading, the logo and a song', async () => {
    await boot({ collections: [{ id: 7, name: 'Sunday', songs: [
        { id: 101, item_type: 'song', song_id: 2, title: 'Holy, Holy, Holy', author: 'Reginald Heber' },
        entry(102, quote({ marks: [[1, ...word('first lantern')]] })),
        entry(103, quote({ offset: LINES[3], marks: [[1, ...word('fourth')]] })),
        { id: 104, item_type: 'bible', reference: 'John 3:16', title: 'John 3:16' },
        { id: 105, item_type: 'logo', title: 'Logo' },
        { id: 106, item_type: 'song', song_id: 1, title: 'Amazing Grace', author: 'John Newton' },
    ] }] });
    await openCollection(7);

    await next();
    assert.equal(app.onScreen().title, 'Holy, Holy, Holy');

    await next();
    assert.equal(app.onScreen().mode, 'message');
    assert.deepEqual(top(), { paragraph: 1, offset: 0 });
    assert.deepEqual(marks(), [[1, ...word('first lantern')]]);
    assert.equal(app.$('#messageDisplay').hidden, false, 'the message opens in the reader');
    assert.deepEqual(readerMarks(), ['first lantern']);
    assert.equal(highlighted(), '1');
    await app.press('ArrowDown');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[1] }, '↓ rolls it, as from the reader');

    await next();
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] });
    assert.equal(app.onScreen().scroll.jump, true, 'it comes up as a new slide');
    assert.deepEqual(marks(), [[1, ...word('fourth')]], 'its own highlights, and only those');
    assert.deepEqual(readerMarks(), ['fourth']);

    await next();
    assert.equal(app.onScreen().isBible, true);
    assert.equal(app.onScreen().title, 'John 3:16');
    await app.press('ArrowRight');
    assert.notEqual(app.onScreen().mode, 'message', 'the arrows no longer roll the sermon');

    await next();
    assert.equal(app.projected('show-logo').at(-1).show, true);

    await next();
    assert.equal(app.projected('show-logo').at(-1).show, false);
    assert.equal(app.onScreen().title, 'Amazing Grace');
    assert.equal(app.$('#songDisplay').hidden, false);

    // And back again.
    await prev();
    await prev();
    await prev();
    assert.equal(app.onScreen().mode, 'message');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] });
    assert.deepEqual(marks(), [[1, ...word('fourth')]]);
    assert.equal(app.state('collectionPosition'), 2);
});

test('a quote added from the reader comes back as it was saved', async () => {
    await boot({ collections: [evening()] });
    await openInReader('61-1231', 3);
    await app.click(paragraphCards()[1]);
    await app.press('ArrowRight');
    await drag(1, word('fourth')[0], word('fourth')[1]);
    await addToCollection(9);

    // Something else goes on screen, the highlights are taken off, and then the quote is projected.
    await app.click(paragraphCards()[0]);
    await app.press('Escape');
    assert.equal(marks(), undefined);
    await openCollection(9);
    await app.click('#collectionSongItems .collection-song-item');
    await app.settle(20);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] });
    assert.deepEqual(marks(), [[1, ...word('fourth')]]);
});

test('a quote that comes after the operator has moved on is not shown', async () => {
    await boot({ collections: [evening([
        entry(1, quote({})),
        { id: 2, item_type: 'song', song_id: 1, title: 'Amazing Grace', author: 'John Newton' },
    ])] });
    await openCollection(9);
    // Hold the message back until the next item has been asked for.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const fetch = app.window.fetch;
    app.window.fetch = async (url, init) => {
        if (String(url).includes('/messages/61-1231')) await gate;
        return fetch(url, init);
    };
    await next();
    await next();
    assert.equal(app.onScreen().title, 'Amazing Grace');
    release();
    await app.settle(20);
    assert.equal(app.onScreen().title, 'Amazing Grace', 'the song stays on screen');
    assert.equal(app.$('#songDisplay').hidden, false);
    assert.equal(app.$('#messageDisplay').hidden, true);
    assert.equal(app.state('collectionPosition'), 1);
});

test('a paragraph number used twice in a message is told apart by its place', async () => {
    const library = structuredClone(messageLibrary);
    library.paragraphs['61-1231'].forEach((p, i) => { p.number = [1, 1, 2][i]; });
    await boot({ messages: library, collections: [evening([entry(1, quote({ at: 1, n: 1 }))])] });
    await openCollection(9);
    await next();
    assert.deepEqual(top(), { paragraph: 1, offset: 0 }, 'the second paragraph numbered 1, not the first');
});

test('on a screen holding fewer lines, the text moves on just enough to show the highlights that were on screen', async () => {
    const on = (line) => [1, LINES[line], LINES[line] + 3];
    const saved = { end: [1, LINES[6]] };              // six lines on screen when saved
    await boot({ size: 40, collections: [evening([      // four lines to a screen here
        entry(1, quote({ ...saved, marks: [on(5)] })),
        entry(2, quote({ ...saved, marks: [on(2), on(5)] })),
        entry(3, quote({ ...saved, marks: [on(1), on(5)] })),
        entry(4, quote({ ...saved, marks: [on(7)] })),
    ])] });
    await openCollection(9);
    await next();
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[2] }, 'its line is the last on screen');
    assert.deepEqual(marks(), [on(5)]);
    await next();
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[2] }, 'both fit, the first at the top');
    await next();
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[1] }, 'not both: never past the first');
    await next();
    assert.deepEqual(top(), { paragraph: 1, offset: 0 }, 'a highlight that was not on screen then moves nothing');
});

// ---- When the library is not the one the quote was saved from -------------------------

test('without the library, a quote is marked as such and PageDown passes over it with a word', async () => {
    await boot({ messages: null, collections: [evening([
        { id: 1, item_type: 'song', song_id: 2, title: 'Holy, Holy, Holy', author: 'Reginald Heber' },
        entry(2, quote({})),
        { id: 3, item_type: 'song', song_id: 1, title: 'Amazing Grace', author: 'John Newton' },
    ])] });
    await openCollection(9);
    await app.until(() => entryLines()[1]?.unavailable, 'the quote to be marked');
    assert.deepEqual(entryLines()[1], {
        title: '61-1231 ¶2', subtitle: '¶2 · 61-1231 · Message library not installed', unavailable: true,
    });
    await next();
    await next();
    assert.equal(app.toast(), 'The message library is not installed');
    assert.equal(app.onScreen().title, 'Holy, Holy, Holy', 'the screen keeps what it had');
    await next();
    assert.equal(app.onScreen().title, 'Amazing Grace');
});

test('after a rebuild, a quote whose paragraph and text still hold is projected as saved', async () => {
    const fields = { numbering: 'an older build', offset: LINES[3], marks: [[1, ...word('fourth')]] };
    await boot({ collections: [evening([entry(1, quote({ ...fields, sum: checksum('61-1231', [1]) }))])] });
    await openCollection(9);
    await app.until(() => entryLines()[0]?.title === 'Lamps And Lanterns', 'the titles from the library');
    assert.equal(entryLines()[0].unavailable, false, 'the list cannot tell, so does not say');
    await next();
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] });
    assert.deepEqual(marks(), [[1, ...word('fourth')]]);
});

test('after a rebuild, a quote that cannot be vouched for opens at its paragraph for the operator to check', async () => {
    await boot({ collections: [evening([
        entry(1, quote({ numbering: 'an older build' })),                          // no checksum
        entry(2, quote({ numbering: 'an older build', sum: '00000000' })),         // text changed
        entry(3, quote({ at: 0, n: 2 })),                                          // its number is not at its place
    ])] });
    await openCollection(9);
    for (let i = 0; i < 3; i++) {
        await next();
        assert.equal(app.onScreen(), undefined, `${i + 1}: nothing is projected`);
        assert.equal(app.$('#messageDisplay').hidden, false);
        assert.equal(highlighted(), '1', `${i + 1}: the paragraph numbered 2`);
        assert.match(app.toast(), /library has changed since this quote was saved/);
    }
    await app.press('Enter');
    assert.deepEqual(top(), { paragraph: 1, offset: 0 }, 'Enter projects it');
});

test('a quote whose wording has changed is shown from its paragraph\'s start, without its highlights', async () => {
    await boot({ collections: [evening([entry(1, quote({ offset: LINES[3], marks: [[1, 4, 17]], sum: '00000000' }))])] });
    await openCollection(9);
    await next();
    assert.deepEqual(top(), { paragraph: 1, offset: 0 });
    assert.equal(marks(), undefined);
    assert.match(app.toast(), /wording has changed/);
});

test('a quote naming a message the library does not have says so', async () => {
    await boot({ collections: [evening([entry(1, quote({ code: '99-0101' }))])] });
    await openCollection(9);
    await app.until(() => entryLines()[0]?.unavailable, 'the quote to be marked');
    assert.match(entryLines()[0].subtitle, /Not in the message library/);
    await next();
    assert.equal(app.toast(), '99-0101 is not in the message library');
    assert.equal(app.onScreen(), undefined);
});

test('leaving the collection for the reader and coming back keeps its place, and so does adding to it', async () => {
    await boot({ collections: [{ id: 7, name: 'Sunday', songs: [
        { id: 101, item_type: 'song', song_id: 2, title: 'Holy, Holy, Holy', author: 'Reginald Heber' },
        entry(102, quote({})),
        { id: 103, item_type: 'song', song_id: 1, title: 'Amazing Grace', author: 'John Newton' },
    ] }] });
    await openCollection(7);
    await next();
    await next();
    assert.equal(app.state('collectionPosition'), 1);
    await app.click(paragraphCards()[2]);              // project another paragraph from the reader
    await app.click('#messageAddToCollectionBtn');
    await app.until(() => app.$('#messageCollectionPickerList .collection-picker-item[data-id="7"]'), 'the picker');
    await app.click('#messageCollectionPickerList .collection-picker-item[data-id="7"]');
    await app.until(() => app.state('openCollection')?.songs.length === 4, 'the quote to be added');
    assert.equal(app.state('collectionPosition'), 1, 'adding mid-service keeps the place');
    await app.click('#messagesTabBtn');
    await app.click('#collectionsTabBtn');
    await app.settle(20);
    assert.equal(app.state('collectionPosition'), 1, 'so does going to another tab and back');
    await next();
    assert.equal(app.onScreen().title, 'Amazing Grace');
});
