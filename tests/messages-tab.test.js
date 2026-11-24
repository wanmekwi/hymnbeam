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
    assert.equal(slide.text, 'The spring will surely come. [The listeners say amen.]');
    assert.equal(slide.title, 'Seeds In Winter');
    assert.equal(slide.label, '', 'no paragraph number on the screen');
    assert.equal(slide.isBlank, false);
    assert.equal(live(), '1');
});

test('from the keyboard: ↓ and Enter open a hit, Enter projects, arrows step on', async () => {
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
    assert.equal(app.onScreen().text, 'The seed lies under the snow, but it is not dead.');
    await app.press('ArrowRight');
    assert.equal(app.onScreen().text, 'The spring will surely come. [The listeners say amen.]');
    await app.press('ArrowRight');
    assert.equal(app.onScreen().text, 'The spring will surely come. [The listeners say amen.]', 'the end of the message');
    await app.press('ArrowLeft');
    assert.equal(app.onScreen().text, 'The seed lies under the snow, but it is not dead.');
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
    assert.equal(app.onScreen().text, 'And the farmer waits, for the spring will surely come.');
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

test('the arrows step the live message even after another is opened', async () => {
    await openMessages();
    await typeQuery('58-0105M');
    await app.until(() => paragraphCards().length === 3, 'the message');
    await app.click(paragraphCards()[0]);
    await typeQuery('59-0300');
    await app.until(() => app.$('#messageDisplayTitle').textContent === 'Market Day', 'the next message');
    await app.press('ArrowRight');
    assert.equal(app.onScreen().text, 'And the farmer waits, for the spring will surely come.');
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

test('Space blanks a paragraph and brings it back; stepping while blank stays blank', async () => {
    await openMessages();
    await typeQuery('58-0105M');
    await app.until(() => paragraphCards().length === 3, 'the message');
    await app.click(paragraphCards()[0]);
    await app.press(' ');
    assert.equal(app.onScreen().isBlank, true);
    await app.press(' ');
    assert.equal(app.onScreen().text, 'Now the seed lies under the snow all winter long.');

    await app.press(' ');
    await app.press('ArrowRight');
    assert.equal(app.onScreen().isBlank, true);
    assert.equal(live(), '1', 'the reader moves on');
    await app.press(' ');
    assert.equal(app.onScreen().text, 'And the farmer waits, for the spring will surely come.');
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
