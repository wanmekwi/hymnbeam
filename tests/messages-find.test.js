// Going straight to a message by title, date or date code: the finder behind
// the message library tab's box (frontend/js/messages-find.js), on its own.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { messageWorks } = require('./helpers/fixtures');

// The file is a plain browser script that touches nothing but its own
// functions, so it can run here without a page.
const finder = vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'messages-find.js'), 'utf8') +
    '\n;({ prepareCatalogue, parseWorkQuery, findWorks, workQueryDateOnly, messageDateLabel })',
    vm.createContext({}));
const catalogue = finder.prepareCatalogue(messageWorks);
const find = (query) => [...finder.findWorks(catalogue, query)].map(w => w.code);
const parse = (query) => ({ ...finder.parseWorkQuery(catalogue, query) });
const codes = (...list) => list;

test('the year range and book prefix come from the catalogue', () => {
    assert.equal(catalogue.firstYear, 1958);
    assert.equal(catalogue.lastYear, 1961);
    assert.equal(catalogue.bookPrefix, 'BOL');
});

test('a date code, whole or in part, lists the messages it starts', () => {
    assert.deepEqual(find('58-0105M'), codes('58-0105M'));
    assert.deepEqual(find('58-0105m'), codes('58-0105M'));
    assert.deepEqual(find('58-0105'), codes('58-0105M', '58-0105E'));
    assert.deepEqual(find('580105'), codes('58-0105M', '58-0105E'));
    assert.deepEqual(find('59-03'), codes('59-0300', '59-0315'));
    assert.deepEqual(find('5901'), []);
});

test('a book chapter opens by its code or its number', () => {
    for (const q of ['BOL-01', 'bol1', 'bol-1', 'chapter 1']) assert.deepEqual(find(q), codes('BOL-01'), q);
    assert.deepEqual(find('book of lamps'), codes('BOL-00', 'BOL-01', 'BOL-02'), 'the book name counts as the place');
});

test('a whole date finds that day, written any of the usual ways', () => {
    for (const q of ['5 January 1958', 'January 5, 1958', '5th Jan 58', '5/1/58', '5.1.1958', '1958-01-05']) {
        assert.deepEqual(find(q), codes('58-0105M', '58-0105E'), q);
    }
    assert.deepEqual(find('1/5/58'), [], 'day first: 1 May');
    assert.deepEqual(find('3/15/59'), codes('59-0315', '59-0300'), 'month first only when day first is impossible');
    assert.deepEqual(find('5 January 1958 evening'), codes('58-0105E'));
    assert.deepEqual(find('5/1/58 morning'), codes('58-0105M'));
});

test('a month or a year finds every message in it', () => {
    for (const q of ['January 1958', 'jan 58', '1/58', '1958', "'58"]) {
        assert.deepEqual(find(q), codes('58-0105M', '58-0105E'), q);
    }
    assert.deepEqual(find('March 1959'), codes('59-0300', '59-0315'));
});

test('a code with no day is listed after the exact dates in its month', () => {
    assert.deepEqual(find('15 March 1959'), codes('59-0315', '59-0300'));
    assert.deepEqual(find('16 March 1959'), codes('59-0300'));
});

test('title words may be partly typed, and rank exact, then starting, then containing', () => {
    assert.deepEqual(find('seeds in winter'), codes('58-0105M', '59-0315'));
    assert.deepEqual(find('see'), codes('58-0105M', '59-0315'));
    assert.deepEqual(find('narr bri'), codes('58-0105E'));
    // 'Lamps And Lanterns' starts with the word, two chapters contain it, and
    // the introduction only matches through the book's name.
    assert.deepEqual(find('lamp'), codes('61-1231', 'BOL-01', 'BOL-02', 'BOL-00'));
});

test('a repeated title is narrowed by year or by place', () => {
    assert.deepEqual(find('seeds 1959'), codes('59-0315'));
    assert.deepEqual(find("seeds '58"), codes('58-0105M'));
    assert.deepEqual(find('seeds lakeside'), codes('59-0315'));
});

test('a month name counts only beside a number, so it can still start a title', () => {
    assert.deepEqual(find('mar'), codes('59-0300'));
    assert.equal(parse('mar').month, null);
    assert.equal(parse('mar 59').month, 3);
});

test('a two-digit number is a year only when marked, beside a month, or alone', () => {
    const q = parse('50 years');
    assert.equal(q.year, null);
    assert.deepEqual([...q.words], ['50', 'years']);
    assert.equal(q.text, '50 years');
    assert.equal(parse('59').year, 1959);
    assert.equal(parse("'59 market").year, 1959);
    assert.equal(parse("'65").year, null, 'outside the library’s years');
});

test('a time of day counts only beside a date', () => {
    const q = parse('good morning');
    assert.equal(q.time, null);
    assert.deepEqual([...q.words], ['good', 'morning']);
    assert.equal(parse('5/1/58 morning').time, 'M');
});

test('impossible dates are not dates', () => {
    assert.equal(parse('1960-02-29').day, 29);
    assert.equal(parse('1960-02-30').day, null, 'no rolling over into March');
    assert.equal(parse('29/2/61').day, null, '1961 was not a leap year');
    assert.deepEqual(find('29/2/60'), codes('60-0229'));
});

test('typed words never pick up properties of plain objects', () => {
    const q = parse('constructor 1958');
    assert.equal(q.month, null);
    assert.deepEqual([...q.words], ['constructor']);
});

test('what is left after the date is the phrase to search for', () => {
    const q = parse('narrow bridge 1958');
    assert.equal(q.year, 1958);
    assert.equal(q.text, 'narrow bridge');
    assert.equal(finder.workQueryDateOnly(q), false);
    assert.equal(parse('seeds ').text, 'seeds ', 'a finished last word stays finished');
    assert.equal(finder.workQueryDateOnly(parse('5 January 1958')), true);
    assert.equal(finder.workQueryDateOnly(parse('58-01')), true);
});

test('each message is labelled with its weekday, date and service', () => {
    const label = (code) => finder.messageDateLabel(catalogue.works.find(w => w.code === code));
    assert.equal(label('58-0105M'), 'Sun 5 Jan 1958, morning');
    assert.equal(label('58-0105E'), 'Sun 5 Jan 1958, evening');
    assert.equal(label('59-0300'), 'Mar 1959');
    assert.equal(label('60-0229'), 'Mon 29 Feb 1960');
    assert.equal(label('BOL-01'), '');
});
