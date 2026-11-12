// What goes out to the screen: projector payloads and previews, opening the
// projector, blank / logo states, the alert banner, and verse navigation.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

// Build the projector payload from current operator state. Both the real
// projector window and the in-operator preview iframe consume this — same
// shape, so any future projector-side field shows up in the preview for free.
function buildProjectorPayload() {
    if (!state.currentSong) return null;
    const currentVerse = state.currentSong.verses[state.currentVerseIndex];
    const navLen = state.navigationOrder.length;
    return {
        text: state.isBlank ? '' : (currentVerse?.text || ''),
        label: currentVerse?.label || '',
        isBlank: state.isBlank,
        title: state.currentSong.title,
        author: state.currentSong.author,
        musical_key: state.currentSong.musical_key,
        songId: state.currentSong.id,
        songNumber: state.currentSong.song_number || null,
        verses: state.currentSong.verses.map(v => v.text),
        // Nav-position rather than verse-index so the audience-facing arrow
        // reflects "operator can advance to another slide" (which includes
        // chorus repeats), not just "there's a later verse in the song body".
        hasPrev: navLen > 0 && state.navPosition > 0,
        hasNext: navLen > 0 && state.navPosition < navLen - 1
    };
}

// Payload for the slide the *next* advance will project — i.e. the verse at
// navPosition + 1 in the navigation order. Returns null at the end of the song
// (nothing queued) or when no song is loaded. Blanking the live screen doesn't
// change what's queued, so isBlank is ignored here.
function buildNextPreviewPayload() {
    if (!state.currentSong) return null;
    const nextNavPos = state.navPosition + 1;
    if (nextNavPos >= state.navigationOrder.length) return null;
    const idx = state.navigationOrder[nextNavPos];
    const verse = state.currentSong.verses[idx];
    if (!verse) return null;
    return {
        text: verse.text || '',
        label: verse.label || '',
        isBlank: false,
        title: state.currentSong.title,
        author: state.currentSong.author,
        musical_key: state.currentSong.musical_key,
        songId: state.currentSong.id,
        songNumber: state.currentSong.song_number || null,
        verses: state.currentSong.verses.map(v => v.text),
        hasPrev: true,
        hasNext: nextNavPos < state.navigationOrder.length - 1
    };
}

const BLANK_PREVIEW_MSG = { type: 'update-lyrics', text: '', label: '', isBlank: true,
    verses: [], hasPrev: false, hasNext: false };

// Sync the "Next" preview iframe with what the next advance will show. Shows an
// "End of song" placeholder when nothing is queued, and nothing when no song is
// loaded.
function updateNextPreview() {
    const frame = elements.nextPreviewFrame;
    const empty = elements.nextPreviewEmpty;
    if (!frame || !frame.contentWindow) return;
    const payload = buildNextPreviewPayload();
    if (!payload) {
        const atEnd = !!state.currentSong;
        empty.textContent = atEnd ? 'End of song' : '';
        empty.classList.toggle('visible', atEnd);
        frame.contentWindow.postMessage(BLANK_PREVIEW_MSG, '*');
        return;
    }
    empty.classList.remove('visible');
    frame.contentWindow.postMessage({ type: 'update-lyrics', ...payload }, '*');
}

// Sync the preview iframe. Always safe to call — no-op if the iframe isn't
// loaded yet or there's no current song. `updatePreview()` accepts an
// optional text arg for callers that still pass one; the arg is ignored
// because the iframe pulls everything from buildProjectorPayload(). The single
// choke point for both preview panes, so the Next pane updates in lockstep.
function updatePreview(_text) {
    if (!previewsEnabled()) return;   // previews are off — don't feed them
    const frame = elements.previewFrame;
    if (frame && frame.contentWindow) {
        const payload = buildProjectorPayload();
        frame.contentWindow.postMessage(
            payload ? { type: 'update-lyrics', ...payload } : BLANK_PREVIEW_MSG, '*');
    }
    updateNextPreview();
}

