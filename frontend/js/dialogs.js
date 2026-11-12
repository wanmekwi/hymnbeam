// About, the keyboard-shortcut reference, and what Escape closes.
//
// One of several plain scripts that share a single global scope; index.html
// loads them in dependency order (see the <script> tags there).

async function openAboutModal() {
    let version = '';
    if (window.__TAURI__) {
        try {
            version = await window.__TAURI__.core.invoke('get_app_version');
        } catch (e) {
            console.warn('Could not get app version:', e);
        }
    }
    elements.aboutVersion.textContent = version ? `Version ${version}` : '';
    // Drop a stale "up to date" / error line, but keep a found or downloaded
    // update on show — the panel is where the user acts on it.
    if (updateFlow.stage === 'current' || updateFlow.stage === 'error') {
        setUpdateStage('idle');
    } else {
        renderUpdatePanel();
    }
    elements.aboutModal.classList.add('active');
}


function closeAboutModal() {
    elements.aboutModal.classList.remove('active');
}


// ----- Keyboard shortcuts reference -----

// Modifier glyphs. macOS gets the symbols people expect on that platform;
// everywhere else spells them out. The chords themselves come from the native
// menu, which registers them as CmdOrCtrl — so the same table describes both.
const KEY_GLYPHS = navigator.userAgent.includes('Mac')
    ? { mod: '⌘', shift: '⇧', ctrl: '⌃', backspace: '⌫' }
    : { mod: 'Ctrl+', shift: 'Shift+', ctrl: 'Ctrl+', backspace: 'Backspace' };

// Every key in a `keys` entry renders as its own <kbd>; a `/` between two of
// them renders as a plain separator ("this or that"). `{mod}` and friends are
// substituted from KEY_GLYPHS above.
const SHORTCUT_GROUPS = [
    {
        title: 'During the service',
        items: [
            { keys: ['→', '/', '←'], action: 'Next / previous verse' },
            { keys: ['1'], action: 'Jump to verse 1–9' , label: '1–9' },
            { keys: ['0'], action: 'Jump to verse 10' },
            { keys: ['PgDn', '/', 'PgUp'], action: 'Next / previous item in the open collection' },
            { keys: ['.', '/', ','], action: 'Same, without reaching for the page keys' },
            { keys: ['Space'], action: 'Blank / unblank screen' },
            { keys: ['L'], action: 'Show / hide logo slide' },
            { keys: ['Esc'], action: 'Close dialog, clear alert, or clear display' },
        ],
    },
    {
        title: 'Projector',
        items: [
            { keys: ['P'], action: 'Open / close projector' },
            { keys: ['F'], action: 'Open projector (never closes it)' },
            { keys: ['{mod}{shift}P'], action: 'Open / close projector' },
            { keys: ['{mod}B'], action: 'Blank screen' },
            { keys: ['{mod}L'], action: 'Show / hide logo slide' },
        ],
    },
    {
        title: 'Alerts',
        items: [
            { keys: ['A'], action: 'Open the alert box' },
            { keys: ['{shift}A'], action: 'Clear the alert on screen' },
        ],
    },
    {
        title: 'Getting around',
        items: [
            { keys: ['/'], action: 'Search the song library', literalSlash: true },
            { keys: ['{ctrl}1', '/', '{ctrl}2', '/', '{ctrl}3'], action: 'Library / Collections / Bible tab' },
            { keys: ['[', '/', ']'], action: 'Previous / next sidebar tab' },
            { keys: ['?'], action: 'Show this list' },
        ],
    },
    {
        title: 'Library',
        items: [
            { keys: ['{mod}N'], action: 'New song' },
            { keys: ['{mod}E'], action: 'Edit selected song' },
            { keys: ['{mod}{backspace}'], action: 'Delete selected song' },
            { keys: ['{mod}I'], action: 'Import songs' },
            { keys: ['{mod}{shift}I'], action: 'Import from database' },
            { keys: ['{mod},'], action: 'Display settings' },
        ],
    },
];

function formatShortcutKey(key) {
    return key.replace(/\{(\w+)\}/g, (_, name) => KEY_GLYPHS[name] ?? '');
}

function renderShortcutsList() {
    elements.shortcutsGroups.innerHTML = SHORTCUT_GROUPS.map(group => `
        <div class="shortcuts-group">
            <div class="shortcuts-group-title">${group.title}</div>
            ${group.items.map(item => `
                <div class="shortcut-row">
                    <span class="shortcut-action">${escapeHtml(item.action)}</span>
                    <span class="shortcut-keys">${item.keys.map(key =>
                        // A bare "/" separates alternatives, unless the row is
                        // documenting the slash key itself.
                        key === '/' && !item.literalSlash
                            ? '<span class="shortcut-sep">/</span>'
                            : `<kbd>${escapeHtml(item.label ?? formatShortcutKey(key))}</kbd>`
                    ).join('')}</span>
                </div>
            `).join('')}
        </div>
    `).join('');
}

function openShortcutsModal() {
    renderShortcutsList();
    elements.shortcutsModal.classList.add('active');
}


function closeShortcutsModal() {
    elements.shortcutsModal.classList.remove('active');
}


// Which dialogs Escape may dismiss, and how. `editModal` is deliberately absent:
// it holds unsaved lyrics, so Cancel and Save stay the only ways out of it.
// Anything listed here is closed through its own function rather than by
// stripping .active, so per-modal cleanup still runs.
const ESCAPE_CLOSERS = {
    shortcutsModal: () => closeShortcutsModal(),
    settingsModal: () => closeSettingsModal(),
    aboutModal: () => closeAboutModal(),
    confirmModal: () => closeDeleteConfirm(),
    importModal: () => closeImportModal(),
    dbImportModal: () => closeDbImportModal(),
};

// Topmost open dialog, or null. Later in document order wins, which matches the
// stacking the operator sees.
function getOpenModal() {
    const open = document.querySelectorAll('.modal-overlay.active');
    return open.length ? open[open.length - 1] : null;
}

// Escape peels off one layer at a time — dialog, then popover, then the alert
// banner, and only then the projected slide. Clearing the display is the most
// destructive of those, so it must never be what a stray Escape does while
// something else is on screen.
function handleEscape() {
    const modal = getOpenModal();
    if (modal) {
        const close = ESCAPE_CLOSERS[modal.id];
        if (close) close();
        return;
    }
    if (elements.alertPopover.classList.contains('open')) {
        closeAlertPopover();
        return;
    }
    if (alertActive) {
        clearAlert();
        return;
    }
    state.currentSong = null;
    state.currentVerseIndex = 0;
    renderSongDisplay();
    renderSongList();
}
