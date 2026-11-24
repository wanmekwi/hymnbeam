// The message library tab: installing a library, browsing it, going straight
// to a message, searching for a phrase, and projecting from the reader.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, amazingGrace, messageLibrary } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

async function openMessages(options = {}) {
    app = await bootApp({ songs, messages: messageLibrary, ...options });
    await app.openProjector();
    await app.click('#messagesTabBtn');
    await app.until(() => app.$('.message-year-cell, .message-empty'), 'the message tab');
}
const tabLabel = () => app.$('#messagesTabBtn').textContent;
const listText = () => app.$('#messageContentList').textContent.replace(/\s+/g, ' ');
const rows = (selector = '#messageContentList .message-row') => app.$$(selector).map(r => r.dataset.code);
const searches = () => app.requests.filter(r => r.startsWith('GET /messages/search'));
const typeQuery = async (text) => {
    await app.type('#messageSearchInput', text);
};
const typeAndWait = async (text) => {
    await typeQuery(text);
    await app.sleep(350);               // the phrase search waits 300 ms for typing to stop
    await app.settle(20);
};
const openRow = async (code) => {
    await app.click(`#messageContentList .message-row[data-code="${code}"]`);
    await app.until(() => !app.$('#messageDisplay').hidden, 'the reader');
};
const paragraphCards = () => app.$$('#messageParagraphs .message-paragraph');
const highlighted = () => app.$('#messageParagraphs .message-paragraph.highlighted')?.dataset.index;
const live = () => app.$('#messageParagraphs .message-paragraph.active')?.dataset.index;
const onScreenCards = () => app.$$('#messageParagraphs .message-paragraph.active').map(c => c.dataset.index);
// The place at the top of the projector's screen: {paragraph, offset}.
const top = () => app.onScreen().scroll.anchor;

// ---- No library ------------------------------------------------------------

test('with no library installed the tab offers to import one', async () => {
    await openMessages({ messages: null });
    assert.equal(tabLabel(), 'Sermons');
    assert.match(listText(), /No message library installed/);
    assert.equal(app.$('#messageImportBtn').disabled, false);
    assert.equal(app.$('#messageSearchInput').disabled, true);
    assert.equal(app.$('#messageLibraryFooter').hidden, true);
    assert.deepEqual(app.unhandledRequests, []);
});

test('importing shows progress, then names the tab and lists the library', async () => {
    let finish;
    await openMessages({
        messages: null,
        commands: {
            import_message_library: (args, db) => new Promise(resolve => {
                finish = () => { db.messages = structuredClone(messageLibrary); resolve(messageLibrary.status); };
            }),
        },
    });
    await app.click('#messageImportBtn');
    assert.equal(app.invokes.filter(i => i.cmd === 'import_message_library').length, 1);
    assert.equal(app.$('#messageImportBtn').disabled, true, 'one import at a time');

    await app.emit('message-library-progress', { copied: 50, total: 200 });
    assert.equal(app.$('#messageImportProgress').textContent, 'Installing… 25%');

    finish();
    await app.until(() => app.$('.message-year-cell'), 'the library to be listed');
    assert.equal(tabLabel(), 'The Test Tab');
    assert.equal(app.toast(), 'Message library installed: 6 messages · 3 chapters');
    assert.equal(app.$('#messageSearchInput').disabled, false);
});

test('cancelling the file picker leaves things as they were', async () => {
    await openMessages({ messages: null, commands: { import_message_library: () => null } });
    await app.click('#messageImportBtn');
    await app.settle(20);
    assert.match(listText(), /No message library installed/);
    assert.equal(app.$('#messageImportBtn').disabled, false);
});

test('a file that is not a library is refused with the reason', async () => {
    await openMessages({
        messages: null,
        commands: { import_message_library: () => { throw 'This file is not a HymnBeam message library.'; } },
    });
    await app.click('#messageImportBtn');
    await app.settle(20);
    assert.match(listText(), /This file is not a HymnBeam message library\./);
    assert.equal(tabLabel(), 'Sermons');
});

test('the library can be removed, after confirming', async () => {
    await openMessages({
        commands: { remove_message_library: (args, db) => { db.messages = null; return { installed: false }; } },
    });
    await app.click('.message-year-cell[data-year="1958"]');
    await openRow('58-0105M');
    await app.click('#messageRemoveBtn');
    assert.equal(app.$('#confirmModal').classList.contains('active'), true);
    assert.equal(app.invokes.filter(i => i.cmd === 'remove_message_library').length, 0);

    await app.click('#confirmDeleteBtn');
    await app.settle(20);
    assert.equal(app.invokes.filter(i => i.cmd === 'remove_message_library').length, 1);
    assert.match(listText(), /No message library installed/);
    assert.equal(tabLabel(), 'Sermons');
    assert.equal(app.$('#messageDisplay').hidden, true, 'the reader closes with it');
});

// ---- Browsing --------------------------------------------------------------

test('the tab is named by the library as soon as the app starts', async () => {
    app = await bootApp({ songs, messages: messageLibrary });
    await app.settle(10);
    assert.equal(tabLabel(), 'The Test Tab');
});

test('the browse list shows each year with its count, then the book', async () => {
    await openMessages();
    const years = app.$$('.message-year-cell').map(c =>
        `${c.querySelector('.message-year').textContent}:${c.querySelector('.message-year-count').textContent}`);
    assert.deepEqual(years, ['1958:2', '1959:2', '1960:1', '1961:1']);
    assert.match(listText(), /Book Of Lamps/);
    assert.deepEqual(rows(), ['BOL-00', 'BOL-01', 'BOL-02']);
    assert.match(app.$('.message-row[data-code="BOL-01"]').textContent, /Book Of Lamps · Chapter 1/);
    assert.equal(app.$('#messageLibraryFooter').hidden, false);
    assert.match(app.$('#messageLibraryFooter').textContent, /6 messages · 3 chapters/);
});

