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
    assert.equal(p.has('songTitleBar', 'visible'), true, 'the title comes back too');
    assert.equal(p.has('songMetaBar', 'visible'), true);
    assert.equal(el('titleColNumber').textContent, 'No.12');
    assert.equal(p.has('verseNavDown', 'visible'), true);
});

test('un-blanking scripture brings back its reference', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', verse());
    await p.send('update-lyrics', verse({ text: '', isBlank: true }));
    assert.equal(p.has('songTitleBar', 'visible'), false);

    await p.send('update-lyrics', verse());
    assert.equal(p.has('songTitleBar', 'visible'), true);
    assert.match(el('songTitleBar').textContent, /Psalms 23:1/);
    assert.equal(p.has('songMetaBar', 'visible'), false, 'scripture still has no meta bar');
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

// ---- Messages ------------------------------------------------------------------

// A message as the operator sends it: paragraphs 10 and 11 of 61-1231, with
// the first line of paragraph 10 at the top of the screen.
const LAMPS = ['The first lamp was lit. [The listeners say amen.]', 'The second lamp was lit.'];
const message = (scroll = {}, overrides = {}) => ({
    mode: 'message', label: '', isBlank: false, isBible: false, title: 'Lamps And Lanterns',
    footer: 'Lamps And Lanterns · 61-1231', songId: 'message-61-1231', songNumber: null, author: null,
    musical_key: null, hasPrev: false, hasNext: false,
    scroll: { first: 10, paragraphs: LAMPS, anchor: { paragraph: 10, offset: 0 }, jump: true, ...scroll },
    ...overrides,
});
const column = () => p.document.querySelector('#lyricsText .message-column');
const paragraphsShown = () => [...p.document.querySelectorAll('#lyricsText .message-para')].map(e => e.innerHTML);
const fading = () => p.document.querySelector('.lyrics-container').classList.contains('transitioning');

test('a message shows its paragraphs as one column, with its footer and no title bar', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', message());
    assert.equal(p.projectorHas('message-mode'), true);
    assert.equal(p.projectorHas('bible-mode'), false);
    assert.equal(p.has('songTitleBar', 'visible'), false);
    assert.equal(p.has('songMetaBar', 'visible'), true, 'the footer sits where the meta bar does');
    assert.equal(el('messageFooterText').textContent, 'Lamps And Lanterns · 61-1231');
    assert.equal(p.has('verseNavDown', 'visible'), false);
    assert.deepEqual(paragraphsShown(), [
        'The first lamp was lit. <span class="message-note">[The listeners say amen.]</span>',
        'The second lamp was lit.',
    ]);
});

test('a message\'s details go at the top in capitals, unless the settings say the foot or as written', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', message());
    assert.equal(el('messageFooterText').textContent, 'Lamps And Lanterns · 61-1231', 'the words as sent; capitals are the stylesheet\'s');
    assert.equal(p.projectorHas('message-details-top'), true, 'the top, by default');
    assert.equal(p.projectorHas('message-details-caps'), true, 'in capitals, by default');
    await p.send('apply-settings', { ...cut, message: { details: { position: 'bottom', caps: false } } });
    assert.equal(p.projectorHas('message-details-top'), false);
    assert.equal(p.projectorHas('message-details-caps'), false);
    await p.send('apply-settings', { ...cut, message: { details: { position: 'top', caps: true } } });
    assert.equal(p.projectorHas('message-details-top'), true);
    assert.equal(p.projectorHas('message-details-caps'), true);
});

test('notes in a message keep their brackets, and markup is shown, not run', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', message({ paragraphs: ['A <b>bold</b> claim & more. [Note <i>here</i>]', '[Never closed'] }));
    assert.equal(p.document.querySelector('#lyricsText b'), null);
    assert.deepEqual(paragraphsShown(), [
        'A &lt;b&gt;bold&lt;/b&gt; claim &amp; more. <span class="message-note">[Note &lt;i&gt;here&lt;/i&gt;]</span>',
        '<span class="message-note">[Never closed</span>',
    ]);
});

