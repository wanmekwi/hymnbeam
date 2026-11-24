// Moving through a message on the projector, a line at a time.
//
// Once a paragraph is chosen, the projector shows the message as one column
// of text that scrolls: what is at the top of the screen is a place in the
// message, {paragraph, line}, and the operator moves it on or back by lines.
// Where lines break is a layout question, so the caller passes a layout:
//
//   count      how many paragraphs there are
//   starts(i)  where each line of paragraph i starts, as offsets in its text
//   pitch      the distance from one line to the next, in px
//   gap        the extra space between two paragraphs, in px
//   view       the height the text is shown in, in px
//
// Everything here is arithmetic on that, so the operator (measuring in a
// hidden copy of the projector page) and the projector (in its own page) come
// to the same answers. index.html and projector.html both load this file
// before their own scripts, which share its global scope.

// The size of message text, as a share of the screen's height (Display
// settings). It is fixed: a long paragraph scrolls rather than shrinking.
const MESSAGE_FONT_PCT = { min: 2.5, max: 8, step: 0.25, default: 4.5 };

// A line counts as on screen if it ends within the view, give or take this
// much rounding (px).
const MESSAGE_FIT_SLACK = 0.5;

// The line of a paragraph holding character `offset`, given where its lines
// start.
function messageLineAt(starts, offset) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

// The place holding character `offset` of paragraph `paragraph`.
function messagePlaceAt(layout, paragraph, offset) {
    const p = Math.max(0, Math.min(layout.count - 1, paragraph));
    return { paragraph: p, line: messageLineAt(layout.starts(p), offset || 0) };
}

// Where a place's line starts in its paragraph's text.
function messageOffsetOf(layout, place) {
    return layout.starts(place.paragraph)[place.line] || 0;
}

function compareMessagePlaces(a, b) {
    return a.paragraph - b.paragraph || a.line - b.line;
}

// The line after a place (direction 1) or before it (-1); null past either
// end of the message.
function messageNextLine(layout, place, direction) {
    if (direction > 0) {
        if (place.line + 1 < layout.starts(place.paragraph).length) {
            return { paragraph: place.paragraph, line: place.line + 1 };
        }
        return place.paragraph + 1 < layout.count ? { paragraph: place.paragraph + 1, line: 0 } : null;
    }
    if (place.line > 0) return { paragraph: place.paragraph, line: place.line - 1 };
    if (place.paragraph <= 0) return null;
    return { paragraph: place.paragraph - 1, line: layout.starts(place.paragraph - 1).length - 1 };
}

// `n` lines on, or back if `n` is negative, stopping at either end.
function messageMoveLines(layout, place, n) {
    const direction = Math.sign(n);
    let at = place;
    for (let i = 0; i < Math.abs(n); i++) {
        const next = messageNextLine(layout, at, direction);
        if (!next) break;
        at = next;
    }
    return at;
}

// How many whole lines show with `place` at the top of the screen. The first
// always does.
function messageLinesShown(layout, place) {
    let count = 1;
    let y = 0;
    let at = place;
    for (;;) {
        const next = messageNextLine(layout, at, 1);
        if (!next) break;
        const top = y + layout.pitch + (next.paragraph !== at.paragraph ? layout.gap : 0);
        if (top + layout.pitch > layout.view + MESSAGE_FIT_SLACK) break;
        count++;
        y = top;
        at = next;
    }
    return count;
}

// The furthest down the text goes: the place from which the rest of the
// message just fills the screen, so a message ends at the foot of the screen
// rather than scrolling away. The start, for a message that fits on one.
function messageLastTop(layout) {
    if (!layout.count) return { paragraph: 0, line: 0 };
    const lastParagraph = layout.count - 1;
    let at = { paragraph: lastParagraph, line: layout.starts(lastParagraph).length - 1 };
    let height = layout.pitch;
    for (;;) {
        const prev = messageNextLine(layout, at, -1);
        if (!prev) break;
        const taller = height + layout.pitch + (prev.paragraph !== at.paragraph ? layout.gap : 0);
        if (taller > layout.view + MESSAGE_FIT_SLACK) break;
        height = taller;
        at = prev;
    }
    return at;
}

// `place`, or the last place the text goes to if it is further on.
function messageClampTop(layout, place) {
    const last = messageLastTop(layout);
    return compareMessagePlaces(place, last) > 0 ? last : place;
}

// The paragraphs the projector is sent with `place` at the top of the screen
// and `shown` lines on it: from two screens above to four below, so that
// moving on or back glides through text the projector already has.
function messageWindowFor(layout, place, shown) {
    return {
        first: messageMoveLines(layout, place, -2 * shown).paragraph,
        last: messageMoveLines(layout, place, 4 * shown).paragraph,
    };
}

// Whether the paragraphs already sent will do for `place`: they must hold the
// screen before it (where a move on glides from) and the two after (the screen
// itself, and the one a move back glides from).
function messageWindowCovers(win, layout, place, shown) {
    return !!win
        && messageMoveLines(layout, place, -shown).paragraph >= win.first
        && messageMoveLines(layout, place, 2 * shown).paragraph <= win.last;
}

// Where lines would start if each held about `perLine` characters, broken at
// spaces. Stands in for real line breaks until the measuring copy of the
// projector page can be asked.
function messageEstimatedStarts(text, perLine = 60) {
    const starts = [Math.max(0, text.search(/\S/))];
    let lineStart = starts[0];
    let lastSpace = -1;
    for (let i = lineStart; i < text.length; i++) {
        if (/\s/.test(text[i])) lastSpace = i;
        if (i - lineStart >= perLine && lastSpace > lineStart) {
            let next = lastSpace + 1;
            while (next < text.length && /\s/.test(text[next])) next++;
            if (next >= text.length) break;
            starts.push(next);
            lineStart = next;
            lastSpace = -1;
        }
    }
    return starts;
}

// Where a search hit's matched words are in the paragraph, from the snippet
// the search returned (U+E000 / U+E001 around each matched word, '…' where
// text was left out). Null if they cannot be found.
function messageHitOffset(text, snippet) {
    if (!snippet) return null;
    const mark = snippet.indexOf('');
    if (mark < 0) return null;
    // The run of the snippet around the first matched word, between ellipses.
    const from = snippet.lastIndexOf('…', mark) + 1;
    let to = snippet.indexOf('…', mark);
    if (to < 0) to = snippet.length;
    const before = snippet.slice(from, mark).replace(/[]/g, '');
    const run = before + snippet.slice(mark, to).replace(/[]/g, '');
    const lead = run.length - run.trimStart().length;
    const at = run.trim() ? text.indexOf(run.trim()) : -1;
    if (at >= 0) return at + before.length - lead;
    // Otherwise the first place the matched word itself appears.
    const close = snippet.indexOf('', mark);
    const word = snippet.slice(mark + 1, close < 0 ? undefined : close).trim().toLowerCase();
    const found = word ? text.toLowerCase().indexOf(word) : -1;
    return found >= 0 ? found : null;
}
