// Building an order of service: creating, naming, filling, reordering, deleting.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, bible, amazingGrace, holyHolyHoly, blessedAssurance, sundayService } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

const entries = () => app.$$('#collectionSongItems .collection-song-title').map(e => e.textContent);
const stored = (id = sundayService.id) => app.backend.collections.find(c => c.id === id);
const pickerOpen = (id = 'collectionPicker') => app.$(`#${id}`).classList.contains('open');

test('the Collections tab lists each collection with its size', async () => {
    app = await bootApp({ songs, collections: [sundayService, { id: 8, name: 'Midweek', songs: [] }] });
    await app.click('#collectionsTabBtn');
    await app.settle(20);
    assert.equal(app.$('#collectionCount').textContent, '2 collections');
    assert.deepEqual(app.$$('.collection-item-name').map(e => e.textContent), ['Sunday Morning', 'Midweek']);
    assert.deepEqual(app.$$('.collection-item-meta').map(e => e.textContent), ['4 songs', '0 songs']);
});

test('opening a collection shows its items in order, typed', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    assert.deepEqual(entries(), ['Holy, Holy, Holy', 'John 3:16', 'Logo', 'Amazing Grace']);
    assert.equal(app.$('#collectionNameInput').value, 'Sunday Morning');
    const kinds = app.$$('#collectionSongItems .collection-song-item').map(e =>
        [...e.classList].find(c => c.startsWith('entry-')));
    assert.deepEqual(kinds, ['entry-song', 'entry-bible', 'entry-logo', 'entry-song']);
});

test('a new collection is created empty', async () => {
    app = await bootApp({ songs });
    await app.click('#collectionsTabBtn');
    await app.click('#newCollectionBtn');
    await app.settle(20);
    assert.deepEqual(app.sent('POST /collections'), [{ name: 'New Collection' }]);
    assert.equal(app.$('#collectionCount').textContent, '1 collection');
    assert.match(app.toast(), /Collection created/);
});

test('a failed create is reported', async () => {
    app = await bootApp({ songs, failing: [/^POST \/collections$/] });
    await app.click('#collectionsTabBtn');
    await app.click('#newCollectionBtn');
    await app.settle(20);
    assert.equal(app.toast(), 'Could not create collection');
});

test('renaming saves once typing pauses, and the list follows', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    await app.type('#collectionNameInput', 'Sunday Mor');
    await app.type('#collectionNameInput', 'Sunday Evening');
    assert.deepEqual(app.sent(`PUT /collections/${sundayService.id}`), [], 'not on every keystroke');
    await app.until(() => stored().name === 'Sunday Evening', 'the rename to be saved');
    assert.equal(app.sent(`PUT /collections/${sundayService.id}`).length, 1);
    await app.click('#backToCollectionsBtn');
    await app.settle(20);
    assert.deepEqual(app.$$('.collection-item-name').map(e => e.textContent), ['Sunday Evening']);
});

test('deleting a collection returns to the list without it', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    await app.click('#deleteCollectionBtn');
    await app.settle(20);
    assert.equal(app.backend.collections.length, 0);
    assert.equal(app.state('openCollection'), null);
    assert.equal(app.$('#collectionsListView').classList.contains('hidden'), false);
    assert.equal(app.$('#collectionCount').textContent, '0 collections');
});

test('the song on screen is added through the picker', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openSong(blessedAssurance.id);
    await app.click('#addToCollectionBtn');
    await app.settle(20);
    assert.equal(pickerOpen(), true);
    await app.click(`#collectionPickerList .collection-picker-item[data-id="${sundayService.id}"]`);
    await app.settle(20);
    assert.equal(app.toast(), 'Added to collection');
    assert.equal(pickerOpen(), false);
    assert.equal(stored().songs.at(-1).song_id, blessedAssurance.id);
});

test('the picker needs a song, and offers to create a collection when there are none', async () => {
    app = await bootApp({ songs });
    await app.click('#addToCollectionBtn');
    assert.equal(app.toast(), 'Select a song first');
    assert.equal(pickerOpen(), false);

    await app.openSong(amazingGrace.id);
    await app.click('#addToCollectionBtn');
    await app.settle(20);
    assert.match(app.$('#collectionPickerList').textContent, /No collections yet/);

    await app.click('#collectionPickerNew');
    await app.settle(30);
    assert.equal(app.backend.collections.length, 1);
    assert.equal(app.backend.collections[0].songs[0].song_id, amazingGrace.id, 'and puts the song straight in');
});

test('adding to the collection that is open updates its list on the spot', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    await app.click('#libraryTabBtn');
    await app.openSong(blessedAssurance.id);
    await app.click('#addToCollectionBtn');
    await app.settle(20);
    await app.click(`#collectionPickerList .collection-picker-item[data-id="${sundayService.id}"]`);
    await app.settle(20);
    assert.equal(entries().at(-1), 'Blessed Assurance');
    assert.equal(app.state('collectionPosition'), 4, 'the new entry is the current one');
});

