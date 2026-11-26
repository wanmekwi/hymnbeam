// Boots the real operator UI (frontend/index.html and every script it loads) inside
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
// the <script src> tags do in the webview, and nothing else (styles, fonts,
// the preview iframes) is loaded.
function pageHtml(page = 'index.html') {
    let html = fs.readFileSync(path.join(FRONTEND, page), 'utf8');
    let inlined = 0;
    html = html.replace(/<script src="(js\/[\w.-]+)"><\/script>/g, (_, src) => {
        inlined++;
        return `<script>${fs.readFileSync(path.join(FRONTEND, src), 'utf8')}\n</script>`;
    });
    if (inlined === 0) throw new Error(`${page} no longer loads its scripts the way the test harness expects`);
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

// An in-memory stand-in for the Rust backend: the HTTP API the operator window
// talks to, with just enough behaviour (soft delete, number conflicts, entry
// ordering) for the UI to be exercised end to end. Its state is exposed to
// tests as `app.backend`. A request it has no route for answers 404 and is
// recorded in `unhandled`, so a test that wanders outside the fake fails
// loudly instead of passing by accident.
function makeBackend(options) {
    const db = {
        // Deep copies: tests mutate these, the fixtures must stay pristine.
        songs: structuredClone(options.songs ?? []),
        collections: structuredClone(options.collections ?? []),
        bible: options.bible ?? { books: [], chapters: {}, search: [] },
        // The installed message library, or null for none: {status, works,
        // paragraphs: {code: [{id, number, text}]}}. Tests may swap it, as an
        // import or removal does.
        messages: structuredClone(options.messages ?? null),
        settings: structuredClone(options.settings ?? {}),
        trash: structuredClone(options.trash ?? []),
        backups: structuredClone(options.backups ?? []),
        duplicates: structuredClone(options.duplicates ?? []),
        latestRelease: options.latestRelease ?? null,
        requests: [],       // 'METHOD /path?query', in order
        bodies: [],         // {route, body} for every request that carried JSON
        unhandled: [],
        failing: [...(options.failing ?? [])],   // regexes; a matching 'METHOD /path' answers 500
        nextId: 500,
    };
    const collection = (id) => db.collections.find(c => c.id === Number(id));

    async function fetch(input, init = {}) {
        const url = new URL(String(input));
        const method = (init.method || 'GET').toUpperCase();
        const route = `${method} ${url.pathname}`;
        db.requests.push(route + url.search);

        let body = null;
        if (typeof init.body === 'string') {
            try { body = JSON.parse(init.body); } catch { body = init.body; }
            db.bodies.push({ route, body });
        }

        if (url.hostname === 'api.github.com') {
            if (!db.latestRelease) throw new TypeError('fetch failed');
            return json(db.latestRelease);
        }
        if (db.failing.some(re => re.test(route))) return json({ error: 'forced failure' }, 500);

        let m;
        if (route === 'GET /') return json({ ok: true });

        if (route === 'GET /settings') return json(db.settings);
        if (route === 'PUT /settings') { db.settings = body; return json({}); }

        if (route === 'GET /songs') return json(db.songs.map(summary));
        if (route === 'GET /songs/search') {
            const q = (url.searchParams.get('q') || '').toLowerCase();
            return json(db.songs
                .filter(s => s.verses.some(v => v.text.toLowerCase().includes(q)))
                .map(summary));
        }
        if (route === 'POST /songs' || (m = route.match(/^PUT \/songs\/(\d+)$/))) {
            const id = m ? Number(m[1]) : db.nextId++;
            const clash = body.song_number != null && db.songs.some(s =>
                s.id !== id && String(s.song_number) === String(body.song_number));
            if (clash) return json({ error: 'song number in use' }, 409);
            const song = { ...body, id };
            const at = db.songs.findIndex(s => s.id === id);
            if (at === -1) db.songs.push(song); else db.songs[at] = song;
            return json({ id });
        }
        if ((m = route.match(/^GET \/songs\/(\d+)$/))) {
            const song = db.songs.find(s => s.id === Number(m[1]));
            return song ? json(song) : json({ error: 'not found' }, 404);
        }
        if ((m = route.match(/^DELETE \/songs\/(\d+)$/))) {
            const at = db.songs.findIndex(s => s.id === Number(m[1]));
            if (at === -1) return json({ error: 'not found' }, 404);
            const [song] = db.songs.splice(at, 1);
            db.trash.push({ ...song, deleted_at: '2026-11-12 09:30:00' });
            return json({});
        }
        if ((m = route.match(/^POST \/songs\/(\d+)\/restore$/))) {
            const at = db.trash.findIndex(s => s.id === Number(m[1]));
            if (at === -1) return json({ error: 'not found' }, 404);
            const [{ deleted_at, ...song }] = db.trash.splice(at, 1);
            db.songs.push(song);
            return json({});
        }
        if (route === 'GET /trash') {
            return json(db.trash.map(s => ({ id: s.id, title: s.title, author: s.author ?? undefined, deleted_at: s.deleted_at })));
        }
        if (route === 'GET /duplicates') return json(db.duplicates);
        if (route === 'GET /export') {
            return new Response(`exported as ${url.searchParams.get('format')}`, { status: 200 });
        }

        if (route === 'GET /backups') return json(db.backups);
        if (route === 'POST /backups') {
            const backup = { name: `songs-20261112-10153${db.backups.length}-manual.db`, created_at_ms: 1794477330000, size_bytes: 2_400_000 };
            db.backups.unshift(backup);
            return json(backup);
        }
        if ((m = route.match(/^POST \/backups\/([^/]+)\/restore$/))) {
            const backup = db.backups.find(b => b.name === decodeURIComponent(m[1]));
            if (!backup) return json({ error: 'not found' }, 404);
            if (backup.songs) db.songs = structuredClone(backup.songs);
            return json({});
        }

        if (route === 'GET /collections') {
            return json(db.collections.map(c => ({ id: c.id, name: c.name, song_count: c.songs.length })));
        }
        if (route === 'POST /collections') {
            const created = { id: db.nextId++, name: body.name, songs: [] };
            db.collections.push(created);
            return json({ id: created.id });
        }
        if ((m = route.match(/^GET \/collections\/(\d+)$/))) {
            const c = collection(m[1]);
            // Like the real query, entries whose song has been deleted are left out.
            return c
                ? json({ ...c, songs: c.songs.filter(e => e.song_id == null || db.songs.some(s => s.id === e.song_id)) })
                : json({ error: 'not found' }, 404);
        }
        if ((m = route.match(/^PUT \/collections\/(\d+)$/))) {
            const c = collection(m[1]);
            if (!c) return json({ error: 'not found' }, 404);
            c.name = body.name;
            return json({});
        }
        if ((m = route.match(/^DELETE \/collections\/(\d+)$/))) {
            db.collections = db.collections.filter(c => c.id !== Number(m[1]));
            return json({});
        }
        if ((m = route.match(/^POST \/collections\/(\d+)\/songs$/))) {
            const c = collection(m[1]);
            if (!c) return json({ error: 'not found' }, 404);
            const entry = { id: db.nextId++, item_type: body.item_type || 'song', position: c.songs.length };
            if (entry.item_type === 'bible') Object.assign(entry, { reference: body.reference, title: body.reference });
            else if (entry.item_type === 'logo') entry.title = 'Logo slide';
            else if (entry.item_type === 'message') {
                // As the real route does: a reference naming a message, titled by its code and paragraph number.
                let quote = null;
                try { quote = JSON.parse(body.reference); } catch { quote = null; }
                if (!quote || typeof quote.code !== 'string' || !quote.code.trim()) return json({ error: 'bad reference' }, 400);
                Object.assign(entry, { reference: body.reference, title: Number.isInteger(quote.n) ? `${quote.code} ¶${quote.n}` : quote.code });
            }
            else {
                const song = db.songs.find(s => s.id === body.song_id);
                if (!song) return json({ error: 'no such song' }, 404);
                Object.assign(entry, { song_id: song.id, title: song.title, author: song.author });
            }
            c.songs.push(entry);
            return json({ entry_id: entry.id });
        }
        if ((m = route.match(/^DELETE \/collections\/(\d+)\/songs\/(\d+)$/))) {
            const c = collection(m[1]);
            if (!c) return json({ error: 'not found' }, 404);
            c.songs = c.songs.filter(e => e.id !== Number(m[2]));
            return json({});
        }
        if ((m = route.match(/^PUT \/collections\/(\d+)\/reorder$/))) {
            const c = collection(m[1]);
            if (!c) return json({ error: 'not found' }, 404);
            c.songs = body.order.map(id => c.songs.find(e => e.id === id));
            return json({});
        }

        if (route === 'GET /bible/books') return json(db.bible.books);
        if (route === 'GET /bible/search') {
            const q = (url.searchParams.get('q') || '').toLowerCase();
            return json((db.bible.search || []).filter(h => h.text.toLowerCase().includes(q)));
        }
        if ((m = route.match(/^GET \/bible\/([^/]+)\/(\d+)$/))) {
            const verses = db.bible.chapters[`${decodeURIComponent(m[1])}/${m[2]}`];
            return verses ? json(verses) : json({ error: 'not found' }, 404);
        }

        if (route === 'GET /messages/status') return json(db.messages ? db.messages.status : { installed: false });
        if (route.startsWith('GET /messages')) {
            // Like the real backend, every other message route answers 404 with
            // a plain-text reason while no library is installed.
            if (!db.messages) return new Response('No message library is installed', { status: 404 });
            if (route === 'GET /messages') return json(db.messages.works);
            if (route === 'GET /messages/search') return json(searchMessages(db.messages, url.searchParams));
            if ((m = route.match(/^GET \/messages\/([^/]+)$/))) {
                const code = decodeURIComponent(m[1]);
                const work = db.messages.works.find(w => w.code === code);
                return work
                    ? json({ ...work, paragraphs: db.messages.paragraphs[code] ?? [] })
                    : new Response(`No message ${code}`, { status: 404 });
            }
        }

        db.unhandled.push(route);
        return json({ error: 'not handled by the test backend' }, 404);
    }

    return { fetch, db };
}

// A stand-in for the phrase search: paragraphs holding the words typed as a
// phrase first, then those holding all of them; the year and kind filters as
// the real search applies them; the first word marked in the snippet with the
// same private-use characters. Like the real snippet, a long paragraph's is
// cut to 16 words around the match, with '…' where words were left out.
function searchMessages(library, params) {
    const q = (params.get('q') || '').toLowerCase().trim();
    const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!words.length) return [];
    const from = params.has('from') ? Number(params.get('from')) : null;
    const to = params.has('to') ? Number(params.get('to')) : null;
    const kind = params.get('kind');
    const code = params.get('code');
    const limit = Number(params.get('limit') || 20);
    // As the real backend names them: the words as a phrase, then all of them anywhere.
    const groups = { phrase: [], all: [] };
    for (const work of library.works) {
        if (kind && kind !== 'all' && work.kind !== kind) continue;
        if (code && work.code !== code) continue;
        if (from != null && !(work.year >= from)) continue;
        if (to != null && !(work.year <= to)) continue;
        for (const p of library.paragraphs[work.code] ?? []) {
            const text = p.text.toLowerCase();
            const group = text.includes(q) ? 'phrase'
                : words.every(w => text.includes(w)) ? 'all' : null;
            if (!group) continue;
            const at = text.indexOf(words[0]);
            const marked = p.text.slice(0, at) + '\uE000' + p.text.slice(at, at + words[0].length) +
                '\uE001' + p.text.slice(at + words[0].length);
            const tokens = marked.split(' ');
            const hitWord = tokens.findIndex(t => t.includes('\uE000'));
            const first = Math.max(0, Math.min(hitWord - 4, tokens.length - 16));
            const snippet = (first > 0 ? '…' : '') + tokens.slice(first, first + 16).join(' ') +
                (first + 16 < tokens.length ? '…' : '');
            groups[group].push({
                group, paragraph_id: p.id, code: work.code, number: p.number, title: work.title,
                kind: work.kind, chapter: work.chapter ?? null, location: work.location ?? null,
                year: work.year ?? null, snippet, score: -1,
            });
        }
    }
    return [...groups.phrase, ...groups.all].slice(0, limit);
}

