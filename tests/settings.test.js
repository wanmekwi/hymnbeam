// Display settings: what the dialog changes, what reaches the projector, what is saved.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

const settings = () => app.state('settings');
const pushed = () => app.projected('apply-settings').at(-1);
const saved = () => app.sent('PUT /settings').at(-1);
const active = (group) => app.$(`#${group} button.active`).dataset.value;
const pick = (group, value) => app.click(`#${group} button[data-value="${value}"]`);
const hidden = (id) => app.$(`#${id}`).classList.contains('hidden');
// Images go to the backend over IPC (see uploadBackgroundImage); it answers with the stored name.
const imageStore = { save_background_image: ({ filename }) => `stored-${filename}` };
const uploads = () => app.invokes.filter(i => i.cmd === 'save_background_image').map(i => i.args);
// Saving is debounced by 250 ms.
const waitForSave = (count = 1) =>
    app.until(() => app.sent('PUT /settings').length >= count, 'the settings to be saved');

async function openSettings(options = {}) {
    app = await bootApp({ songs, commands: imageStore, ...options });
    await app.openProjector();
    await app.click('#settingsBtn');
    assert.equal(app.$('#settingsModal').classList.contains('active'), true);
}

test('with nothing saved the defaults are used', async () => {
    app = await bootApp({ songs });
    const s = settings();
    assert.equal(s.typography.fontFamily, 'Montserrat');
    assert.equal(s.typography.alignment, 'center');
    assert.equal(s.background.kind, 'solid');
    assert.equal(s.bible.separate, false);
    assert.equal(s.bible.typography.alignment, 'left', 'scripture reads flush-left by default');
});

test('saved settings are loaded, and anything they lack falls back to the default', async () => {
    // As written by an older version: no `bible`, no `logo`, no autoBreakLines.
    app = await bootApp({
        songs,
        settings: {
            typography: { fontFamily: 'Lora', fontWeight: 700 },
            background: { kind: 'gradient', gradient: { from: '#112233' } },
            layout: { showTitleBar: false },
        },
    });
    const s = settings();
    assert.deepEqual(s.typography, { fontFamily: 'Lora', fontWeight: 700, alignment: 'center' });
    assert.equal(s.background.kind, 'gradient');
    assert.deepEqual(s.background.gradient, { from: '#112233', to: '#1a1a2e', angle: 180 });
    assert.equal(s.background.image.dim, 0.4);
    assert.equal(s.layout.showTitleBar, false);
    assert.equal(s.layout.autoBreakLines, true);
    assert.equal(s.layout.safeAreaPct, 5);
    assert.deepEqual(s.logo, { image: null });
    assert.equal(s.bible.separate, false);
});

test('if settings cannot be loaded the app still starts, on defaults', async () => {
    app = await bootApp({ songs, failing: [/^GET \/settings$/] });
    assert.equal(settings().typography.fontFamily, 'Montserrat');
    assert.equal(app.$$('.song-item').length, 3);
});

test('the dialog opens showing the current values', async () => {
    await openSettings({ settings: {
        typography: { fontFamily: 'Inter', fontWeight: 500, alignment: 'left' },
        background: { kind: 'gradient', color: '#101010', gradient: { from: '#000000', to: '#333333', angle: 90 } },
        layout: { showVerseLabel: true, safeAreaPct: 8 },
        transition: { style: 'cut', durationMs: 200 },
    } });
    assert.equal(app.$('#setFontFamily').value, 'Inter');
    assert.equal(app.$('#setFontWeightValue').textContent, '500');
    assert.equal(active('setAlignment'), 'left');
    assert.equal(active('setBgKind'), 'gradient');
    assert.equal(hidden('setBgGradientGroup'), false);
    assert.equal(hidden('setBgSolidGroup'), true);
    assert.equal(app.$('#setBgGradAngleValue').textContent, '90°');
    assert.equal(app.$('#setShowVerseLabel').checked, true);
    assert.equal(app.$('#setSafeAreaValue').textContent, '8%');
    assert.equal(active('setTransStyle'), 'cut');
    assert.equal(app.$('#setTransDurationValue').textContent, '200 ms');
});

test('a change goes to the projector at once and is saved shortly after', async () => {
    await openSettings();
    await app.type('#setFontFamily', 'Lora', 'change');
    assert.equal(pushed().typography.fontFamily, 'Lora', 'the congregation sees it immediately');
    assert.equal(saved(), undefined, 'but the save waits for the operator to stop adjusting');
    await waitForSave();
    assert.equal(saved().typography.fontFamily, 'Lora');
    assert.equal(app.backend.settings.typography.fontFamily, 'Lora');
});

