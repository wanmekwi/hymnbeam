const elements = {
    lyricsText: document.getElementById('lyricsText'),
    lyricsContainer: document.querySelector('.lyrics-container'),
    verseLabel: document.getElementById('verseLabel'),
    blankScreen: document.getElementById('blankScreen'),
    logoScreen: document.getElementById('logoScreen'),
    logoImage: document.getElementById('logoImage'),
    alertBanner: document.getElementById('alertBanner'),
    alertText: document.getElementById('alertText'),
    songTitleBar: document.getElementById('songTitleBar'),
    songMetaBar: document.getElementById('songMetaBar'),
    verseNavUp: document.getElementById('verseNavUp'),
    verseNavDown: document.getElementById('verseNavDown'),
    titleColNumber: document.getElementById('titleColNumber'),
    titleColTitle: document.getElementById('titleColTitle'),
    titleColKey: document.getElementById('titleColKey'),
    metaColAuthor: document.getElementById('metaColAuthor'),
    messageFooterText: document.getElementById('messageFooterText'),
    projector: document.querySelector('.projector')
};

// What is on screen: 'song', 'bible' (a verse) or 'message' (a sermon,
// scrolling). Each has its own layout class and display profile.
let currentMode = 'song';
function slideMode(data) {
    if (data.mode === 'message') return 'message';
    return data.isBible ? 'bible' : 'song';
}
function setMode(mode) {
    currentMode = mode;
    elements.projector.classList.toggle('bible-mode', mode === 'bible');
    elements.projector.classList.toggle('message-mode', mode === 'message');
}

// projector.html?measure is a hidden copy of this page that the operator asks
// where the lines of a message break (see window.messageMeasure below); it is
// never shown and is not sent slides.
const MEASURE_ONLY = new URLSearchParams(location.search).has('measure');

let currentText = '';          // original (unwrapped) text of the current slide
let currentSongId = null;
let currentVerses = [];        // original verse texts, as sent by the operator
let wrapMap = new Map();       // original verse text -> auto-broken text
let songFontSize = null;
let currentSettings = null;
let pendingSwapTimer = null;   // in-flight transition swap; cancelled when superseded
const apiBase = (() => {
    if (!window.__TAURI_INTERNALS__ && !window.__TAURI__) {
        return 'http://127.0.0.1:8765';
    }
    const isWin = navigator.platform?.toLowerCase().includes('win') ||
                  navigator.userAgent?.toLowerCase().includes('windows');
    return isWin ? 'http://axum.localhost' : 'axum://localhost';
})();

const FONT_STACKS = {
    'Montserrat':       "'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif",
    'Inter':            "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    'Lora':             "'Lora', Georgia, 'Times New Roman', serif",
    'EB Garamond':      "'EB Garamond', Garamond, Georgia, serif",
    'Crimson Pro':      "'Crimson Pro', Georgia, 'Times New Roman', serif",
    'Playfair Display': "'Playfair Display', Georgia, serif",
    'system-sans':      "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    'system-serif':     "Georgia, 'Times New Roman', serif"
};

function applySettings(settings) {
    if (!settings) return;
    currentSettings = settings;
    const root = document.documentElement;
    const t = settings.typography || {};
    const bg = settings.background || {};
    const layout = settings.layout || {};
    const trans = settings.transition || {};

    if (t.fontFamily) {
        root.style.setProperty('--font-display', FONT_STACKS[t.fontFamily] || FONT_STACKS['Montserrat']);
    }
    if (t.fontWeight) {
        elements.lyricsText.style.fontWeight = t.fontWeight;
    }
    if (t.alignment) {
        // Block stays centered on screen; text-align only controls how the
        // individual lines sit inside the (max-content) lyrics block — so
        // "left" gives flush-left lines under a centered verse, rather than
        // pulling the whole block to the screen edge.
        elements.lyricsText.style.textAlign = t.alignment;
        elements.lyricsContainer.style.justifyContent = 'center';
    }

    let bgValue;
    if (bg.kind === 'image' && bg.image && bg.image.filename && apiBase) {
        const url = `${apiBase}/backgrounds/${encodeURIComponent(bg.image.filename)}`;
        const dim = Math.max(0, Math.min(1, bg.image.dim ?? 0));
        bgValue = `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url('${url}') center/cover no-repeat`;
    } else if (bg.kind === 'gradient' && bg.gradient) {
        bgValue = `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to})`;
    } else if (bg.color) {
        bgValue = bg.color;
    }
    if (bgValue) {
        root.style.setProperty('--bg-color', bg.color || '#000000');
        elements.projector.style.background = bgValue;
    }

    if (typeof layout.safeAreaPct === 'number') {
        root.style.setProperty('--safe-area', `${layout.safeAreaPct}vmin`);
    }
    elements.projector.classList.toggle('layout-hide-title', layout.showTitleBar === false);
    elements.projector.classList.toggle('layout-hide-meta', layout.showMetaBar === false);
    refreshVerseLabel();

    elements.projector.classList.remove('transition-cut', 'transition-fade', 'transition-fade-up');
    const style = trans.style || 'fade-up';
    elements.projector.classList.add(`transition-${style}`);
    const dur = (typeof trans.durationMs === 'number') ? trans.durationMs : 400;
    root.style.setProperty('--trans-duration', `${dur}ms`);

    // Font swap, safe-area or auto-break change alters the fit, so re-lay out.
    if (currentVerses.length) {
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => relayout());
        } else {
            relayout();
        }
    }
    // A message's lines break afresh; its place stays at the top.
    if (messageView) {
        relayoutMessage();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayoutMessage);
    }
}