// Stand-in for window.__TAURI__. Records every command the UI invokes;
// `commands` supplies results for the ones that return data (imports and the
// like), given the arguments and the backend state.
function makeTauri({ version = '0.5.1', updater = null, commands = {} } = {}, db) {
    const invokes = [];
    const emitted = [];
    const listeners = new Map();
    const relaunches = [];
    const closed = [];

    const tauri = {
        core: {
            async invoke(cmd, args) {
                // Copy out of the page's realm, so tests can deepEqual against
                // plain literals (and later mutation by the page can't rewrite history).
                args = args === undefined ? undefined : JSON.parse(JSON.stringify(args));
                invokes.push({ cmd, args });
                if (cmd === 'get_app_version') return version;
                if (commands[cmd]) return commands[cmd](args, db);
                return null;
            },
        },
        event: {
            async listen(name, fn) {
                listeners.set(name, fn);
                return () => listeners.delete(name);
            },
            // A webview → app event, as the projector window sends its size.
            async emit(name, payload) {
                emitted.push({ name, payload: JSON.parse(JSON.stringify(payload ?? null)) });
            },
        },
        window: { getCurrent: () => ({ close() { closed.push(Date.now()); } }) },
        process: { async relaunch() { relaunches.push(Date.now()); } },
    };
    if (updater) tauri.updater = updater;

    return {
        tauri, invokes, relaunches, closed, emitted,
        // Fire a backend → webview event, e.g. a menu item or 'projector-closed'.
        emit(name, payload) {
            const fn = listeners.get(name);
            if (!fn) throw new Error(`the page is not listening for "${name}"`);
            return fn({ event: name, payload });
        },
    };
}

