#!/usr/bin/env node
/**
 * Capture the CLI screens as images for the README.
 *
 * Runs each command with colour forced on, converts the ANSI output to styled HTML,
 * and writes one .html per screen. A renderer (the gstack browse daemon, or any
 * headless browser) rasterises them to PNG.
 *
 * Why not just screenshot a terminal: this is reproducible. Re-run it after a UI change
 * and every image in the README updates, with no window-size or font luck involved.
 *
 * Usage:  node scripts/capture-ui.js [outdir]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'docs', 'ui');

/**
 * Strip machine-identifying paths out of captured output.
 *
 * These images are committed to a public repo. Several screens print real paths --
 * `check` names your ledger when it is empty, and a missing file surfaces an ENOENT
 * with the full path in it -- so a capture run from a fresh checkout would publish the
 * maintainer's OS username and directory layout inside a PNG, where no reviewer would
 * think to look for it. Redact here rather than in the CLI: the terminal is exactly
 * where an absolute path is useful.
 */
export function redactPaths(text) {
  let out = text;
  // Repo root before home: it is the longer, more specific prefix, and on a dev machine
  // it usually sits underneath the home directory.
  for (const [real, mask] of [[root, '.'], [os.homedir(), '~']]) {
    if (!real) continue;
    for (const variant of new Set([real, real.replace(/\\/g, '/'), real.replace(/\//g, '\\')])) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'gi'), mask);
    }
  }
  return out;
}

/** Screens worth showing. Width is chosen per screen so nothing wraps. */
const SCREENS = [
  // lineHeight 1 for the banner: half-block sprites stack seamlessly only when the
  // line box is exactly the glyph height. Any leading cuts visible gaps through the art.
  { name: 'banner', args: ['banner'], cols: 132, caption: 'bamboo', lineHeight: 1 },
  { name: 'ledger', args: ['ledger'], cols: 100, caption: 'bamboo ledger' },
  { name: 'check', args: ['check'], cols: 108, caption: 'bamboo check' },
  { name: 'help', args: ['help'], cols: 92, caption: 'bamboo help' },
];

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * ANSI -> HTML. Handles the subset this project emits: 24-bit foreground
 * (38;2;r;g;b), 24-bit background (48;2;r;g;b), bold (1), and reset (0).
 * The banner needs background support because half-block sprites colour the
 * lower pixel with the cell background.
 */
export function ansiToHtml(text) {
  let fg = null;
  let bg = null;
  let bold = false;
  let open = false;
  let out = '';

  const close = () => {
    if (open) {
      out += '</span>';
      open = false;
    }
  };
  const openSpan = () => {
    if (!fg && !bg && !bold) return;
    const style = [
      fg ? `color:${fg}` : '',
      bg ? `background:${bg}` : '',
      bold ? 'font-weight:700' : '',
    ]
      .filter(Boolean)
      .join(';');
    out += `<span style="${style}">`;
    open = true;
  };

  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    last = re.lastIndex;
    close();

    const codes = m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) {
        fg = bg = null;
        bold = false;
      } else if (c === 1) bold = true;
      else if (c === 38 && codes[i + 1] === 2) {
        fg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
        i += 4;
      } else if (c === 48 && codes[i + 1] === 2) {
        bg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
        i += 4;
      }
    }
    openSpan();
  }
  out += esc(text.slice(last));
  close();
  return out;
}

/** A terminal window frame, styled from the design handoff's tokens. */
export function terminalHtml(body, { caption = '', lineHeight = 1.5 } = {}) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#14161f; padding:22px; font-family: ui-monospace, "JetBrains Mono", "Cascadia Mono", Consolas, monospace; }
  .win { background:#1f212d; border-radius:10px; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,.5); width:max-content; }
  .bar { display:flex; align-items:center; gap:8px; padding:10px 14px; background:#282b3a; }
  .dot { width:11px; height:11px; border-radius:50%; }
  .cap { margin-left:8px; color:#9a9eb0; font-size:12px; }
  pre { margin:0; padding:16px 18px; color:#d7dae5; font-size:13px; line-height:${lineHeight};
        white-space:pre; tab-size:8; }
</style>
<div class="win" id="shot">
  <div class="bar">
    <span class="dot" style="background:#ff5f57"></span>
    <span class="dot" style="background:#febc2e"></span>
    <span class="dot" style="background:#28c840"></span>
    <span class="cap">${esc(caption)}</span>
  </div>
  <pre>${body}</pre>
</div>
<div id="done"></div>`;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const cli = path.join(root, 'src', 'cli.js');

  for (const s of SCREENS) {
    let raw;
    try {
      raw = execFileSync(process.execPath, [cli, ...s.args], {
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '1', COLUMNS: String(s.cols) },
        // `check` exits 1 when the ledger is not ready, which is correct behaviour
        // and still produces the output we want to show.
      });
    } catch (err) {
      raw = (err.stdout || '') + (err.stderr || '');
    }
    const html = terminalHtml(ansiToHtml(redactPaths(raw.replace(/\r/g, ''))), {
      caption: s.caption,
      lineHeight: s.lineHeight ?? 1.5,
    });
    const file = path.join(outDir, `${s.name}.html`);
    await fs.writeFile(file, html);
    console.log(`${s.name.padEnd(8)} ${raw.split('\n').length} lines -> ${path.relative(root, file)}`);
  }
  console.log(`\nRasterise with the diagram-render bundle or any headless browser.`);
}

// pathToFileURL, not string concatenation: on Windows import.meta.url is
// file:///C:/... with three slashes, so a hand-built file://C:/... never matches and
// main() silently never runs.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
