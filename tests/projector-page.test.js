// The projector page: what the congregation sees for each message it is sent.
// (Font fitting needs real layout, which jsdom does not do; it is not covered here.)
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootProjector } = require('./helpers/boot');

let p;
afterEach(() => p?.close());

// "Cut" swaps text immediately; the default fade defers the swap by 240 ms.
const cut = { transition: { style: 'cut', durationMs: 0 } };
const slide = (overrides = {}) => ({
    text: 'Amazing grace, how sweet the sound', label: 'Verse 1', isBlank: false,
    title: 'Amazing Grace', author: 'John Newton', musical_key: 'G',
    songId: 1, songNumber: 12, verses: ['Amazing grace, how sweet the sound', 'My chains are gone'],
    hasPrev: false, hasNext: true, ...overrides,
});
const verse = (overrides = {}) => ({
    text: 'The LORD [is] my shepherd', label: '23:1', isBlank: false, isBible: true,
    title: 'Psalms 23:1', author: null, musical_key: null, songId: 'bible-19O-23', songNumber: null,
    verses: [], hasPrev: false, hasNext: false, ...overrides,
});
const rootVar = (name) => p.document.documentElement.style.getPropertyValue(name);
const el = (id) => p.document.getElementById(id);

test('a song slide shows its text, number, title, key and author', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', slide());
    assert.equal(p.text(), 'Amazing grace, how sweet the sound');
    assert.equal(el('titleColNumber').textContent, 'No.12');
    assert.equal(el('titleColTitle').textContent, 'Amazing Grace');
    assert.equal(el('titleColKey').textContent, 'KeyG');
    assert.equal(el('metaColAuthor').textContent, 'John Newton');
    assert.equal(p.has('songTitleBar', 'visible'), true);
    assert.equal(p.has('songMetaBar', 'visible'), true);
    assert.equal(p.has('blankScreen', 'active'), false);
});

test('a song without a key or author leaves those spaces empty', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', slide({ musical_key: null, author: null }));
    assert.equal(el('titleColKey').textContent, '');
    assert.equal(el('metaColAuthor').textContent, '');
    assert.equal(p.has('songMetaBar', 'visible'), true, 'the bar still holds the verse arrows');
});

test('the arrows show whether there is a slide before or after', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', slide({ hasPrev: false, hasNext: true }));
    assert.deepEqual([p.has('verseNavUp', 'visible'), p.has('verseNavDown', 'visible')], [false, true]);
    await p.send('update-lyrics', slide({ text: 'My chains are gone', hasPrev: true, hasNext: false }));
    assert.deepEqual([p.has('verseNavUp', 'visible'), p.has('verseNavDown', 'visible')], [true, false]);
});

test('moving to another verse replaces the text and keeps the song details', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', slide());
    await p.send('update-lyrics', slide({ text: 'My chains are gone', label: 'Chorus' }));
    assert.equal(p.text(), 'My chains are gone');
    assert.equal(el('titleColTitle').textContent, 'Amazing Grace');
});

test('blanking hides everything, and un-blanking brings the same slide back', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', slide());
    await p.send('update-lyrics', slide({ text: '', isBlank: true }));
    assert.equal(p.has('blankScreen', 'active'), true);
    assert.equal(p.has('songTitleBar', 'visible'), false);
    assert.equal(p.has('songMetaBar', 'visible'), false);
    assert.equal(p.has('verseNavDown', 'visible'), false);

    await p.send('update-lyrics', slide());
    assert.equal(p.has('blankScreen', 'active'), false);
    assert.equal(p.text(), 'Amazing grace, how sweet the sound');
});

test('with a fade, the new text appears part-way through the transition', async () => {
    p = await bootProjector({ settings: { transition: { style: 'fade', durationMs: 200 } } });
    await p.send('update-lyrics', slide());
    assert.equal(p.text(), '', 'the old (empty) slide is still fading out');
    assert.equal(p.document.querySelector('.lyrics-container').classList.contains('transitioning'), true);
    await p.sleep(160);
    assert.equal(p.text(), 'Amazing grace, how sweet the sound');
    assert.equal(p.document.querySelector('.lyrics-container').classList.contains('transitioning'), false);
});

