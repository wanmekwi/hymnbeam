// Opening and closing the output, and the blank / logo screen states.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, amazingGrace } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

const commands = () => app.invokes.map(i => i.cmd);

test('nothing is sent to the projector while it is closed', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.press('ArrowRight');
    await app.press(' ');
    await app.press('l');
    assert.equal(commands().includes('send_to_projector'), false);
});

test('opening the projector pushes the slide the operator is already on', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.press('ArrowRight');
    await app.openProjector();
    assert.equal(app.onScreen().label, 'Chorus');
    assert.equal(app.projected('apply-settings').length > 0, true, 'display settings are pushed too');
});

test('F opens the projector but never closes it', async () => {
    app = await bootApp({ songs });
    await app.openProjector();
    await app.press('f');
    await app.press('F');
    assert.equal(app.state('projectorOpen'), true);
    assert.equal(commands().includes('close_projector_window'), false);
    assert.equal(commands().filter(c => c === 'open_projector_window').length, 1);
});

test('P toggles the projector and the header button follows', async () => {
    app = await bootApp({ songs });
    const button = app.document.getElementById('projectorBtn');
    await app.press('p');
    await app.until(() => app.state('projectorOpen') === true, 'projector to open');
    assert.match(button.textContent, /Close Projector/);
    await app.press('p');
    await app.until(() => app.state('projectorOpen') === false, 'projector to close');
    assert.match(button.textContent, /Open Projector/);
    assert.deepEqual(commands().filter(c => c.endsWith('_projector_window')),
        ['open_projector_window', 'close_projector_window']);
});

test('closing the projector window itself resets the operator', async () => {
    app = await bootApp({ songs });
    await app.openProjector();
    await app.emit('projector-closed');
    assert.equal(app.state('projectorOpen'), false);
    assert.match(app.document.getElementById('projectorBtn').textContent, /Open Projector/);
});

test('Space blanks the screen and Space again restores the same slide', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();
    await app.press('ArrowRight');

    await app.press(' ');
    assert.equal(app.onScreen().isBlank, true);
    assert.equal(app.onScreen().text, '');
    assert.equal(app.document.getElementById('blankBtn').classList.contains('active'), true);

    await app.press(' ');
    assert.equal(app.onScreen().isBlank, false);
    assert.equal(app.onScreen().text, amazingGrace.verses[1].text);
});

test('the logo slide and blank are mutually exclusive', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();

    await app.press('l');
    assert.equal(app.projected('show-logo').at(-1).show, true);

    await app.press(' ');
    assert.equal(app.state('isBlank'), true);
    assert.equal(app.state('showLogo'), false);
    assert.equal(app.projected('show-logo').at(-1).show, false);

    await app.press('l');
    assert.equal(app.state('showLogo'), true);
    assert.equal(app.state('isBlank'), false);
    assert.equal(app.onScreen().isBlank, false);
});

test('the logo slide works before any song is chosen', async () => {
    app = await bootApp({ songs });
    await app.openProjector();
    await app.press('l');
    assert.equal(app.projected('show-logo').at(-1).show, true);
});
