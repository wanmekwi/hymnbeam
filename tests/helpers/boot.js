// Boots the real operator UI (frontend/index.html + app.js + bible.js) inside
// jsdom, against an in-memory stand-in for the Rust backend and the Tauri
// bridge. Tests then drive it the way an operator does — key presses and
// clicks — and assert on what would have reached the projector.
//
// Nothing here is a copy of app code: the scripts are read from disk and run
// unmodified, so a test failure means the shipped file misbehaves.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');

// The page is given its scripts inline rather than letting jsdom fetch them:
// they run synchronously during parsing and share one global scope, exactly as
// the two <script src> tags do in the webview, and nothing else (styles, fonts,
// the preview iframes) is loaded.
function pageHtml() {
    let html = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8');
    let inlined = 0;
    html = html.replace(/<script src="(js\/[\w.-]+)"><\/script>/g, (_, src) => {
        inlined++;
        return `<script>${fs.readFileSync(path.join(FRONTEND, src), 'utf8')}\n</script>`;
    });
    if (inlined === 0) throw new Error('index.html no longer loads its scripts the way the test harness expects');
    return html;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
});

function summary(song) {
    return {
        id: song.id, title: song.title, author: song.author ?? null,
        song_number: song.song_number ?? null, musical_key: song.musical_key ?? null,
        verse_count: song.verses.length,
    };
}

// The slice of the HTTP API the operator window needs to start up and run a
// service. Anything else answers 404 and is recorded in `unhandled`, so a test
// that wanders outside the fake fails loudly instead of passing by accident.
function makeBackend({ songs = [], collections = [], bible = { books: [], chapters: {} }, latestRelease = null }) {
    // Tests add to collections; work on a copy so fixtures stay pristine.
    collections = structuredClone(collections);
    const requests = [];
    const unhandled = [];

    async function fetch(input, init = {}) {
        const url = new URL(String(input));
        const method = (init.method || 'GET').toUpperCase();
        const route = `${method} ${url.pathname}`;
        requests.push(route + url.search);

        if (url.hostname === 'api.github.com') {
            if (!latestRelease) throw new TypeError('fetch failed');
            return json(latestRelease);
        }

        let m;
        if (route === 'GET /') return json({ ok: true });
        if (route === 'GET /settings') return json({});
        if (route === 'PUT /settings') return json({});
        if (route === 'GET /songs') return json(songs.map(summary));
        if (route === 'GET /songs/search') {
            const q = (url.searchParams.get('q') || '').toLowerCase();
            return json(songs
                .filter(s => s.verses.some(v => v.text.toLowerCase().includes(q)))
                .map(summary));
        }
        if ((m = route.match(/^GET \/songs\/(\d+)$/))) {
            const song = songs.find(s => s.id === Number(m[1]));
            return song ? json(song) : json({ error: 'not found' }, 404);
        }
        if (route === 'GET /collections') {
            return json(collections.map(c => ({ id: c.id, name: c.name, song_count: c.songs.length })));
        }
        if ((m = route.match(/^GET \/collections\/(\d+)$/))) {
            const c = collections.find(x => x.id === Number(m[1]));
            return c ? json(c) : json({ error: 'not found' }, 404);
        }
        if ((m = route.match(/^POST \/collections\/(\d+)\/songs$/))) {
            const c = collections.find(x => x.id === Number(m[1]));
            if (!c) return json({ error: 'not found' }, 404);
            const body = JSON.parse(init.body);
            const entry = { id: 1000 + c.songs.length, item_type: body.item_type || 'song', position: c.songs.length };
            if (entry.item_type === 'bible') Object.assign(entry, { reference: body.reference, title: body.reference });
            else if (entry.item_type === 'logo') entry.title = 'Logo slide';
            else {
                const song = songs.find(s => s.id === body.song_id);
                Object.assign(entry, { song_id: song.id, title: song.title, author: song.author });
            }
            c.songs.push(entry);
            return json({ id: entry.id });
        }
        if (route === 'GET /bible/books') return json(bible.books);
        if ((m = route.match(/^GET \/bible\/([^/]+)\/(\d+)$/))) {
            const verses = bible.chapters[`${decodeURIComponent(m[1])}/${m[2]}`];
            return verses ? json(verses) : json({ error: 'not found' }, 404);
        }

        unhandled.push(route);
        return json({ error: 'not handled by the test backend' }, 404);
    }

    return { fetch, requests, unhandled };
}