test("a year opens to its messages in date order, and closes again", async () => {
    await openMessages();
    await app.click('.message-year-cell[data-year="1959"]');
    assert.deepEqual(rows('.message-year-list .message-row'), ['59-0300', '59-0315']);
    assert.equal(app.$('.message-row[data-code="59-0315"] .message-row-meta').textContent,
        'Sun 15 Mar 1959 · Lakeside MN · 59-0315');
    await app.click('.message-year-cell[data-year="1958"]');
    assert.deepEqual(rows('.message-year-list .message-row'), ['58-0105M', '58-0105E'], 'one year at a time');
    await app.click('.message-year-cell[data-year="1958"]');
    assert.equal(app.$('.message-year-list'), null);
});

test('opening a message shows its paragraphs without projecting anything', async () => {
    await openMessages();
    const sent = app.projected().length;
    await app.click('.message-year-cell[data-year="1958"]');
    await openRow('58-0105M');
    assert.equal(app.$('#messageDisplayTitle').textContent, 'Seeds In Winter');
    assert.equal(app.$('#messageDisplaySubtitle').textContent, 'Sun 5 Jan 1958, morning · Riverton OH · 58-0105M');
    assert.equal(paragraphCards().length, 3);
    assert.equal(paragraphCards()[1].querySelector('.bible-verse-num').textContent, '2');
    assert.equal(highlighted(), '0');
    assert.equal(app.projected().length, sent);
    assert.equal(app.$('.message-row[data-code="58-0105M"]').classList.contains('selected'), true);
});

test('the reader shows the text as it is, brackets and all', async () => {
    await openMessages();
    await typeQuery('60-0229');
    await app.until(() => paragraphCards().length, 'the message');
    assert.equal(paragraphCards()[0].querySelector('.verse-card-text').innerHTML,
        'A quiet harbour &lt;is&gt; no place to stay &amp; rest for ever.');
    await typeQuery('59-0315');
    await app.until(() => app.$('#messageDisplayTitle').textContent === 'Seeds In Winter', 'the next message');
    assert.equal(paragraphCards()[1].querySelector('.verse-card-text').textContent,
        'The spring will surely come. [The listeners say amen.]');
});

test('messages opened are listed under Recent, newest first', async () => {
    await openMessages();
    await app.click('.message-year-cell[data-year="1958"]');
    await openRow('58-0105M');
    await openRow('58-0105E');
    await app.click('#libraryTabBtn');
    await app.click('#messagesTabBtn');
    await app.settle(10);
    const recent = app.$$('#messageContentList > .message-row').map(r => r.dataset.code);
    assert.deepEqual(recent.slice(0, 2), ['58-0105E', '58-0105M']);
    assert.ok(app.$('.message-year-cell[data-year="1958"].expanded'), 'and the year last opened is open');
});

// ---- Going straight to a message ----------------------------------------------

test('a title shows matching messages at once, before any phrase search', async () => {
    await openMessages();
    await typeQuery('seeds in');
    assert.deepEqual(rows(), ['58-0105M', '59-0315']);
    assert.deepEqual(searches(), []);
    assert.match(listText(), /Searching…/);
});

test('a title used many times lists a few above the phrase results, and the rest on request', async () => {
    const works = [...messageLibrary.works];
    const paragraphs = { ...messageLibrary.paragraphs };
    for (let i = 1; i <= 7; i++) {
        const code = `60-030${i}`;
        works.push({ code, kind: 'message', collection: null, title: 'Seeds In Winter', chapter: null,
                     location: 'Lakeside MN', year: 1960, sort: 20 + i });
        paragraphs[code] = [{ id: 100 + i, number: 1, text: 'The seed lies waiting.' }];
    }
    await openMessages({ messages: { ...messageLibrary, works, paragraphs } });
    await typeAndWait('seeds in winter');
    assert.equal(app.$$('#messageContentList .message-row').length, 5);
    assert.equal(app.$('.message-show-all').textContent, 'Show all 9 messages');
    assert.match(listText(), /Paragraphs/, 'the phrase results follow');
    await app.click('.message-show-all');
    assert.equal(app.$$('#messageContentList .message-row').length, 9);
    assert.equal(app.$('.message-show-all'), null);

    await typeQuery('1960');                   // only a date: no phrase results, so the longer list
    assert.equal(app.$$('#messageContentList .message-row').length, 8);
});

test('a whole date code opens that message at once', async () => {
    await openMessages();
    const sent = app.projected().length;
    await typeQuery('58-0105');
    assert.deepEqual(rows(), ['58-0105M', '58-0105E']);
    assert.equal(app.$('#messageDisplay').hidden, true, 'two services that day: nothing opens yet');
    await typeQuery('58-0105E');
    await app.until(() => !app.$('#messageDisplay').hidden, 'the message to open');
    assert.equal(app.$('#messageDisplayTitle').textContent, 'The Narrow Bridge');
    assert.equal(app.projected().length, sent);
    await typeQuery('bol-2');
    await app.until(() => app.$('#messageDisplayTitle').textContent === 'The Second Lamp', 'the chapter to open');
    assert.equal(app.$('#messageDisplaySubtitle').textContent, 'Book Of Lamps · Chapter 2');
});

test('a query that is only a date runs no phrase search', async () => {
    await openMessages();
    await typeAndWait('5 January 1958');
    assert.deepEqual(rows(), ['58-0105M', '58-0105E']);
    assert.deepEqual(searches(), []);
    assert.doesNotMatch(listText(), /Paragraphs/);
});

// ---- Phrase search ------------------------------------------------------------

test('a phrase lists the paragraphs holding it, with the words marked', async () => {
    await openMessages();
    await typeAndWait('surely come');
    assert.deepEqual(searches(), ['GET /messages/search?q=surely+come&limit=50']);
    const hits = app.$$('.message-hit');
    assert.deepEqual(hits.map(h => h.dataset.paragraphId), ['2', '8']);
    assert.equal(hits[0].querySelector('.message-hit-ref').textContent, 'Seeds In Winter · 58-0105M · Riverton OH');
    assert.equal(hits[0].querySelector('.message-hit-text').innerHTML,
        'And the farmer waits, for the spring will <mark>surely</mark> come.');
});

