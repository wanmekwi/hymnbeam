// The announcement banner, and the order Escape peels things off the screen.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, amazingGrace } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

async function showAlert(text) {
    await app.press('a');
    const input = app.document.getElementById('alertInput');
    input.value = text;
    await app.press('Enter', { target: input });
}

test('an alert is sent to the projector and the operator sees it is live', async () => {
    app = await bootApp({ songs });
    await app.openProjector();
    await showAlert('Parent of child 14 to the nursery');
    assert.deepEqual(app.projected('show-alert'), [{ text: 'Parent of child 14 to the nursery' }]);
    assert.equal(app.document.getElementById('alertLiveDot').classList.contains('visible'), true);
    assert.equal(app.document.getElementById('alertPopover').classList.contains('open'), false);
});

test('an empty alert is not sent', async () => {
    app = await bootApp({ songs });
    await app.openProjector();
    await showAlert('   ');
    assert.deepEqual(app.projected('show-alert'), []);
});

test('Shift+A clears the alert', async () => {
    app = await bootApp({ songs });
    await app.openProjector();
    await showAlert('Car lights on');
    await app.press('A', { shiftKey: true });
    assert.equal(app.projected('clear-alert').length, 1);
    assert.equal(app.document.getElementById('alertLiveDot').classList.contains('visible'), false);
});

test('Escape clears the alert first and only then the song', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();
    await showAlert('Car lights on');

    await app.press('Escape');
    assert.equal(app.projected('clear-alert').length, 1);
    assert.equal(app.state('currentSong').id, amazingGrace.id, 'the song survives the first Escape');

    await app.press('Escape');
    assert.equal(app.state('currentSong'), null);
});

test('a live alert is re-sent when the projector is reopened', async () => {
    app = await bootApp({ songs });
    await app.openProjector();
    await showAlert('Service starts in 5 minutes');
    await app.press('p');
    await app.until(() => app.state('projectorOpen') === false, 'projector to close');
    await app.openProjector();
    assert.equal(app.projected('show-alert').length, 2);
});

test('an alert raised while the projector is closed appears when it opens', async () => {
    app = await bootApp({ songs });
    await showAlert('Welcome');
    assert.deepEqual(app.projected('show-alert'), []);
    await app.openProjector();
    assert.deepEqual(app.projected('show-alert'), [{ text: 'Welcome' }]);
});