// The operator sends the whole settings blob (song fields at the top level plus
// optional `bible` and `message` overrides). We split it into three display
// profiles and apply whichever matches what's currently on screen;
// updateDisplay re-applies when that changes. When Bible isn't split off, it
// reuses the songs'; when the message profile isn't, it reuses the Bible's.
let songSettings = null;
let bibleSettings = null;
let messageSettings = null;

function ingestSettings(raw) {
    if (!raw || typeof raw !== 'object') return;
    songSettings = {
        typography: raw.typography, background: raw.background,
        layout: raw.layout, transition: raw.transition, logo: raw.logo,
    };
    // Scripture alignment is its own setting even when everything else
    // mirrors the songs, and defaults to left.
    const b = raw.bible || {};
    const bibleAlignment = (b.typography && b.typography.alignment) || 'left';
    const base = b.separate ? b : {};
    bibleSettings = {
        typography: { ...(base.typography || raw.typography), alignment: bibleAlignment },
        background: base.background || raw.background,
        layout: base.layout || raw.layout,
        transition: base.transition || raw.transition,
        logo: raw.logo,
    };
    const m = raw.message || {};
    const pct = Number(m.fontPct);
    messageFontPct = pct >= MESSAGE_FONT_PCT.min && pct <= MESSAGE_FONT_PCT.max ? pct : MESSAGE_FONT_PCT.default;
    messageSettings = m.separate ? {
        typography: { ...(m.typography || bibleSettings.typography) },
        background: m.background || bibleSettings.background,
        layout: m.layout || bibleSettings.layout,
        transition: m.transition || bibleSettings.transition,
        logo: raw.logo,
    } : bibleSettings;
    applySettingsForMode(currentMode);
}

function applySettingsForMode(mode) {
    const next = mode === 'message' ? messageSettings : mode === 'bible' ? bibleSettings : songSettings;
    if (next && next !== currentSettings) applySettings(next);
}

let currentLabel = '';
function refreshVerseLabel() {
    const show = currentSettings && currentSettings.layout && currentSettings.layout.showVerseLabel;
    elements.verseLabel.textContent = currentLabel;
    elements.verseLabel.classList.toggle('visible', !!(show && currentLabel));
}

async function loadInitialSettings() {
    try {
        const res = await fetch(`${apiBase}/settings`);
        if (res.ok) ingestSettings(await res.json());
    } catch (e) {
        console.warn('Could not load settings', e);
    }
}

// Off-screen node for measuring verse sizes without disturbing the visible one.
const measureEl = document.createElement('div');
measureEl.className = 'lyrics-text';
measureEl.setAttribute('aria-hidden', 'true');
measureEl.style.cssText = 'position:absolute;visibility:hidden;left:-99999px;top:0';
document.body.appendChild(measureEl);


// Convert [word] italic markers to <em>word</em>. Input must already be escaped
// or be plain text — we escape non-bracket segments ourselves.
function bibleTextToHtml(text) {
    const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return text.split(/(\[[^\]]+\])/).map((part, i) =>
        i % 2 === 1 ? `<em>${esc(part.slice(1,-1))}</em>` : esc(part)
    ).join('');
}

// Strip [word] brackets to get plain text (used for font-size measurement).
function bibleTextPlain(text) {
    return text.replace(/\[([^\]]+)\]/g, '$1');
}

// Message text is shown as written. Its bracketed notes ("[The listeners say
// amen.]") keep their brackets, unlike scripture's supplied words, and are set
// quieter than the words spoken. A '[' never closed is a note to the end of
// the paragraph, and a ']' never opened one from its start.
function messageTextToHtml(text) {
    const t = String(text);
    const note = (part) => `<span class="message-note">${escapeHtml(part)}</span>`;
    let html = '';
    let i = 0;
    const firstClose = t.indexOf(']');
    const firstOpen = t.indexOf('[');
    if (firstClose >= 0 && (firstOpen < 0 || firstClose < firstOpen)) {
        html += note(t.slice(0, firstClose + 1));
        i = firstClose + 1;
    }
    while (i < t.length) {
        const open = t.indexOf('[', i);
        if (open < 0) { html += escapeHtml(t.slice(i)); break; }
        html += escapeHtml(t.slice(i, open));
        const close = t.indexOf(']', open);
        const end = close < 0 ? t.length : close + 1;
        html += note(t.slice(open, end));
        i = end;
    }
    return html;
}

// A message's footer: its title and code.
function setMessageFooter(footer) {
    elements.messageFooterText.textContent = footer || '';
    elements.songMetaBar.classList.toggle('visible', !!footer);
}


// ---------------------------------------------------------------------------
// Auto line-breaking: split overly long verse lines at natural pause points so
// the whole verse can render larger. A break is only kept when it measurably
// increases the fitted font size, so verses whose lines are already balanced
// pass through untouched.

const measureCtx = document.createElement('canvas').getContext('2d');

function verseLineWidths(lines) {
    const cs = getComputedStyle(measureEl);
    // A fixed 100px size is fine: we only compare lines against each other.
    measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
    return lines.map(l => measureCtx.measureText(l).width);
}