test('a hit in the book is labelled with the book and chapter', async () => {
    await openMessages();
    await typeAndWait('dark room');
    assert.equal(app.$('.message-hit .message-hit-ref').textContent, 'Book Of Lamps · Chapter 1 – The First Lamp');
});

test('a year typed with the words narrows the search to that year', async () => {
    await openMessages();
    await typeAndWait('surely come 1959');
    assert.deepEqual(searches(), ['GET /messages/search?q=surely+come&limit=50&from=1959&to=1959']);
    assert.deepEqual(app.$$('.message-hit').map(h => h.dataset.paragraphId), ['8']);
});

test('nothing found says so', async () => {
    await openMessages();
    await typeAndWait('zzzz qqqq');
    assert.match(listText(), /No paragraphs found/);
});

test('a slow answer to an earlier query never replaces a newer one', async () => {
    await openMessages();
    const realFetch = app.window.fetch;
    app.window.fetch = async (input, init) => {
        if (String(input).includes('q=river')) await new Promise(r => setTimeout(r, 400));
        return realFetch(input, init);
    };
    await typeAndWait('river');           // its answer is held back
    await typeAndWait('market day');
    await app.sleep(300);                 // the held-back answer arrives now
    await app.settle(20);
    assert.deepEqual(app.$$('.message-hit').map(h => h.dataset.paragraphId), ['6']);
});

test('Enter straight after typing waits for the new results, never opening an old one', async () => {
    await openMessages();
    await typeAndWait('surely come');                 // results for this are on screen
    const realFetch = app.window.fetch;
    app.window.fetch = async (input, init) => {
        if (String(input).includes('q=whole+town')) await new Promise(r => setTimeout(r, 150));
        return realFetch(input, init);
    };
    app.$('#messageSearchInput').focus();
    await typeQuery('whole town');                    // no title matches; the old hits are now stale
    assert.equal(app.$$('.message-hit.stale').length, 2);
    assert.equal(app.$$('.message-result').length, 0, 'the keyboard passes over them');
    await app.press('Enter', { target: '#messageSearchInput' });
    await app.until(() => !app.$('#messageDisplay').hidden, 'the reader');
    assert.equal(app.$('#messageDisplayTitle').textContent, 'Market Day');
    assert.deepEqual(searches().filter(r => r.includes('whole+town')).length, 1, 'searched once, without the pause');
});

test('a month name is kept in the phrase unless a year narrows the search', async () => {
    await openMessages();
    await typeAndWait('you may have 2 coats');
    assert.deepEqual(searches(), ['GET /messages/search?q=you+may+have+2+coats&limit=50']);
});

test('the snippet cannot inject markup', async () => {
    await openMessages();
    await typeAndWait('quiet harbour');
    assert.equal(app.$('.message-hit .message-hit-text').innerHTML,
        'A <mark>quiet</mark> harbour &lt;is&gt; no place to stay &amp; rest for ever.');
});

// ---- Projecting ---------------------------------------------------------------

test('choosing a hit opens the message at that paragraph, and a click projects it', async () => {
    await openMessages();
    await typeAndWait('surely come');
    await app.click('.message-hit[data-paragraph-id="8"]');
    await app.until(() => !app.$('#messageDisplay').hidden, 'the reader');
    assert.equal(app.$('#messageDisplaySubtitle').textContent, 'Sun 15 Mar 1959 · Lakeside MN · 59-0315');
    assert.equal(highlighted(), '1');

    await app.click(paragraphCards()[1]);
    const slide = app.onScreen();
    assert.equal(slide.mode, 'message');
    assert.equal(slide.footer, 'Seeds In Winter · 59-0315');
    assert.equal(slide.label, '', 'no paragraph number on the screen');
    assert.equal(slide.isBlank, false);
    assert.deepEqual(slide.scroll.paragraphs, [
        'The seed lies under the snow, but it is not dead.',
        'The spring will surely come. [The listeners say amen.]',
    ], 'the message goes as one column');
    assert.equal(slide.scroll.first, 0);
    assert.equal(slide.scroll.jump, true);
    assert.deepEqual(top(), { paragraph: 0, offset: 0 }, 'the whole message fits on the screen, so it shows from the top');
    assert.deepEqual(onScreenCards(), ['0', '1']);
    assert.equal(highlighted(), '1', 'the highlight stays on the paragraph chosen');
});

test('from the keyboard: ↓ and Enter open a hit, and Enter projects it', async () => {
    await openMessages();
    await app.openSong(amazingGrace.id);
    await app.click('#messagesTabBtn');
    app.$('#messageSearchInput').focus();
    await typeAndWait('the snow');
    await app.press('ArrowDown', { target: '#messageSearchInput' });
    await app.press('ArrowDown', { target: '#messageSearchInput' });
    assert.equal(app.$('.message-result.cursor').dataset.paragraphId, '7');
    await app.press('Enter', { target: '#messageSearchInput' });
    await app.until(() => app.$('#messageDisplaySubtitle').textContent.includes('59-0315'), 'the hit to open');
    assert.notEqual(app.document.activeElement, app.$('#messageSearchInput'), 'the box lets go of the keyboard');
    assert.equal(app.onScreen().title, 'Amazing Grace', 'still nothing projected');

    await app.press('Enter');
    assert.equal(app.onScreen().mode, 'message');
    assert.deepEqual(top(), { paragraph: 0, offset: 0 });
    // The whole message is on screen, so the arrows have nowhere to take it.
    const sent = app.projected().length;
    await app.press('ArrowRight');
    await app.press('ArrowLeft');
    assert.equal(app.projected().length, sent);
    assert.equal(app.state('navPosition'), 0, 'the song did not move');
});

