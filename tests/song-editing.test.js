// Adding, editing, deleting and exporting songs.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, amazingGrace, holyHolyHoly, sundayService } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

const modalOpen = (id) => app.$(`#${id}`).classList.contains('active');
const submit = async () => {
    app.$('#songForm').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    await app.settle(20);
};
const titles = () => app.$$('.song-item-title').map(e => e.textContent);

test('a new song is saved with its details and appears in the library', async () => {
    app = await bootApp({ songs });
    await app.click('#newSongBtn');
    assert.equal(app.$('#editModalTitle').textContent, 'Add Song');

    await app.type('#songPasteInput', 'It Is Well\n\nWhen peace like a river\n\nChorus\nIt is well with my soul');
    await app.type('#songNumberInput', '77');
    await app.type('#songKeyInput', ' C ');
    await app.type('#songAuthorInput', 'Horatio Spafford');
    await app.type('#songSourceInput', 'Hymnal');
    await submit();

    assert.deepEqual(app.sent('POST /songs'), [{
        title: 'It Is Well', author: 'Horatio Spafford', musical_key: 'C',
        song_number: '77', source: 'Hymnal', tags: [],
        verses: [
            { label: 'Verse 1', text: 'When peace like a river' },
            { label: 'Chorus', text: 'It is well with my soul' },
        ],
    }]);
    assert.equal(modalOpen('editModal'), false);
    assert.equal(titles().includes('It Is Well'), true);
    assert.equal(app.toast(), 'Song added');
});

test('optional details left empty are saved as absent, not as empty text', async () => {
    app = await bootApp({ songs });
    await app.click('#newSongBtn');
    await app.type('#songPasteInput', 'Plain Song\n\nonly a verse');
    await submit();
    const [saved] = app.sent('POST /songs');
    assert.equal(saved.author, null);
    assert.equal(saved.musical_key, null);
    assert.equal(saved.song_number, null);
    assert.equal(saved.source, null);
});

test('an empty form, or a title with no lyrics, is not saved', async () => {
    app = await bootApp({ songs });
    await app.click('#newSongBtn');
    await submit();
    assert.match(app.toast(), /Paste song lyrics/);

    await app.type('#songPasteInput', 'Just A Title');
    await submit();
    assert.match(app.toast(), /No verses found/);

    assert.deepEqual(app.sent('POST /songs'), []);
    assert.equal(modalOpen('editModal'), true, 'the dialog stays open so nothing typed is lost');
});

test('a song number already in use is flagged while typing and blocks the save', async () => {
    app = await bootApp({ songs });
    await app.click('#newSongBtn');
    await app.type('#songPasteInput', 'New Song\n\nwords');

    await app.type('#songNumberInput', '12');
    assert.match(app.$('#songNumberHint').textContent, /Already used by "Amazing Grace"/);
    await submit();
    assert.deepEqual(app.sent('POST /songs'), []);
    assert.equal(modalOpen('editModal'), true);

    await app.type('#songNumberInput', '13');
    assert.equal(app.$('#songNumberHint').textContent, '');
    await submit();
    assert.equal(app.sent('POST /songs').length, 1);
});

test('a number conflict reported by the backend keeps the dialog open', async () => {
    app = await bootApp({ songs });
    // The library on screen is stale: someone else has taken number 99.
    app.backend.songs.push({ id: 900, title: 'Unseen', song_number: '99', verses: [{ label: 'Verse 1', text: 'x' }] });
    await app.click('#newSongBtn');
    await app.type('#songPasteInput', 'New Song\n\nwords');
    await app.type('#songNumberInput', '99');
    await submit();
    assert.match(app.$('#songNumberHint').textContent, /#99 is already used by another song/);
    assert.equal(modalOpen('editModal'), true);
});

test('editing opens the song as pasteable text with its details filled in', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.click('#editSongBtn');
    assert.equal(app.$('#editModalTitle').textContent, 'Edit Song');
    assert.equal(app.$('#songNumberInput').value, '12');
    assert.equal(app.$('#songKeyInput').value, 'G');
    assert.equal(app.$('#songAuthorInput').value, 'John Newton');
    assert.equal(app.$('#songPasteInput').value.startsWith(
        'Amazing Grace\n\nVerse 1\nAmazing grace, how sweet the sound\n\nChorus\n'), true);
});

test('re-saving an unedited song changes nothing about it', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.click('#editSongBtn');
    await submit();
    const [saved] = app.sent(`PUT /songs/${amazingGrace.id}`);
    assert.equal(saved.title, amazingGrace.title);
    assert.equal(saved.song_number, '12', 'its own number is not treated as a conflict');
    assert.deepEqual(saved.verses, amazingGrace.verses);
});

