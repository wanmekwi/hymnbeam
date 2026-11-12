// Importing song files, and cherry-picking songs out of another database.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, amazingGrace, sundayService } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

const modalOpen = (id) => app.$(`#${id}`).classList.contains('active');
const imports = () => app.invokes.filter(i => i.cmd === 'import_songs_from_content').map(i => i.args);
const newSong = (id, title) => ({ id, title, verses: [{ label: 'Verse 1', text: `${title} words` }] });

// The backend's import command: each file adds `count` songs (2 by default).
const importer = (perFile = {}) => ({
    import_songs_from_content({ filename, replace }, db) {
        const outcome = perFile[filename] ?? 2;
        if (typeof outcome === 'string') throw outcome;      // Tauri rejects with a string
        if (replace) db.songs.length = 0;
        for (let i = 0; i < outcome; i++) db.songs.push(newSong(db.nextId++, `${filename} song ${i + 1}`));
        return { imported: outcome };
    },
});

test('a dropped file is imported and the library refreshes', async () => {
    app = await bootApp({ songs, commands: importer() });
    await app.emit('menu-import');
    assert.equal(modalOpen('importModal'), true);
    await app.drop('#dropZone', [{ name: 'hymns.json', text: '[{"title":"x"}]' }]);
    await app.settle(20);

    assert.deepEqual(imports(), [{ filename: 'hymns.json', content: '[{"title":"x"}]', replace: false }]);
    assert.equal(app.toast(), 'Imported 2 songs');
    assert.equal(app.$$('.song-item').length, 5);
    assert.equal(modalOpen('importModal'), false);
});

test('several files are imported in turn and the total is reported', async () => {
    app = await bootApp({ songs, commands: importer({ 'a.json': 1, 'b.csv': 3 }) });
    await app.emit('menu-import');
    await app.drop('#dropZone', [{ name: 'a.json', text: 'a' }, { name: 'b.csv', text: 'b' }]);
    await app.settle(20);
    assert.deepEqual(imports().map(i => i.filename), ['a.json', 'b.csv']);
    assert.equal(app.toast(), 'Imported 4 songs');
});

test('one bad file does not stop the others from importing', async () => {
    app = await bootApp({ songs, commands: importer({ 'bad.json': 'Unrecognised file format', 'good.json': 1 }) });
    await app.emit('menu-import');
    await app.drop('#dropZone', [{ name: 'bad.json', text: '?' }, { name: 'good.json', text: 'ok' }]);
    await app.settle(20);
    assert.equal(app.toast(), 'Imported 1 song');
});

test('the backend\'s reason is shown when nothing could be imported', async () => {
    app = await bootApp({ songs, commands: importer({ 'bad.json': 'Unrecognised file format' }) });
    await app.emit('menu-import');
    await app.drop('#dropZone', [{ name: 'bad.json', text: '?' }]);
    await app.settle(20);
    assert.equal(app.toast(), 'Unrecognised file format');
    assert.equal(app.$$('.song-item').length, 3);
});

test('a file with no songs in it says so', async () => {
    app = await bootApp({ songs, commands: importer({ 'empty.json': 0 }) });
    await app.emit('menu-import');
    await app.drop('#dropZone', [{ name: 'empty.json', text: '[]' }]);
    await app.settle(20);
    assert.equal(app.toast(), 'No songs were imported from that file');
});

test('replacing the library asks first, and cancelling imports nothing', async () => {
    app = await bootApp({ songs, commands: importer() });
    await app.emit('menu-import');
    await app.check('#replaceLibraryCheck');
    await app.drop('#dropZone', [{ name: 'new.json', text: 'x' }]);

    assert.equal(modalOpen('confirmModal'), true);
    assert.equal(modalOpen('importModal'), false, 'the two dialogs are never stacked');
    assert.match(app.$('#confirmMessage').textContent, /Delete every song in your library.*"new\.json"/);
    assert.equal(app.$('#confirmDeleteBtn').textContent, 'Replace Library');

    await app.click('#cancelDeleteBtn');
    assert.deepEqual(imports(), []);
    assert.equal(app.backend.songs.length, 3);
});