// jsdom plus the handful of browser features it lacks that the pages touch.
function openPage(page, backend, bridge, { tauri = true } = {}) {
    const pageErrors = [];
    const dom = new JSDOM(pageHtml(page), {
        url: 'http://hymnbeam.test/',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        beforeParse(window) {
            window.fetch = backend.fetch;
            if (tauri) window.__TAURI__ = bridge.tauri;
            window.Element.prototype.scrollIntoView = () => {};
            window.URL.createObjectURL = () => 'blob:hymnbeam-test';
            window.URL.revokeObjectURL = () => {};
            // jsdom has no canvas; the projector only uses it to compare line widths.
            window.HTMLCanvasElement.prototype.getContext = () => ({
                font: '', measureText: (text) => ({ width: String(text).length * 50 }),
            });
            // A real anchor click would try to navigate; downloads are recorded instead.
            window.__downloads = [];
            window.HTMLAnchorElement.prototype.click = function () {
                window.__downloads.push({ href: this.href, download: this.download });
            };
            // The pages log their own progress and expected failures; keep test
            // output for the test runner. Uncaught errors are still collected.
            for (const level of ['log', 'info', 'warn', 'error', 'debug']) window.console[level] = () => {};
            window.addEventListener('error', (e) => pageErrors.push(e.error || e.message));
            window.addEventListener('unhandledrejection', (e) => pageErrors.push(e.reason));
        },
    });
    const { window } = dom;
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
    const find = (target) => {
        const el = typeof target === 'string' ? window.document.querySelector(target) : target;
        if (!el) throw new Error(`nothing matches ${target}`);
        return el;
    };

    return {
        window,
        document: window.document,
        /** Evaluate an expression in the page, e.g. app.eval('state.navPosition'). */
        eval: (expr) => window.eval(expr),
        pageErrors,
        settle, sleep, until,
        $: (selector) => window.document.querySelector(selector),
        $$: (selector) => [...window.document.querySelectorAll(selector)],

        /** Press a key the way the operator would, on the page or a focused element. */
        async press(key, { target = window.document.body, ...modifiers } = {}) {
            find(target).dispatchEvent(new window.KeyboardEvent('keydown', {
                key, bubbles: true, cancelable: true, ...modifiers,
            }));
            await settle();
        },
        async click(target) {
            find(target).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
            await settle();
        },
        /** Type into a field: set its value and fire the event the app listens for. */
        async type(target, value, event = 'input') {
            const el = find(target);
            el.value = value;
            el.dispatchEvent(new window.Event(event, { bubbles: true }));
            await settle();
        },
        /** Tick or untick a checkbox. */
        async check(target, checked = true) {
            const el = find(target);
            el.checked = checked;
            el.dispatchEvent(new window.Event('change', { bubbles: true }));
            await settle();
        },
        /** Drop files onto a drop zone. Files are {name, text} pairs. */
        async drop(target, files) {
            const event = new window.Event('drop', { bubbles: true, cancelable: true });
            event.dataTransfer = {
                files: files.map(f => ({ name: f.name, text: async () => f.text })),
            };
            find(target).dispatchEvent(event);
            await settle();
        },
        /** Choose a file in a file input, as the system picker would. */
        async chooseFile(target, name, contents = 'x') {
            const el = find(target);
            const file = new window.File([contents], name);
            Object.defineProperty(el, 'files', { configurable: true, value: [file] });
            el.dispatchEvent(new window.Event('change', { bubbles: true }));
            await settle();
        },

        /** Stop timers and free the window. Call from an afterEach. */
        close() { window.close(); },
    };
}