async function sendToProjector() {
    updatePreview();
    if (!state.projectorOpen || !state.currentSong) return;

    const payload = buildProjectorPayload();
    if (!payload) return;

    try {
        if (window.__TAURI__) {
            await window.__TAURI__.core.invoke('send_to_projector', {
                event: 'update-lyrics',
                payload: JSON.stringify(payload)
            });
        }
    } catch (error) {
        console.error('Error sending to projector:', error);
    }

    if (!window.__TAURI__ && window.projectorWindow) {
        window.projectorWindow.postMessage({ type: 'update-lyrics', ...payload }, '*');
    }
}


// Single source of truth for the header button's label and icon, so the four
// places that can change projector state (open, close, the browser fallback,
// and the projector-closed event) can never disagree about what it says.
function setProjectorButton(open) {
    elements.projectorBtn.innerHTML = open
        ? `
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M5 5l10 10M15 5L5 15"/>
            </svg>
            Close Projector
        `
        : `
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="4" width="16" height="10" rx="1"/>
                <path d="M6 17h8"/>
                <path d="M10 14v3"/>
            </svg>
            Open Projector
        `;
}


async function toggleProjector() {
    try {
        if (window.__TAURI__) {
            if (state.projectorOpen) {
                await window.__TAURI__.core.invoke('close_projector_window');
                state.projectorOpen = false;
                setProjectorButton(false);
            } else {
                await window.__TAURI__.core.invoke('open_projector_window');
                state.projectorOpen = true;
                setProjectorButton(true);
                setTimeout(() => {
                    sendToProjector();
                    pushSettingsToProjector();
                    sendLogoState();
                    resendAlertState();
                }, 500);
            }
        } else if (state.projectorOpen && window.projectorWindow) {
            // Browser fallback (dev only — the shipped app always has Tauri).
            // This branch used to open unconditionally, so the toggle was
            // one-way outside Tauri.
            window.projectorWindow.close();
            window.projectorWindow = null;
            state.projectorOpen = false;
            setProjectorButton(false);
        } else {
            const projectorWindow = window.open('projector.html', 'projector',
                'width=1280,height=720,menubar=no,toolbar=no');
            if (projectorWindow) {
                state.projectorOpen = true;
                window.projectorWindow = projectorWindow;
                setProjectorButton(true);
            }
        }
    } catch (error) {
        console.error('Error toggling projector:', error);
    }
}


function toggleBlank() {
    state.isBlank = !state.isBlank;
    // Blank and logo are mutually exclusive projector states.
    if (state.isBlank && state.showLogo) state.showLogo = false;
    syncScreenStateButtons();
    updatePreview(state.currentSong?.verses[state.currentVerseIndex]?.text || '');
    sendToProjector();
    sendLogoState();
}

function toggleLogo() {
    state.showLogo = !state.showLogo;
    if (state.showLogo && state.isBlank) state.isBlank = false;
    syncScreenStateButtons();
    updatePreview();
    sendToProjector();
    sendLogoState();
}

function syncScreenStateButtons() {
    elements.blankBtn.classList.toggle('active', state.isBlank);
    elements.logoBtn.classList.toggle('active', state.showLogo);
}

// Logo is an independent overlay, sent on its own channel so it works with no
// song loaded (pre-service). Mirrors sendToProjector's live-preview + projector
// + browser-fallback fan-out, but only to the live preview (the Next pane keeps
// showing the queued verse).
function sendLogoState() {
    const image = state.settings?.logo?.image || null;
    const msg = { type: 'show-logo', show: state.showLogo, image };
    if (elements.previewFrame?.contentWindow) {
        elements.previewFrame.contentWindow.postMessage(msg, '*');
    }
    if (window.__TAURI__) {
        if (state.projectorOpen) {
            window.__TAURI__.core.invoke('send_to_projector', {
                event: 'show-logo',
                payload: JSON.stringify({ show: state.showLogo, image })
            }).catch(err => console.error('Failed to send logo state:', err));
        }
    } else if (window.projectorWindow) {
        window.projectorWindow.postMessage(msg, '*');
    }
}