test('dragging a slider saves once, with the final value', async () => {
    await openSettings();
    for (const weight of ['600', '500', '400', '500', '700']) await app.type('#setFontWeight', weight);
    assert.equal(app.$('#setFontWeightValue').textContent, '700');
    await waitForSave();
    await app.sleep(300);
    assert.equal(app.sent('PUT /settings').length, 1);
    assert.equal(saved().typography.fontWeight, 700);
    assert.equal(pushed().typography.fontWeight, 700);
});

test('every control writes the setting it is labelled with', async () => {
    await openSettings();
    await pick('setAlignment', 'left');
    await pick('setBgKind', 'gradient');
    await app.type('#setBgGradFrom', '#102030');
    await app.type('#setBgGradTo', '#405060');
    await app.type('#setBgGradAngle', '45');
    await app.type('#setBgColor', '#0a0a0a');
    await app.type('#setBgImageDim', '65');
    await app.check('#setShowTitleBar', false);
    await app.check('#setShowMetaBar', false);
    await app.check('#setShowVerseLabel', true);
    await app.check('#setAutoBreakLines', false);
    await app.type('#setSafeArea', '9');
    await pick('setTransStyle', 'fade');
    await app.type('#setTransDuration', '750');

    const s = pushed();
    assert.equal(s.typography.alignment, 'left');
    assert.deepEqual(s.background.gradient, { from: '#102030', to: '#405060', angle: 45 });
    assert.equal(s.background.kind, 'gradient');
    assert.equal(s.background.color, '#0a0a0a');
    assert.equal(s.background.image.dim, 0.65);
    assert.deepEqual(s.layout, { showTitleBar: false, showMetaBar: false, showVerseLabel: true, autoBreakLines: false, safeAreaPct: 9 });
    assert.deepEqual(s.transition, { style: 'fade', durationMs: 750 });
});

test('choosing a background kind shows only that kind\'s controls', async () => {
    await openSettings();
    for (const [kind, shown] of [['gradient', 'setBgGradientGroup'], ['image', 'setBgImageGroup'], ['solid', 'setBgSolidGroup']]) {
        await pick('setBgKind', kind);
        for (const group of ['setBgSolidGroup', 'setBgGradientGroup', 'setBgImageGroup']) {
            assert.equal(hidden(group), group !== shown, `${group} while ${kind}`);
        }
    }
});

test('uploading a background image switches to it; removing it falls back to solid', async () => {
    await openSettings();
    await app.chooseFile('#setBgImageInput', 'sunrise.jpg', 'pixels');
    await app.until(() => uploads().length === 1, 'the image to upload');
    await app.settle(20);
    assert.deepEqual(uploads(), [{ filename: 'sunrise.jpg', dataBase64: Buffer.from('pixels').toString('base64') }]);
    assert.equal(pushed().background.kind, 'image');
    assert.equal(pushed().background.image.filename, 'stored-sunrise.jpg');

    await app.click('#setBgImageRemoveBtn');
    assert.equal(pushed().background.kind, 'solid');
    assert.equal(pushed().background.image.filename, null);
});

test('a failed image upload is reported and changes nothing', async () => {
    await openSettings({ commands: { save_background_image: () => { throw 'disk full'; } } });
    await app.chooseFile('#setBgImageInput', 'sunrise.jpg');
    await app.until(() => app.toast() === 'Image upload failed', 'the failure to be reported');
    assert.equal(settings().background.kind, 'solid');
});

test('changing the logo image updates a logo slide that is already showing', async () => {
    await openSettings();
    await app.click('#settingsDoneBtn');
    await app.press('l');
    await app.click('#settingsBtn');
    await app.chooseFile('#setLogoImageInput', 'crest.png');
    await app.until(() => uploads().length === 1, 'the image to upload');
    await app.settle(20);
    assert.deepEqual(app.projected('show-logo').at(-1), { show: true, image: 'stored-crest.png' });

    await app.click('#setLogoImageRemoveBtn');
    assert.deepEqual(app.projected('show-logo').at(-1), { show: true, image: null });
    assert.equal(settings().logo.image, null);
});

test('Reset puts everything back to the defaults', async () => {
    await openSettings({ settings: { typography: { fontFamily: 'Lora' }, bible: { separate: true, initialized: true } } });
    await app.click('#settingsResetBtn');
    assert.equal(app.$('#setFontFamily').value, 'Montserrat');
    assert.equal(pushed().typography.fontFamily, 'Montserrat');
    assert.equal(pushed().bible.separate, false);
    await waitForSave();
    assert.equal(saved().typography.fontFamily, 'Montserrat');
});

test('nothing is pushed to a projector that is not open, but it is still saved', async () => {
    app = await bootApp({ songs });
    await app.click('#settingsBtn');
    await app.type('#setFontFamily', 'Inter', 'change');
    assert.deepEqual(app.projected('apply-settings'), []);
    await waitForSave();
    assert.equal(saved().typography.fontFamily, 'Inter');
});

