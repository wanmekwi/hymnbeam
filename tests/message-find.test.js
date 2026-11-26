// Find in the open message: a second box, under the reader's title, that
// searches only the message open in it, for when the preacher skips ahead.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

// A made-up library of its own. 62-0000 has the phrase in three paragraphs,
// one of them numbered twice, and its words apart in another; 62-0001 has the
// phrase too, so a find that strayed out of the open message would show it.
const work = (code, title, sort) => ({
    code, kind: 'message', collection: null, title, chapter: null, location: 'Riverton OH', year: 1962, sort,
});
const paragraph = (id, number, text) => ({ id, number, text });
const library = {
    status: {
        installed: true, tab_label: 'The Test Tab', book_collection: null, book_title: null,
        language: 'en', built_at: '2026-11-20T10:00:00Z', numbering_id: 'test',
        message_count: 3, book_chapter_count: 0, paragraph_count: 113,
    },
    works: [work('62-0000', 'The Lamb In The Field', 1), work('62-0001', 'The Shepherd', 2), work('62-0002', 'Many Lambs', 3)],
    paragraphs: {
        '62-0000': [
            paragraph(101, 1, 'The lamb was found in the field.'),
            paragraph(102, 2, 'He said the lamb of God takes away sin.'),
            paragraph(103, 3, 'Behold the lamb of God, the shepherd cried.'),
            paragraph(104, 3, 'In 1963 the lamb of God was preached again.'),
            paragraph(105, 4, 'God sent a lamb, of all things, to the shepherd.'),
            paragraph(106, 5, 'Let us bow our heads.'),
        ],
        '62-0001': [
            paragraph(201, 1, 'The shepherd spoke of the lamb of God.'),
            // Two lines at the stand-in's 40 characters, the words looked for on the second.
            paragraph(202, 2, 'He counted every one of them at dusk, and then found the lost lamb by the river.'),
            // Enough after it that it can be brought to the top of the screen.
            paragraph(203, 3, 'Then he carried it home.'),
            paragraph(204, 4, 'And there was joy in the house.'),
            paragraph(205, 5, 'Let us bow our heads.'),
            paragraph(206, 6, 'Amen.'),
        ],
        // More paragraphs holding a word than the back end gives at once.
        '62-0002': Array.from({ length: 102 }, (_, i) => paragraph(300 + i, i + 1, `A lamb in the fold, number ${i + 1}.`)),
    },
};

// Stands in for the measuring copy of the projector page: lines of up to 40
// characters, 10 px apart, in a screen 60 px high.
function lineStarts(text, perLine = 40) {
    const starts = [0];
    let lineStart = 0;
    let lastSpace = -1;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') lastSpace = i;
        if (i - lineStart >= perLine && lastSpace > lineStart) {
            starts.push(lastSpace + 1);
            lineStart = lastSpace + 1;
            lastSpace = -1;
        }
    }
    return starts;
}
const measureCopy = { metrics: () => ({ pitch: 10, gap: 5, view: 60 }), lines: (text) => lineStarts(text) };

async function boot() {
    app = await bootApp({ songs, messages: library, messageMeasure: measureCopy });
    await app.openProjector();
    await app.click('#messagesTabBtn');
    await app.until(() => app.$('.message-year-cell'), 'the message tab');
}
async function openMessage(code) {
    await app.type('#messageSearchInput', code);
    await app.until(() => app.$('#messageDisplaySubtitle').textContent.includes(code) && paragraphCards().length,
        `${code} in the reader`);
}

const onMac = () => app.window.navigator.userAgent.includes('Mac');
const findKey = () => (onMac() ? { metaKey: true } : { ctrlKey: true });
const findBox = () => app.$('#messageFindInput');
const finds = () => app.requests.filter(r => r.startsWith('GET /messages/search'));
const opened = (code) => app.requests.filter(r => r === `GET /messages/${code}`).length;
async function find(text) {
    findBox().focus();
    await app.type('#messageFindInput', text);
    await app.sleep(150);               // the find waits 120 ms for typing to pause
    await app.settle(20);
}
const listShown = () => !app.$('#messageFindResults').hidden;
const resultRefs = () => app.$$('#messageFindResults .message-find-hit').map(r => r.querySelector('.message-hit-ref').textContent);
const resultIds = () => app.$$('#messageFindResults .message-find-hit').map(r => r.dataset.find);
const cursorRef = () => app.$('#messageFindResults .message-find-hit.cursor')?.querySelector('.message-hit-ref').textContent;
const listText = () => app.$('#messageFindResults').textContent.replace(/\s+/g, ' ').trim();
const paragraphCards = () => app.$$('#messageParagraphs .message-paragraph');
const highlighted = () => app.$('#messageParagraphs .message-paragraph.highlighted')?.dataset.index;
const top = () => app.onScreen().scroll.anchor;