test("a paragraph's number rides beside it, and is no part of its text", async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', message({ numbers: [41, null] }));
    const [first, second] = p.document.querySelectorAll('#lyricsText .message-para');
    assert.equal(first.dataset.number, '41', 'drawn in the margin by the stylesheet');
    assert.equal(first.textContent, LAMPS[0], 'so lines break and are counted as without it');
    assert.equal(second.hasAttribute('data-number'), false, 'none given: none shown');

    await p.send('update-lyrics', message({ numbers: ['7"><b>x</b>', 12] }));
    assert.equal(p.document.querySelector('#lyricsText b'), null, 'a number is text, not markup');
    await p.send('update-lyrics', message());
    assert.equal(p.document.querySelector('#lyricsText [data-number]'), null, 'no numbers sent');
});

test('moving on within the paragraphs it has glides there, without fading or drawing them again', async () => {
    p = await bootProjector();                       // the default fade
    await p.send('update-lyrics', message());
    assert.equal(fading(), true, 'a message put on screen fades in, as a slide does');
    await p.sleep(300);
    const drawn = column();
    assert.ok(drawn);
    await p.send('update-lyrics', message({ anchor: { paragraph: 10, offset: 24 }, jump: false }));
    assert.equal(fading(), false);
    assert.equal(column(), drawn, 'the same column, moved');

    // On into paragraphs it was not sent before: drawn again, still without a fade.
    await p.send('update-lyrics', message({
        first: 11, paragraphs: [LAMPS[1], 'The third lamp was lit.'], anchor: { paragraph: 11, offset: 0 }, jump: false,
    }));
    assert.equal(fading(), false);
    assert.notEqual(column(), drawn);
    assert.deepEqual(paragraphsShown(), ['The second lamp was lit.', 'The third lamp was lit.']);
});

test('a jump within the message, or another message, fades to its place', async () => {
    p = await bootProjector();
    await p.send('update-lyrics', message());
    await p.sleep(300);
    await p.send('update-lyrics', message({ anchor: { paragraph: 11, offset: 0 }, jump: true }));
    assert.equal(fading(), true);
    await p.sleep(300);
    assert.equal(fading(), false);

    await p.send('update-lyrics', message({ first: 0, paragraphs: ['Another message.'], anchor: { paragraph: 0, offset: 0 },
        jump: false }, { songId: 'message-62-0101', footer: 'Another · 62-0101' }));
    assert.equal(fading(), true, 'another message, even sent as a move');
    await p.sleep(300);
    assert.deepEqual(paragraphsShown(), ['Another message.']);
    assert.equal(el('messageFooterText').textContent, 'Another · 62-0101');
});

test('moves sent while a fade is under way end on the last of them', async () => {
    p = await bootProjector();
    await p.send('update-lyrics', message());
    await p.send('update-lyrics', message({ first: 11, paragraphs: [LAMPS[1]], anchor: { paragraph: 11, offset: 0 }, jump: false }));
    await p.sleep(300);
    assert.deepEqual(paragraphsShown(), ['The second lamp was lit.']);
});

test('blanking a message hides it and its footer, and un-blanking draws it again at its place', async () => {
    p = await bootProjector();
    await p.send('update-lyrics', message());
    await p.sleep(300);
    await p.send('update-lyrics', message({}, { isBlank: true }));
    assert.equal(p.has('songMetaBar', 'visible'), false);
    assert.equal(p.projectorHas('message-mode'), false);
    // The operator sends what is live again, which may be a move.
    await p.send('update-lyrics', message({ anchor: { paragraph: 11, offset: 0 }, jump: false }));
    assert.equal(fading(), true, 'it comes back as a new slide, at its place, rather than gliding from the old one');
    await p.sleep(300);
    assert.equal(p.has('songMetaBar', 'visible'), true);
    assert.equal(p.projectorHas('message-mode'), true);
    assert.equal(paragraphsShown().length, 2);
});

