const elements = {
    lyricsText: document.getElementById('lyricsText'),
    lyricsContainer: document.querySelector('.lyrics-container'),
    blankScreen: document.getElementById('blankScreen'),
    songTitleBar: document.getElementById('songTitleBar'),
    songMetaBar: document.getElementById('songMetaBar')
};

let currentText = '';
let currentSongId = null;
let currentVerses = [];
let songFontSize = null;

// Off-screen node for measuring verse sizes without disturbing the visible one.
const measureEl = document.createElement('div');
measureEl.className = 'lyrics-text';
measureEl.setAttribute('aria-hidden', 'true');
measureEl.style.cssText = 'position:absolute;visibility:hidden;left:-99999px;top:0';
document.body.appendChild(measureEl);


function updateDisplay(data) {
    const { text, isBlank, title, author, musical_key, songId, verses } = data;

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

    if (text === currentText) return;

    elements.lyricsContainer.classList.add('transitioning');

    setTimeout(() => {
        currentText = text;
        elements.lyricsText.textContent = text;
        applySongFontSize();
        elements.lyricsContainer.classList.remove('transitioning');
        elements.lyricsText.classList.add('entering');

        setTimeout(() => {
            elements.lyricsText.classList.remove('entering');
        }, 500);
    }, 300);
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
    const targetW = window.innerWidth * FILL_RATIO;
    const targetH = window.innerHeight * FILL_RATIO;

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
} else {
    window.addEventListener('message', (event) => {
        if (event.data.type === 'update-lyrics') {
            updateDisplay(event.data);
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