test('Enter in the box with nothing marked opens the first row', async () => {
    await openMessages();
    await typeQuery('market');
    await app.press('Enter', { target: '#messageSearchInput' });
    await app.until(() => !app.$('#messageDisplay').hidden, 'the reader');
    assert.equal(app.$('#messageDisplayTitle').textContent, 'Market Day');
});

test('↑ and ↓ move the reader’s highlight without projecting', async () => {
    await openMessages();
    await typeQuery('58-0105M');
    await app.until(() => paragraphCards().length === 3, 'the message');
    const sent = app.projected().length;
    await app.press('ArrowDown');
    await app.press('ArrowDown');
    await app.press('ArrowDown');
    assert.equal(highlighted(), '2', 'stops at the last paragraph');
    await app.press('ArrowUp');
    assert.equal(highlighted(), '1');
    assert.equal(app.projected().length, sent);
    await app.press('Enter');
    assert.equal(app.onScreen().scroll.paragraphs[1], 'And the farmer waits, for the spring will surely come.');
    assert.equal(highlighted(), '1');
});

test('a focused drop-down keeps its own ↑ and ↓', async () => {
    await openMessages();
    await typeQuery('58-0105M');
    await app.until(() => paragraphCards().length === 3, 'the message');
    await app.press('ArrowDown', { target: '#sortSelect' });
    assert.equal(highlighted(), '0');
});

test('until a paragraph is on screen, the arrows keep stepping the song', async () => {
    await openMessages();
    await app.openSong(amazingGrace.id);
    await app.click('#messagesTabBtn');
    await typeQuery('58-0105M');
    await app.until(() => paragraphCards().length === 3, 'the message');
    await app.press('ArrowRight');
    assert.equal(app.onScreen().title, 'Amazing Grace');
    assert.equal(app.state('navPosition'), 1);
});

test('the arrows move the message on screen even after another is opened', async () => {
    await openLong();
    await app.click(paragraphCards()[0]);
    await typeQuery('59-0300');
    await app.until(() => app.$('#messageDisplayTitle').textContent === 'Market Day', 'the next message');
    await app.press('ArrowRight');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[2] });
    assert.equal(app.onScreen().footer, 'Lamps And Lanterns · 61-1231');
    assert.equal(live(), undefined, 'the reader shows another message');
});

test('a song chosen after a paragraph takes the arrows back', async () => {
    await openMessages();
    await typeQuery('58-0105M');
    await app.until(() => paragraphCards().length === 3, 'the message');
    await app.click(paragraphCards()[0]);
    await app.click('#libraryTabBtn');
    await app.openSong(amazingGrace.id);
    await app.press('ArrowRight');
    assert.equal(app.onScreen().title, 'Amazing Grace');
    assert.equal(app.state('navPosition'), 1);
});

test('Space blanks the message and brings it back; moving while blank stays blank', async () => {
    await openLong();
    await app.click(paragraphCards()[0]);
    await app.press(' ');
    assert.equal(app.onScreen().isBlank, true);
    await app.press(' ');
    assert.equal(app.onScreen().isBlank, false);
    assert.deepEqual(top(), { paragraph: 0, offset: 0 });

    await app.press(' ');
    await app.press('ArrowRight');
    assert.equal(app.onScreen().isBlank, true);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[2] }, 'the place moves on');
    await app.press(' ');
    assert.equal(app.onScreen().isBlank, false);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[2] }, 'and comes back where it was moved to');
});

test('a paragraph is not sent anywhere while the projector is closed', async () => {
    app = await bootApp({ songs, messages: messageLibrary });
    await app.click('#messagesTabBtn');
    await app.until(() => app.$('.message-year-cell'), 'the browse list');
    await typeQuery('58-0105M');
    await app.until(() => paragraphCards().length === 3, 'the message');
    await app.click(paragraphCards()[0]);
    assert.deepEqual(app.projected(), []);
});

// ---- On the projector ----------------------------------------------------------

// Stands in for the measuring copy of the projector page: lines of up to 40
// characters at the default size (fewer as the size goes up), broken at
// spaces, 10 px apart with 5 px more between paragraphs, in a view `view` px
// high. At 60 px the long fixture message, 61-1231, is one line, nine (LINES)
// and two, with six lines to a screen within a paragraph and five across a
// break; its last screen starts at the long paragraph's seventh line.
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
const perLine = (settings) => Math.round(180 / settings.message.fontPct);
const measureCopy = {
    metrics: () => ({ pitch: 10, gap: 5, view }),
    lines: (text, settings) => lineStarts(text, perLine(settings)),
};
const LONG_TEXT = messageLibrary.paragraphs['61-1231'][1].text;
const LINES = lineStarts(LONG_TEXT, 40);
const openLong = async (options = {}) => {
    view = options.view ?? 60;
    await openMessages({ messageMeasure: measureCopy, ...options });
    await typeQuery('61-1231');
    await app.until(() => paragraphCards().length === 3, 'the message');
};

test('the stand-in measuring copy breaks the long paragraph as these tests expect', () => {
    assert.deepEqual(LINES, [0, 40, 77, 113, 150, 186, 224, 263, 303]);
});

test('a book chapter\'s footer gives the chapter and the book', async () => {
    await openMessages();
    await typeQuery('BOL-01');
    await app.until(() => paragraphCards().length === 1, 'the chapter');
    await app.click(paragraphCards()[0]);
    assert.equal(app.onScreen().footer, 'The First Lamp · Book Of Lamps');
});

test('lines are measured in the message layout, at the size set, with the message\'s footer', async () => {
    await openLong({ settings: { message: { fontPct: 4 } } });
    await app.click(paragraphCards()[1]);
    assert.deepEqual(app.measured.at(-1), { footer: 'Lamps And Lanterns · 61-1231', fontPct: 4 });
});