/**
 * Start the operator window.
 *
 * @param {object} [options]
 * @param {Array}  [options.songs]        full songs ({id, title, verses:[{label, text}], ...})
 * @param {Array}  [options.collections]  full collections ({id, name, songs:[entries]})
 * @param {object} [options.bible]        {books: [...], chapters: {'GEN/1': [{verse, text}]}}
 * @param {object} [options.messages]     installed message library: {status, works, paragraphs}
 * @param {object} [options.messageMeasure] {metrics(settings), lines(text, settings)}: stands in for
 *                                        the measuring copy of the projector page, which jsdom cannot
 *                                        lay out (without it, the app guesses lines by length)
 * @param {object} [options.updater]      stand-in for window.__TAURI__.updater
 * @param {object} [options.latestRelease] body returned by the GitHub releases API (null = offline)
 * @param {string} [options.version]      what get_app_version reports
 * @param {object} [options.settings]     saved display settings returned by GET /settings
 * @param {Array}  [options.trash]        recently deleted songs
 * @param {Array}  [options.backups]      library backups ({name, created_at_ms, size_bytes})
 * @param {Array}  [options.duplicates]   duplicate groups returned by GET /duplicates
 * @param {object} [options.commands]     results for Tauri commands: {name: (args, backend) => result}
 * @param {RegExp[]} [options.failing]    routes ('METHOD /path') that answer 500
 * @param {boolean} [options.started]     false = don't wait for start-up to finish
 */
