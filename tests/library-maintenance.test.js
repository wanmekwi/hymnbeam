// Settings → Library: backups, recently deleted songs, duplicates, batch source.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, amazingGrace, holyHolyHoly } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

const rows = (id) => app.$$(`#${id} li`).map(li => li.textContent.replace(/\s+/g, ' ').trim());
const modalOpen = (id) => app.$(`#${id}`).classList.contains('active');

async function openLibraryPanel(options = {}) {
    app = await bootApp({ songs, ...options });
    await app.click('#settingsBtn');
    await app.click('.settings-tab[data-tab="library"]');
    await app.settle(20);
}

const dailyBackup = {
    name: 'songs-20261110-060000-daily.db', created_at_ms: Date.UTC(2026, 10, 10, 6), size_bytes: 3_250_000,
    songs: [{ id: 1, title: 'Only Song In The Backup', verses: [{ label: 'Verse 1', text: 'x' }] }],
};
const smallBackup = { name: 'songs-20261109-060000-pre-restore-2.db', created_at_ms: Date.UTC(2026, 10, 9, 6), size_bytes: 300 };

test('the panel says so when there is nothing to show', async () => {
    await openLibraryPanel();
    assert.deepEqual(rows('backupList'), ['No backups yet']);
    assert.deepEqual(rows('trashList'), ['Nothing deleted recently']);
});

test('backups are listed with their kind and size', async () => {
    await openLibraryPanel({ backups: [dailyBackup, smallBackup] });
    const [first, second] = rows('backupList');
    assert.match(first, /daily · 3\.1 MB/);
    assert.match(second, /pre-restore · 1 KB/, 'the -2 uniquifier is not part of the label');
    assert.equal(app.$$('#backupList button').length, 2);
});

test('"Back up now" creates a backup and lists it', async () => {
    await openLibraryPanel();
    await app.click('#backupNowBtn');
    await app.settle(20);
    assert.equal(app.toast(), 'Backup created');
    assert.match(rows('backupList')[0], /manual · 2\.3 MB/);
    assert.equal(app.$('#backupNowBtn').disabled, false);
});

test('a failed backup is reported and the button is usable again', async () => {
    await openLibraryPanel({ failing: [/^POST \/backups$/] });
    await app.click('#backupNowBtn');
    await app.settle(20);
    assert.equal(app.toast(), 'Failed to create backup');
    assert.equal(app.$('#backupNowBtn').disabled, false);
});

test('restoring a backup asks first, then replaces the library', async () => {
    await openLibraryPanel({ backups: [dailyBackup] });
    await app.click('#settingsDoneBtn');
    await app.openSong(amazingGrace.id);
    await app.click('#settingsBtn');

    await app.click('#backupList button');
    assert.equal(modalOpen('confirmModal'), true);
    assert.equal(modalOpen('settingsModal'), false, 'the two dialogs are never stacked');
    assert.match(app.$('#confirmMessage').textContent, /The current library is backed up first/);
    assert.equal(app.$('#confirmDeleteBtn').textContent, 'Restore');

    await app.click('#confirmDeleteBtn');
    await app.settle(30);
    assert.equal(app.requests.includes(`POST /backups/${dailyBackup.name}/restore`), true);
    assert.equal(app.toast(), 'Backup restored');
    assert.deepEqual(app.$$('.song-item-title').map(e => e.textContent), ['Only Song In The Backup']);
    assert.equal(app.state('currentSong'), null, 'the old selection may no longer exist');
});

test('cancelling a restore changes nothing', async () => {
    await openLibraryPanel({ backups: [dailyBackup] });
    await app.click('#backupList button');
    await app.click('#cancelDeleteBtn');
    assert.equal(app.requests.some(r => r.includes('/restore')), false);
    assert.equal(app.backend.songs.length, 3);
});

test('a failed restore is reported and the library is left alone', async () => {
    await openLibraryPanel({ backups: [dailyBackup], failing: [/^POST \/backups\/.*\/restore$/] });
    await app.click('#backupList button');
    await app.click('#confirmDeleteBtn');
    await app.settle(20);
    assert.equal(app.toast(), 'Failed to restore backup');
    assert.equal(app.$$('.song-item').length, 3);
});

