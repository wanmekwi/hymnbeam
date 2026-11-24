// Finding a message in the message library by title, date or date code, from
// what the operator types into The Message tab's box. Pure functions over the
// catalogue the tab already holds (GET /messages), so the Messages group can
// update on every keystroke without asking the backend; the phrase search
// (GET /messages/search) is separate.
//
// Message codes are date codes: YY-MMDD plus an optional letter, e.g. 61-0312M
// for the morning of 12 March 1961. MM or DD is 00 when the date is not known
// to the day. Book chapters have codes like XYZ-03.
//
// Nothing here touches the page, so tests load this file on its own.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

const MESSAGE_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
// Maps rather than objects, so a typed word such as "constructor" can never
// be taken for a month.
const MESSAGE_MONTHS = new Map(MESSAGE_MONTH_NAMES.flatMap((name, i) => [
    [name.toLowerCase(), i + 1], [name.slice(0, 3).toLowerCase(), i + 1],
]).concat([['sept', 9]]));
// Code letters that name a time of day. Others are shown as they are.
const MESSAGE_TIMES = new Map([['morning', 'M'], ['afternoon', 'A'], ['evening', 'E']]);
const MESSAGE_TIME_NAMES = { M: 'morning', A: 'afternoon', E: 'evening' };
const MESSAGE_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MESSAGE_CODE_RE = /^(\d{2})-(\d{2})(\d{2})([A-Z]?)$/;
const CODE_TYPED_RE = /^(\d{2})-(\d{0,4})([a-z]?)$|^(\d{2})(\d{2,4})([a-z]?)$/;
const ISO_DATE_RE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
const NUMERIC_DATE_RE = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/g;
const MONTH_YEAR_RE = /\b(\d{1,2})\/(\d{4}|\d{2})\b/g;
const ORDINAL_RE = /\b(\d{1,2})(?:st|nd|rd|th)\b/g;