async function bootApp(options = {}) {
    const backend = makeBackend(options);
    const bridge = makeTauri(options, backend.db);
    const page = openPage('index.html', backend, bridge);
    const { window, until, settle, sleep } = page;
    const measured = [];
    if (options.messageMeasure) {
        let prepared = null;
        window.document.getElementById('messageMeasureFrame').contentWindow.messageMeasure = {
            prepare(settings, footer) {
                prepared = JSON.parse(JSON.stringify(settings));
                measured.push({ footer, fontPct: settings.message.fontPct });
            },
            metrics: () => options.messageMeasure.metrics(prepared),
            lines: (text) => options.messageMeasure.lines(text, prepared),
        };
    }

    // Start-up is finished once the song list request has been answered.
    // (`started: false` skips the wait, for tests about start-up going wrong.)
    if (options.started !== false) {
        await until(() => backend.db.requests.some(r => r.startsWith('GET /songs?')), 'the app to finish starting');
        await settle();
    }

    const app = {
        ...page,
        /** Read live app state as plain data. */
        state: (field) => JSON.parse(window.eval(`JSON.stringify(state.${field} ?? null)`)),
        /** The fake backend's data and request log. */
        backend: backend.db,
        requests: backend.db.requests,
        unhandledRequests: backend.db.unhandled,
        invokes: bridge.invokes,
        relaunches: bridge.relaunches,
        /** What the measuring copy was prepared for: [{footer, fontPct}], oldest first. */
        measured,
        emit: bridge.emit,
        toast: () => window.document.getElementById('toast').textContent,

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
        /** JSON bodies sent to a route, e.g. app.sent('PUT /settings'). */
        sent(route) {
            return backend.db.bodies.filter(b => b.route === route).map(b => b.body);
        },

        /** Select a song from the library list, as a click on it does. */
        async openSong(id) {
            await page.click(`.song-item[data-id="${id}"]`);
            await until(() => app.state('currentSong')?.id === id, `song ${id} to load`);
        },
        /** Open the projector and wait for its first paint to be pushed. */
        async openProjector() {
            await page.press('f');
            await until(() => app.state('projectorOpen') === true, 'the projector to open');
            // toggleProjector pushes the current slide half a second after the
            // window opens, to give the new webview time to start listening.
            await sleep(550);
            await settle();
        },
        /** Open the Collections tab and then one collection. */
        async openCollection(id) {
            await page.click('#collectionsTabBtn');
            await until(() => page.$(`.collection-item[data-id="${id}"]`), 'the collection list');
            await page.click(`.collection-item[data-id="${id}"]`);
            await until(() => app.state('openCollection')?.id === id, 'the collection to open');
        },
    };
    return app;
}