test('a confirmed replace wipes once, then adds the remaining files on top', async () => {
    app = await bootApp({ songs, collections: [sundayService], commands: importer({ 'a.json': 2, 'b.json': 1 }) });
    await app.openSong(amazingGrace.id);
    await app.emit('menu-import');
    await app.check('#replaceLibraryCheck');
    await app.drop('#dropZone', [{ name: 'a.json', text: 'a' }, { name: 'b.json', text: 'b' }]);
    assert.match(app.$('#confirmMessage').textContent, /these 2 files/);
    await app.click('#confirmDeleteBtn');
    await app.settle(30);

    assert.deepEqual(imports().map(i => i.replace), [true, false]);
    assert.equal(app.toast(), 'Library replaced — 3 songs imported');
    assert.equal(app.$$('.song-item').length, 3);
    assert.equal(app.state('currentSong'), null, 'the old song is no longer selected');
});

test('if the first file fails, the replace falls to the next file that imports', async () => {
    app = await bootApp({ songs, commands: importer({ 'bad.json': 'Unrecognised file format', 'b.json': 1 }) });
    await app.emit('menu-import');
    await app.check('#replaceLibraryCheck');
    await app.drop('#dropZone', [{ name: 'bad.json', text: '?' }, { name: 'b.json', text: 'b' }]);
    await app.click('#confirmDeleteBtn');
    await app.settle(30);
    // The operator confirmed a replace, so it still happens — once, on the first success.
    assert.deepEqual(imports().map(i => i.replace), [true, true]);
    assert.equal(app.toast(), 'Library replaced — 1 song imported');
});

test('"replace library" is never left ticked from a previous visit', async () => {
    app = await bootApp({ songs, commands: importer() });
    await app.emit('menu-import');
    await app.check('#replaceLibraryCheck');
    await app.press('Escape');
    await app.emit('menu-import');
    assert.equal(app.$('#replaceLibraryCheck').checked, false);
});

test('a second drop while an import is running is ignored', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    app = await bootApp({
        songs,
        commands: { async import_songs_from_content() { await gate; return { imported: 1 }; } },
    });
    await app.emit('menu-import');
    await app.drop('#dropZone', [{ name: 'a.json', text: 'a' }]);
    await app.drop('#dropZone', [{ name: 'a.json', text: 'a' }]);
    assert.equal(app.$('#dropZone').classList.contains('busy'), true);
    release();
    await app.settle(30);
    assert.equal(imports().length, 1);
    assert.equal(app.$('#dropZone').classList.contains('busy'), false);
});

// ── Import from another database ─────────────────────────────────────────────

const otherDb = [
    { title: 'Abide With Me', author: 'Henry Lyte', song_number: '5', musical_key: 'Eb', verses: [{ label: 'Verse 1', text: 'a' }, { label: 'Verse 2', text: 'b' }] },
    { title: 'Be Thou My Vision', author: null, song_number: '8', verses: [{ label: 'Verse 1', text: 'c' }] },
    { title: 'Crown Him', author: 'Matthew Bridges', song_number: '21', verses: [{ label: 'Verse 1', text: 'd' }] },
];
const dbCommands = (preview = otherDb) => ({
    preview_import_database: () => { if (typeof preview === 'string') throw preview; return preview; },
    import_selected_songs({ songs: chosen }, db) {
        for (const s of chosen) db.songs.push({ ...s, id: db.nextId++ });
        return { imported: chosen.length };
    },
});
const dbTitles = () => app.$$('#dbSongList .title').map(e => e.textContent);
const selectedImport = () => app.invokes.find(i => i.cmd === 'import_selected_songs')?.args;

async function openOtherDatabase(commands = dbCommands()) {
    app = await bootApp({ songs, commands });
    await app.emit('menu-import-database');
    await app.drop('#dbDropZone', [{ name: 'other.db.json', text: '{}' }]);
    await app.settle(20);
}

test('opening a database lists its songs with nothing selected', async () => {
    await openOtherDatabase();
    assert.deepEqual(dbTitles(), ['Abide With Me', 'Be Thou My Vision', 'Crown Him']);
    assert.match(app.$('#dbSourceInfo').textContent, /other\.db\.json — 3 songs/);
    assert.equal(app.$('#dbImportSelectedBtn').disabled, true);
    assert.equal(app.$('#dbBrowser').hidden, false);
    assert.equal(app.$('#dbDropZone').hidden, true);
});