test('a deleted song shows under Recently Deleted and can be restored there', async () => {
    app = await bootApp({ songs });
    await app.openSong(holyHolyHoly.id);
    await app.click('#deleteSongBtn');
    await app.click('#confirmDeleteBtn');
    await app.settle(20);

    await app.click('#settingsBtn');
    await app.click('.settings-tab[data-tab="library"]');
    await app.settle(20);
    assert.match(rows('trashList')[0], /^Holy, Holy, Holy — Reginald Heber/);

    await app.click('#trashList button');
    await app.settle(30);
    assert.equal(app.toast(), 'Restored "Holy, Holy, Holy"');
    assert.deepEqual(rows('trashList'), ['Nothing deleted recently']);
    assert.equal(app.$$('.song-item').length, 3);
});

const duplicates = [{
    title: 'Amazing Grace',
    songs: [
        { id: 1, title: 'Amazing Grace', author: 'John Newton', song_number: '12', verse_count: 4, content_hash: 'aaa' },
        { id: 61, title: 'Amazing Grace', author: 'John Newton', verse_count: 4, content_hash: 'aaa' },
        { id: 62, title: 'Amazing Grace', verse_count: 1, content_hash: 'bbb' },
    ],
}];

test('a duplicate scan groups copies and marks the word-for-word identical ones', async () => {
    await openLibraryPanel({ duplicates });
    await app.click('#scanDuplicatesBtn');
    await app.settle(20);
    const list = rows('duplicateList');
    assert.equal(list[0], 'Amazing Grace (3 copies)');
    assert.match(list[1], /John Newton · #12 · 4 verses.*identical lyrics/);
    assert.match(list[2], /John Newton · 4 verses.*identical lyrics/);
    assert.match(list[3], /1 verse(?!s)/);
    assert.doesNotMatch(list[3], /identical lyrics/);
});

test('a scan that finds nothing says so', async () => {
    await openLibraryPanel();
    await app.click('#scanDuplicatesBtn');
    await app.settle(20);
    assert.deepEqual(rows('duplicateList'), ['No duplicates found']);
    assert.equal(app.$('#scanDuplicatesBtn').disabled, false);
});

test('deleting a duplicate moves it to Recently Deleted, with undo', async () => {
    await openLibraryPanel({ duplicates });
    await app.click('#settingsDoneBtn');
    await app.openSong(amazingGrace.id);
    await app.click('#settingsBtn');
    await app.click('#scanDuplicatesBtn');
    await app.settle(20);

    await app.click('#duplicateList button');           // the first copy: the song on screen
    await app.settle(30);
    assert.match(app.toast(), /Moved "Amazing Grace" to Recently Deleted/);
    assert.equal(app.state('currentSong'), null, 'the deleted song is no longer selected');
    assert.match(rows('trashList')[0], /^Amazing Grace/);

    await app.click('.toast-action');
    await app.settle(30);
    assert.equal(app.backend.songs.some(s => s.id === amazingGrace.id), true);
});

// ── Batch "set source" ───────────────────────────────────────────────────────

const sourceSetter = { set_songs_source: () => 3 };
const sourceCalls = () => app.invokes.filter(i => i.cmd === 'set_songs_source').map(i => i.args);

test('setting a source needs a name', async () => {
    await openLibraryPanel({ commands: sourceSetter });
    await app.click('#applySourceBtn');
    assert.equal(app.toast(), 'Enter a source name first');
    assert.equal(modalOpen('confirmModal'), false);
});

test('setting a source is confirmed, naming how far it reaches', async () => {
    await openLibraryPanel({ commands: sourceSetter });
    await app.type('#batchSourceInput', '  BCF Library ');
    await app.check('#batchSourceUntagged', true);
    await app.click('#applySourceBtn');
    assert.match(app.$('#confirmMessage').textContent, /untagged songs.*"BCF Library"/);
    await app.click('#cancelDeleteBtn');
    assert.deepEqual(sourceCalls(), []);

    await app.check('#batchSourceUntagged', false);
    await app.click('#applySourceBtn');
    assert.match(app.$('#confirmMessage').textContent, /ALL songs/);
    await app.click('#confirmDeleteBtn');
    await app.settle(30);
    assert.deepEqual(sourceCalls(), [{ source: 'BCF Library', onlyUntagged: false }]);
    assert.equal(app.toast(), 'Source set on 3 songs');
    assert.equal(app.$('#batchSourceInput').value, '');
});

test('a failed source update is reported and the button is usable again', async () => {
    await openLibraryPanel({ commands: { set_songs_source: () => { throw 'locked'; } } });
    await app.type('#batchSourceInput', 'BCF');
    await app.click('#applySourceBtn');
    await app.click('#confirmDeleteBtn');
    await app.settle(30);
    assert.equal(app.toast(), 'Failed to set source');
    assert.equal(app.$('#applySourceBtn').disabled, false);
});