// Stand-in for window.__TAURI__. Records every command the UI invokes;
// `projector` filters that down to what was sent to the projector window.
function makeTauri({ version = '0.5.1', updater = null } = {}) {
    const invokes = [];
    const listeners = new Map();
    const relaunches = [];

    const tauri = {
        core: {
            async invoke(cmd, args) {
                invokes.push({ cmd, args });
                if (cmd === 'get_app_version') return version;
                return null;
            },
        },
        event: {
            async listen(name, fn) {
                listeners.set(name, fn);
                return () => listeners.delete(name);
            },
        },
        process: { async relaunch() { relaunches.push(Date.now()); } },
    };
    if (updater) tauri.updater = updater;

    return {
        tauri, invokes, relaunches,
        // Fire a backend → webview event, e.g. a menu item or 'projector-closed'.
        emit(name, payload) {
            const fn = listeners.get(name);
            if (!fn) throw new Error(`the app is not listening for "${name}"`);
            return fn({ event: name, payload });
        },
    };
}

/**
 * Start the operator window.
 *
 * @param {object} [options]
 * @param {Array}  [options.songs]        full songs ({id, title, verses:[{label, text}], ...})
 * @param {Array}  [options.collections]  full collections ({id, name, songs:[entries]})
 * @param {object} [options.bible]        {books: [...], chapters: {'GEN/1': [{verse, text}]}}
 * @param {object} [options.updater]      stand-in for window.__TAURI__.updater
 * @param {object} [options.latestRelease] body returned by the GitHub releases API (null = offline)
 * @param {string} [options.version]      what get_app_version reports
 */
async function bootApp(options = {}) {
    const backend = makeBackend(options);
    const bridge = makeTauri(options);
    const pageErrors = [];

    const dom = new JSDOM(pageHtml(), {
        url: 'http://hymnbeam.test/',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        beforeParse(window) {
            window.fetch = backend.fetch;
            window.__TAURI__ = bridge.tauri;
            window.Element.prototype.scrollIntoView = () => {};
            // The app logs its own progress and expected failures; keep test
            // output for the test runner. Uncaught errors are still collected.
            for (const level of ['log', 'info', 'warn', 'error', 'debug']) window.console[level] = () => {};
            window.addEventListener('error', (e) => pageErrors.push(e.error || e.message));
            window.addEventListener('unhandledrejection', (e) => pageErrors.push(e.reason));
        },
    });
    const { window } = dom;
    const evaluate = (expr) => window.eval(expr);

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    // Let pending fetches and their follow-up renders finish.
    const settle = async (rounds = 5) => { for (let i = 0; i < rounds; i++) await sleep(0); };
    const until = async (predicate, what = 'condition', timeoutMs = 2000) => {
        const deadline = Date.now() + timeoutMs;
        while (!predicate()) {
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
            await sleep(5);
        }
    };

    // Start-up is finished once the song list request has been answered.
    await until(() => backend.requests.some(r => r.startsWith('GET /songs?')), 'the app to finish starting');
    await settle();

    const app = {
        window,
        document: window.document,
        /** Evaluate an expression in the page, e.g. app.eval('state.navPosition'). */
        eval: evaluate,
        /** Read live app state as plain data. */
        state: (field) => JSON.parse(evaluate(`JSON.stringify(state.${field} ?? null)`)),
        requests: backend.requests,
        unhandledRequests: backend.unhandled,
        invokes: bridge.invokes,
        relaunches: bridge.relaunches,
        emit: bridge.emit,
        pageErrors,
        settle, sleep, until,

        /** Every payload sent to the projector window for `event`, oldest first. */
        projected(event = 'update-lyrics') {
            return bridge.invokes
                .filter(i => i.cmd === 'send_to_projector' && i.args.event === event)
                .map(i => JSON.parse(i.args.payload));
        },
        /** The slide the congregation is looking at, or undefined before any was sent. */
        onScreen() {
            return app.projected().at(-1);
        },

        /** Press a key the way the operator would, on the page or a focused element. */
        async press(key, { target = window.document.body, ...modifiers } = {}) {
            target.dispatchEvent(new window.KeyboardEvent('keydown', {
                key, bubbles: true, cancelable: true, ...modifiers,
            }));
            await settle();
        },
        async click(selector) {
            const el = typeof selector === 'string' ? window.document.querySelector(selector) : selector;
            if (!el) throw new Error(`nothing matches ${selector}`);
            el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
            await settle();
        },

        /** Select a song from the library list, as a click on it does. */
        async openSong(id) {
            await app.click(`.song-item[data-id="${id}"]`);
            await until(() => app.state('currentSong')?.id === id, `song ${id} to load`);
        },
        /** Open the projector and wait for its first paint to be pushed. */
        async openProjector() {
            await app.press('f');
            await until(() => app.state('projectorOpen') === true, 'the projector to open');
            // toggleProjector pushes the current slide half a second after the
            // window opens, to give the new webview time to start listening.
            await sleep(550);
            await settle();
        },

        /** Stop timers and free the window. Call from an afterEach. */
        close() { window.close(); },
    };
    return app;
}

module.exports = { bootApp };
