// Windows smoke-test driver. The workflow launches HymnBeam with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222; this
// script attaches to the live webview over the Chrome DevTools Protocol and
// asserts the app really booted on Windows: the page finished loading, the
// frontend JS ran inside Tauri, and the http://axum.localhost custom protocol
// answers from inside the webview (the exact fetch path the UI uses). It also
// saves an in-app screenshot (smoke-screenshot.png) as visual proof.
//
// Requires Node 22+ (global fetch and WebSocket). Exits non-zero on failure.

const PORT = process.env.CDP_PORT || '9222';
const STARTUP_DEADLINE_MS = 120_000;

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`SMOKE OK: ${msg}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Poll the DevTools HTTP endpoint until the operator page target appears.
// This alone proves the process started and WebView2 created the webview.
async function findPageTarget() {
  const start = Date.now();
  let lastErr = 'no response';
  while (Date.now() - start < STARTUP_DEADLINE_MS) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find(
        (t) => t.type === 'page' && /tauri\.localhost/.test(t.url)
      );
      if (page) return page;
      lastErr = `no page target yet in: ${targets.map((t) => `${t.type}:${t.url}`).join(', ')}`;
    } catch (e) {
      lastErr = e.message;
    }
    await sleep(1000);
  }
  fail(`WebView2 debugging endpoint never became ready (${lastErr}) — the app or its webview failed to launch`);
}

// Minimal CDP client over the target's WebSocket.
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = nextId++;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => ws.close(),
      });
    ws.onerror = (e) => reject(new Error(`WebSocket error: ${e.message || 'unknown'}`));
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };
  });
}

async function evalJs(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(
      exceptionDetails.exception?.description || JSON.stringify(exceptionDetails)
    );
  }
  return result.value;
}

const target = await findPageTarget();
ok(`webview is up — page target ${target.url}`);

const client = await connect(target.webSocketDebuggerUrl);

// 1. Page finished loading.
const deadline = Date.now() + 30_000;
while ((await evalJs(client, 'document.readyState')) !== 'complete') {
  if (Date.now() > deadline) fail('page never reached readyState=complete');
  await sleep(500);
}
ok(`page loaded — title "${await evalJs(client, 'document.title')}"`);

// 2. Running inside Tauri (IPC bridge injected), not a plain browser.
if (!(await evalJs(client, '!!(window.__TAURI__ || window.__TAURI_INTERNALS__)'))) {
  fail('Tauri IPC bridge not present in the webview');
}
ok('Tauri IPC bridge present');

// 3. The axum custom protocol answers from inside the webview — the exact
//    origin-crossing fetch (tauri.localhost -> axum.localhost) the UI uses.
const health = await evalJs(
  client,
  `(async () => {
     const res = await fetch('http://axum.localhost/');
     return { status: res.status, body: await res.json() };
   })()`
);
if (health.status !== 200) fail(`API health check returned HTTP ${health.status}`);
ok(`axum protocol answers — health: ${JSON.stringify(health.body)}`);

// 4. A real data endpoint round-trips through SQLite.
const songs = await evalJs(
  client,
  `(async () => {
     const res = await fetch('http://axum.localhost/songs');
     return { status: res.status, isArray: Array.isArray(await res.json()) };
   })()`
);
if (songs.status !== 200 || !songs.isArray) {
  fail(`GET /songs failed: HTTP ${songs.status}, array=${songs.isArray}`);
}
ok('GET /songs returns a song list from the database');

// 5. The operator UI rendered its main structure.
if (!(await evalJs(client, "!!document.getElementById('songList')"))) {
  fail('operator UI did not render (#songList missing)');
}
ok('operator UI rendered');

// 6. In-app screenshot as visual proof.
const shot = await client.send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('smoke-screenshot.png', Buffer.from(shot.data, 'base64'));
ok('captured smoke-screenshot.png');

client.close();
console.log('SMOKE PASS: HymnBeam launched and is functional on Windows');
process.exit(0);