// Lower case, apostrophes dropped ("It'll" -> "itll"), anything that is not a
// letter or digit turned into a space.
function plainWords(text) {
    return (text || '').toLowerCase().replace(/’/g, "'").replace(/'/g, '')
        .replace(/[^\p{L}\p{N}]/gu, ' ')
        .split(' ').filter(Boolean);
}

function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Whether day/month exists, in `year` or (with no year) in some leap year.
function isValidDay(year, month, day) {
    if (!(month >= 1 && month <= 12) || day < 1) return false;
    const leap = year == null ? true : isLeapYear(year);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    return day <= days;
}

/**
 * The catalogue as the finder needs it: every message and book chapter, books
 * first then in date order, each with its month, day and code letter read out
 * of its code, plus the library's year range and book code prefix.
 */
function prepareCatalogue(works) {
    const items = works.map(w => {
        const item = { ...w, month: null, day: null, suffix: '' };
        const m = MESSAGE_CODE_RE.exec(w.code);
        if (m) {
            item.month = parseInt(m[2], 10) || null;
            item.day = parseInt(m[3], 10) || null;
            item.suffix = m[4];
        }
        const title = plainWords(w.title);
        if (w.kind === 'book') {
            item.titleWords = w.chapter ? ['chapter', String(w.chapter), ...title] : title;
            item.otherWords = plainWords(w.collection);
        } else {
            item.titleWords = title;
            item.otherWords = plainWords(w.location);
        }
        return item;
    });
    items.sort((a, b) =>
        ((a.kind !== 'book') - (b.kind !== 'book')) || (a.sort - b.sort) ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

    const years = items.filter(w => w.kind !== 'book' && w.year != null).map(w => w.year);
    const bookCode = items.map(w => w.kind === 'book' && /^([A-Z]+)-\d+$/.exec(w.code)).find(Boolean);
    return {
        works: items,
        firstYear: years.length ? Math.min(...years) : null,
        lastYear: years.length ? Math.max(...years) : null,
        bookPrefix: bookCode ? bookCode[1] : null,
    };
}

// A year written with two or four digits, if the library has messages from it.
// Two digits are read as the year in the library's range that ends with them.
function libraryYear(catalogue, digits) {
    const { firstYear, lastYear } = catalogue;
    if (firstYear == null) return null;
    const n = parseInt(digits, 10);
    if (digits.length === 4) return n >= firstYear && n <= lastYear ? n : null;
    for (let y = firstYear; y <= lastYear; y++) if (y % 100 === n) return y;
    return null;
}

/**
 * What a query asks for, as far as opening a message directly goes:
 * {codePrefix, year, month, day, time, words, text}. `words` are the other
 * words in plainWords form; `text` is them as typed, for the phrase search.
 */
function parseWorkQuery(catalogue, raw) {
    const q = { codePrefix: null, year: null, month: null, day: null, time: null, words: [], text: '' };
    let text = raw.trim().toLowerCase().replace(/’/g, "'");
    const compact = text.replace(/\s+/g, '');
    if (!compact) return q;
    const year = (digits) => libraryYear(catalogue, digits);
    const hasDate = () => q.year != null || q.month != null || q.day != null;

    if (catalogue.bookPrefix) {
        const book = new RegExp(`^${catalogue.bookPrefix.toLowerCase()}-?(\\d{1,2})$`).exec(compact);
        if (book) {
            q.codePrefix = `${catalogue.bookPrefix}-${String(parseInt(book[1], 10)).padStart(2, '0')}`;
            return q;
        }
    }
    if (/^\d{4}$/.test(compact) && year(compact)) {
        q.year = parseInt(compact, 10);
        return q;
    }
    const code = CODE_TYPED_RE.exec(compact);
    if (code) {
        const [yy, rest, suffix] = code[1] !== undefined ? code.slice(1, 4) : code.slice(4, 7);
        q.codePrefix = `${yy}-${rest}${suffix.toUpperCase()}`;
        return q;
    }

    // Whole dates written with digits. Numbers are read day first (25/7/65);
    // month first only when day first is impossible (7/25/65).
    text = text.replace(ISO_DATE_RE, (all, y, mo, d) => {
        const [yn, mon, dn] = [parseInt(y, 10), parseInt(mo, 10), parseInt(d, 10)];
        if (year(y) && isValidDay(yn, mon, dn)) {
            [q.year, q.month, q.day] = [yn, mon, dn];
            return ' ';
        }
        return all;
    });
    text = text.replace(NUMERIC_DATE_RE, (all, a, b, y) => {
        const [an, bn, yn] = [parseInt(a, 10), parseInt(b, 10), year(y)];
        if (yn == null) return all;
        if (bn >= 1 && bn <= 12 && isValidDay(yn, bn, an)) [q.year, q.month, q.day] = [yn, bn, an];
        else if (an >= 1 && an <= 12 && isValidDay(yn, an, bn)) [q.year, q.month, q.day] = [yn, an, bn];
        else return all;
        return ' ';
    });
    text = text.replace(MONTH_YEAR_RE, (all, mo, y) => {
        const [mon, yn] = [parseInt(mo, 10), year(y)];
        if (yn == null || mon < 1 || mon > 12) return all;
        [q.year, q.month] = [yn, mon];
        return ' ';
    });
    text = text.replace(ORDINAL_RE, '$1');

    const tokens = text.split(/[^a-z0-9']+/).filter(t => t.replace(/^'+|'+$/g, ''));
    const bare = (t) => t.replace(/'/g, '');
    // Words that would otherwise be misread while a phrase or title is typed:
    //   - a month name counts only when a number is typed too ("mar 63",
    //     "25 July"), so "mar" can still start a title word;
    //   - a two-digit year counts only as '63, beside a month, or on its own,
    //     so "50 years" is not read as a year (four-digit years always count);
    //   - "morning", "afternoon" and "evening" count only beside a date, so
    //     "good morning" stays a phrase.
    const anyNumber = hasDate() || tokens.some(t => /^\d+$/.test(t.replace(/^'+|'+$/g, '')));
    const rest = [];
    tokens.forEach((token, i) => {
        const markedYear = token.startsWith("'");
        const t = bare(token);
        if (anyNumber && MESSAGE_MONTHS.has(t) && q.month == null) {
            q.month = MESSAGE_MONTHS.get(t);
            return;
        }
        if (/^\d+$/.test(t)) {
            const n = parseInt(t, 10);
            const besideMonth = anyNumber && [i - 1, i + 1].some(j =>
                j >= 0 && j < tokens.length && MESSAGE_MONTHS.has(bare(tokens[j])));
            if (t.length === 4 && q.year == null && year(t)) {
                q.year = n;
                return;
            }
            if (besideMonth && !markedYear && n >= 1 && n <= 31 && q.day == null) {
                q.day = n;
                return;
            }
            if (t.length === 2 && q.year == null && year(t) &&
                    (markedYear || besideMonth || tokens.length === 1)) {
                q.year = year(t);
                return;
            }
        }
        rest.push({ token, isTime: MESSAGE_TIMES.has(t) });
    });
    const typed = [];
    for (const { token, isTime } of rest) {
        const t = bare(token);
        if (isTime && hasDate() && q.time == null) {
            q.time = MESSAGE_TIMES.get(t);
            continue;
        }
        q.words.push(t);
        typed.push(token.replace(/^'+|'+$/g, ''));
    }
    q.text = typed.join(' ') + (/\s$/.test(raw) ? ' ' : '');
    return q;
}

function workQueryHasDate(q) {
    return q.year != null || q.month != null || q.day != null;
}

// Nothing in the query but a date or code, so a phrase search would be pointless.
function workQueryDateOnly(q) {
    return q.words.length === 0 && (workQueryHasDate(q) || q.codePrefix != null);
}

/**
 * Messages and chapters to open directly for what was typed, best first.
 *
 * - A date code, typed in full or in part (61-0312M, 61-0312, 610312, 61-03),
 *   lists the messages whose codes start with it; XYZ-03 a book chapter.
 * - Dates and years narrow the list (12 March 1961, 12/3/61, March 1961, 1961,
 *   '61); "morning", "afternoon" and "evening" pick the service. Messages
 *   whose code has no day are kept, after the others, when a day in their
 *   month is asked for.
 * - Other words must each start a word of the title or the place (for a book
 *   chapter, "chapter 3" counts as part of the title and the book's name as
 *   the place). Order: exact title, then titles that start with the words,
 *   then titles that contain them, then matches that need the place; each in
 *   date order.
 */
function findWorks(catalogue, raw, query = parseWorkQuery(catalogue, raw)) {
    const q = query;
    if (q.codePrefix != null) return catalogue.works.filter(w => w.code.startsWith(q.codePrefix));
    const hasDate = workQueryHasDate(q);
    if (!hasDate && !q.words.length) return [];

    const dateRank = (w) => {
        if (!hasDate) return 0;
        if (w.kind === 'book') return null;
        if (q.year != null && w.year !== q.year) return null;
        if (q.month != null && w.month !== q.month) return null;
        if (q.day != null && w.day !== q.day) return w.day == null && w.month != null ? 1 : null;
        return 0;
    };
    const found = (word, words) => words.some(x => x.startsWith(word));
    const wordRank = (w) => {
        if (!q.words.length) return 0;
        const title = w.titleWords;
        if (!q.words.every(word => found(word, title) || found(word, w.otherWords))) return null;
        if (title.length === q.words.length && title.every((x, i) => x === q.words[i])) return 0;
        if (q.words.length <= title.length && q.words.every((word, i) => title[i].startsWith(word))) return 1;
        if (q.words.every(word => found(word, title))) return 2;
        return 3;
    };

    const ranked = [];
    for (const w of catalogue.works) {
        const d = dateRank(w);
        if (d == null) continue;
        const r = wordRank(w);
        if (r == null) continue;
        ranked.push({ key: [r, d, w.kind !== 'book' ? 1 : 0, w.sort], w });
    }
    ranked.sort((a, b) => {
        for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
        return a.w.code < b.w.code ? -1 : a.w.code > b.w.code ? 1 : 0;
    });
    let works = ranked.map(x => x.w);
    if (q.time) {
        const rightTime = works.filter(w => w.suffix === q.time);
        if (rightTime.length) works = rightTime;
    }
    return works;
}

// For example "Sun 12 Mar 1961, morning", "Jun 1953" or "1948". Empty for a
// book chapter.
function messageDateLabel(w) {
    if (w.kind === 'book' || w.year == null) return '';
    const mon = w.month ? MESSAGE_MONTH_NAMES[w.month - 1].slice(0, 3) : null;
    let text;
    if (w.month && w.day && isValidDay(w.year, w.month, w.day)) {
        const weekday = MESSAGE_WEEKDAYS[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()];
        text = `${weekday} ${w.day} ${mon} ${w.year}`;
    } else if (w.month) {
        text = `${mon} ${w.year}`;
    } else {
        text = String(w.year);
    }
    return text + (MESSAGE_TIME_NAMES[w.suffix] ? `, ${MESSAGE_TIME_NAMES[w.suffix]}` : '');
}