test('a failed add is reported', async () => {
    app = await bootApp({ songs, collections: [sundayService], failing: [/^POST \/collections\/\d+\/songs$/] });
    await app.openSong(blessedAssurance.id);
    await app.click('#addToCollectionBtn');
    await app.settle(20);
    await app.click('#collectionPickerList .collection-picker-item');
    await app.settle(20);
    assert.equal(app.toast(), 'Could not add song to collection');
});

test('a logo slide can be added from the + Add menu', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    await app.click('#collectionAddBtn');
    assert.equal(app.$('#collectionAddMenu').classList.contains('open'), true);
    await app.click('#collectionAddLogoBtn');
    await app.until(() => stored().songs.length === 5, 'the logo slide to be added');
    await app.settle(20);
    assert.equal(stored().songs.at(-1).item_type, 'logo');
    assert.equal(app.$('#collectionAddMenu').classList.contains('open'), false);
});

test('a reading can be added by pressing Enter in the reference box', async () => {
    app = await bootApp({ songs, bible, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    app.$('#collectionBibleInput').value = 'ecc 9 11';
    await app.press('Enter', { target: '#collectionBibleInput' });
    await app.until(() => stored().songs.length === 5, 'the reading to be added');
    await app.settle(20);
    assert.equal(stored().songs.at(-1).reference, 'ecc 9 11');
    assert.equal(app.$('#collectionBibleInput').value, '');
});

test('items can be moved up and down, and the ends cannot move further', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    const item = (n) => app.$$('#collectionSongItems .collection-song-item')[n];

    assert.equal(item(0).querySelector('.up').disabled, true);
    assert.equal(item(3).querySelector('.down').disabled, true);

    await app.click(item(0).querySelector('.down'));
    await app.settle(30);
    assert.deepEqual(entries(), ['John 3:16', 'Holy, Holy, Holy', 'Logo', 'Amazing Grace']);
    assert.deepEqual(app.sent(`PUT /collections/${sundayService.id}/reorder`), [{ order: [102, 101, 103, 104] }]);

    await app.click(item(3).querySelector('.up'));
    await app.settle(30);
    assert.deepEqual(entries(), ['John 3:16', 'Holy, Holy, Holy', 'Amazing Grace', 'Logo']);
});

test('moving or removing an item does not project it', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openProjector();
    await app.openCollection(sundayService.id);
    const sent = app.projected().length;
    await app.click(app.$('#collectionSongItems .collection-song-item .down'));
    await app.settle(30);
    await app.click(app.$('#collectionSongItems .collection-song-item .remove'));
    await app.settle(30);
    assert.equal(app.projected().length, sent);
    assert.equal(app.state('currentSong'), null);
});

test('an item can be removed', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    await app.click(app.$$('#collectionSongItems .collection-song-item')[1].querySelector('.remove'));
    await app.settle(30);
    assert.deepEqual(entries(), ['Holy, Holy, Holy', 'Logo', 'Amazing Grace']);
    assert.deepEqual(stored().songs.map(e => e.id), [101, 103, 104]);
});

test('clicking an item projects it and makes it the current position', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openProjector();
    await app.openCollection(sundayService.id);
    await app.click(app.$$('#collectionSongItems .collection-song-item')[3]);
    await app.settle(30);
    assert.equal(app.onScreen().title, 'Amazing Grace');
    assert.equal(app.state('collectionPosition'), 3);
    await app.click('#collectionPrevBtn');
    await app.settle(30);
    assert.equal(app.projected('show-logo').at(-1).show, true);
});

test('opening a collection picks up from the song already on screen', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openSong(amazingGrace.id);
    await app.openCollection(sundayService.id);
    assert.equal(app.state('collectionPosition'), 3);
    assert.equal(app.$('#collectionSongItems .active-song').dataset.entryId, '104');
});

// Regression: readings and logo slides have no song_id, which used to match
// "no song selected" and mark the first of them as the current item.
test('opening a collection with nothing selected starts before the first item', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    assert.equal(app.state('collectionPosition'), -1);
    assert.equal(app.$('#collectionSongItems .active-song'), null);
});

test('going back to the list forgets the position', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openSong(holyHolyHoly.id);
    await app.openCollection(sundayService.id);
    await app.click('#backToCollectionsBtn');
    assert.equal(app.state('openCollection'), null);
    assert.equal(app.state('collectionPosition'), -1);
    await app.press('PageDown');
    assert.equal(app.state('currentSong').id, holyHolyHoly.id, 'the page keys do nothing without a service open');
});

test('the sidebar tabs can be reached from the keyboard', async () => {
    app = await bootApp({ songs, bible });
    const activeTab = () => app.$('.sidebar-tab.active').id;
    await app.press('2', { ctrlKey: true });
    assert.equal(activeTab(), 'collectionsTabBtn');
    await app.press('3', { ctrlKey: true });
    assert.equal(activeTab(), 'bibleTabBtn');
    await app.press(']');
    assert.equal(activeTab(), 'libraryTabBtn', '] wraps round from the last tab');
    await app.press('[');
    assert.equal(activeTab(), 'bibleTabBtn');
    await app.press('1', { ctrlKey: true });
    assert.equal(activeTab(), 'libraryTabBtn');
});
