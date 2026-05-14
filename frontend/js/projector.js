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
        applyTextSizeClass(elements.lyricsText, text);
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


function applyTextSizeClass(element, text) {
    element.classList.remove('size-xl', 'size-lg', 'size-md', 'size-sm', 'size-xs');
    
    const lineCount = (text.match(/\n/g) || []).length + 1;
    const charCount = text.length;
    const maxLineLength = Math.max(...text.split('\n').map(l => l.length));
    
    let sizeClass = 'size-xl';
    
    if (lineCount <= 2 && charCount <= 60) {
        sizeClass = 'size-xl';
    } else if (lineCount <= 4 && charCount <= 120 && maxLineLength <= 40) {
        sizeClass = 'size-lg';
    } else if (lineCount <= 6 && charCount <= 200 && maxLineLength <= 50) {
        sizeClass = 'size-md';
    } else if (lineCount <= 8 && charCount <= 300) {
        sizeClass = 'size-sm';
    } else {
        sizeClass = 'size-xs';
    }
    
    element.classList.add(sizeClass);
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