test('a chosen paragraph goes to the top of the screen, with the paragraphs around it', async () => {
    await openLong();
    await app.click(paragraphCards()[1]);
    const slide = app.onScreen();
    assert.equal(slide.songId, 'message-61-1231');
    assert.equal(slide.scroll.first, 0);
    assert.equal(slide.scroll.paragraphs.length, 3);
    assert.equal(slide.scroll.paragraphs[1], LONG_TEXT);
    assert.deepEqual(slide.scroll.numbers, [1, 2, 3], "each paragraph's number goes with it");
    assert.deepEqual(top(), { paragraph: 1, offset: 0 });
    assert.equal(slide.scroll.jump, true, 'it fades in, as a new slide does');
    assert.deepEqual(onScreenCards(), ['1']);
});

test('→ moves the text on three lines and Shift+→ a screen less a line; ← goes back', async () => {
    await openLong();
    await app.click(paragraphCards()[0]);
    assert.deepEqual(onScreenCards(), ['0', '1']);
    await app.press('ArrowRight');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[2] }, 'on into the next paragraph');
    assert.equal(app.onScreen().scroll.jump, false, 'it glides there');
    assert.equal(highlighted(), '1', 'the reader follows the paragraph at the top');
    assert.deepEqual(onScreenCards(), ['1']);
    await app.press('ArrowRight', { shiftKey: true });
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[6] }, 'five lines, held at the end of the message');
    assert.deepEqual(onScreenCards(), ['1', '2']);
    await app.press('ArrowLeft');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] });
    await app.press('ArrowLeft', { shiftKey: true });
    assert.deepEqual(top(), { paragraph: 0, offset: 0 }, 'back to the start, and no further');
    assert.equal(app.state('navPosition'), 0, 'the song did not move');
});

test('the text stops where the end of the message fills the screen', async () => {
    await openLong();
    await app.click(paragraphCards()[2]);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[6] }, 'the last paragraph shows at the foot of the screen');
    assert.equal(highlighted(), '2', 'the highlight stays on the paragraph chosen');
    const sent = app.projected().length;
    await app.press('ArrowRight');
    assert.equal(app.projected().length, sent, 'nothing further to show');
});

test('the projector keeps the paragraphs it has until a move nears their edge', async () => {
    // Two lines to a screen, so the paragraphs sent run out.
    await openLong({ view: 20 });
    await app.click(paragraphCards()[0]);
    assert.equal(app.onScreen().scroll.paragraphs.length, 2);
    const firsts = [];
    for (let i = 0; i < 6; i++) {
        await app.press('ArrowRight');
        firsts.push(app.onScreen().scroll.first);
    }
    assert.deepEqual(firsts, [0, 0, 0, 0, 0, 1]);
    assert.deepEqual(app.onScreen().scroll.paragraphs, messageLibrary.paragraphs['61-1231'].slice(1).map(p => p.text));
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[5] });
});

test('a search result projects from the line with the matched words', async () => {
    await openLong();
    await app.type('#messageSearchInput', '');
    await typeAndWait('seventh lantern');
    assert.match(app.$('.message-hit .message-hit-text').textContent, /^…/, 'the snippet is cut, as a real one is');
    await app.click('.message-hit[data-paragraph-id="11"]');
    await app.until(() => highlighted() === '1', 'the hit to open');
    await app.press('Enter');
    assert.deepEqual(top(), { paragraph: 1, offset: LONG_TEXT.indexOf('seventh lantern') });

    // Another paragraph starts as usual.
    await app.click(paragraphCards()[0]);
    assert.deepEqual(top(), { paragraph: 0, offset: 0 });
});

test('a click in the reader projects from the line clicked', async () => {
    await openLong();
    const textNode = paragraphCards()[1].querySelector('.verse-card-text').firstChild;
    app.document.caretRangeFromPoint = () => {
        const range = app.document.createRange();
        range.setStart(textNode, LINES[4] + 10);
        return range;
    };
    await app.click(paragraphCards()[1].querySelector('.verse-card-text'));
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[4] }, 'the line holding the word clicked');
    await app.click(paragraphCards()[1].querySelector('.bible-verse-num'));
    assert.deepEqual(top(), { paragraph: 1, offset: 0 }, 'off the text: the paragraph\'s start');
    delete app.document.caretRangeFromPoint;
    await app.click(paragraphCards()[1].querySelector('.verse-card-text'));
    assert.deepEqual(top(), { paragraph: 1, offset: 0 }, 'a webview that cannot say: the start');
});

const wheelOver = (selector, deltaY, init = {}) => {
    const e = new app.window.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init });
    app.$(selector).dispatchEvent(e);
    return e.defaultPrevented;
};

test('the mouse wheel over the preview rolls the text with it, and the text stays where the wheel leaves it', async () => {
    await openLong();
    const wheel = (deltaY) => wheelOver('#messagePreviewSurface', deltaY);
    assert.equal(wheel(300), false, 'nothing on screen: the wheel is left alone');
    await app.click(paragraphCards()[0]);
    assert.equal(wheel(300), true);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[1], part: 0.5 },
        '720 px a screenful, here six lines: two and a half lines on');
    assert.equal(app.onScreen().scroll.jump, false);
    assert.equal(highlighted(), '1', 'the reader follows');
    const sent = app.projected().length;
    await app.sleep(300);
    assert.equal(app.projected().length, sent, 'left alone, it stays part-way down a line, as a page does');
    wheel(30);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[1], part: 0.75 });
    wheel(-210);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[0] }, 'back a line and three quarters');

    // A key moves by whole lines, from the whole line nearest where the wheel left it.
    wheel(48);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[0], part: 0.4 });
    await app.press('ArrowRight');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] }, 'three lines on from the line it was nearest');
    wheel(72);
    await app.sleep(40);
    await app.press('ArrowRight');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[6] }, 'past half-way, the nearest is the next line (held at the end)');

    // A hard flick moves no more than Shift and an arrow would, and the ends stop it on a whole line.
    await app.click(paragraphCards()[0]);
    wheel(12000);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] }, 'four lines: a screen of five, less one');
    wheel(390);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[6] }, 'the end of the message');
    await app.click(paragraphCards()[0]);
    wheel(-90);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 0, offset: 0 }, 'and its start');
});