test('rapid changes end on the last slide sent, never an earlier one', async () => {
    p = await bootProjector({ settings: { transition: { style: 'fade', durationMs: 200 } } });
    await p.send('update-lyrics', slide({ text: 'one' }));
    await p.send('update-lyrics', slide({ text: 'two' }));
    await p.send('update-lyrics', slide({ text: 'three' }));
    await p.sleep(200);
    assert.equal(p.text(), 'three');
});

// The race described in updateDisplay: a song's text swap is deferred for its
// fade. If scripture (set here to cut, so it swaps at once) arrives in that
// window, the song's late swap must be cancelled — otherwise the projector
// ends up showing the song's words under the scripture layout.
test('scripture sent straight after a song is what ends up on screen', async () => {
    const fade = { style: 'fade', durationMs: 200 };
    p = await bootProjector({ settings: {
        transition: fade,
        bible: { separate: true, transition: { style: 'cut', durationMs: 0 } },
    } });
    await p.send('update-lyrics', slide());
    await p.send('update-lyrics', verse());
    assert.equal(p.text(), 'The LORD is my shepherd');
    await p.sleep(200);                 // past the point the song's swap would have fired
    assert.equal(p.text(), 'The LORD is my shepherd');
    assert.equal(p.projectorHas('bible-mode'), true);
});

test('scripture shows the reference alone, with supplied words in italics', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', verse());
    assert.equal(p.html(), 'The LORD <em>is</em> my shepherd');
    assert.equal(el('titleColTitle').textContent, 'Psalms 23:1');
    assert.equal(el('titleColNumber').textContent, '');
    assert.equal(el('titleColKey').textContent, '');
    assert.equal(p.has('songMetaBar', 'visible'), false);
    assert.equal(p.has('verseNavUp', 'visible'), false);
    assert.equal(p.has('verseNavDown', 'visible'), false);
});

test('going from scripture back to a song restores the song layout', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', verse());
    await p.send('update-lyrics', slide());
    assert.equal(p.projectorHas('bible-mode'), false);
    assert.equal(el('titleColNumber').textContent, 'No.12');
    assert.equal(p.has('songMetaBar', 'visible'), true);
    assert.equal(p.html(), 'Amazing grace, how sweet the sound');
});

test('markup in song or scripture text is displayed, not executed', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', slide({
        text: '<img src=x onerror="window.__pwned=1">', title: '<b>T</b>', author: '<i>A</i>',
        musical_key: '<u>G</u>', songNumber: '<s>1</s>',
    }));
    assert.equal(p.document.querySelector('.projector img:not(#logoImage)'), null);
    assert.equal(p.text(), '<img src=x onerror="window.__pwned=1">');
    assert.equal(el('titleColTitle').textContent, '<b>T</b>');
    assert.equal(el('titleColKey').querySelector('u'), null);
    assert.equal(el('titleColNumber').querySelector('s'), null);
    assert.equal(el('metaColAuthor').querySelector('i'), null);

    await p.send('update-lyrics', verse({ text: 'a <script>x</script> [<b>y</b>]' }));
    assert.equal(el('lyricsText').querySelector('script, b'), null);
    assert.equal(p.window.__pwned, undefined);
});

test('a garbled message is ignored and the next good one still works', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', slide());
    for (const event of ['update-lyrics', 'apply-settings', 'show-logo', 'show-alert']) {
        await p.emitRaw(event, '{not json');
    }
    assert.deepEqual(p.pageErrors, []);
    await p.send('update-lyrics', slide({ text: 'still alive' }));
    assert.equal(p.text(), 'still alive');
});

// ── Logo and alert layers ────────────────────────────────────────────────────

