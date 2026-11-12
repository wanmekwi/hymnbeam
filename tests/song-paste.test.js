// Pasting lyrics into the new-song box.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');

let app;
afterEach(() => app?.close());

const parse = (text) => JSON.parse(app.eval(`JSON.stringify(parsePastedSong(${JSON.stringify(text)}))`));

test('unlabelled paragraphs become numbered verses', async () => {
    app = await bootApp();
    assert.deepEqual(parse('My Song\n\nline one\nline two\n\nline three'), {
        title: 'My Song',
        verses: [
            { label: 'Verse 1', text: 'line one\nline two' },
            { label: 'Verse 2', text: 'line three' },
        ],
    });
});

test('section headings are kept as labels and not counted as verses', async () => {
    app = await bootApp();
    const song = parse('My Song\n\nVerse 1\nfirst\n\nCHORUS\nsing\n\nsecond\n\nBridge\nover');
    assert.deepEqual(song.verses.map(v => v.label), ['Verse 1', 'Chorus', 'Verse 1', 'Bridge']);
    assert.deepEqual(song.verses.map(v => v.text), ['first', 'sing', 'second', 'over']);
});

test('stray whitespace and empty sections are dropped', async () => {
    app = await bootApp();
    const song = parse('  My Song  \n\n\n\n   padded line   \n\nChorus\n\n');
    assert.equal(song.title, 'My Song');
    assert.deepEqual(song.verses, [{ label: 'Verse 1', text: 'padded line' }]);
});

test('a title with no lyrics yields no verses', async () => {
    app = await bootApp();
    assert.deepEqual(parse('Only A Title'), { title: 'Only A Title', verses: [] });
});