test('a turning wheel is followed closely; one move on its own glides', async () => {
    await openLong();
    await app.click(paragraphCards()[0]);
    wheelOver('#messagePreviewSurface', 20);
    await app.sleep(120);
    assert.equal(app.onScreen().scroll.close, undefined, 'the first move, like one notch of a mouse wheel');
    for (let i = 0; i < 3; i++) {
        const sent = app.projected().length;
        wheelOver('#messagePreviewSurface', 20);
        await app.until(() => app.projected().length > sent, 'the move to be sent');
    }
    assert.equal(app.onScreen().scroll.close, true, 'moves one after another');
    await app.press('ArrowRight');
    assert.equal(app.onScreen().scroll.close, undefined, 'a key glides');
});

test('↓ and ↑ roll the text on screen a line; with the highlight elsewhere they move the highlight', async () => {
    await openLong();
    await app.click(paragraphCards()[1]);
    await app.press('ArrowDown');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[1] }, 'a line on');
    assert.equal(app.onScreen().scroll.jump, false, 'it glides');
    await app.press('ArrowDown', { shiftKey: true });
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[6] }, 'with Shift a screen less a line, held at the end');
    await app.press('ArrowUp');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[5] });
    assert.equal(highlighted(), '1', 'the highlight stays with the screen');

    // A search result elsewhere takes the highlight: the arrows are for choosing again.
    await app.click(paragraphCards()[0]);
    await typeAndWait('way home');
    await app.click('.message-hit[data-paragraph-id="12"]');
    await app.until(() => highlighted() === '2', 'the hit to open');
    const sent = app.projected().length;
    await app.press('ArrowUp');
    assert.equal(highlighted(), '1', 'the highlight moved');
    assert.equal(app.projected().length, sent, 'and the screen did not');
    await app.press('ArrowRight');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[2] }, '→ still moves the text on screen');
});

// The reader, as these tests lay it out: each paragraph's text 90 px high,
// 100 px apart, in a reader 400 px high. So the long paragraph's nine lines
// on screen are 10 px each in the reader.
const layOutReader = () => {
    const grid = app.$('#messageParagraphs');
    Object.defineProperty(grid, 'clientHeight', { value: 400, configurable: true });
    grid.getBoundingClientRect = () => ({ top: 50, height: 400 });
    paragraphCards().forEach((card, i) => {
        card.querySelector('.verse-card-text').getBoundingClientRect = () => ({ top: 50 + i * 100 - grid.scrollTop, height: 90 });
    });
    return grid;
};

test('the wheel over the reader rolls the screen, and the reader rolls with it', async () => {
    await openLong();
    const grid = layOutReader();
    const wheel = (deltaY, init) => wheelOver('#messageParagraphs', deltaY, init);
    assert.equal(wheel(50), false, 'nothing on screen: the reader scrolls as usual');
    await app.click(paragraphCards()[0]);
    assert.equal(wheel(180), true);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[0], part: 0.5 }, 'a line and a half on');
    assert.equal(grid.scrollTop, 89,
        'the reader has rolled to half-way down the first of the nine lines (105 px), less the 16 px kept above it');
    wheel(240);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[2], part: 0.5 });
    assert.equal(grid.scrollTop, 109, 'two lines on the screen are 20 px in the reader');
    wheel(-300);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[0] });
    assert.equal(grid.scrollTop, 84);

    // With Option held the reader is scrolled alone, to look ahead.
    const sent = app.projected().length;
    assert.equal(wheel(120, { altKey: true }), false);
    await app.sleep(40);
    assert.equal(app.projected().length, sent);

    // Scrolled away, the next roll brings the reader back to the screen's place.
    grid.scrollTop = 0;
    wheel(120);
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[1] });
    assert.equal(grid.scrollTop, 10, 'where the top of the screen was in the reader (100 px down) is kept');
});

test('with the reader on something else, the wheel over it scrolls the reader alone', async () => {
    await openLong();
    layOutReader();
    await app.click(paragraphCards()[0]);
    await typeAndWait('way home');
    await app.click('.message-hit[data-paragraph-id="12"]');
    await app.until(() => highlighted() === '2', 'the hit to open');
    const sent = app.projected().length;
    assert.equal(wheelOver('#messageParagraphs', 120), false);
    await app.sleep(40);
    assert.equal(app.projected().length, sent);
    assert.equal(wheelOver('#messagePreviewSurface', 120), true, 'the preview still rolls the screen');
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[0] });
    assert.equal(highlighted(), '1', 'and the reader is back with the screen');
});

// ---- Highlights ----------------------------------------------------------------