test('going from a message back to a song or scripture restores their layouts', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', message());
    await p.send('update-lyrics', slide());
    assert.equal(p.projectorHas('message-mode'), false);
    assert.equal(p.has('songTitleBar', 'visible'), true);
    assert.equal(el('titleColTitle').textContent, 'Amazing Grace');
    assert.equal(p.text(), 'Amazing grace, how sweet the sound');

    await p.send('update-lyrics', message());
    await p.send('update-lyrics', verse());
    assert.equal(p.projectorHas('bible-mode'), true);
    assert.equal(p.has('songMetaBar', 'visible'), false);
    assert.equal(p.has('songTitleBar', 'visible'), true);
    assert.match(el('songTitleBar').textContent, /Psalms 23:1/);

    await p.send('update-lyrics', message());
    assert.equal(p.projectorHas('message-mode'), true);
    assert.equal(paragraphsShown().length, 2, 'and back to the message');
});

test('messages use the Bible\'s look until their own is split off', async () => {
    const settings = {
        ...cut, typography: { fontFamily: 'Inter' },
        bible: { separate: true, typography: { fontFamily: 'Lora', alignment: 'left' } },
    };
    p = await bootProjector({ settings });
    await p.send('update-lyrics', message());
    assert.match(rootVar('--font-display'), /Lora/, 'the same as scripture');

    await p.send('apply-settings', {
        ...settings, message: { separate: true, typography: { fontFamily: 'EB Garamond', alignment: 'center' } },
    });
    assert.match(rootVar('--font-display'), /EB Garamond/);
    assert.equal(el('lyricsText').style.textAlign, 'center');
    await p.send('update-lyrics', verse());
    assert.match(rootVar('--font-display'), /Lora/, 'scripture keeps its own');
});

test('message text is the size set for it, as a share of the screen height', async () => {
    p = await bootProjector({ settings: { ...cut, message: { fontPct: 5 } } });
    await p.send('update-lyrics', message());
    assert.equal(column().style.fontSize, '5vh');
    await p.send('apply-settings', { ...cut, message: { fontPct: 3.25 } });
    assert.equal(column().style.fontSize, '3.25vh', 'changed on screen');
    await p.send('apply-settings', { ...cut, message: { fontPct: 40 } });
    assert.equal(column().style.fontSize, '4.5vh', 'out of range: the default');
});

test('the operator can ask where lines break and how many fit', async () => {
    p = await bootProjector({ settings: cut });
    const measure = p.window.messageMeasure;
    measure.prepare({ ...cut, message: { separate: false } }, 'Lamps And Lanterns · 61-1231');
    // jsdom lays nothing out: no measurements, and a paragraph is one line.
    assert.equal(measure.metrics(), null);
    assert.deepEqual([...measure.lines('  Some words.')], [2]);
});

test('the projector window tells the operator its size; a preview does not', async () => {
    p = await bootProjector({ settings: cut });
    assert.deepEqual(p.emitted.filter(e => e.name === 'projector-size').at(-1)?.payload,
        { width: p.window.innerWidth, height: p.window.innerHeight });
    p.close();
    p = await bootProjector({ settings: cut, tauri: false });
    assert.deepEqual(p.emitted, []);
});

test('highlighted words are marked where they stand, and the text is otherwise as it was', async () => {
    p = await bootProjector({ settings: cut });
    // LAMPS[0]: "The first lamp was lit. [The listeners say amen.]": "lamp was" is 10–18, the note starts at 24.
    await p.send('update-lyrics', message({ marks: [[10, 10, 18], [10, 19, 28], [11, 0, 3]] }));
    assert.deepEqual(paragraphsShown(), [
        'The first <mark class="message-mark">lamp was</mark> ' +
            '<mark class="message-mark">lit. </mark><mark class="message-mark"><span class="message-note">[The</span></mark>' +
            '<span class="message-note"> listeners say amen.]</span>',
        '<mark class="message-mark">The</mark> second lamp was lit.',
    ]);
    assert.deepEqual([...column().children].map(e => e.textContent), LAMPS, 'not a character is added or lost');
});