test('the Settings menu item and Escape open and close the dialog', async () => {
    app = await bootApp({ songs });
    await app.emit('open-settings');
    assert.equal(app.$('#settingsModal').classList.contains('active'), true);
    await app.press('Escape');
    assert.equal(app.$('#settingsModal').classList.contains('active'), false);
});

// ── The separate Bible profile ───────────────────────────────────────────────

test('Bible display mirrors the songs until it is split off', async () => {
    await openSettings({ settings: { typography: { fontFamily: 'Lora', fontWeight: 700, alignment: 'center' } } });
    await pick('setDisplayTarget', 'bible');
    assert.equal(app.$('#setBibleSameAsSongs').checked, true);
    assert.equal(app.$('.settings-content').classList.contains('display-locked'), true);
    assert.equal(app.$('#setFontFamily').value, 'Lora', 'it shows the song look it is mirroring');
    assert.equal(hidden('setLogoGroup'), true, 'the logo is shared, not per-profile');
    assert.equal(hidden('bibleMatchSongBtn'), true);
});

test('scripture alignment is its own setting even while mirroring', async () => {
    await openSettings();
    await pick('setDisplayTarget', 'bible');
    assert.equal(active('setAlignment'), 'left');
    await pick('setAlignment', 'center');
    assert.equal(pushed().bible.typography.alignment, 'center');
    assert.equal(pushed().bible.separate, false, 'changing it does not split the profile off');

    await pick('setDisplayTarget', 'song');
    await pick('setAlignment', 'left');
    assert.equal(pushed().typography.alignment, 'left');
    assert.equal(pushed().bible.typography.alignment, 'center', 'each profile keeps its own');
});

test('splitting the Bible off starts it as a copy of the songs, keeping its alignment', async () => {
    await openSettings({ settings: {
        typography: { fontFamily: 'Lora', fontWeight: 700, alignment: 'center' },
        background: { kind: 'gradient' },
    } });
    await pick('setDisplayTarget', 'bible');
    await app.check('#setBibleSameAsSongs', false);

    const b = pushed().bible;
    assert.equal(b.separate, true);
    assert.equal(b.initialized, true);
    assert.equal(b.typography.fontFamily, 'Lora');
    assert.equal(b.typography.fontWeight, 700);
    assert.equal(b.typography.alignment, 'left');
    assert.equal(b.background.kind, 'gradient');
    assert.equal(app.$('.settings-content').classList.contains('display-locked'), false);
    assert.equal(hidden('bibleMatchSongBtn'), false);
});

test('once split, Bible changes leave the songs alone and vice versa', async () => {
    await openSettings();
    await pick('setDisplayTarget', 'bible');
    await app.check('#setBibleSameAsSongs', false);
    await app.type('#setFontFamily', 'EB Garamond', 'change');
    await pick('setBgKind', 'gradient');
    assert.equal(pushed().bible.typography.fontFamily, 'EB Garamond');
    assert.equal(pushed().bible.background.kind, 'gradient');
    assert.equal(pushed().typography.fontFamily, 'Montserrat');
    assert.equal(pushed().background.kind, 'solid');

    await pick('setDisplayTarget', 'song');
    assert.equal(app.$('#setFontFamily').value, 'Montserrat');
    await app.type('#setFontFamily', 'Inter', 'change');
    assert.equal(pushed().typography.fontFamily, 'Inter');
    assert.equal(pushed().bible.typography.fontFamily, 'EB Garamond');
});

test('a customised Bible profile is kept when mirroring is switched on and off again', async () => {
    await openSettings();
    await pick('setDisplayTarget', 'bible');
    await app.check('#setBibleSameAsSongs', false);
    await app.type('#setFontFamily', 'EB Garamond', 'change');
    await app.check('#setBibleSameAsSongs', true);
    assert.equal(pushed().bible.separate, false);
    await app.check('#setBibleSameAsSongs', false);
    assert.equal(pushed().bible.typography.fontFamily, 'EB Garamond', 'not re-seeded from the songs');
});

test('"Match song settings" copies the song look across on request', async () => {
    await openSettings();
    await pick('setDisplayTarget', 'bible');
    await app.check('#setBibleSameAsSongs', false);
    await app.type('#setFontFamily', 'EB Garamond', 'change');
    await app.click('#bibleMatchSongBtn');
    assert.equal(pushed().bible.typography.fontFamily, 'Montserrat');
    assert.equal(pushed().typography.alignment, 'center');
    assert.equal(pushed().bible.typography.alignment, 'left', 'scripture keeps its own alignment');
    assert.equal(app.$('#setFontFamily').value, 'Montserrat');
});

test('the dialog always reopens on the Songs profile', async () => {
    await openSettings();
    await pick('setDisplayTarget', 'bible');
    await app.click('#settingsDoneBtn');
    await app.click('#settingsBtn');
    assert.equal(active('setDisplayTarget'), 'song');
    assert.equal(hidden('bibleTargetOptions'), true);
});