// Drag across the reader's text as the operator would: from `from` characters
// into one paragraph's text to `to` characters into another's (or the same).
const readerText = (i) => paragraphCards()[i].querySelector('.verse-card-text');
const pointIn = (textEl, offset) => {
    const walker = app.document.createTreeWalker(textEl, app.window.NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    for (; node && offset > node.length; node = walker.nextNode()) offset -= node.length;
    return [node, offset];
};
const drag = async (fromCard, from, toCard, to) => {
    // The mouse comes up 40 px from where it went down.
    const fire = (el, type) => el.dispatchEvent(new app.window.MouseEvent(type,
        { bubbles: true, cancelable: true, button: 0, clientX: type === 'mousedown' ? 100 : 140, clientY: 50 }));
    fire(readerText(fromCard), 'mousedown');
    const range = app.document.createRange();
    range.setStart(...pointIn(readerText(fromCard), from));
    range.setEnd(...pointIn(readerText(toCard), to));
    const selection = app.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    fire(readerText(toCard), 'mouseup');
    // A press and release on the same text is a click as well.
    if (fromCard === toCard) fire(readerText(toCard), 'click');
    await app.settle();
};
const marks = () => app.onScreen().scroll.marks;
const readerMarks = () => [...app.document.querySelectorAll('#messageParagraphs mark.message-mark')].map(m => m.textContent);

test('dragging across words of the message on screen highlights them there, and moves nothing', async () => {
    await openLong();
    await app.click(paragraphCards()[1]);
    await app.press('ArrowRight');
    const at = top();
    const sent = app.projected().length;

    await drag(1, 6, 1, 12);                       // from inside "first" to inside "lantern"
    assert.deepEqual(marks(), [[1, 4, 17]], 'whole words: "first lantern"');
    assert.deepEqual(readerMarks(), ['first lantern'], 'marked in the reader too');
    assert.equal(readerText(1).textContent, LONG_TEXT, 'the reader\'s text is otherwise as it was');
    assert.deepEqual(top(), at, 'the text on screen stays where it is');
    assert.equal(app.onScreen().scroll.jump, false);
    assert.equal(app.projected().length, sent + 1, 'the release is not taken for a click as well');
    assert.equal(app.window.getSelection().isCollapsed, true, 'the selection is put away');
    assert.equal(highlighted(), '1');

    await drag(1, 19, 1, 21);                      // inside "hung", the next word
    assert.deepEqual(marks(), [[1, 4, 22]], 'next to the first, it joins it');
    const second = LONG_TEXT.indexOf('second');
    await drag(1, second + 1, 1, second + 2);
    assert.deepEqual(marks(), [[1, 4, 22], [1, second, second + 6]]);
    assert.deepEqual(readerMarks(), ['first lantern hung', 'second']);

    // The highlights go with the text as it rolls.
    await app.press('ArrowRight');
    assert.deepEqual(marks(), [[1, 4, 22], [1, second, second + 6]]);

    // A click on one takes it off, and does not move the text.
    const before = top();
    await app.click(app.$('#messageParagraphs mark.message-mark'));
    assert.deepEqual(marks(), [[1, second, second + 6]]);
    assert.deepEqual(readerMarks(), ['second']);
    assert.deepEqual(top(), before);

    // Escape takes off what is left, before it does anything else.
    await app.press('Escape');
    assert.equal(marks(), undefined);
    assert.deepEqual(readerMarks(), []);
    assert.equal(readerText(1).textContent, LONG_TEXT);
    assert.deepEqual(top(), before);
});

test('a drag across paragraphs highlights the part of each, and only what the projector is sent goes with it', async () => {
    await openLong({ view: 20 });                  // two lines to a screen, so the paragraphs sent run out
    await app.click(paragraphCards()[0]);
    await drag(0, 6, 1, 8);                        // from "the lamps…" to the end, and "The first"
    assert.deepEqual(marks(), [[0, 5, 38], [1, 0, 9]]);
    assert.deepEqual(readerMarks(), ['the lamps and light the lanterns.', 'The first']);
    for (let i = 0; i < 6; i++) await app.press('ArrowRight');
    assert.equal(app.onScreen().scroll.first, 1, 'the first paragraph is no longer sent');
    assert.deepEqual(marks(), [[1, 0, 9]], 'nor its highlight');
    await app.click(paragraphCards()[0]);
    assert.deepEqual(marks(), [[0, 5, 38], [1, 0, 9]], 'which is back when the paragraph is');
});

test('a drag the webview leaves unselected still highlights, from where the mouse went down to where it came up', async () => {
    await openLong();
    await app.click(paragraphCards()[1]);
    const at = top();
    const sent = app.projected().length;
    // The webview says where in the text a point is: here, x is the offset.
    app.document.caretRangeFromPoint = (x) => {
        const range = app.document.createRange();
        range.setStart(...pointIn(readerText(1), x));
        return range;
    };
    const fire = (type, x) => readerText(1).dispatchEvent(
        new app.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0, button: 0 }));
    fire('mousedown', 12);
    fire('mouseup', 6);                             // dragged backwards, from "lantern" to "first"
    fire('click', 6);
    await app.settle();
    assert.deepEqual(marks(), [[1, 4, 17]]);
    assert.deepEqual(top(), at, 'and the release is not a click');
    assert.equal(app.projected().length, sent + 1);

    // A press and release in one spot is a click, as ever.
    fire('mousedown', 150);
    fire('mouseup', 152);
    fire('click', 152);
    await app.settle();
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[4] }, 'it projects from the line clicked');
    delete app.document.caretRangeFromPoint;
});

test('a plain click never highlights, whatever is selected; a double click on a word does', async () => {
    await openLong();
    await app.click(paragraphCards()[1]);
    const fire = (type, init = {}) => readerText(1).dispatchEvent(
        new app.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 50, ...init }));
    const select = (from, to) => {
        const range = app.document.createRange();
        range.setStart(...pointIn(readerText(1), from));
        range.setEnd(...pointIn(readerText(1), to));
        app.window.getSelection().removeAllRanges();
        app.window.getSelection().addRange(range);
    };
    // Text selected some other way (Select All, say), then a click inside it.
    select(0, 60);
    fire('mousedown', { detail: 1 });
    fire('mouseup', { detail: 1 });
    fire('click', { detail: 1 });
    await app.settle();
    assert.equal(marks(), undefined, 'nothing is highlighted');
    assert.deepEqual(readerMarks(), []);
    assert.equal(app.onScreen().scroll.jump, true, 'it is a click, and projects from its line');

    // The second click of a double click selects its word, and that is highlighted.
    fire('mousedown', { detail: 2 });
    select(10, 17);
    fire('mouseup', { detail: 2 });
    fire('click', { detail: 2 });
    await app.settle();
    assert.deepEqual(marks(), [[1, 10, 17]]);
    assert.deepEqual(readerMarks(), ['lantern']);
});

test('highlights come back after a blank, and Escape takes them off', async () => {
    await openLong();
    await app.click(paragraphCards()[1]);
    await drag(1, 6, 1, 12);
    await app.click('#blankBtn');
    await app.click('#blankBtn');
    assert.deepEqual(marks(), [[1, 4, 17]], 'blanking keeps them');
    await app.press('Escape');
    assert.equal(marks(), undefined, 'with the message on screen, Escape takes them off');
});

