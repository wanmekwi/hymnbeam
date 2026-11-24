// Moving through a message a line at a time (frontend/js/message-scroll.js).
// The file is plain arithmetic on a layout passed in; here the layouts are
// made up: paragraphs of so many lines, each line ten characters.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'message-scroll.js'), 'utf8'), context);
const {
    messageLineAt, messagePlaceAt, messageOffsetOf, messageMoveLines, messageLinesShown, messageLastTop,
    messageClampTop, messageWindowFor, messageWindowCovers, messageEstimatedStarts, messageHitOffset,
} = context;

// Results are copied out of the script's own realm, so deepEqual compares values only.
const plain = (value) => JSON.parse(JSON.stringify(value));
const at = (paragraph, line) => ({ paragraph, line });

// Paragraphs of `lineCounts[i]` lines, 10 px apart with 5 px more between
// paragraphs, shown 100 px high unless said otherwise.
function layoutOf(lineCounts, { pitch = 10, gap = 5, view = 100 } = {}) {
    return {
        count: lineCounts.length, pitch, gap, view,
        starts: (i) => Array.from({ length: lineCounts[i] }, (_, k) => k * 10),
    };
}

test('a character is on the line that starts at or before it', () => {
    assert.equal(messageLineAt([0, 12, 30], 0), 0);
    assert.equal(messageLineAt([0, 12, 30], 11), 0);
    assert.equal(messageLineAt([0, 12, 30], 12), 1);
    assert.equal(messageLineAt([0, 12, 30], 29), 1);
    assert.equal(messageLineAt([0, 12, 30], 999), 2);
    assert.equal(messageLineAt([3, 12], 0), 0, 'space before the first line is on it');
    const layout = layoutOf([2, 3]);
    assert.deepEqual(plain(messagePlaceAt(layout, 1, 25)), at(1, 2));
    assert.deepEqual(plain(messagePlaceAt(layout, 9, 0)), at(1, 0), 'no such paragraph: the last');
    assert.equal(messageOffsetOf(layout, at(1, 2)), 20);
});

test('moving by lines runs on into the next paragraph and back into the one before', () => {
    const layout = layoutOf([2, 3, 1]);
    assert.deepEqual(plain(messageMoveLines(layout, at(0, 0), 3)), at(1, 1));
    assert.deepEqual(plain(messageMoveLines(layout, at(1, 0), -1)), at(0, 1));
    assert.deepEqual(plain(messageMoveLines(layout, at(0, 0), 10)), at(2, 0), 'stops at the end');
    assert.deepEqual(plain(messageMoveLines(layout, at(1, 2), -10)), at(0, 0), 'stops at the start');
    assert.deepEqual(plain(messageMoveLines(layout, at(1, 1), 0)), at(1, 1));
});

test('the lines shown are those that end within the view, counting the gaps between paragraphs', () => {
    assert.equal(messageLinesShown(layoutOf([20]), at(0, 0)), 10, 'one paragraph: 100 px of 10 px lines');
    // Lines at 0, 10, 20; 35, 45, 55; 70, 80, 90 — the last ends at exactly 100.
    assert.equal(messageLinesShown(layoutOf([3, 3, 3, 3]), at(0, 0)), 9);
    assert.equal(messageLinesShown(layoutOf([3, 3, 3, 3], { view: 99 }), at(0, 0)), 8);
    assert.equal(messageLinesShown(layoutOf([3, 3]), at(1, 1)), 2, 'only what is left');
    assert.equal(messageLinesShown(layoutOf([5], { view: 4 }), at(0, 0)), 1, 'the top line always shows');
});

test('the text stops where the rest of the message just fills the screen', () => {
    const layout = layoutOf([3, 3, 3, 3]);
    // From the second paragraph's first line, the last nine lines end at exactly 100 px.
    assert.deepEqual(plain(messageLastTop(layout)), at(1, 0));
    assert.equal(messageLinesShown(layout, at(1, 0)), 9, 'the screen is full there');
    assert.deepEqual(plain(messageClampTop(layout, at(3, 0))), at(1, 0));
    assert.deepEqual(plain(messageClampTop(layout, at(0, 2))), at(0, 2));
    assert.deepEqual(plain(messageLastTop(layoutOf([2, 2]))), at(0, 0), 'a message that fits stays at its start');
});

test('the paragraphs sent run from two screens above to four below, and do until a move nears their edge', () => {
    const layout = layoutOf(Array(100).fill(2));
    const win = plain(messageWindowFor(layout, at(50, 0), 5));
    assert.deepEqual(win, { first: 45, last: 60 });
    assert.equal(messageWindowCovers(win, layout, at(50, 0), 5), true);
    assert.equal(messageWindowCovers(win, layout, at(52, 0), 5), true);
    assert.equal(messageWindowCovers(win, layout, at(58, 0), 5), false, 'two screens on would pass the last');
    assert.equal(messageWindowCovers(win, layout, at(47, 0), 5), false, 'a screen back would pass the first');
    assert.equal(messageWindowCovers(null, layout, at(50, 0), 5), false);
    assert.deepEqual(plain(messageWindowFor(layout, at(0, 0), 5)), { first: 0, last: 10 }, 'clipped at the start');
});

test('until lines can be measured, they are guessed at by length, breaking at spaces', () => {
    assert.deepEqual(plain(messageEstimatedStarts('aaa bbb ccc', 4)), [0, 4, 8]);
    assert.deepEqual(plain(messageEstimatedStarts('  aaa bbb', 4)), [2, 6], 'from the first word');
    assert.deepEqual(plain(messageEstimatedStarts('short', 60)), [0]);
    assert.deepEqual(plain(messageEstimatedStarts('', 60)), [0]);
    assert.deepEqual(plain(messageEstimatedStarts('averyveryverylongword and more', 4)), [0, 22, 26],
        'a word longer than a line is one line');
});

test('the words a search matched are found in the paragraph from its snippet', () => {
    const text = 'The harbour was calm. Boats rocked gently. The quiet harbour waited for the storm to pass.';
    // As the search returns it: the match marked, words left out shown as '…'.
    const snippet = '…rocked gently. The quiet harbour waited for…';
    assert.equal(messageHitOffset(text, snippet), text.indexOf('harbour waited'));
    // A whole paragraph as its own snippet.
    assert.equal(messageHitOffset('Calm seas ahead.', 'Calm seas ahead.'), 5);
    // If the run around the match is not found as it is, the matched word is looked for.
    assert.equal(messageHitOffset(text, '…changed words around Boats here…'), text.indexOf('Boats'));
    assert.equal(messageHitOffset(text, 'no marks at all'), null);
    assert.equal(messageHitOffset(text, null), null);
});