/**
 * Start the projector page — the window the congregation sees.
 *
 * With `tauri` (the default) it behaves as the real projector window and is
 * driven by backend events via `send`. Without it, it behaves as the preview
 * iframe inside the operator window and is driven by postMessage via `post`.
 */
async function bootProjector(options = {}) {
    const backend = makeBackend(options);
    const bridge = makeTauri(options, backend.db);
    const page = openPage('projector.html', backend, bridge, { tauri: options.tauri !== false });
    await page.until(() => backend.db.requests.includes('GET /settings'), 'the projector to load its settings');
    await page.settle();

    const classes = (id) => [...page.document.getElementById(id).classList];
    return {
        ...page,
        backend: backend.db,
        closed: bridge.closed,
        /** Events the page sent to the app, e.g. its size: [{name, payload}]. */
        emitted: bridge.emitted,
        /** Deliver an event the way the Rust side does: a JSON string payload. */
        async send(event, payload = {}) {
            await bridge.emit(event, JSON.stringify(payload));
            await page.settle();
        },
        /** Deliver an event with a raw (possibly malformed) payload string. */
        async emitRaw(event, payload) {
            await bridge.emit(event, payload);
            await page.settle();
        },
        /** Deliver a message the way the operator's preview pane does. */
        async post(message) {
            page.window.dispatchEvent(new page.window.MessageEvent('message', { data: message }));
            await page.settle();
        },
        text: () => page.document.getElementById('lyricsText').textContent,
        html: () => page.document.getElementById('lyricsText').innerHTML,
        has: (id, cls) => classes(id).includes(cls),
        projectorHas: (cls) => page.document.querySelector('.projector').classList.contains(cls),
    };
}

module.exports = { bootApp, bootProjector };