test('highlights are for the message on screen: none before it is shown, and gone when another is', async () => {
    await openLong();
    await drag(1, 6, 1, 12);
    assert.deepEqual(readerMarks(), [], 'nothing on screen, nothing to highlight');
    assert.equal(app.projected().length, 0, 'and a drag is never a click: nothing is projected');
    assert.equal(app.window.getSelection().isCollapsed, true, 'nor is anything left selected');

    await app.click(paragraphCards()[1]);
    await drag(1, 6, 1, 12);
    assert.deepEqual(marks(), [[1, 4, 17]]);
    await typeQuery('59-0315');
    await app.until(() => paragraphCards().length === 2, 'another message');
    const sent = app.projected().length;
    await drag(0, 2, 0, 6);
    assert.deepEqual(readerMarks(), [], 'the reader\'s message is not the one on screen');
    assert.equal(app.projected().length, sent, 'and nothing is sent');
    await app.click(paragraphCards()[0]);
    assert.equal(app.onScreen().songId, 'message-59-0315');
    assert.equal(marks(), undefined, 'the other message\'s highlights do not come with it');
    await typeQuery('61-1231');
    await app.until(() => paragraphCards().length === 3, 'the first message again');
    assert.deepEqual(readerMarks(), [], 'its highlights went when the other was shown');
});

test('the projector window passes on the wheel and the keys, as if they were the operator\'s', async () => {
    await openLong();
    await app.click(paragraphCards()[0]);
    await app.emit('projector-input', { wheel: 25 });
    await app.sleep(40);
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[1], part: 0.5 }, '25 px of the screen, at 10 px a line');
    await app.emit('projector-input', { key: 'ArrowDown', shift: false, repeat: false });
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] }, 'a line on from the nearest whole line');
    await app.emit('projector-input', JSON.stringify({ key: 'ArrowRight', shift: true, repeat: false }));
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[6] });
    await app.emit('projector-input', { key: ' ' });
    assert.equal(app.onScreen().isBlank, true, 'Space blanks the screen');
    await app.emit('projector-input', { key: ' ' });
    assert.equal(app.onScreen().isBlank, false);
    const sent = app.projected().length;
    await app.emit('projector-input', { key: 'Escape' });
    await app.emit('projector-input', 'not json');
    await app.emit('projector-input', null);
    assert.equal(app.projected().length, sent, 'Escape is the projector window\'s own, and nonsense is ignored');
});

test('a held arrow runs the text on by the clock, not by how fast the keyboard repeats', async () => {
    await openLong({ view: 30 });                    // two or three lines to a screen, so there is room to run
    await app.click(paragraphCards()[0]);
    const line = () => LINES.indexOf(top().offset);
    await app.press('ArrowRight');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[0] }, 'the press: a screen less a line');
    for (let i = 0; i < 12; i++) await app.press('ArrowRight', { repeat: true });
    assert.ok(line() <= 1, `a dozen repeats at once move a line at most, not a dozen: ${line()}`);
    const before = line();
    await app.sleep(170);
    await app.press('ArrowRight', { repeat: true });
    assert.ok(line() - before >= 2 && line() - before <= 3, `two lines in 170 ms, at 80 ms a line: ${line() - before}`);
    assert.equal(app.onScreen().scroll.jump, false);
    const held = line();
    await app.press('ArrowLeft');
    assert.equal(line(), held - 2, 'a fresh press steps as before: a screen of three lines, less one');
});

test('changing the text size breaks the lines afresh, keeping the text at the top on screen', async () => {
    await openLong();
    await app.click(paragraphCards()[1]);
    await app.press('ArrowRight');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] });

    await app.click('#settingsBtn');
    await app.click('#setDisplayTarget button[data-value="message"]');
    await app.type('#setMessageFont', '6');
    await app.until(() => app.measured.at(-1)?.fontPct === 6 && top().offset !== LINES[3], 'the lines to break afresh');
    const at = top();
    const newLines = lineStarts(LONG_TEXT, 30);
    assert.equal(at.paragraph, 1);
    assert.ok(newLines.includes(at.offset), 'at the start of a line');
    assert.ok(at.offset <= LINES[3] && newLines.find(o => o > at.offset) > LINES[3],
        'on the line holding what was at the top');
    assert.equal(app.onScreen().isBlank, false);
    assert.equal(app.onScreen().scroll.jump, false);
});

test('breaking the lines afresh leaves the reader\'s highlight alone', async () => {
    await openLong();
    await app.click(paragraphCards()[2]);
    assert.equal(highlighted(), '2', 'not the paragraph at the top of the screen');
    assert.deepEqual(onScreenCards(), ['1', '2']);
    const before = app.measured.length;
    await app.emit('projector-size', { width: 1440, height: 1080 });
    await app.until(() => app.measured.length > before, 'the lines to be measured again');
    await app.sleep(20);
    assert.equal(highlighted(), '2', 'still where the operator put it');
    assert.deepEqual(onScreenCards(), ['1', '2']);
});

test('lines are measured at the projector\'s size once it has said, and the message on screen keeps its place', async () => {
    await openLong();
    const frame = app.$('#messageMeasureFrame');
    await app.click(paragraphCards()[1]);
    await app.press('ArrowRight');
    const before = app.measured.length;
    const sent = app.projected().length;
    await app.emit('projector-size', { width: 1440, height: 1080 });
    assert.equal(frame.style.width, '1440px');
    assert.equal(frame.style.height, '1080px');
    await app.until(() => app.measured.length > before && app.projected().length > sent, 'the message to be sent again');
    assert.deepEqual(top(), { paragraph: 1, offset: LINES[3] }, 'at the same place');

    await app.emit('projector-size', JSON.stringify({ width: 1280, height: 720 }));
    assert.equal(frame.style.width, '1280px');
    await app.emit('projector-size', { width: 0, height: 'tall' });
    assert.equal(frame.style.width, '1280px', 'a nonsense size is ignored');
});
