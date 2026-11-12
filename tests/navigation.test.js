// Moving through a song: the order the arrows walk, and what reaches the screen.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/boot');
const { songs, amazingGrace, holyHolyHoly } = require('./helpers/fixtures');

let app;
afterEach(() => app?.close());

test('the chorus is repeated after every verse, and closes the song', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    // V1, Chorus, V2, Chorus, V3, Chorus
    assert.deepEqual(app.state('navigationOrder'), [0, 1, 2, 1, 3, 1]);
});

test('a song without a chorus runs top to bottom', async () => {
    app = await bootApp({ songs });
    await app.openSong(holyHolyHoly.id);
    assert.deepEqual(app.state('navigationOrder'), [0, 1, 2]);
});

test('the right arrow walks the whole song in order and stops at the end', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();

    const seen = [app.onScreen().label];
    for (let i = 0; i < 8; i++) {       // more presses than there are slides
        await app.press('ArrowRight');
        seen.push(app.onScreen().label);
    }
    assert.deepEqual(seen.slice(0, 6),
        ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Verse 3', 'Chorus']);
    assert.deepEqual(seen.slice(6), ['Chorus', 'Chorus', 'Chorus'], 'stays on the last slide');
    assert.equal(app.onScreen().hasNext, false);
    assert.equal(app.onScreen().hasPrev, true);
});

test('the left arrow goes back and stops at the first slide', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();
    await app.press('ArrowRight');
    await app.press('ArrowLeft');
    await app.press('ArrowLeft');
    assert.equal(app.onScreen().label, 'Verse 1');
    assert.equal(app.onScreen().hasPrev, false);
    assert.equal(app.onScreen().hasNext, true);
});

test('digit keys jump to a verse, and the arrows carry on from there', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();

    await app.press('3');               // third verse card = "Verse 2"
    assert.equal(app.onScreen().text, amazingGrace.verses[2].text);
    await app.press('ArrowRight');
    assert.equal(app.onScreen().label, 'Chorus');
    await app.press('ArrowRight');
    assert.equal(app.onScreen().label, 'Verse 3');
});

test('a digit past the end of the song changes nothing', async () => {
    app = await bootApp({ songs });
    await app.openSong(holyHolyHoly.id);
    await app.openProjector();
    const before = app.projected().length;
    await app.press('9');
    await app.press('0');
    assert.equal(app.projected().length, before);
    assert.equal(app.onScreen().label, 'Verse 1');
});

test('the projected slide carries the song details the projector displays', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();
    const slide = app.onScreen();
    assert.equal(slide.title, 'Amazing Grace');
    assert.equal(slide.author, 'John Newton');
    assert.equal(slide.musical_key, 'G');
    assert.equal(slide.songNumber, 12);
    assert.equal(slide.text, amazingGrace.verses[0].text);
    assert.deepEqual(slide.verses, amazingGrace.verses.map(v => v.text));
});

test('choosing another song starts it from its first verse', async () => {
    app = await bootApp({ songs });
    await app.openSong(amazingGrace.id);
    await app.openProjector();
    await app.press('ArrowRight');
    await app.press('ArrowRight');
    await app.openSong(holyHolyHoly.id);
    assert.equal(app.onScreen().title, 'Holy, Holy, Holy');
    assert.equal(app.onScreen().label, 'Verse 1');
    assert.equal(app.onScreen().hasPrev, false);
});
