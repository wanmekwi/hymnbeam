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
    projector: document.querySelector('.projector')
};

let currentText = '';          // original (unwrapped) text of the current slide
let currentSongId = null;
let currentVerses = [];        // original verse texts, as sent by the operator
let wrapMap = new Map();       // original verse text -> auto-broken text
let songFontSize = null;
let currentSettings = null;
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
        if (res.ok) applySettings(await res.json());
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
    const isBible = elements.projector.classList.contains('bible-mode');
    wrapMap = new Map();
    if (!isBible && autoBreakEnabled()) {
        for (const v of currentVerses) {
            if (!v || !v.trim()) continue;
            const broken = autoBreakVerse(v);
            if (broken !== v) wrapMap.set(v, broken);
        }
    }
    songFontSize = computeSongFontSize(currentVerses.map(displayTextFor));
    applySongFontSize();
    if (refreshDom && currentText && !isBible) {
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
            hasPrev, hasNext, isBible } = data;

    if (isBlank) {
        elements.blankScreen.classList.add('active');
        elements.songTitleBar.classList.remove('visible');
        elements.songMetaBar.classList.remove('visible');
        elements.verseNavUp.classList.remove('visible');
        elements.verseNavDown.classList.remove('visible');
        elements.projector.classList.remove('bible-mode');
        return;
    }

    elements.blankScreen.classList.remove('active');
    elements.projector.classList.toggle('bible-mode', !!isBible);

    if (isBible) {
        // Bible mode: no chevrons, no meta bar
        elements.verseNavUp.classList.remove('visible');
        elements.verseNavDown.classList.remove('visible');
        elements.songMetaBar.classList.remove('visible');
    } else {
        elements.verseNavUp.classList.toggle('visible', !!hasPrev);
        elements.verseNavDown.classList.toggle('visible', !!hasNext);
    }

    if (songId !== currentSongId) {
        currentSongId = songId;
        if (!isBible) {
            updateSongMeta(title, author, musical_key, songNumber || songId);
        } else {
            // Bible mode: just the reference, centred — no number or key.
            setTitleBar('', title, '');
        }
        // For font-size measurement use plain text (strip italic markers).
        const plainVerses = isBible
            ? (verses && verses.length ? verses.map(bibleTextPlain) : (text ? [bibleTextPlain(text)] : []))
            : (verses && verses.length ? verses : (text ? [text] : []));
        currentVerses = plainVerses;
        relayout(false);
    }

    currentLabel = label || '';
    refreshVerseLabel();

    if (text === currentText) return;

    const trans = (currentSettings && currentSettings.transition) || {};
    const dur = typeof trans.durationMs === 'number' ? trans.durationMs : 400;
    const halfDur = trans.style === 'cut' ? 0 : Math.round(dur * 0.6);

    elements.lyricsContainer.classList.add('transitioning');

    setTimeout(() => {
        currentText = text;
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
const BAR_GAP_PX = 24;
const MIN_FONT_PX = 16;

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
        let lo = MIN_FONT_PX, hi = 300;
        for (let pass = 0; pass < 12; pass++) {
            const mid = (lo + hi) / 2;
            measureEl.style.fontSize = mid + 'px';
            const rect = measureEl.getBoundingClientRect();
            if (!rect.height) break;
            if (rect.height > targetH) hi = mid;
            else lo = mid;
        }
        measureEl.style.whiteSpace = '';
        measureEl.style.width = '';
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
        try { applySettings(JSON.parse(event.payload)); }
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
        applySettings(event.data.settings);
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
    loadInitialSettings();
    // Iframe preview: tell the parent we're alive so it can pump current state.
    if (window.parent && window.parent !== window) {
        try { window.parent.postMessage({ type: 'projector-ready' }, '*'); }
        catch (e) { /* parent origin mismatch — harmless */ }
    }
});


// Recompute the song-wide size when the window moves or the resolution changes.
let resizeRaf;
window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => relayout());
});

// The first verse can render before the web font loads; recompute once ready.
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => relayout());
}
