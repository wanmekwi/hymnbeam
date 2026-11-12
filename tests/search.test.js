// Finding a song under time pressure: forgiving of typos and half-remembered titles.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

async function search(text) {
    const input = app.document.getElementById('searchInput');
    input.value = text;
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    await app.settle();
}
const titles = () => [...app.document.querySelectorAll('.song-item-title')].map(e => e.textContent);

test('a title fragment finds the song', async () => {
    app = await bootApp({ songs });
    await search('grace');
    assert.deepEqual(titles(), ['Amazing Grace']);
    assert.equal(app.document.getElementById('songCount').textContent, '1 match');
});

test('search ignores case and punctuation', async () => {
    app = await bootApp({ songs });
    await search('HOLY HOLY');
    assert.deepEqual(titles(), ['Holy, Holy, Holy']);
});

test('a typo still finds the song', async () => {
    app = await bootApp({ songs });
    await search('amazng grace');
    assert.equal(titles()[0], 'Amazing Grace');
    await search('blesed assurance');
    assert.equal(titles()[0], 'Blessed Assurance');
});

test('a first line of lyrics finds the song once typing pauses', async () => {
    app = await bootApp({ songs });
    await search('this is my story');
    await app.until(() => titles().includes('Blessed Assurance'), 'the lyric match to arrive');
});

test('clearing the search brings the whole library back', async () => {
    app = await bootApp({ songs });
    await search('grace');
    await search('');
    assert.equal(titles().length, 3);
    assert.equal(app.document.getElementById('songCount').textContent, '3 songs');
});

test('a search with no match says so instead of showing stale results', async () => {
    app = await bootApp({ songs });
    await search('zzzzqqqq');
    assert.deepEqual(titles(), []);
    assert.equal(app.document.getElementById('songCount').textContent, '0 matches');
});
