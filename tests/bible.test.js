// Scripture references, as typed by an operator in a hurry.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, bible, sundayService } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

async function parse(ref) {
    return JSON.parse(app.eval(`JSON.stringify((() => {
        const r = parseReference(${JSON.stringify(ref)});
        return r && { book: r.book.name, chapter: r.chapter, verse: r.verse };
    })())`));
}

test('common ways of writing a reference all resolve', async () => {
    app = await bootApp({ songs, bible });
    await app.eval('ensureBibleBooks()');
    const expected = { book: 'Ecclesiastes', chapter: 9, verse: 11 };
    for (const ref of ['Ecc 9:11', 'ec 9 11', 'ecclesiastes 9:11', 'Eccl. 9.11', '  ECC 9:11  ']) {
        assert.deepEqual(await parse(ref), expected, ref);
    }
});

test('numbered books resolve, in digits or roman numerals', async () => {
    app = await bootApp({ songs, bible });
    await app.eval('ensureBibleBooks()');
    assert.deepEqual(await parse('1 John 4:8'), { book: '1 John', chapter: 4, verse: 8 });
    assert.deepEqual(await parse('1jn 4:8'), { book: '1 John', chapter: 4, verse: 8 });
    assert.deepEqual(await parse('I John 4:8'), { book: '1 John', chapter: 4, verse: 8 });
    assert.deepEqual(await parse('John 4:8'), { book: 'John', chapter: 4, verse: 8 });
});

test('a chapter on its own has no verse', async () => {
    app = await bootApp({ songs, bible });
    await app.eval('ensureBibleBooks()');
    assert.deepEqual(await parse('Psalm 23'), { book: 'Psalms', chapter: 23, verse: null });
});

test('nonsense and out-of-range chapters are rejected', async () => {
    app = await bootApp({ songs, bible });
    await app.eval('ensureBibleBooks()');
    assert.equal(await parse('Hezekiah 3:16'), null);
    assert.equal(await parse('John 22:1'), null);
    assert.equal(await parse('John'), null);
    assert.equal(await parse(''), null);
});

// Regression: book names were only loaded when the Bible tab was opened, so on
// a fresh launch every reading in an order of service failed to resolve.
test('a reading can be added to a service without visiting the Bible tab', async () => {
    app = await bootApp({ songs, bible, collections: [sundayService] });
    await app.click('#collectionsTabBtn');
    await app.until(() => app.document.querySelector('.collection-item'), 'the collection list');
    await app.click(`.collection-item[data-id="${sundayService.id}"]`);
    await app.until(() => app.state('openCollection')?.id === sundayService.id, 'the collection to open');

    app.document.getElementById('collectionBibleInput').value = 'John 3:16';
    await app.click('#collectionAddBibleBtn');
    await app.until(() => app.state('openCollection').songs.length === 5, 'the reading to be added');
    assert.equal(app.state('openCollection').songs.at(-1).reference, 'John 3:16');
});

test('a reference that does not resolve is not added to a service', async () => {
    app = await bootApp({ songs, bible, collections: [sundayService] });
    await app.click('#collectionsTabBtn');
    await app.until(() => app.document.querySelector('.collection-item'), 'the collection list');
    await app.click(`.collection-item[data-id="${sundayService.id}"]`);
    await app.until(() => app.state('openCollection')?.id === sundayService.id, 'the collection to open');

    app.document.getElementById('collectionBibleInput').value = 'Hezekiah 3:16';
    await app.click('#collectionAddBibleBtn');
    await app.settle(20);
    assert.equal(app.state('openCollection').songs.length, 4);
    assert.match(app.document.getElementById('toast').textContent, /Couldn't resolve/);
});