test('⌘F (Ctrl+F away from a Mac) goes to the find box only while the reader shows a message', async () => {
    await boot();
    await app.press('f', findKey());
    assert.notEqual(app.document.activeElement, findBox(), 'no message open: nothing to find in');

    await openMessage('62-0000');
    app.$('#messageSearchInput').focus();
    const press = new app.window.KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, ...findKey() });
    app.$('#messageSearchInput').dispatchEvent(press);
    await app.settle();
    assert.equal(app.document.activeElement, findBox(), 'even from the tab\'s own box');
    assert.equal(press.defaultPrevented, true, 'and the webview\'s own find is kept shut');
    assert.equal(app.projected().length, 0, 'nothing was projected by it');
    assert.match(findBox().title, /F\)$/);
});

test('it searches only the open message, and lists it in the message\'s order, the exact phrase first', async () => {
    await boot();
    await openMessage('62-0000');
    await find('lamb of god');
    assert.deepEqual(finds(), ['GET /messages/search?q=lamb+of+god&code=62-0000&limit=100']);
    assert.equal(listShown(), true);
    // ¶3 twice: the message numbers two paragraphs 3, and each is listed in its own place.
    assert.deepEqual(resultRefs(), ['¶2', '¶3', '¶3', '¶4']);
    assert.match(listText(), /With the words apart ¶4/, 'the words apart come after, under a label');
    assert.equal(app.$$('#messageFindResults .message-find-hit mark').length > 0, true, 'the words are marked');
    assert.doesNotMatch(listText(), /spoke of the lamb/, 'nothing from another message');
    assert.equal(cursorRef(), '¶2', 'from the top of the message, the keyboard starts on the first');
});

test('the list keeps the message\'s order however the back end ranks the results', async () => {
    await boot();
    await openMessage('62-0000');
    // The real back end ranks by how well each paragraph matches; turn the
    // stand-in's answer round, and swap the groups, to be sure it is sorted here.
    const realFetch = app.window.fetch;
    app.window.fetch = async (input, init) => {
        const res = await realFetch(input, init);
        if (!String(input).includes('/messages/search')) return res;
        const hits = await res.json();
        return new Response(JSON.stringify(hits.reverse()), { headers: { 'Content-Type': 'application/json' } });
    };
    await find('lamb of god');
    assert.deepEqual(resultRefs(), ['¶2', '¶3', '¶3', '¶4']);
    await app.press('ArrowDown', { target: '#messageFindInput' });
    await app.press('ArrowDown', { target: '#messageFindInput' });
    await app.press('Enter', { target: '#messageFindInput' });
    assert.equal(highlighted(), '3', 'the second paragraph numbered 3');
});

test('a year typed in the box is part of the phrase, and a space at the end is kept', async () => {
    await boot();
    await openMessage('62-0000');
    await find('1963 the lamb ');
    assert.deepEqual(finds(), ['GET /messages/search?q=1963+the+lamb+&code=62-0000&limit=100']);
    assert.deepEqual(resultRefs(), ['¶3']);
});

test('the keyboard starts on the first result from where the reader is, and Enter goes there without projecting', async () => {
    await boot();
    await openMessage('62-0000');
    await app.click(paragraphCards()[2]);              // the preacher is reading the second ¶3
    assert.deepEqual(top(), { paragraph: 2, offset: 0 });
    const sent = app.projected().length;
    const fetched = opened('62-0000');

    app.$('#messageParagraphs').focus?.();
    await app.press('f', findKey());
    assert.equal(app.document.activeElement, findBox());
    await find('lamb of god');
    assert.equal(cursorRef(), '¶3');
    assert.equal(app.$('#messageFindResults .message-find-hit.cursor').dataset.find, '1', 'the paragraph read now');
    await app.press('ArrowDown', { target: '#messageFindInput' });
    await app.press('ArrowDown', { target: '#messageFindInput' });
    await app.press('ArrowDown', { target: '#messageFindInput' });
    assert.equal(app.$('#messageFindResults .message-find-hit.cursor').dataset.find, '3', 'the last; no further');
    await app.press('ArrowUp', { target: '#messageFindInput' });
    assert.equal(app.$('#messageFindResults .message-find-hit.cursor').dataset.find, '2');

    await app.press('Enter', { target: '#messageFindInput' });
    assert.equal(highlighted(), '3', 'the paragraph numbered 3 again, by its place in the message');
    assert.notEqual(app.document.activeElement, findBox(), 'the box lets go of the keyboard');
    assert.equal(listShown(), false);
    assert.equal(app.projected().length, sent, 'nothing projected yet');
    assert.equal(opened('62-0000'), fetched, 'and the message is not fetched again');

    await app.press('Enter');
    assert.deepEqual(top(), { paragraph: 3, offset: 0 }, 'Enter projects it, from the line with the words');
});

