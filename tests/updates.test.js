// Checking for, downloading and installing a new version.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

// Stand-in for the Tauri updater plugin. `log` records what it was asked to do.
function fakeUpdater({ version = '9.9.9', none = false, checkFails = false, downloadFails = false, installFails = false } = {}) {
    const log = [];
    return {
        log,
        async check() {
            log.push('check');
            if (checkFails) throw new Error('manifest unreachable');
            if (none) return null;
            return {
                version, available: true,
                async download(onEvent) {
                    if (downloadFails) throw new Error('connection reset');
                    onEvent({ event: 'Started', data: { contentLength: 200 } });
                    onEvent({ event: 'Progress', data: { chunkLength: 50 } });
                    onEvent({ event: 'Progress', data: { chunkLength: 150 } });
                    onEvent({ event: 'Finished' });
                    log.push('download');
                },
                async install() {
                    if (installFails) throw new Error('read-only volume');
                    log.push('install');
                },
            };
        },
    };
}

const status = () => app.document.getElementById('updateStatus').textContent;
const actionButton = () => app.document.querySelector('#updateAction button');
const hasDot = () => app.document.getElementById('aboutBtn').classList.contains('has-update');
const stage = () => app.eval('updateFlow.stage');
const check = async (opts = '') => { await app.eval(`checkForUpdates(${opts})`); await app.settle(); };

test('the launch check announces a new version without downloading it', async () => {
    const updater = fakeUpdater();
    app = await bootApp({ songs, updater });
    await check('{ silent: true }');

    assert.match(app.document.getElementById('toast').textContent, /HymnBeam 9\.9\.9 is available/);
    assert.equal(hasDot(), true);
    assert.equal(actionButton().textContent, 'Install update');
    assert.match(status(), /Version 9\.9\.9 is available — you have 0\.5\.1/);
    assert.deepEqual(updater.log, ['check']);
});

test('the launch check is silent when already up to date', async () => {
    app = await bootApp({ songs, updater: fakeUpdater({ none: true }) });
    await check('{ silent: true }');
    assert.equal(status(), '');
    assert.equal(hasDot(), false);
    assert.equal(app.document.getElementById('toast').classList.contains('visible'), false);
});

test('a manual check says when the app is up to date', async () => {
    app = await bootApp({ songs, updater: fakeUpdater({ none: true }) });
    await check();
    assert.match(status(), /up to date \(version 0\.5\.1\)/);
});

test('Install update downloads, installs and relaunches', async () => {
    const updater = fakeUpdater();
    app = await bootApp({ songs, updater });
    await check();
    await app.click(actionButton());
    await app.until(() => app.relaunches.length === 1, 'the app to relaunch');
    assert.deepEqual(updater.log, ['check', 'download', 'install']);
});

test('with the projector open the update waits instead of restarting', async () => {
    const updater = fakeUpdater();
    app = await bootApp({ songs, updater });
    await app.openProjector();
    await check();
    await app.click(actionButton());
    await app.until(() => stage() === 'ready', 'the download to finish');

    assert.deepEqual(updater.log, ['check', 'download']);
    assert.equal(actionButton().textContent, 'Restart to finish updating');

    // Checking again must not throw the downloaded update away.
    await check();
    assert.equal(stage(), 'ready');

    // Asking to restart while still projecting is refused.
    await app.click(actionButton());
    assert.match(status(), /Close the projector first/);
    assert.deepEqual(updater.log, ['check', 'download']);
    assert.equal(app.relaunches.length, 0);

    await app.press('p');
    await app.until(() => app.state('projectorOpen') === false, 'the projector to close');
    await app.click(actionButton());
    await app.until(() => app.relaunches.length === 1, 'the app to relaunch');
    assert.deepEqual(updater.log, ['check', 'download', 'install']);
});

test('a failed plugin check falls back to a browser download', async () => {
    app = await bootApp({
        songs,
        updater: fakeUpdater({ checkFails: true }),
        latestRelease: {
            tag_name: 'v0.6.0', html_url: 'https://example.test/release',
            assets: [
                { name: 'HymnBeam_0.6.0_universal.dmg', browser_download_url: 'https://example.test/app.dmg' },
                { name: 'HymnBeam_0.6.0_x64-setup.exe', browser_download_url: 'https://example.test/app.exe' },
            ],
        },
    });
    await check();
    assert.equal(stage(), 'manual');
    assert.equal(actionButton().textContent, 'Download update');
    assert.match(app.eval('updateFlow.manualUrl'), /app\.(dmg|exe)$/);

    await app.click(actionButton());
    const opened = app.invokes.find(i => i.cmd === 'open_external');
    assert.equal(opened.args.url, app.eval('updateFlow.manualUrl'));
});

test('the fallback does not offer the version already installed', async () => {
    app = await bootApp({
        songs, updater: fakeUpdater({ checkFails: true }),
        latestRelease: { tag_name: 'v0.5.1', html_url: 'https://example.test/release', assets: [] },
    });
    await check();
    assert.match(status(), /up to date/);
    assert.equal(actionButton(), null);
});

test('being offline is reported on a manual check and ignored at launch', async () => {
    app = await bootApp({ songs, updater: fakeUpdater({ checkFails: true }) });
    await check('{ silent: true }');
    assert.equal(status(), '');
    await check();
    assert.match(status(), /Could not check for updates/);
    assert.equal(app.document.getElementById('checkUpdateBtn').disabled, false);
});

test('a failed download can be retried', async () => {
    app = await bootApp({ songs, updater: fakeUpdater({ downloadFails: true }) });
    await check();
    await app.click(actionButton());
    await app.until(() => stage() === 'error', 'the download to fail');
    assert.match(status(), /could not be downloaded/);
    assert.equal(app.document.getElementById('checkUpdateBtn').disabled, false);
    assert.equal(app.relaunches.length, 0);
});

test('a failed install points at the release page', async () => {
    app = await bootApp({ songs, updater: fakeUpdater({ installFails: true }) });
    await check();
    await app.click(actionButton());
    await app.until(() => stage() === 'manual', 'the install to fail');
    assert.match(app.eval('updateFlow.manualUrl'), /releases\/latest$/);
    assert.equal(actionButton().textContent, 'Download update');
    assert.equal(app.relaunches.length, 0);
});

test('version comparison is numeric, not alphabetical', async () => {
    app = await bootApp({ songs });
    const newer = (a, b) => app.eval(`isNewerVersion(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
    assert.equal(newer('0.10.0', '0.9.9'), true);
    assert.equal(newer('v1.0.0', '0.99.99'), true);
    assert.equal(newer('0.5.1', '0.5.1'), false);
    assert.equal(newer('0.5.0', '0.5.1'), false);
    assert.equal(newer('0.5.1.1', '0.5.1'), true);
});

test('opening About keeps a pending update on show', async () => {
    app = await bootApp({ songs, updater: fakeUpdater() });
    await check('{ silent: true }');
    await app.click('#aboutBtn');
    assert.equal(app.document.getElementById('aboutModal').classList.contains('active'), true);
    assert.equal(actionButton().textContent, 'Install update');
    assert.equal(app.document.getElementById('aboutVersion').textContent, 'Version 0.5.1');
});
