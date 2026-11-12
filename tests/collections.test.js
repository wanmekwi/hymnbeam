// Driving a whole service through an order of service with one key.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, bible, sundayService } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

async function openService() {
    app = await bootApp({ songs, bible, collections: [sundayService] });
    await app.openProjector();
    await app.click('#collectionsTabBtn');
    await app.until(() => app.document.querySelector('.collection-item'), 'the collection list');
    await app.click(`.collection-item[data-id="${sundayService.id}"]`);
    await app.until(() => app.state('openCollection')?.id === sundayService.id, 'the collection to open');
}

const next = async () => { await app.press('PageDown'); await app.settle(20); };
const prev = async () => { await app.press('PageUp'); await app.settle(20); };

test('PageDown steps through song, reading, logo and song', async () => {
    await openService();

    await next();
    assert.equal(app.onScreen().title, 'Holy, Holy, Holy');
    assert.equal(app.onScreen().label, 'Verse 1');

    await next();
    assert.equal(app.onScreen().isBible, true);
    assert.equal(app.onScreen().title, 'John 3:16');
    assert.equal(app.onScreen().text, 'For God so loved the world');

    await next();
    assert.equal(app.projected('show-logo').at(-1).show, true);

    await next();
    assert.equal(app.projected('show-logo').at(-1).show, false, 'the logo comes down for the next song');
    assert.equal(app.onScreen().title, 'Amazing Grace');
    assert.equal(app.state('collectionPosition'), 3);
});

test('the active entry is highlighted as the service advances', async () => {
    await openService();
    await next();
    await next();
    const active = app.document.querySelectorAll('#collectionSongItems .collection-song-item.active-song');
    assert.equal(active.length, 1);
    assert.equal(active[0].dataset.entryId, '102');
});

test('stepping past either end of the service does nothing', async () => {
    await openService();
    await prev();
    assert.equal(app.state('collectionPosition'), -1);
    for (let i = 0; i < 6; i++) await next();
    assert.equal(app.state('collectionPosition'), 3);
    assert.equal(app.onScreen().title, 'Amazing Grace');
});

test('PageUp goes back to the previous item', async () => {
    await openService();
    await next();
    await next();
    await prev();
    assert.equal(app.onScreen().title, 'Holy, Holy, Holy');
    assert.equal(app.state('collectionPosition'), 0);
});

test('. and , do the same as the page keys', async () => {
    await openService();
    await app.press('.'); await app.settle(20);
    await app.press('.'); await app.settle(20);
    assert.equal(app.state('collectionPosition'), 1);
    await app.press(','); await app.settle(20);
    assert.equal(app.state('collectionPosition'), 0);
});

test('arrow keys still move within the song an entry loaded', async () => {
    await openService();
    await next();
    await app.press('ArrowRight');
    assert.equal(app.onScreen().label, 'Verse 2');
    assert.equal(app.state('collectionPosition'), 0);
});
