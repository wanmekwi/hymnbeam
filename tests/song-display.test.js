// The selected song in the operator window: details, verse cards and the flow strip.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, amazingGrace, holyHolyHoly } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

test('before a song is chosen the placeholder is shown', async () => {
    app = await bootApp({ songs });
    assert.equal(app.$('.song-item.active'), null);
    assert.equal(app.$$('.verse-card').length, 0);
});

test('choosing a song shows its number, title, author and verses', async () => {
    app = await bootApp({ songs: [{ ...amazingGrace, source: 'BCF Library' }, holyHolyHoly] });
    await app.openSong(amazingGrace.id);
    assert.equal(app.$('#displayTitle').textContent, '#12  Amazing Grace');
    assert.equal(app.$('#displayAuthor').textContent, 'John Newton');
    assert.equal(app.$('#displaySource').textContent, 'Source: BCF Library');
    assert.deepEqual(app.$$('.verse-card-label').map(e => e.textContent), ['Verse 1', 'Chorus', 'Verse 2', 'Verse 3']);
    assert.equal(app.$('.song-item.active').dataset.id, '1');

    await app.openSong(holyHolyHoly.id);
    assert.equal(app.$('#displaySource').hidden, true, 'no stale source from the previous song');
    assert.equal(app.$('#displayTitle').textContent, '#3  Holy, Holy, Holy');
});

test('the active verse card follows the arrows', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    const activeLabel = () => app.$('.verse-card.active .verse-card-label').textContent;
    assert.equal(activeLabel(), 'Verse 1');
    await app.press('ArrowRight');
    assert.equal(activeLabel(), 'Chorus');
    await app.press('ArrowRight');
    assert.equal(activeLabel(), 'Verse 2');
});

test('clicking a verse card projects that verse', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();
    await app.click('.verse-card[data-index="3"]');
    assert.equal(app.onScreen().label, 'Verse 3');
    await app.press('ArrowRight');
    assert.equal(app.onScreen().label, 'Chorus', 'and the arrows carry on from it');
});

test('the flow strip shows the sung order and jumps to any point in it', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();
    const flow = () => app.$$('.nav-flow-btn');
    assert.deepEqual(flow().map(b => b.textContent), ['V1', 'C', 'V2', 'C', 'V3', 'C']);
    assert.equal(flow().findIndex(b => b.classList.contains('active')), 0);

    await app.click(flow()[3]);                 // the second time through the chorus
    assert.equal(app.onScreen().label, 'Chorus');
    assert.equal(app.state('navPosition'), 3);
    assert.equal(flow().findIndex(b => b.classList.contains('active')), 3);
    await app.press('ArrowRight');
    assert.equal(app.onScreen().label, 'Verse 3', 'not back to verse 2');
});

test('a one-verse song has no flow strip', async () => {
    app = await bootApp({ songs: [{ id: 9, title: 'Doxology', verses: [{ label: 'Verse 1', text: 'Praise God' }] }] });
    await app.openSong(9);
    assert.equal(app.$$('.nav-flow-btn').length, 0);
});

test('lyrics and titles containing markup are shown as text, not interpreted', async () => {
    const hostile = {
        id: 9, title: '<img src=x onerror="window.__pwned = 1">', author: '<b>bold</b>',
        verses: [{ label: '<i>V</i>', text: '<script>window.__pwned = 1</script> & more' }],
    };
    app = await bootApp({ songs: [hostile] });
    await app.openSong(9);
    assert.equal(app.window.__pwned, undefined);
    assert.equal(app.$('#songList img'), null);
    assert.equal(app.$('#lyricsScroll script'), null);
    assert.equal(app.$('.verse-card-text').textContent, '<script>window.__pwned = 1</script> & more');
    assert.equal(app.$('.song-item-title').textContent, hostile.title);
});

test('changing the sort order reloads the list in that order', async () => {
    app = await bootApp({ songs });
    await app.type('#sortSelect', 'title', 'change');
    await app.settle(20);
    assert.equal(app.requests.at(-1), 'GET /songs?sort=title');
});

test('Escape with nothing else open clears the selected song', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.press('Escape');
    assert.equal(app.state('currentSong'), null);
    assert.equal(app.$('.song-item.active'), null);
});

test('a song that fails to load leaves the current one in place', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    app.backend.failing.push(/^GET \/songs\/2$/);
    await app.click('.song-item[data-id="2"]');
    await app.settle(20);
    assert.equal(app.state('currentSong').id, amazingGrace.id);
    assert.deepEqual(app.pageErrors, []);
});

// ── Start-up ─────────────────────────────────────────────────────────────────

test('an empty library shows the empty state rather than a blank list', async () => {
    app = await bootApp({ songs: [] });
    assert.equal(app.$('#songCount').textContent, '0 songs');
    assert.equal(app.$('#songList').contains(app.$('#emptyState')), true);
});

test('if the backend never answers, the operator is told', async () => {
    app = await bootApp({ songs, failing: [/^GET \/$/], started: false });
    await app.until(() => app.toast() === 'Backend not responding', 'the failure to be reported', 5000);
    assert.equal(app.requests.some(r => r.startsWith('GET /songs')), false);
});

test('the song list failing to load is reported', async () => {
    app = await bootApp({ songs, failing: [/^GET \/songs$/], started: false });
    await app.until(() => app.toast() === 'Backend not responding', 'the failure to be reported', 5000);
});
