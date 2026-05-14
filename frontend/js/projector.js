const elements = {
    lyricsText: document.getElementById('lyricsText'),
    lyricsContainer: document.querySelector('.lyrics-container'),
    blankScreen: document.getElementById('blankScreen'),
    songTitleBar: document.getElementById('songTitleBar'),
    songMetaBar: document.getElementById('songMetaBar')
};

let currentText = '';
let currentSongId = null;


function updateDisplay(data) {
    const { text, isBlank, title, author, musical_key, songId } = data;
    
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
    }
    
    if (text === currentText) return;
    
    elements.lyricsContainer.classList.add('transitioning');
    
    setTimeout(() => {
        currentText = text;
        elements.lyricsText.textContent = text;
        fitText(elements.lyricsText);
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

// Scale the verse to fill ~90% of the screen on whichever axis binds first.
// With `white-space: pre` the text never wraps, so its width and height both
// scale linearly with font-size — one measurement at a base size is enough to
// solve for the exact fit, no iteration needed.
function fitText(element) {
    const BASE = 100;
    element.style.fontSize = BASE + 'px';

    const naturalW = element.scrollWidth;
    const naturalH = element.scrollHeight;
    if (!naturalW || !naturalH) return;

    const targetW = window.innerWidth * FILL_RATIO;
    const targetH = window.innerHeight * FILL_RATIO;
    const scale = Math.min(targetW / naturalW, targetH / naturalH);

    element.style.fontSize = Math.max(MIN_FONT_PX, BASE * scale).toFixed(1) + 'px';
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


// Re-fit when the projector window moves or the display resolution changes.
let resizeRaf;
window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
        if (currentText) fitText(elements.lyricsText);
    });
});

// The first verse can render before the web font loads; re-fit once it's ready.
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
        if (currentText) fitText(elements.lyricsText);
    });
}