test('saving an edit updates the slide that is on screen', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();
    await app.click('#editSongBtn');
    await app.type('#songPasteInput', 'Amazing Grace\n\nVerse 1\nAmazing grace, corrected line');
    await submit();
    assert.equal(app.toast(), 'Song updated');
    assert.equal(app.onScreen().text, 'Amazing grace, corrected line');
    assert.equal(app.$('.verse-card-text').textContent, 'Amazing grace, corrected line');
});

test('Cancel closes the dialog without saving', async () => {
    app = await bootApp({ songs });
    await app.click('#newSongBtn');
    await app.type('#songPasteInput', 'Abandoned\n\nwords');
    await app.click('#cancelEditBtn');
    assert.equal(modalOpen('editModal'), false);
    assert.deepEqual(app.sent('POST /songs'), []);
});

test('a failed save is reported and the dialog keeps what was typed', async () => {
    app = await bootApp({ songs, failing: [/^POST \/songs$/] });
    await app.click('#newSongBtn');
    await app.type('#songPasteInput', 'Unlucky\n\nwords');
    await submit();
    assert.equal(app.toast(), 'Failed to save song');
    assert.equal(modalOpen('editModal'), true);
    assert.equal(app.$('#songPasteInput').value, 'Unlucky\n\nwords');
});

test('deleting asks first, and cancelling keeps the song', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.click('#deleteSongBtn');
    assert.equal(modalOpen('confirmModal'), true);
    assert.match(app.$('#confirmMessage').textContent, /delete "Amazing Grace"/);
    await app.click('#cancelDeleteBtn');
    assert.equal(modalOpen('confirmModal'), false);
    assert.equal(app.backend.songs.length, 3);
    assert.equal(app.state('currentSong').id, amazingGrace.id);
});

test('a deleted song leaves the library and can be undone from the toast', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.click('#deleteSongBtn');
    await app.click('#confirmDeleteBtn');
    await app.settle(20);

    assert.equal(titles().includes('Amazing Grace'), false);
    assert.equal(app.state('currentSong'), null);
    assert.match(app.toast(), /Deleted "Amazing Grace"/);

    await app.click('.toast-action');
    await app.settle(20);
    assert.equal(titles().includes('Amazing Grace'), true);
    assert.equal(app.toast(), 'Restored "Amazing Grace"');
});

test('deleting a song takes it out of an open order of service', async () => {
    app = await bootApp({ songs, collections: [sundayService] });
    await app.openCollection(sundayService.id);
    await app.click('#libraryTabBtn');
    await app.openSong(holyHolyHoly.id);
    await app.click('#deleteSongBtn');
    await app.click('#confirmDeleteBtn');
    await app.settle(20);
    await app.click('#collectionsTabBtn');
    await app.until(() => app.state('openCollection').songs.length === 3, 'the collection to refresh');
    assert.equal(app.state('openCollection').songs.some(s => s.song_id === holyHolyHoly.id), false);
});

test('a failed delete is reported and the song stays selected', async () => {
    app = await bootApp({ songs, failing: [/^DELETE \/songs\//] });
    await app.openSong(amazingGrace.id);
    await app.click('#deleteSongBtn');
    await app.click('#confirmDeleteBtn');
    await app.settle(20);
    assert.equal(app.toast(), 'Failed to delete song');
    assert.equal(app.state('currentSong').id, amazingGrace.id);
});

test('the delete shortcut from the menu needs a song to act on', async () => {
    app = await bootApp({ songs });
    await app.emit('menu-delete-song');
    assert.equal(modalOpen('confirmModal'), false);
    assert.equal(app.toast(), 'Select a song first');
    await app.emit('menu-edit-song');
    assert.equal(modalOpen('editModal'), false);
});

test('each export format downloads a file with the matching extension', async () => {
    app = await bootApp({ songs });
    for (const format of ['json', 'csv', 'txt']) {
        await app.click(`.export-option[data-format="${format}"]`);
        await app.settle(20);
        assert.equal(app.requests.includes(`GET /export?format=${format}`), true);
        assert.equal(app.window.__downloads.at(-1).download, `songs.${format}`);
        assert.equal(app.toast(), `Exported as ${format.toUpperCase()}`);
    }
});

test('a failed export says so', async () => {
    app = await bootApp({ songs, failing: [/^GET \/export$/] });
    await app.emit('menu-export-json');
    await app.settle(20);
    assert.equal(app.toast(), 'Export failed');
    assert.deepEqual(app.window.__downloads, []);
});