// Trailing punctuation (allowing closing quotes/brackets after it) marks a
// phrase boundary — the same places a sung line naturally pauses, which is
// why breaking there tends to coincide with the hymn's metre.
const STRONG_PUNCT = /[.;:!?—–]['"”’)\]]*$/;
const COMMA_PUNCT = /,['"”’)\]]*$/;

// Only lines this long are candidates for breaking. Hymnal lines rarely
// exceed ~50 characters, so anything past this is two sung phrases printed
// as one. The floor also stops runaway fragmentation: without it, pure
// font-size maximisation happily chops a verse into two-word shreds.
const MIN_BREAK_LINE_CHARS = 52;

// Pick the best point to split one line in two: prefer punctuation, and
// prefer breaks near the middle so the halves stay balanced. Returns
// [left, right] or null when there's no acceptable break.
function bestBreakPoint(line) {
    const words = line.trim().split(/\s+/);
    if (words.length < 4 || line.trim().length < MIN_BREAK_LINE_CHARS) return null;
    const total = words.join(' ').length;
    let best = null;
    let bestScore = 0;
    let offset = 0;
    for (let i = 1; i < words.length; i++) {
        offset += words[i - 1].length + 1;
        const frac = offset / total;
        // Reject breaks that would leave a stub of a line.
        if (frac < 0.35 || frac > 0.65) continue;
        const balance = 1 - Math.abs(frac - 0.5) * 2; // 1 mid-line, 0 at edges
        let bonus = 0;
        if (STRONG_PUNCT.test(words[i - 1])) bonus = 0.7;
        else if (COMMA_PUNCT.test(words[i - 1])) bonus = 0.5;
        const score = balance + bonus;
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    }
    if (best === null) return null;
    return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

// Repeatedly split the visually widest line, tracking the layout with the
// largest fitted font along the way. Gains often come in pairs (two long
// lines must both be broken before either helps), so intermediate steps are
// never rejected — only the final winner is compared against the original.
// The verse keeps the hymnal's own line layout unless re-breaking buys
// clearly larger text.
const MIN_BREAK_GAIN = 1.15;

function autoBreakVerse(text) {
    const origSize = measureFitSize(text);
    if (origSize === null) return text;
    let lines = text.split('\n');
    let best = { size: origSize, lines: null };
    for (let breaks = 0; breaks < 8; breaks++) {
        const widths = verseLineWidths(lines);
        let widest = 0;
        for (let i = 1; i < lines.length; i++) {
            if (widths[i] > widths[widest]) widest = i;
        }
        const split = bestBreakPoint(lines[widest]);
        if (!split) break;
        lines = lines.slice(0, widest).concat(split, lines.slice(widest + 1));
        const size = measureFitSize(lines.join('\n'));
        if (size === null) break;
        if (size > best.size) best = { size, lines: lines.slice() };
    }
    return (best.lines && best.size >= origSize * MIN_BREAK_GAIN)
        ? best.lines.join('\n')
        : text;
}

function autoBreakEnabled() {
    const layout = (currentSettings && currentSettings.layout) || {};
    return layout.autoBreakLines !== false; // missing (older settings) = on
}

function displayTextFor(original) {
    return wrapMap.get(original) || original;
}

// Rebuild the wrap map and the song-wide font size for the current geometry
// (song change, window resize, font swap, safe-area or toggle change), then
// refresh the visible slide if its wrapping came out differently. Pass
// refreshDom=false when the on-screen text is about to be replaced anyway
// (song change), so the outgoing slide isn't re-wrapped against the new map.
function relayout(refreshDom = true) {
    if (!currentVerses.length) return;
    wrapMap = new Map();
    if (currentMode === 'song' && autoBreakEnabled()) {
        for (const v of currentVerses) {
            if (!v || !v.trim()) continue;
            const broken = autoBreakVerse(v);
            if (broken !== v) wrapMap.set(v, broken);
        }
    }
    songFontSize = computeSongFontSize(currentVerses.map(displayTextFor));
    applySongFontSize();
    if (refreshDom && currentText && currentMode === 'song') {
        const wrapped = displayTextFor(currentText);
        if (elements.lyricsText.textContent !== wrapped) {
            elements.lyricsText.textContent = wrapped;
        }
    }
}

// Logo / holding slide is an independent overlay layer, toggled by its own
// event so it works even with no song loaded (pre-service). It shows the
// centred logo image over the themed background, hiding lyrics/title/meta.
function setLogoScreen(show, image) {
    if (show) {
        if (image && apiBase) {
            elements.logoImage.src = `${apiBase}/backgrounds/${encodeURIComponent(image)}`;
            elements.logoImage.style.display = '';
        } else {
            elements.logoImage.removeAttribute('src');
            elements.logoImage.style.display = 'none';
        }
        elements.projector.classList.add('logo-active');
        elements.logoScreen.classList.add('active');
    } else {
        elements.projector.classList.remove('logo-active');
        elements.logoScreen.classList.remove('active');
    }
}

// Alert banner: an announcement flashed over any state. Independent layer, so
// it survives verse navigation and blank/logo changes until explicitly cleared.
function setAlert(text) {
    if (text) {
        elements.alertText.textContent = text;
        elements.alertBanner.classList.add('active');
    } else {
        elements.alertBanner.classList.remove('active');
    }
}

function updateDisplay(data) {
    const { text, label, isBlank, title, author, musical_key, songId, songNumber, verses,
            hasPrev, hasNext } = data;
    const mode = slideMode(data);
    const isBible = mode === 'bible';

    if (isBlank) {
        // Drop any in-flight swap and forget the current slide, so un-blanking
        // to the same slide redraws all of it: the text, and the title and meta
        // bars hidden below, which are only drawn when the slide changes.
        if (pendingSwapTimer) { clearTimeout(pendingSwapTimer); pendingSwapTimer = null; }
        currentText = '';
        currentSongId = null;
        messageView = null;
        messageSwapTarget = null;
        stopMessageGlide();
        elements.blankScreen.classList.add('active');
        elements.songTitleBar.classList.remove('visible');
        elements.songMetaBar.classList.remove('visible');
        elements.verseNavUp.classList.remove('visible');
        elements.verseNavDown.classList.remove('visible');
        setMode('song');
        return;
    }

    elements.blankScreen.classList.remove('active');
    setMode(mode);
    // Apply the matching display profile before any font/layout measurement
    // below so the fit is computed against the right typography.
    applySettingsForMode(mode);

    if (mode === 'song') {
        elements.verseNavUp.classList.toggle('visible', !!hasPrev);
        elements.verseNavDown.classList.toggle('visible', !!hasNext);
    } else {
        // Scripture and messages: no chevrons.
        elements.verseNavUp.classList.remove('visible');
        elements.verseNavDown.classList.remove('visible');
    }
    if (isBible) elements.songMetaBar.classList.remove('visible');
    if (mode === 'message') {
        // No title bar or verse label; the footer is drawn with every move.
        elements.songTitleBar.classList.remove('visible');
        setMessageFooter(data.footer);
        currentLabel = '';
        refreshVerseLabel();
        showMessage(data);
        return;
    }
    messageView = null;
    messageSwapTarget = null;
    stopMessageGlide();

    const slideVerses = verses && verses.length ? verses : (text ? [text] : []);
    if (songId !== currentSongId) {
        currentSongId = songId;
        if (mode === 'song') {
            updateSongMeta(title, author, musical_key, songNumber || songId);
        } else if (isBible) {
            // Bible mode: just the reference, centred — no number or key.
            setTitleBar('', title, '');
        }
        // Songs share one size across every verse. Bible verses are sized one
        // at a time below, as each is put on screen.
        currentVerses = isBible ? [] : slideVerses;
        relayout(false);
    }

    currentLabel = label || '';
    refreshVerseLabel();

    if (text === currentText) return;

    // Commit the target text synchronously and cancel any still-pending swap
    // from a superseded update. The actual DOM write is deferred by halfDur for
    // the cross-fade; without committing currentText now and cancelling the old
    // timer, rapid updates race — e.g. projecting a Bible verse right after a
    // song: the dedup check above would compare against a stale currentText, and
    // the song's deferred write could fire *after* the verse's, leaving the
    // projector stuck showing the song under a Bible-mode layout.
    currentText = text;
    if (pendingSwapTimer) clearTimeout(pendingSwapTimer);

    // One verse on screen, at the default size (smaller only if it wouldn't
    // fit). Applied by the swap below, so the outgoing verse keeps its size
    // while it fades out.
    if (isBible) {
        currentVerses = text ? [bibleTextPlain(text)] : [];
        songFontSize = computeSongFontSize(currentVerses);
    }

    const trans = (currentSettings && currentSettings.transition) || {};
    const dur = typeof trans.durationMs === 'number' ? trans.durationMs : 400;
    const halfDur = trans.style === 'cut' ? 0 : Math.round(dur * 0.6);

    elements.lyricsContainer.classList.add('transitioning');

    pendingSwapTimer = setTimeout(() => {
        pendingSwapTimer = null;
        if (isBible) {
            elements.lyricsText.innerHTML = bibleTextToHtml(text);
        } else {
            elements.lyricsText.textContent = displayTextFor(text);
        }
        applySongFontSize();
        elements.lyricsContainer.classList.remove('transitioning');
        if (trans.style !== 'cut' && trans.style !== 'fade') {
            elements.lyricsText.classList.add('entering');
            setTimeout(() => elements.lyricsText.classList.remove('entering'), dur);
        }
    }, halfDur);
}


const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Populate the three title-bar columns: number | title | key. Empty side
// columns keep their grid track so the title stays centred whichever parts
// are present.
function setTitleBar(number, title, key) {
    elements.titleColNumber.innerHTML = number
        ? `<span class="title-bar-label">No.</span><span class="title-bar-value">${escapeHtml(number)}</span>`
        : '';
    elements.titleColTitle.textContent = title || '';
    elements.titleColKey.innerHTML = key
        ? `<span class="title-bar-label">Key</span><span class="title-bar-value">${escapeHtml(key)}</span>`
        : '';
    elements.songTitleBar.classList.toggle('visible', !!title);
}

function updateSongMeta(title, author, musical_key, songNumber) {
    const number = songNumber != null && songNumber !== '' ? String(songNumber) : '';
    setTitleBar(number, title, musical_key);

    // Only touch the author column — the left column hosts the verse-nav
    // chevrons and verse label, which are managed elsewhere and must persist
    // across meta updates.
    elements.metaColAuthor.innerHTML = author
        ? `<span class="meta-value">${escapeHtml(author)}</span>`
        : '';

    // The bar always shows for a loaded song now — the left col holds the
    // chevrons / verse label, so it has content even when author is blank.
    elements.songMetaBar.classList.toggle('visible', !!title);
}


const WIDTH_FILL = 0.9;
const BIBLE_WIDTH_VW = 0.82; // matches the CSS 82vw on .bible-mode .lyrics-text
const BIBLE_LINE_HEIGHT = 1.4; // matches the CSS line-height on .bible-mode .lyrics-text
const BAR_GAP_PX = 24;
const MIN_FONT_PX = 16;
// Bible verses show at this fixed size (a share of the screen height, so the
// projector and the scaled preview agree) rather than being blown up to fill
// the screen; only a verse too long to fit at this size is shrunk.
const BIBLE_DEFAULT_FONT_VH = 0.06;

function availableLyricBand() {
    const containerRect = elements.lyricsContainer.getBoundingClientRect();
    const titleRect = elements.songTitleBar.getBoundingClientRect();
    const metaRect = elements.songMetaBar.getBoundingClientRect();
    const top = titleRect.height > 0 ? titleRect.bottom + BAR_GAP_PX : containerRect.top;
    const bottom = metaRect.height > 0 ? metaRect.top - BAR_GAP_PX : containerRect.bottom;
    return Math.max(MIN_FONT_PX * 2, bottom - top);
}

// For song verses (white-space: pre): size so the longest line fits the width
// AND all lines fit the height band — whichever is tighter wins.
// For Bible verses (white-space: normal, fixed width): text wraps within the
// target width, so we binary-search on height. Binary search is necessary here
// because multiplying by the ratio oscillates when line count changes discretely
// (e.g. the font alternates between 6-line and 10-line wrapping for long verses).
function measureFitSize(text) {
    measureEl.textContent = text;
    const cw = elements.lyricsContainer.clientWidth || window.innerWidth;

    if (elements.projector.classList.contains('bible-mode')) {
        const targetW = cw * BIBLE_WIDTH_VW;
        // Use actual available band (accounts for title bar height) with a small
        // margin so the text doesn't crowd the edges.
        const targetH = availableLyricBand() * 0.92;
        measureEl.style.whiteSpace = 'normal';
        measureEl.style.width = targetW + 'px';
        measureEl.style.lineHeight = BIBLE_LINE_HEIGHT;
        const defaultPx = Math.max(MIN_FONT_PX, window.innerHeight * BIBLE_DEFAULT_FONT_VH);
        let lo = MIN_FONT_PX, hi = defaultPx;
        measureEl.style.fontSize = defaultPx + 'px';
        if (measureEl.getBoundingClientRect().height <= targetH) lo = hi; // fits as is
        for (let pass = 0; pass < 12 && lo < hi; pass++) {
            const mid = (lo + hi) / 2;
            measureEl.style.fontSize = mid + 'px';
            const rect = measureEl.getBoundingClientRect();
            if (!rect.height) break;
            if (rect.height > targetH) hi = mid;
            else lo = mid;
        }
        measureEl.style.whiteSpace = '';
        measureEl.style.width = '';
        measureEl.style.lineHeight = '';
        return Math.max(MIN_FONT_PX, Math.floor(lo * 10) / 10);
    }

    const targetW = cw * WIDTH_FILL;
    const targetH = availableLyricBand();
    let fontSize = 100;
    for (let pass = 0; pass < 3; pass++) {
        measureEl.style.fontSize = fontSize + 'px';
        const rect = measureEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        fontSize *= Math.min(targetW / rect.width, targetH / rect.height);
    }
    return Math.max(MIN_FONT_PX, Math.floor(fontSize * 10) / 10);
}

// One font-size for the whole song: the size that fits the most demanding
// verse, so the chorus and every verse render at exactly the same scale.
function computeSongFontSize(verses) {
    let size = Infinity;
    for (const text of verses) {
        if (!text || !text.trim()) continue;
        const fit = measureFitSize(text);
        if (fit !== null) size = Math.min(size, fit);
    }
    return size === Infinity ? null : size;
}

function applySongFontSize() {
    if (songFontSize) {
        elements.lyricsText.style.fontSize = songFontSize + 'px';
    }
}


// ---------------------------------------------------------------------------
// A message on screen: one column of its paragraphs, which scrolls. The
// operator sends the paragraphs around the place at the top of the screen
// (see message-scroll.js) and that place. A move within the same paragraphs
// glides there; anything else (another message, a jump, coming back from
// blank) fades in at the place, as a new slide does.

const MESSAGE_GLIDE_FALLBACK_GAP_EM = 0.5;   // matches .message-para + .message-para

let messageFontPct = MESSAGE_FONT_PCT.default;
let messageView = null;        // what the column shows: {songId, first, count, anchor, starts}
let messageSwapTarget = null;  // what a fade under way draws when it swaps

function messageColumn() {
    return elements.lyricsText.querySelector('.message-column');
}

// Draw a run of paragraphs, the first being paragraph `first` of the message.
// A paragraph's number is an attribute, drawn by the stylesheet in the margin:
// it is no part of the text, so lines break and are counted as without it.
function drawMessageColumn(target) {
    const numbers = target.numbers || [];
    elements.lyricsText.innerHTML = `<div class="message-column">${target.paragraphs.map((text, i) => {
        const number = numbers[i] == null || numbers[i] === '' ? '' : ` data-number="${escapeHtml(String(numbers[i]))}"`;
        return `<p class="message-para"${number}>${text.trim() ? messageTextToHtml(text) : '&nbsp;'}</p>`;
    }).join('')}</div>`;
    messageColumn().style.fontSize = `${messageFontPct}vh`;
    messageView = {
        songId: target.songId, first: target.first, count: target.paragraphs.length,
        anchor: target.anchor, starts: new Map(),
    };
}

// The column's measurements as laid out now (see message-scroll.js), or null
// where nothing is laid out.
function messageMetrics(column) {
    const paras = column ? column.children : [];
    if (!paras.length) return null;
    const style = getComputedStyle(paras[0]);
    const fontPx = parseFloat(style.fontSize);
    let pitch = parseFloat(style.lineHeight);
    if (!(pitch > 0)) pitch = fontPx * BIBLE_LINE_HEIGHT;
    const gap = paras.length > 1
        ? parseFloat(getComputedStyle(paras[1]).marginTop) || 0
        : fontPx * MESSAGE_GLIDE_FALLBACK_GAP_EM;
    const view = elements.lyricsContainer.getBoundingClientRect().height;
    return pitch > 0 && view > 0 ? { pitch, gap, view } : null;
}

// Where each line of a drawn paragraph starts, as offsets in its text: for
// each line after the first, the first character drawn on it, found by a
// binary search on where characters are drawn.
function messageParagraphStarts(p, pitch) {
    const text = p.textContent;
    const first = Math.max(0, text.search(/\S/));
    const box = p.getBoundingClientRect();
    const lines = pitch > 0 ? Math.round(box.height / pitch) : 1;
    if (!(lines > 1)) return [first];
    const linePitch = box.height / lines;
    const nodes = [];
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(), at = 0; n; at += n.length, n = walker.nextNode()) nodes.push({ node: n, at });
    const range = document.createRange();
    // The line the first character drawn at or after `i` is on (`lines` past the end).
    const lineOf = (i) => {
        for (; i < text.length; i++) {
            if (/\s/.test(text[i])) continue;
            let k = nodes.length - 1;
            while (k > 0 && nodes[k].at > i) k--;
            const { node, at } = nodes[k];
            range.setStart(node, i - at);
            range.setEnd(node, Math.min(node.length, i - at + 1));
            const r = range.getBoundingClientRect();
            if (r.height > 0) return Math.floor((r.top + r.height / 2 - box.top) / linePitch);
        }
        return lines;
    };
    const starts = [first];
    let lo = first;
    for (let line = 1; line < lines; line++) {
        let hi = text.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (lineOf(mid) >= line) hi = mid;
            else lo = mid + 1;
        }
        let at = lo;
        while (at < text.length && /\s/.test(text[at])) at++;
        if (at >= text.length) break;
        starts.push(at);
        lo = at + 1;
    }
    return starts;
}

// The drawn paragraphs as a layout for message-scroll.js. Line starts are
// worked out as they are asked for, once per drawing.
function messageWindowLayout(column, metrics) {
    const v = messageView;
    return {
        count: column.children.length,
        pitch: metrics.pitch, gap: metrics.gap, view: metrics.view,
        starts(i) {
            if (!v.starts.has(i)) v.starts.set(i, messageParagraphStarts(column.children[i], metrics.pitch));
            return v.starts.get(i);
        },
    };
}

// The top of a line (a place among the drawn paragraphs), in px down the column.
function messageLineTop(column, place, pitch) {
    const box = column.children[place.paragraph].getBoundingClientRect();
    const lines = Math.max(1, Math.round(box.height / pitch));
    return box.top - column.getBoundingClientRect().top + place.line * (box.height / lines);
}

// Where the view's place is drawn, or null if it is not: how far down the
// column the top of the screen is to be, and how much to cut off under the
// last whole line. Part-way between two lines (where the wheel has left it),
// both are part-way between those lines' values.
function messageAnchorTarget(column) {
    const v = messageView;
    const metrics = messageMetrics(column);
    const rel = v ? v.anchor.paragraph - v.first : -1;
    if (!metrics || rel < 0 || rel >= v.count) return null;
    const layout = messageWindowLayout(column, metrics);
    const at = (place) => {
        const top = messageLineTop(column, place, metrics.pitch);
        const last = messageMoveLines(layout, place, messageLinesShown(layout, place) - 1);
        const bottom = messageLineTop(column, last, metrics.pitch) + metrics.pitch;
        return { top, cut: Math.max(0, metrics.view - (bottom - top)) };
    };
    const place = messagePlaceAt(layout, rel, v.anchor.offset);
    const here = at(place);
    const part = Math.max(0, Math.min(1, Number(v.anchor.part) || 0));
    const next = part > 0 ? messageNextLine(layout, place, 1) : null;
    if (!next) return { ...here, lineTop: here.top, view: metrics.view };
    const there = at(next);
    return {
        top: here.top + part * (there.top - here.top),
        cut: here.cut + part * (there.cut - here.cut),
        lineTop: here.top,
        view: metrics.view,
    };
}

// Where the column is and where it is going (see Gliding in message-scroll.js).
// `y` is how far the column is moved (px, negative is up) and `cut` how much is
// cut off the foot of the view; each glides to its target at its own speed.
const MESSAGE_GLIDE_STALL_MS = 250;   // no frame for this long: land without one
const MESSAGE_FRAME_SECONDS = 1 / 60;  // what a glide's first frame is taken to last
const messageMotion = {
    y: 0, speed: 0, toY: 0, cut: 0, cutSpeed: 0, toCut: 0,
    rate: MESSAGE_GLIDE_RATE,   // how quickly it closes on its target
    frame: null, watch: null,
    last: null,      // the time of the last frame drawn, as frames are timed
    seen: 0,         // when a frame last came, by the clock
};

function drawMessageMotion() {
    const column = messageColumn();
    if (column) column.style.transform = `translateY(${messageMotion.y}px)`;
    elements.lyricsContainer.style.setProperty('--message-cut', `${Math.max(0, messageMotion.cut)}px`);
}

function stopMessageGlide() {
    const m = messageMotion;
    if (m.frame != null) cancelAnimationFrame(m.frame);
    if (m.watch != null) clearInterval(m.watch);
    m.frame = null;
    m.watch = null;
}

// Be there at once.
function landMessage() {
    const m = messageMotion;
    stopMessageGlide();
    m.y = m.toY;
    m.cut = m.toCut;
    m.speed = 0;
    m.cutSpeed = 0;
    drawMessageMotion();
}

// One frame of a glide. `time` is the frame's own time, which keeps step with
// the screen however late in the frame this runs, so the text moves evenly.
function messageGlideFrame(time) {
    const m = messageMotion;
    m.frame = null;
    if (!messageView || !messageColumn()) { stopMessageGlide(); return; }
    // A long gap between frames (a busy moment) is not caught up in one leap.
    const seconds = m.last == null ? MESSAGE_FRAME_SECONDS : Math.min(0.05, Math.max(0, (time - m.last) / 1000));
    m.last = time;
    m.seen = performance.now();
    ({ pos: m.y, speed: m.speed } = messageGlideStep(m.y, m.speed, m.toY, seconds, m.rate));
    ({ pos: m.cut, speed: m.cutSpeed } = messageGlideStep(m.cut, m.cutSpeed, m.toCut, seconds, m.rate));
    if (messageGlideArrived(m.y, m.speed, m.toY) && messageGlideArrived(m.cut, m.cutSpeed, m.toCut)) {
        landMessage();
        return;
    }
    drawMessageMotion();
    m.frame = requestAnimationFrame(messageGlideFrame);
}

function glideMessage() {
    const m = messageMotion;
    if (m.frame == null) {
        m.last = null;
        m.seen = performance.now();
        m.frame = requestAnimationFrame(messageGlideFrame);
    }
    // A hidden or covered page is given no frames: the text must still end up
    // in its place.
    if (m.watch == null) {
        m.watch = setInterval(() => {
            if (performance.now() - m.seen > MESSAGE_GLIDE_STALL_MS) landMessage();
        }, MESSAGE_GLIDE_STALL_MS);
    }
}

// Put the view's place at the top of the screen. On a whole line, whole lines
// only show: the space under the last line that fits is cut off. Part-way
// between two lines (where the wheel has left it), the text shows as a page
// does part-way through a scroll: the top line going off, the next coming on
// at the foot. `glide` moves there smoothly, otherwise it is at once.
// Where things are drawn is read here, once a move, and never while gliding.
function placeMessage(glide) {
    const column = messageColumn();
    if (!column || !messageView) return;
    const target = messageAnchorTarget(column);
    const m = messageMotion;
    m.toY = target ? -target.top : 0;
    m.toCut = target ? target.cut : 0;
    if (glide && target) {
        // Flung hard, the text may not trail more than a screen behind where
        // it is going: the paragraphs drawn reach only so far (see
        // messageWindowCovers), and beyond them the screen would show nothing.
        if (Math.abs(m.toY - m.y) > target.view) m.y = m.toY - Math.sign(m.toY - m.y) * target.view;
        glideMessage();
    } else {
        landMessage();
    }
}

// Move to a new place in the message on screen. If it comes with other
// paragraphs, they are drawn first with the text on screen kept where it is
// and moving as it was (part-way through a glide included), so the screen
// never jumps.
function scrollMessageTo(target) {
    let column = messageColumn();
    const v = messageView;
    if (v.first !== target.first || v.count !== target.paragraphs.length) {
        const before = messageAnchorTarget(column);
        drawMessageColumn({ ...target, anchor: v.anchor });
        column = messageColumn();
        const after = before && messageAnchorTarget(column);
        if (!after) {
            messageView.anchor = target.anchor;
            placeMessage(false);
            return;
        }
        // The line that was at `before.lineTop` down the old column is at
        // `after.lineTop` down the new one.
        messageMotion.y += before.lineTop - after.lineTop;
        drawMessageMotion();
    }
    messageView.anchor = target.anchor;
    placeMessage(true);
}

function showMessage(data) {
    const s = data.scroll || {};
    const first = Number(s.first) || 0;
    const target = {
        songId: data.songId,
        first,
        paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs.map(String) : [],
        numbers: Array.isArray(s.numbers) ? s.numbers : [],
        anchor: {
            paragraph: Number(s.anchor && s.anchor.paragraph != null ? s.anchor.paragraph : first),
            offset: Number(s.anchor && s.anchor.offset) || 0,
            part: Number(s.anchor && s.anchor.part) || 0,
        },
    };
    currentText = null;
    currentVerses = [];
    const same = !s.jump && !!messageView && messageView.songId === data.songId && currentSongId === data.songId;
    currentSongId = data.songId;
    // A fade under way draws the latest place when it swaps.
    if (messageSwapTarget) {
        messageSwapTarget = target;
        return;
    }
    if (pendingSwapTimer) { clearTimeout(pendingSwapTimer); pendingSwapTimer = null; }
    if (same && messageColumn()) {
        // A turning wheel is followed closely; a move on its own glides.
        messageMotion.rate = s.close ? MESSAGE_FOLLOW_RATE : MESSAGE_GLIDE_RATE;
        scrollMessageTo(target);
        return;
    }
    const trans = (currentSettings && currentSettings.transition) || {};
    const dur = typeof trans.durationMs === 'number' ? trans.durationMs : 400;
    const halfDur = trans.style === 'cut' ? 0 : Math.round(dur * 0.6);
    messageSwapTarget = target;
    elements.lyricsContainer.classList.add('transitioning');
    pendingSwapTimer = setTimeout(() => {
        pendingSwapTimer = null;
        const next = messageSwapTarget;
        messageSwapTarget = null;
        drawMessageColumn(next);
        placeMessage(false);
        elements.lyricsContainer.classList.remove('transitioning');
    }, halfDur);
}

// The settings, a font or the window's size changed: the lines break afresh
// and the place stays at the top.
function relayoutMessage() {
    const column = messageColumn();
    if (!column || !messageView || currentMode !== 'message') return;
    column.style.fontSize = `${messageFontPct}vh`;
    messageView.starts = new Map();
    placeMessage(false);
}

// For the operator, which moves the text by lines and sends the projector the
// paragraphs it needs, so must know where lines break and how many fit. It
// asks a hidden copy of this page (projector.html?measure), sized as the
// projector is, which lays text out with this same code. Measuring is
// synchronous, so moving never waits.
let preparedSettingsJson = null;
window.messageMeasure = {
    // Take the operator's current settings and the message's footer, so text
    // is measured in the message profile's font and in the room the footer
    // leaves.
    prepare(settings, footer) {
        const json = JSON.stringify(settings || null);
        if (settings && json !== preparedSettingsJson) {
            preparedSettingsJson = json;
            ingestSettings(settings);
        }
        setMode('message');
        applySettingsForMode('message');
        setMessageFooter(footer);
    },
    // {pitch, gap, view} in px (see message-scroll.js), or null if this copy
    // cannot lay text out.
    metrics() {
        drawMessageColumn({ songId: null, first: 0, paragraphs: ['M', 'M'], anchor: { paragraph: 0, offset: 0 } });
        return messageMetrics(messageColumn());
    },
    // Where each line of a paragraph starts, as offsets in its text.
    lines(text) {
        drawMessageColumn({ songId: null, first: 0, paragraphs: [String(text)], anchor: { paragraph: 0, offset: 0 } });
        const column = messageColumn();
        const metrics = messageMetrics(column);
        return messageParagraphStarts(column.children[0], metrics ? metrics.pitch : 0);
    },
};

// Tauri events drive the real projector window. postMessage drives the
// in-operator preview iframe — same projector page, fed by the operator
// directly. Both are registered unconditionally so a single source file
// renders both the live projection and the WYSIWYG preview.
if (window.__TAURI__) {
    window.__TAURI__.event.listen('update-lyrics', (event) => {
        try { updateDisplay(JSON.parse(event.payload)); }
        catch (error) { console.error('Error parsing lyrics update:', error); }
    });
    window.__TAURI__.event.listen('apply-settings', (event) => {
        try { ingestSettings(JSON.parse(event.payload)); }
        catch (error) { console.error('Error parsing settings update:', error); }
    });
    window.__TAURI__.event.listen('show-logo', (event) => {
        try { const d = JSON.parse(event.payload); setLogoScreen(d.show, d.image); }
        catch (error) { console.error('Error parsing logo update:', error); }
    });
    window.__TAURI__.event.listen('show-alert', (event) => {
        try { const d = JSON.parse(event.payload); setAlert(d.text); }
        catch (error) { console.error('Error parsing alert update:', error); }
    });
    window.__TAURI__.event.listen('clear-alert', () => setAlert(''));
}
window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'update-lyrics') {
        updateDisplay(event.data);
    } else if (event.data.type === 'apply-settings') {
        ingestSettings(event.data.settings);
    } else if (event.data.type === 'show-logo') {
        setLogoScreen(event.data.show, event.data.image);
    } else if (event.data.type === 'show-alert') {
        setAlert(event.data.text);
    } else if (event.data.type === 'clear-alert') {
        setAlert('');
    }
});