// ----- Projector alert banner -----

const ALERT_RECENTS_KEY = 'hymnbeam.alertRecents';
let alertActive = false;
let alertTimer = null;
let currentAlertText = '';

// Re-assert the current alert to a freshly-opened projector / preview so it
// isn't lost when a window opens after the alert was raised.
function resendAlertState() {
    if (alertActive && currentAlertText) {
        sendAlert('show-alert', { text: currentAlertText });
    }
}

// Fan an alert event out to the live preview + real projector + browser
// fallback (same channels as the lyrics/logo transports).
function sendAlert(event, payload) {
    const msg = { type: event, ...payload };
    if (elements.previewFrame?.contentWindow) {
        elements.previewFrame.contentWindow.postMessage(msg, '*');
    }
    if (window.__TAURI__) {
        if (state.projectorOpen) {
            window.__TAURI__.core.invoke('send_to_projector', {
                event, payload: JSON.stringify(payload)
            }).catch(err => console.error('Failed to send alert:', err));
        }
    } else if (window.projectorWindow) {
        window.projectorWindow.postMessage(msg, '*');
    }
}

function updateAlertIndicator() {
    elements.alertBtn.classList.toggle('active', alertActive);
    elements.alertLiveDot.classList.toggle('visible', alertActive);
}

function showAlert() {
    const text = elements.alertInput.value.trim();
    if (!text) {
        elements.alertInput.focus();
        return;
    }
    clearTimeout(alertTimer);
    alertActive = true;
    currentAlertText = text;
    updateAlertIndicator();
    sendAlert('show-alert', { text });
    saveAlertRecent(text);

    // The operator owns the auto-clear timer so its "live" indicator stays
    // authoritative; when it fires it sends clear-alert to the projector.
    const seconds = parseInt(elements.alertAutoClear.value, 10) || 0;
    if (seconds > 0) {
        alertTimer = setTimeout(() => clearAlert(), seconds * 1000);
    }
    closeAlertPopover();
}

function clearAlert() {
    clearTimeout(alertTimer);
    alertTimer = null;
    if (!alertActive) return;
    alertActive = false;
    currentAlertText = '';
    updateAlertIndicator();
    sendAlert('clear-alert', {});
}

function toggleAlertPopover() {
    const open = elements.alertPopover.classList.toggle('open');
    if (open) {
        renderAlertRecents();
        elements.alertInput.focus();
    }
}

function closeAlertPopover() {
    elements.alertPopover.classList.remove('open');
}

function loadAlertRecents() {
    try {
        const raw = localStorage.getItem(ALERT_RECENTS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(s => typeof s === 'string') : [];
    } catch (e) {
        return [];
    }
}

function saveAlertRecent(text) {
    // Most-recent-first, de-duplicated, capped at 6. Nursery alerts repeat.
    const recents = [text, ...loadAlertRecents().filter(t => t !== text)].slice(0, 6);
    try { localStorage.setItem(ALERT_RECENTS_KEY, JSON.stringify(recents)); }
    catch (e) { /* storage full/blocked — non-fatal */ }
    renderAlertRecents();
}

function renderAlertRecents() {
    const recents = loadAlertRecents();
    elements.alertRecents.innerHTML = recents
        .map(t => `<option value="${t.replace(/"/g, '&quot;')}"></option>`).join('');
}


function navigateVerse(direction) {
    if (!state.currentSong) return;

    const newNavPos = state.navPosition + direction;
    if (newNavPos >= 0 && newNavPos < state.navigationOrder.length) {
        state.navPosition = newNavPos;
        state.currentVerseIndex = state.navigationOrder[newNavPos];
        renderSongDisplay();
        sendToProjector();
    }
}


function jumpToVerse(index) {
    if (!state.currentSong) return;

    if (index >= 0 && index < state.currentSong.verses.length) {
        state.currentVerseIndex = index;
        const navPos = state.navigationOrder.indexOf(index);
        if (navPos !== -1) {
            state.navPosition = navPos;
        }
        renderSongDisplay();
        sendToProjector();
    }
}
