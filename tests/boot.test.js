const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

test('the operator window starts and lists the library', async () => {
    app = await bootApp({ songs });
    assert.deepEqual(app.pageErrors, []);
    assert.deepEqual(app.unhandledRequests, []);
    assert.equal(app.document.querySelectorAll('.song-item').length, 3);
    assert.equal(app.document.getElementById('songCount').textContent, '3 songs');
});