document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (window.__TAURI__) {
            window.__TAURI__.window.getCurrent().close();
        } else {
            window.close();
        }
    }
});


document.addEventListener('DOMContentLoaded', () => {
    elements.lyricsText.textContent = '';
    // The measuring copy tells the operator once it can measure, and again
    // when a font finishes loading, since either can change where lines
    // break. It is not sent slides, so needs no state pump, and it is handed
    // the operator's settings each time (which may not be saved yet), so it
    // does not load them itself.
    if (MEASURE_ONLY) {
        const changed = () => {
            try { window.parent.postMessage({ type: 'message-measure-changed' }, '*'); }
            catch (e) { /* no operator page */ }
        };
        changed();
        if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', changed);
        return;
    }
    loadInitialSettings();
    // Iframe preview: tell the parent we're alive so it can pump current state.
    if (window.parent && window.parent !== window) {
        try { window.parent.postMessage({ type: 'projector-ready' }, '*'); }
        catch (e) { /* parent origin mismatch — harmless */ }
    }
});


// The projector window may have the keyboard (it takes it when it opens) or be
// under the pointer, and the operator should not have to click away from it
// first. So it passes what it is given on to the operator, which alone decides
// what is on screen: the wheel, to roll a message, and the keys, as if pressed
// there. Escape stays here: it closes this window. Only the real window does
// this; the previews and the measuring copy are the operator's own.
const IS_PROJECTOR_WINDOW = !MEASURE_ONLY && window.parent === window;

