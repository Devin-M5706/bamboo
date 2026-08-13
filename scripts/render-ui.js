#!/usr/bin/env node
/**
 * Rasterise the capture HTML from capture-ui.js into the PNGs the README displays.
 *
 * This was a manual step ("rasterise with any headless browser"), which meant the images
 * were only as reproducible as whoever last regenerated them. Now the whole docs pipeline
 * is two commands: capture-ui.js writes HTML, this writes PNG.
 *
 * Zero dependencies, like everything else here: it drives Chrome over the DevTools
 * protocol using Node 22's built-in WebSocket. A headless-browser library would be the
 * largest dependency in the project by an order of magnitude, for one screenshot call.
 *
 * Each image is clipped to the #shot element rather than the viewport, which is what
 * makes them tight to their own content -- the five committed PNGs have five different
 * widths. A viewport screenshot would pad every one of them to a fixed size.
 *
 * Usage:  node scripts/render-ui.js [outdir] [name...]
 *         CHROME_PATH=/path/to/chrome node scripts/render-ui.js
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Chrome needs a moment after load for fonts to settle; a clip measured before that is short. */
const SETTLE_MS = 400;
const LAUNCH_TIMEOUT_MS = 30_000;

/**
 * Where a Chrome might be, most specific first. CHROME_PATH always wins so a machine
 * with an unusual install (or a pinned build) never has to edit this list.
 */
export function chromeCandidates(platform = process.platform, env = process.env) {
  if (env.CHROME_PATH) return [env.CHROME_PATH];

  const programFiles = env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = env.LOCALAPPDATA || '';

  if (platform === 'win32') {
    return [
      path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
      path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
      localAppData && path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),
      // Edge is Chromium and speaks the same protocol. On a stock Windows box it is
      // the one that is definitely present.
      path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
    ].filter(Boolean);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
}

export async function findChrome(candidates = chromeCandidates()) {
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // Try the next one. Every entry is a guess about someone else's machine.
    }
  }
  return null;
}

/**
 * CDP box models are quads: [x1,y1, x2,y2, x3,y3, x4,y4] clockwise from top-left.
 * Round outward -- a clip half a pixel short crops the window's rounded border.
 */
export function clipFromBoxModel(model, scale = 1) {
  const [x1, y1, x2, , , y3] = model.border;
  // Measure from the rounded origin, not the raw delta: flooring x to 10.0 and then
  // taking ceil(110.2 - 10.4) = 100 puts the right edge at 110, shaving the border off
  // an element that actually ends at 110.2.
  const left = Math.floor(x1);
  const top = Math.floor(y1);
  return {
    x: left,
    y: top,
    width: Math.ceil(x2) - left,
    height: Math.ceil(y3) - top,
    scale,
  };
}

/** One CDP session over a WebSocket, with request/response correlation by id. */
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const waiters = [];
  let nextId = 1;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
      return;
    }
    // Events: resolve anyone waiting on this method, newest waiter first.
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].method === msg.method) {
        waiters[i].resolve(msg.params);
        waiters.splice(i, 1);
      }
    }
  });

  return {
    ready: new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)));
    }),
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method) {
      return new Promise((resolve) => waiters.push({ method, resolve }));
    },
    close: () => ws.close(),
  };
}

/** Launch headless Chrome on an ephemeral port and return its debugging endpoint. */
async function launch(chromePath, profileDir) {
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ]);

  const endpoint = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(
      () => reject(new Error(`${chromePath} did not report a debugging port in ${LAUNCH_TIMEOUT_MS}ms`)),
      LAUNCH_TIMEOUT_MS,
    );
    chrome.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    chrome.stderr.on('data', (chunk) => {
      buf += chunk;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });

  return { chrome, endpoint };
}

async function renderOne(httpBase, file) {
  const url = pathToFileURL(file).href;
  const target = await fetch(`${httpBase}/json/new?${url}`, { method: 'PUT' }).then((r) => r.json());
  const page = connect(target.webSocketDebuggerUrl);
  await page.ready;

  try {
    await page.send('Page.enable');
    const loaded = page.once('Page.loadEventFired');
    await page.send('Page.navigate', { url });
    await loaded;
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const { root: document } = await page.send('DOM.getDocument');
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: document.nodeId, selector: '#shot' });
    if (!nodeId) throw new Error(`${path.basename(file)} has no #shot element to clip to`);

    const { model } = await page.send('DOM.getBoxModel', { nodeId });
    const clip = clipFromBoxModel(model);
    const shot = await page.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip,
    });
    return { png: Buffer.from(shot.data, 'base64'), clip };
  } finally {
    await page.send('Page.close').catch(() => {});
    page.close();
  }
}

async function main() {
  const [outArg, ...names] = process.argv.slice(2);
  const outDir = outArg || path.join(root, 'docs', 'ui');

  // Default to whatever capture-ui.js just wrote, so the two scripts cannot disagree
  // about which screens exist.
  const screens = names.length
    ? names
    : (await fs.readdir(outDir)).filter((f) => f.endsWith('.html')).map((f) => path.basename(f, '.html'));

  if (!screens.length) {
    console.error(`No .html captures in ${outDir}. Run: node scripts/capture-ui.js`);
    process.exitCode = 1;
    return;
  }

  const chromePath = await findChrome();
  if (!chromePath) {
    console.error('No Chrome, Chromium or Edge found. Set CHROME_PATH to one:');
    console.error(chromeCandidates().map((c) => `  ${c}`).join('\n'));
    process.exitCode = 1;
    return;
  }

  // The profile is scratch state, not output. Writing it under outDir would drop a
  // .chrome-profile directory into docs/ui.
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bamboo-render-'));
  const { chrome, endpoint } = await launch(chromePath, profileDir);
  const httpBase = `http://${new URL(endpoint).host}`;

  try {
    for (const name of screens) {
      const file = path.join(outDir, `${name}.html`);
      const { png, clip } = await renderOne(httpBase, file);
      const out = path.join(outDir, `${name}.png`);
      await fs.writeFile(out, png);
      console.log(
        `${name.padEnd(10)} ${clip.width}x${clip.height}  ${(png.length / 1024).toFixed(0)}KB -> ${path.relative(root, out)}`,
      );
    }
  } finally {
    chrome.kill();
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

// pathToFileURL, not string concatenation: on Windows import.meta.url is file:///C:/...
// with three slashes, so a hand-built file://C:/... never matches and main() silently
// never runs.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
