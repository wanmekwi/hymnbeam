// Browsing, searching and projecting scripture from the Bible tab.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, bible, amazingGrace, sundayService } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

async function openBible(options = {}) {
    app = await bootApp({ songs, bible, ...options });
    await app.openProjector();
    await app.click('#bibleTabBtn');
    await app.until(() => app.$('.bible-book-cell'), 'the book list');
}
const openChapter = async (code, chapter) => {
    await app.click(`.bible-book-cell[data-code="${code}"]`);
    await app.click(`.bible-chapter-cell[data-chapter="${chapter}"]`);
    await app.until(() => app.$('#bibleVerseGrid .verse-card'), 'the chapter to load');
};
const searchFor = async (text) => {
    await app.type('#bibleSearchInput', text);
    await app.sleep(350);               // the lookup waits 300 ms for typing to stop
    await app.settle(20);
};

test('books are listed under their testament', async () => {
    await openBible();
    const sections = app.$$('#bibleContentList .bible-book-grid').map(grid =>
        [...grid.querySelectorAll('.bible-book-name')].map(e => e.textContent));
    assert.deepEqual(sections, [['Genesis', 'Psalms', 'Ecclesiastes'], ['John', '1 John']]);
    assert.equal(app.$('.bible-book-cell[data-code="43N"] .bible-book-abbr').textContent, 'Jhn');
});

test('clicking a book opens its chapters, and clicking it again closes them', async () => {
    await openBible();
    await app.click('.bible-book-cell[data-code="62N"]');
    assert.equal(app.$$('.bible-chapter-cell').length, 5);
    await app.click('.bible-book-cell[data-code="01O"]');
    assert.equal(app.$$('.bible-chapter-cell').length, 50, 'only one book is open at a time');
    await app.click('.bible-book-cell[data-code="01O"]');
    assert.equal(app.$$('.bible-chapter-cell').length, 0);
});

test('opening a chapter shows its verses without projecting anything', async () => {
    await openBible();
    const sent = app.projected().length;
    await openChapter('43N', 3);
    assert.equal(app.$('#bibleDisplayTitle').textContent, 'John 3');
    assert.equal(app.$$('#bibleVerseGrid .verse-card').length, 36);
    assert.equal(app.$('.bible-chapter-cell.selected').dataset.chapter, '3');
    assert.equal(app.projected().length, sent);
});

test('clicking a verse projects it as scripture', async () => {
    await openBible();
    await openChapter('43N', 3);
    await app.click('#bibleVerseGrid .verse-card[data-verse="16"]');
    const slide = app.onScreen();
    assert.equal(slide.isBible, true);
    assert.equal(slide.title, 'John 3:16');
    assert.equal(slide.label, '3:16');
    assert.equal(slide.text, 'For God so loved the world');
    assert.equal(slide.hasNext, false);
    assert.equal(app.$('#bibleDisplayTitle').textContent, 'John 3:16');
    assert.equal(app.$('#bibleVerseGrid .verse-card.active').dataset.verse, '16');
});

test('translator-supplied words are shown in italics, never as raw brackets', async () => {
    await openBible();
    await openChapter('19O', 23);
    const card = app.$('#bibleVerseGrid .verse-card[data-verse="1"] .verse-card-text');
    assert.equal(card.innerHTML, 'The LORD <em>is</em> my shepherd; I shall not want.');
});

test('a chapter that cannot be loaded leaves the view as it was', async () => {
    await openBible();
    await app.click('.bible-book-cell[data-code="01O"]');
    await app.click('.bible-chapter-cell[data-chapter="1"]');      // not in the fake Bible → 404
    await app.settle(20);
    assert.equal(app.$$('#bibleVerseGrid .verse-card').length, 0);
    assert.deepEqual(app.pageErrors, []);
});

test('typing a reference projects that verse', async () => {
    await openBible();
    await searchFor('jn 3 16');
    assert.equal(app.onScreen().title, 'John 3:16');
    assert.equal(app.onScreen().text, 'For God so loved the world');
    assert.equal(app.$('#bibleDisplayTitle').textContent, 'John 3:16');
});

