const elements = {
    lyricsText: document.getElementById('lyricsText'),
    lyricsContainer: document.querySelector('.lyrics-container'),
    verseLabel: document.getElementById('verseLabel'),
    blankScreen: document.getElementById('blankScreen'),
    songTitleBar: document.getElementById('songTitleBar'),
    songMetaBar: document.getElementById('songMetaBar'),
    projector: document.querySelector('.projector')
};

let currentText = '';
let currentSongId = null;
let currentVerses = [];
let songFontSize = null;
let currentSettings = null;
let apiBase = null;

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
        elements.lyricsText.style.textAlign = t.alignment;
        elements.lyricsContainer.style.justifyContent =
            t.alignment === 'left' ? 'flex-start' : 'center';
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

    // Font swap or safe-area change resizes the available box, so re-fit.
    if (currentVerses.length) {
        const recompute = () => {
            songFontSize = computeSongFontSize(currentVerses);
            applySongFontSize();
        };
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(recompute);
        } else {
            recompute();
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
    if (!window.__TAURI__) return;
    try {
        const port = await window.__TAURI__.core.invoke('get_api_port');
        apiBase = `http://127.0.0.1:${port}`;
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


function updateDisplay(data) {
    const { text, label, isBlank, title, author, musical_key, songId, verses } = data;

    if (isBlank) {
        elements.blankScreen.classList.add('active');
        elements.songTitleBar.classList.remove('visible');
        elements.songMetaBar.classList.remove('visible');
        return;
    }

    elements.blankScreen.classList.remove('active');

    if (songId !== currentSongId) {
        currentSongId = songId;
        updateSongMeta(title, author, musical_key, songId);
        currentVerses = verses && verses.length ? verses : (text ? [text] : []);
        songFontSize = computeSongFontSize(currentVerses);
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
        elements.lyricsText.textContent = text;
        applySongFontSize();
        elements.lyricsContainer.classList.remove('transitioning');
        if (trans.style !== 'cut' && trans.style !== 'fade') {
            elements.lyricsText.classList.add('entering');
            setTimeout(() => elements.lyricsText.classList.remove('entering'), dur);
        }
    }, halfDur);
}


function updateSongMeta(title, author, musical_key, songId) {
    elements.songTitleBar.textContent = title || '';
    elements.songTitleBar.classList.toggle('visible', !!title);
    
    const hasAnyMeta = songId || musical_key || author;
    
    let metaHtml = `
        <div class="meta-col">
            ${songId ? `<span class="meta-label">#</span><span class="meta-value">${songId}</span>` : ''}
        </div>
        <div class="meta-col">
            ${musical_key ? `<span class="meta-label">Key:</span><span class="meta-value">${musical_key}</span>` : ''}
        </div>
        <div class="meta-col">
            ${author ? `<span class="meta-value">${author}</span>` : ''}
        </div>
    `;
    
    elements.songMetaBar.innerHTML = metaHtml;
    elements.songMetaBar.classList.toggle('visible', hasAnyMeta);
}


const FILL_RATIO = 0.9;
const MIN_FONT_PX = 16;

// Measure the largest font-size at which `text` fits within the 90% box, using
// the off-screen node so the visible verse isn't disturbed. `white-space: pre`
// means lines never wrap (they break only where the lyrics already do), so
// width and height scale almost linearly with font-size. Font metrics aren't
// perfectly linear though — sub-pixel rounding, hinting — so we measure-and-
// correct over a few passes and round down so it never tips over 90%.
function measureFitSize(text) {
    measureEl.textContent = text;
    // Container size already accounts for safe-area padding on .projector and
    // for the title/meta bars (they're absolute-positioned so don't reduce it,
    // but the bars sit inside the safe area, so leaving a small margin here is
    // still useful when bars are visible — the FILL_RATIO covers that).
    const cw = elements.lyricsContainer.clientWidth || window.innerWidth;
    const ch = elements.lyricsContainer.clientHeight || window.innerHeight;
    const targetW = cw * FILL_RATIO;
    const targetH = ch * FILL_RATIO;

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


if (window.__TAURI__) {
    window.__TAURI__.event.listen('update-lyrics', (event) => {
        try {
            const data = JSON.parse(event.payload);
            updateDisplay(data);
        } catch (error) {
            console.error('Error parsing lyrics update:', error);
        }
    });
    window.__TAURI__.event.listen('apply-settings', (event) => {
        try {
            applySettings(JSON.parse(event.payload));
        } catch (error) {
            console.error('Error parsing settings update:', error);
        }
    });
} else {
    window.addEventListener('message', (event) => {
        if (event.data.type === 'update-lyrics') {
            updateDisplay(event.data);
        } else if (event.data.type === 'apply-settings') {
            applySettings(event.data.settings);
        }
    });
}


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
});


// Recompute the song-wide size when the window moves or the resolution changes.
let resizeRaf;
window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
        if (!currentVerses.length) return;
        songFontSize = computeSongFontSize(currentVerses);
        applySongFontSize();
    });
});

// The first verse can render before the web font loads; recompute once ready.
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
        if (!currentVerses.length) return;
        songFontSize = computeSongFontSize(currentVerses);
        applySongFontSize();
    });
}