test('the logo slide covers the song, with the image when one is set', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', slide());
    await p.send('show-logo', { show: true, image: 'crest one.png' });
    assert.equal(p.has('logoScreen', 'active'), true);
    assert.equal(p.projectorHas('logo-active'), true);
    assert.equal(el('logoImage').getAttribute('src'), 'axum://localhost/backgrounds/crest%20one.png');

    await p.send('show-logo', { show: true, image: null });
    assert.equal(el('logoImage').hasAttribute('src'), false);
    assert.equal(el('logoImage').style.display, 'none', 'no broken-image icon on a plain holding slide');

    await p.send('show-logo', { show: false, image: null });
    assert.equal(p.has('logoScreen', 'active'), false);
    assert.equal(p.text(), 'Amazing grace, how sweet the sound', 'the song is still underneath');
});

test('an alert stays up through slide changes and blanking until cleared', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('show-alert', { text: 'Parent of child 14 to the nursery' });
    assert.equal(p.has('alertBanner', 'active'), true);
    assert.equal(el('alertText').textContent, 'Parent of child 14 to the nursery');

    await p.send('update-lyrics', slide());
    await p.send('update-lyrics', slide({ text: '', isBlank: true }));
    await p.send('show-logo', { show: true, image: null });
    assert.equal(p.has('alertBanner', 'active'), true);

    await p.send('clear-alert');
    assert.equal(p.has('alertBanner', 'active'), false);
});

// ── Display settings ─────────────────────────────────────────────────────────

test('the projector loads its saved look on start-up', async () => {
    p = await bootProjector({ settings: {
        typography: { fontFamily: 'Lora', fontWeight: 700, alignment: 'left' },
        background: { kind: 'solid', color: '#101820' },
        layout: { showTitleBar: false, showMetaBar: true, safeAreaPct: 8 },
        transition: { style: 'fade', durationMs: 250 },
    } });
    assert.match(rootVar('--font-display'), /^'Lora'/);
    assert.equal(el('lyricsText').style.fontWeight, '700');
    assert.equal(el('lyricsText').style.textAlign, 'left');
    assert.equal(rootVar('--bg-color'), '#101820');
    assert.equal(rootVar('--safe-area'), '8vmin');
    assert.equal(rootVar('--trans-duration'), '250ms');
    assert.equal(p.projectorHas('layout-hide-title'), true);
    assert.equal(p.projectorHas('layout-hide-meta'), false);
    assert.equal(p.projectorHas('transition-fade'), true);
    assert.equal(p.projectorHas('transition-fade-up'), false);
});

test('settings pushed by the operator take effect live', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('apply-settings', {
        typography: { fontFamily: 'Inter', fontWeight: 500, alignment: 'center' },
        background: { kind: 'gradient', color: '#000000', gradient: { from: '#000000', to: '#223344', angle: 90 } },
        layout: { showTitleBar: true, showMetaBar: false, safeAreaPct: 3 },
        transition: { style: 'fade-up', durationMs: 400 },
    });
    assert.match(rootVar('--font-display'), /^'Inter'/);
    assert.match(p.document.querySelector('.projector').style.background, /linear-gradient\(90deg/);
    assert.equal(p.projectorHas('layout-hide-meta'), true);
    assert.equal(p.projectorHas('transition-cut'), false);
    assert.equal(p.projectorHas('transition-fade-up'), true);
});

test('an unknown font falls back to the default rather than breaking the display', async () => {
    p = await bootProjector({ settings: { typography: { fontFamily: 'Comic Sans' } } });
    assert.match(rootVar('--font-display'), /^'Montserrat'/);
});

test('the verse label is shown only when that option is on', async () => {
    p = await bootProjector({ settings: { ...cut, layout: { showVerseLabel: false } } });
    await p.send('update-lyrics', slide());
    assert.equal(p.has('verseLabel', 'visible'), false);

    await p.send('apply-settings', { ...cut, layout: { showVerseLabel: true } });
    assert.equal(p.has('verseLabel', 'visible'), true);
    assert.equal(el('verseLabel').textContent, 'Verse 1');

    await p.send('update-lyrics', slide({ text: 'My chains are gone', label: 'Chorus' }));
    assert.equal(el('verseLabel').textContent, 'Chorus');
});