test('ticked songs are imported in the database\'s order, tagged with the source', async () => {
    await openOtherDatabase();
    const boxes = app.$$('#dbSongList input[type=checkbox]');
    await app.check(boxes[2]);
    await app.check(boxes[0]);
    assert.equal(app.$('#dbImportSelectedBtn').textContent, 'Import 2 selected');

    await app.type('#dbSourceInput', '  Old hymnal  ');
    await app.click('#dbImportSelectedBtn');
    await app.settle(30);

    assert.deepEqual(selectedImport().songs.map(s => s.title), ['Abide With Me', 'Crown Him']);
    assert.equal(selectedImport().source, 'Old hymnal');
    assert.equal(app.toast(), 'Imported 2 songs');
    assert.equal(modalOpen('dbImportModal'), false);
    assert.equal(app.$$('.song-item').length, 5);
});

test('select-all only touches the songs the filter is showing', async () => {
    await openOtherDatabase();
    await app.type('#dbSearchInput', 'b');           // "Abide…", "Be Thou…", and author "…Bridges"
    await app.type('#dbSearchInput', 'vision');
    assert.deepEqual(dbTitles(), ['Be Thou My Vision']);
    await app.check('#dbSelectAll');
    await app.type('#dbSearchInput', '');
    assert.equal(app.$('#dbSelectedCount').textContent, '1 selected');
    assert.equal(app.$('#dbSelectAll').indeterminate, true);

    await app.check('#dbSelectAll');
    assert.equal(app.$('#dbSelectedCount').textContent, '3 selected');
    await app.check('#dbSelectAll', false);
    assert.equal(app.$('#dbSelectedCount').textContent, '');
    assert.equal(app.$('#dbImportSelectedBtn').disabled, true);
});

test('the filter matches title, author and number, and says when nothing matches', async () => {
    await openOtherDatabase();
    await app.type('#dbSearchInput', 'lyte');
    assert.deepEqual(dbTitles(), ['Abide With Me']);
    await app.type('#dbSearchInput', '21');
    assert.deepEqual(dbTitles(), ['Crown Him']);
    await app.type('#dbSearchInput', 'zzz');
    assert.match(app.$('#dbSongList').textContent, /No songs match/);
});

test('a selection survives being filtered out of view', async () => {
    await openOtherDatabase();
    await app.check(app.$$('#dbSongList input[type=checkbox]')[0]);
    await app.type('#dbSearchInput', 'crown');
    await app.type('#dbSearchInput', '');
    assert.equal(app.$$('#dbSongList input[type=checkbox]')[0].checked, true);
});

test('an unreadable or empty database is reported and the picker stays', async () => {
    await openOtherDatabase(dbCommands('Not a song database'));
    assert.equal(app.toast(), 'Not a song database');
    assert.equal(app.$('#dbBrowser').hidden, true);
    app.close();

    await openOtherDatabase(dbCommands([]));
    assert.equal(app.toast(), 'No songs found in that file');
    assert.equal(app.$('#dbDropZone').hidden, false);
});

test('a failed import keeps the dialog and the selection so it can be retried', async () => {
    await openOtherDatabase({ ...dbCommands(), import_selected_songs: () => { throw 'Database is locked'; } });
    await app.check(app.$$('#dbSongList input[type=checkbox]')[1]);
    await app.click('#dbImportSelectedBtn');
    await app.settle(20);
    assert.equal(app.toast(), 'Database is locked');
    assert.equal(modalOpen('dbImportModal'), true);
    assert.equal(app.$('#dbImportSelectedBtn').disabled, false);
    assert.equal(app.$('#dbSelectedCount').textContent, '1 selected');
});

test('"Change file" goes back to the picker and forgets the selection', async () => {
    await openOtherDatabase();
    await app.check('#dbSelectAll');
    await app.click('#dbChangeFileBtn');
    assert.equal(app.$('#dbDropZone').hidden, false);
    assert.equal(app.$('#dbBrowser').hidden, true);
    assert.equal(app.$('#dbSongList').innerHTML, '');
});
