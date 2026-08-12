#!/usr/bin/env node
/**
 * Generate extension/vendor/validator.js from src/validator.core.js.
 *
 * Content scripts are not ES modules, so we strip the `export` keywords and hang the
 * public functions off a global. The core file is deliberately import-free to make
 * this transformation trivial and reviewable.
 *
 * Run after any change to the validator: npm run build:ext
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'validator.core.js');
const outDir = path.join(root, 'extension', 'vendor');
const out = path.join(outDir, 'validator.js');

const core = await fs.readFile(src, 'utf8');

if (/^\s*import\s/m.test(core)) {
  console.error('validator.core.js must have no imports -- the extension cannot resolve them.');
  process.exit(1);
}

const body = core.replace(/^export\s+/gm, '');

const banner = `/* GENERATED FILE -- do not edit.
 * Source: src/validator.core.js
 * Regenerate: npm run build:ext
 * The CLI and the extension must share one validator, or only one of them refuses.
 */
`;

const footer = `
;(function (g) {
  g.__jobapplr = g.__jobapplr || {};
  g.__jobapplr.validator = { extractClaims, validateAnswer, validateBank };
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(out, banner + body + footer);
console.log(`wrote ${path.relative(root, out)} (${banner.length + body.length + footer.length} bytes)`);