test('scripture uses its own look only when the Bible profile is split off', async () => {
    const look = {
        ...cut,
        typography: { fontFamily: 'Montserrat', fontWeight: 600, alignment: 'center' },
        background: { kind: 'solid', color: '#000000' },
        layout: {},
        bible: {
            separate: false,
            typography: { fontFamily: 'EB Garamond', fontWeight: 400, alignment: 'left' },
            background: { kind: 'solid', color: '#1b2a3a' },
            layout: {}, transition: cut.transition,
        },
    };
    p = await bootProjector({ settings: look });
    await p.send('update-lyrics', verse());
    assert.match(rootVar('--font-display'), /^'Montserrat'/, 'mirroring: the song font');
    assert.equal(el('lyricsText').style.textAlign, 'left', 'but scripture keeps its own alignment');
    assert.equal(rootVar('--bg-color'), '#000000');

    await p.send('apply-settings', { ...look, bible: { ...look.bible, separate: true } });
    assert.match(rootVar('--font-display'), /^'EB Garamond'/);
    assert.equal(rootVar('--bg-color'), '#1b2a3a');

    await p.send('update-lyrics', slide());
    assert.match(rootVar('--font-display'), /^'Montserrat'/, 'songs are unaffected');
    assert.equal(el('lyricsText').style.textAlign, 'center');
    assert.equal(rootVar('--bg-color'), '#000000');
});

// ── The two ways the page is driven ──────────────────────────────────────────

test('as the operator\'s preview pane it is driven by posted messages', async () => {
    p = await bootProjector({ settings: cut, tauri: false });
    await p.post({ type: 'apply-settings', settings: cut });
    await p.post({ type: 'update-lyrics', ...slide() });
    assert.equal(p.text(), 'Amazing grace, how sweet the sound');
    await p.post({ type: 'show-alert', text: 'Hello' });
    assert.equal(p.has('alertBanner', 'active'), true);
    await p.post({ type: 'clear-alert' });
    assert.equal(p.has('alertBanner', 'active'), false);
    await p.post({ type: 'show-logo', show: true, image: null });
    assert.equal(p.has('logoScreen', 'active'), true);
});

test('messages that are not for it are ignored', async () => {
    p = await bootProjector({ settings: cut, tauri: false });
    await p.post({ type: 'update-lyrics', ...slide() });
    for (const junk of [null, 'update-lyrics', 42, {}, { type: 'something-else', text: 'x' }]) await p.post(junk);
    assert.equal(p.text(), 'Amazing grace, how sweet the sound');
    assert.deepEqual(p.pageErrors, []);
});

test('Escape closes the projector window', async () => {
    p = await bootProjector({ settings: cut });
    await p.press('Escape');
    assert.equal(p.closed.length, 1);
    await p.press('a');
    assert.equal(p.closed.length, 1);
});

// ── Line breaking ────────────────────────────────────────────────────────────

const breakLine = (line) => JSON.parse(p.eval(`JSON.stringify(bestBreakPoint(${JSON.stringify(line)}))`));

test('a long line is broken at punctuation near its middle', async () => {
    p = await bootProjector({ settings: cut });
    assert.deepEqual(
        breakLine('Amazing grace, how sweet the sound, that saved a wretch like me'),
        ['Amazing grace, how sweet the sound,', 'that saved a wretch like me']);
    assert.deepEqual(
        breakLine('I once was lost but now am found; was blind but now I see today'),
        ['I once was lost but now am found;', 'was blind but now I see today']);
});

test('short lines are left alone, and a break never leaves a stub', async () => {
    p = await bootProjector({ settings: cut });
    assert.equal(breakLine('Amazing grace, how sweet the sound'), null);
    assert.equal(breakLine('Supercalifragilisticexpialidocious-and-then-some-more-letters-to-be-long'), null);
    const [left, right] = breakLine('Oh, what a very long unpunctuated line of words this one happens to be');
    const share = left.length / (left.length + right.length);
    assert.equal(share > 0.3 && share < 0.7, true, `balanced halves, got ${left.length}/${right.length}`);
});
