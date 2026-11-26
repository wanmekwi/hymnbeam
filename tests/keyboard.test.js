// Shortcuts must not fire where they would surprise the operator.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, amazingGrace } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

test('typing in the search box does not trigger single-key shortcuts', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();
    const sent = app.invokes.length;

    const search = app.document.getElementById('searchInput');
    for (const key of ['p', ' ', 'l', '2', 'ArrowRight', 'a', 'f']) {
        await app.press(key, { target: search });
    }
    assert.equal(app.invokes.length, sent, 'no command reached the backend');
    assert.equal(app.state('projectorOpen'), true);
    assert.equal(app.state('isBlank'), false);
    assert.equal(app.state('navPosition'), 0);
});

test('an open dialog swallows shortcuts until Escape closes it', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();

    await app.press('?');
    const modal = app.document.getElementById('shortcutsModal');
    assert.equal(modal.classList.contains('active'), true);

    await app.press('ArrowRight');
    await app.press(' ');
    await app.press('p');
    assert.equal(app.state('navPosition'), 0);
    assert.equal(app.state('isBlank'), false);
    assert.equal(app.state('projectorOpen'), true);

    await app.press('Escape');
    assert.equal(modal.classList.contains('active'), false);
    assert.equal(app.state('currentSong').id, amazingGrace.id, 'Escape closed the dialog, not the song');

    await app.press('ArrowRight');
    assert.equal(app.state('navPosition'), 1);
});

test('Cmd/Ctrl chords are not mistaken for bare keys', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.press('p', { metaKey: true });
    await app.press('l', { ctrlKey: true });
    await app.press(' ', { altKey: true });
    assert.equal(app.state('projectorOpen'), false);
    assert.equal(app.state('showLogo'), false);
    assert.equal(app.state('isBlank'), false);
});

test('/ focuses the library search', async () => {
    app = await bootApp({ songs });
    await app.press('/');
    assert.equal(app.document.activeElement, app.document.getElementById('searchInput'));
});