test('typing a chapter reference opens it without projecting', async () => {
    await openBible();
    const sent = app.projected().length;
    await searchFor('Psalm 23');
    assert.equal(app.$('#bibleDisplayTitle').textContent, 'Psalms 23');
    assert.equal(app.$$('#bibleVerseGrid .verse-card').length, 2);
    assert.equal(app.projected().length, sent);
});

test('nothing is looked up until typing pauses', async () => {
    await openBible();
    const before = app.requests.length;
    await app.type('#bibleSearchInput', 'j');
    await app.type('#bibleSearchInput', 'jn');
    await app.type('#bibleSearchInput', 'jn 3');
    assert.equal(app.requests.length, before);
    await app.sleep(350);
    await app.settle(20);
    assert.deepEqual(app.requests.slice(before), ['GET /bible/43N/3']);
});

test('other text is searched as keywords, and a hit can be projected', async () => {
    await openBible();
    await searchFor('shepherd');
    const hits = app.$$('.bible-search-hit');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].querySelector('.bible-search-ref').textContent, 'Psalms 23:1');
    assert.equal(hits[0].querySelector('.bible-search-text').innerHTML, 'The LORD <em>is</em> my shepherd; I shall not want.');

    await app.click(hits[0]);
    await app.settle(30);
    assert.equal(app.onScreen().title, 'Psalms 23:1');
    assert.equal(app.onScreen().text, 'The LORD [is] my shepherd; I shall not want.');
});

test('a keyword with no hits says so, and clearing the box brings the books back', async () => {
    await openBible();
    await searchFor('zzzzzz');
    assert.match(app.$('#bibleContentList').textContent, /No results/);
    await app.type('#bibleSearchInput', '');
    assert.equal(app.$$('.bible-book-cell').length, 5);
});

test('scripture is not sent anywhere while the projector is closed', async () => {
    app = await bootApp({ songs, bible });
    await app.click('#bibleTabBtn');
    await app.until(() => app.$('.bible-book-cell'), 'the book list');
    await openChapter('43N', 3);
    await app.click('#bibleVerseGrid .verse-card[data-verse="16"]');
    assert.deepEqual(app.projected(), []);
});

test('the passage on screen can be added to a collection', async () => {
    await openBible({ collections: [sundayService] });
    await app.click('#bibleAddToCollectionBtn');
    assert.equal(app.toast(), 'Open a passage first');

    await openChapter('43N', 3);
    await app.click('#bibleVerseGrid .verse-card[data-verse="16"]');
    await app.click('#bibleAddToCollectionBtn');
    await app.settle(20);
    await app.click(`#bibleCollectionPickerList .collection-picker-item[data-id="${sundayService.id}"]`);
    await app.settle(30);
    assert.equal(app.toast(), 'Added John 3:16');
    assert.equal(app.backend.collections[0].songs.at(-1).reference, 'John 3:16');
    assert.equal(app.$('#bibleCollectionPicker').classList.contains('open'), false);
});

test('with only a chapter open, the whole chapter is what gets added', async () => {
    await openBible({ collections: [sundayService] });
    await openChapter('19O', 23);
    await app.click('#bibleAddToCollectionBtn');
    await app.settle(20);
    await app.click('#bibleCollectionPickerList .collection-picker-item');
    await app.settle(30);
    assert.equal(app.backend.collections[0].songs.at(-1).reference, 'Psalms 23');
});

test('returning to a song after scripture puts the song back on screen', async () => {
    await openBible();
    await openChapter('43N', 3);
    await app.click('#bibleVerseGrid .verse-card[data-verse="16"]');
    await app.click('#libraryTabBtn');
    await app.openSong(amazingGrace.id);
    assert.equal(app.onScreen().title, 'Amazing Grace');
    assert.equal(app.onScreen().isBible, undefined);
    assert.equal(app.$('#bibleDisplay').hidden, true);
});