function sendProjectorInput(data) {
    const emit = window.__TAURI__?.event?.emit;
    if (!IS_PROJECTOR_WINDOW || !emit) return false;
    try { emit('projector-input', data)?.catch?.(() => { /* the operator is gone */ }); }
    catch (e) { return false; }
    return true;
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
    if (sendProjectorInput({ key: e.key, shift: e.shiftKey, repeat: e.repeat })) e.preventDefault();
});

// The wheel's travel is passed on in px of this screen, at most once a frame.
let projectorWheelTravel = 0;
let projectorWheelFrame = null;
document.addEventListener('wheel', (e) => {
    if (!IS_PROJECTOR_WINDOW || !window.__TAURI__?.event?.emit) return;
    e.preventDefault();
    if (currentMode !== 'message' || e.ctrlKey || e.metaKey) return;
    const metrics = messageMetrics(messageColumn());
    const line = metrics ? metrics.pitch : window.innerHeight / 16;
    projectorWheelTravel += e.deltaMode === 1 ? e.deltaY * line
        : e.deltaMode === 2 ? e.deltaY * window.innerHeight * 0.8 : e.deltaY;
    if (projectorWheelFrame == null) {
        projectorWheelFrame = requestAnimationFrame(() => {
            projectorWheelFrame = null;
            const wheel = projectorWheelTravel;
            projectorWheelTravel = 0;
            if (wheel) sendProjectorInput({ wheel });
        });
    }
}, { passive: false });

// The projector window goes fullscreen on whatever screen it is given, so it
// tells the operator its size, which message paragraphs are measured at (see
// setMessageMeasureSize in messages.js). Only the real window does; the
// previews and the measuring copy are the operator's own.
function reportProjectorSize() {
    if (MEASURE_ONLY || window.parent !== window || !window.__TAURI__?.event?.emit) return;
    window.__TAURI__.event.emit('projector-size', { width: window.innerWidth, height: window.innerHeight })
        .catch?.(() => { /* the operator is gone */ });
}
document.addEventListener('DOMContentLoaded', reportProjectorSize);

// Recompute the song-wide size when the window moves or the resolution changes.
let resizeRaf;
window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
        relayout();
        relayoutMessage();
        reportProjectorSize();
    });
});

// The first verse can render before the web font loads; recompute once ready.
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { relayout(); relayoutMessage(); });
}
// A font chosen later loads later still, after `ready` has long resolved: a
// message's lines break afresh when it arrives.
if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => relayoutMessage());
}