test('a change of highlights is drawn in place: nothing else is redrawn, and only the new one fades in', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', message({ marks: [[10, 4, 9]] }));
    const [first, second] = column().children;
    assert.equal(first.querySelector('mark').className, 'message-mark', 'drawn with the slide, it does not fade in on its own');

    await p.send('update-lyrics', message({ marks: [[10, 4, 9], [11, 4, 10]], jump: false }));
    assert.equal(column().children[0], first, 'the same paragraphs, not drawn afresh');
    assert.equal(column().children[1], second);
    assert.equal(first.querySelector('mark').className, 'message-mark', 'the highlight already there is left alone');
    assert.equal(second.innerHTML, 'The <mark class="message-mark fresh">second</mark> lamp was lit.');

    await p.send('update-lyrics', message({ marks: [[10, 4, 9], [10, 15, 18], [11, 4, 10]], jump: false }));
    assert.deepEqual([...first.querySelectorAll('mark')].map(m => [m.textContent, m.classList.contains('fresh')]),
        [['first', false], ['was', true]]);

    await p.send('update-lyrics', message({ jump: false }));
    assert.equal(column().querySelector('mark'), null, 'taken off');
    assert.deepEqual(paragraphsShown(), [
        'The first lamp was lit. <span class="message-note">[The listeners say amen.]</span>',
        'The second lamp was lit.',
    ]);
});

test('highlights that make no sense are ignored', async () => {
    p = await bootProjector({ settings: cut });
    await p.send('update-lyrics', message({ marks: [[10, 9, 4], [10, 'a', 3], null, [10], [99, 0, 5], [11, 20, 500]] }));
    assert.deepEqual(paragraphsShown(), [
        'The first lamp was lit. <span class="message-note">[The listeners say amen.]</span>',
        'The second lamp was <mark class="message-mark">lit.</mark>',
    ]);
});

test('the projector window passes the wheel and the keys on to the operator', async () => {
    p = await bootProjector({ settings: cut });
    const inputs = () => p.emitted.filter(e => e.name === 'projector-input').map(e => e.payload);
    const key = (init) => {
        const e = new p.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        p.document.dispatchEvent(e);
        return e.defaultPrevented;
    };
    const wheel = (deltaY, init = {}) => {
        const e = new p.window.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init });
        p.document.body.dispatchEvent(e);
        return e.defaultPrevented;
    };
    assert.equal(key({ key: 'ArrowRight' }), true);
    assert.equal(key({ key: 'ArrowDown', shiftKey: true, repeat: true }), true);
    assert.equal(key({ key: 'Shift' }), false, 'a modifier on its own is nothing');
    assert.equal(key({ key: 'q', metaKey: true }), false, 'the system keeps its own shortcuts');
    assert.deepEqual(inputs(), [
        { key: 'ArrowRight', shift: false, repeat: false },
        { key: 'ArrowDown', shift: true, repeat: true },
    ]);
    key({ key: 'Escape' });
    assert.equal(p.closed.length, 1, 'Escape still closes the window');
    assert.equal(inputs().length, 2, 'and is not passed on');

    // The wheel is passed on only while a message is on screen, a frame's worth at a time.
    assert.equal(wheel(30), true, 'the page itself never scrolls');
    await p.sleep(40);
    assert.equal(inputs().length, 2);
    await p.send('update-lyrics', {
        mode: 'message', songId: 'message-1', title: 'A message', footer: 'A message',
        scroll: { first: 0, paragraphs: ['One.', 'Two.'], numbers: [1, 2], anchor: { paragraph: 0, offset: 0 }, jump: true },
    });
    wheel(30);
    wheel(12.5);
    await p.sleep(40);
    assert.deepEqual(inputs()[2], { wheel: 42.5 });
    wheel(-3, { deltaMode: 1 });
    await p.sleep(40);
    assert.ok(inputs()[3].wheel < -3, 'a wheel that counts in lines is turned into px');
});

test('a preview or measuring copy of the projector page keeps the wheel and keys to itself', async () => {
    p = await bootProjector({ settings: cut, tauri: false });
    const e = new p.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    p.document.dispatchEvent(e);
    assert.equal(e.defaultPrevented, false);
    const w = new p.window.WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true });
    p.document.body.dispatchEvent(w);
    assert.equal(w.defaultPrevented, false);
});