test('Enter projects a found paragraph from the line with the words, not from its start', async () => {
    await boot();
    await openMessage('62-0001');
    await find('lost lamb');
    await app.press('Enter', { target: '#messageFindInput' });
    assert.equal(highlighted(), '1');
    await app.press('Enter');
    const text = library.paragraphs['62-0001'][1].text;
    const second = lineStarts(text)[1];
    assert.ok(second > 0 && second <= text.indexOf('lost'), 'the words are on the second line');
    assert.deepEqual(top(), { paragraph: 1, offset: second });
});

test('a click on a result goes to it too', async () => {
    await boot();
    await openMessage('62-0000');
    await find('shepherd');
    assert.deepEqual(resultRefs(), ['¶3', '¶4']);
    app.$$('#messageFindResults .message-find-hit')[1].dispatchEvent(
        new app.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    await app.settle();
    assert.equal(highlighted(), '4');
    assert.notEqual(app.document.activeElement, findBox());
});

test('Enter straight after typing waits for the new results, never going to an old one', async () => {
    await boot();
    await openMessage('62-0000');
    await find('lamb of god');
    const realFetch = app.window.fetch;
    app.window.fetch = async (input, init) => {
        if (String(input).includes('q=bow+our')) await new Promise(r => setTimeout(r, 150));
        return realFetch(input, init);
    };
    await app.type('#messageFindInput', 'bow our');
    assert.equal(app.$$('#messageFindResults .message-find-hit.stale').length, 4, 'the old results are dimmed');
    await app.press('Enter', { target: '#messageFindInput' });
    await app.until(() => highlighted() === '5', 'the new result');
    assert.equal(finds().filter(r => r.includes('q=bow+our')).length, 1, 'searched once, without the pause');
});

test('a late reply to an earlier find is dropped, after more typing or another message', async () => {
    await boot();
    await openMessage('62-0000');
    const realFetch = app.window.fetch;
    app.window.fetch = async (input, init) => {
        if (String(input).includes('q=lamb&')) await new Promise(r => setTimeout(r, 300));
        return realFetch(input, init);
    };
    await find('lamb');                       // its reply is held back
    await find('bow our heads');
    await app.sleep(300);
    await app.settle(20);
    assert.deepEqual(resultRefs(), ['¶5']);

    await find('lamb');                       // held back again
    await openMessage('62-0001');             // and another message opened meanwhile
    await app.sleep(350);
    await app.settle(20);
    assert.equal(findBox().value, '', 'the find starts afresh with another message');
    findBox().focus();
    await app.settle();
    assert.equal(listShown(), false);
    assert.deepEqual(resultRefs(), []);
});

test('it says when the words are not in the message, and when not every result is listed', async () => {
    await boot();
    await openMessage('62-0000');
    await find('river');
    assert.equal(listText(), 'Not found in this message');
    // Typing on: until the new reply comes, there is nothing to show, and no
    // empty list is left open.
    await app.type('#messageFindInput', 'river bank');
    assert.equal(listShown(), false);

    await openMessage('62-0002');
    await find('lamb');
    assert.equal(resultRefs().length, 100);
    assert.match(listText(), /^Only the 100 closest matches are listed/);
});

test('Escape leaves the box and hides the list; the words stay for coming back', async () => {
    await boot();
    await openMessage('62-0000');
    await find('lamb of god');
    const escape = new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    findBox().dispatchEvent(escape);
    await app.settle();
    assert.equal(escape.defaultPrevented, true, 'the webview does not empty the box');
    assert.equal(findBox().value, 'lamb of god');
    assert.notEqual(app.document.activeElement, findBox());
    assert.equal(listShown(), false);
    assert.equal(app.projected().length, 0, 'nothing was projected');
    await app.press('f', findKey());
    assert.equal(listShown(), true, 'the list is back with the box');
    assert.deepEqual(resultRefs(), ['¶2', '¶3', '¶3', '¶4']);
});

test('a find changes nothing on screen, and leaves highlights as they were', async () => {
    await boot();
    await openMessage('62-0000');
    await app.click(paragraphCards()[1]);
    // Highlight "lamb" in the paragraph on screen, as a drag across it does.
    const textEl = paragraphCards()[1].querySelector('.verse-card-text');
    const fire = (type) => textEl.dispatchEvent(new app.window.MouseEvent(type,
        { bubbles: true, cancelable: true, button: 0, clientX: type === 'mousedown' ? 100 : 140, clientY: 50 }));
    fire('mousedown');
    const range = app.document.createRange();
    const from = textEl.textContent.indexOf('lamb');
    range.setStart(textEl.firstChild, from);
    range.setEnd(textEl.firstChild, from + 4);
    app.window.getSelection().removeAllRanges();
    app.window.getSelection().addRange(range);
    fire('mouseup');
    fire('click');
    await app.settle();
    const marks = app.onScreen().scroll.marks;
    assert.deepEqual(marks, [[1, from, from + 4]]);
    const sent = app.projected().length;

    await find('lamb of god');
    await app.press('ArrowDown', { target: '#messageFindInput' });
    await app.press('Enter', { target: '#messageFindInput' });
    assert.equal(highlighted(), '2');
    assert.equal(app.projected().length, sent, 'nothing sent to the projector');
    assert.deepEqual(app.$$('#messageParagraphs mark.message-mark').map(m => m.textContent), ['lamb']);
    assert.equal(app.$$('#messageParagraphs .message-find-hit, #messageParagraphs .message-hit').length, 0,
        'the find marks nothing in the reader itself');
});

// ---- A found place, while the text on screen rolls ------------------------------
//
// 62-0002's paragraphs are a line each, four to a screen here, so a found
// place can be well off the screen.

const onScreenCards = () => app.$$('#messageParagraphs .message-paragraph.active').map(c => Number(c.dataset.index));
async function goToFound(words) {
    await find(words);
    await app.press('Enter', { target: '#messageFindInput' });
}

test('a found place waits for Enter while the text on screen rolls, whether it is ahead or behind', async () => {
    await boot();
    await openMessage('62-0002');
    await app.click(paragraphCards()[0]);
    await goToFound('number 50');
    assert.equal(highlighted(), '49');
    await app.press('ArrowRight');
    await app.press('ArrowRight');
    assert.ok(top().paragraph > 0, 'the text rolled on');
    assert.equal(onScreenCards().includes(49), false);
    assert.equal(highlighted(), '49', 'the found place is still the one Enter projects');
    await app.press('Enter');
    assert.deepEqual(top(), { paragraph: 49, offset: 0 }, 'and Enter projects it');

    await goToFound('number 20');
    assert.equal(highlighted(), '19', 'behind the screen');
    await app.press('ArrowRight');
    await app.press('ArrowLeft');
    await app.press('ArrowLeft');
    assert.equal(highlighted(), '19');
    await app.press('Enter');
    assert.deepEqual(top(), { paragraph: 19, offset: 0 });
});

test('once the screen reaches a found place, or the highlight is moved off it, the highlight follows the screen again', async () => {
    await boot();
    await openMessage('62-0002');
    await app.click(paragraphCards()[0]);
    await goToFound('number 8');                  // ¶8, the first from the top, then ¶80 to ¶89
    assert.equal(highlighted(), '7');
    for (let i = 0; i < 5 && !onScreenCards().includes(7); i++) {
        await app.press('ArrowRight');
        assert.equal(highlighted(), '7', 'waiting off the screen');
    }
    assert.equal(onScreenCards().includes(7), true, 'the screen has reached it');
    await app.press('ArrowRight');
    assert.equal(highlighted(), String(top().paragraph), 'from there it goes with the screen');

    await goToFound('number 50');
    assert.equal(highlighted(), '49');
    const sent = app.projected().length;
    await app.press('ArrowDown');                 // the highlight is off the screen: ↓ moves it
    assert.equal(highlighted(), '50');
    assert.equal(app.projected().length, sent, 'without moving the screen');
    await app.press('ArrowRight');
    assert.equal(app.projected().length, sent + 1);
    assert.equal(highlighted(), String(top().paragraph), 'moved off the found place, it goes back to the screen');
});

test('a message opened again while it is on screen keeps its highlight with the screen', async () => {
    await boot();
    await openMessage('62-0002');
    await app.click(paragraphCards()[60]);
    await openMessage('62-0001');
    await openMessage('62-0002');                 // opened from the list: at its start, not at a result
    assert.equal(highlighted(), '0');
    await app.press('ArrowRight');
    assert.ok(top().paragraph > 60);
    assert.equal(highlighted(), String(top().paragraph), 'the next roll brings it back to the screen');
});

test('the keyboard starts from the paragraph being read now: not where an earlier find began, nor a found place waiting', async () => {
    await boot();
    await openMessage('62-0002');
    await app.click(paragraphCards()[0]);
    await goToFound('number 50');                 // waiting at ¶50
    await app.press('ArrowRight');
    await app.press('ArrowRight');
    const reading = top().paragraph;
    assert.ok(reading > 0 && reading < 49);

    await app.press('f', findKey());              // the words from before are selected, and typed over
    await find('fold');
    assert.equal(cursorRef(), `¶${reading + 1}`, 'the top of the screen');

    findBox().dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await app.settle();
    await app.press('ArrowRight');
    const later = top().paragraph;
    assert.ok(later > reading);
    await app.press('f', findKey());              // back to the same words
    assert.equal(findBox().value, 'fold');
    assert.equal(cursorRef(), `¶${later + 1}`, 'afresh from where the screen is now');
});
