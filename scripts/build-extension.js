#!/usr/bin/env node
/**
 * Generate the extension's copies of the import-free core modules.
 *
 * Content scripts are not ES modules, so we strip `export` and hang the public functions
 * off a global. The core files are deliberately import-free to make this transformation
 * trivial and reviewable, and test/extension-sync.test.js fails if a copy goes stale.
 *
 * Run after changing either core file: npm run build:ext
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'extension', 'vendor');

const TARGETS = [
  { src: 'validator.core.js', out: 'validator.js', ns: 'validator', exports: ['extractClaims', 'validateAnswer', 'validateBank'] },
  { src: 'selects.js', out: 'selects.js', ns: 'selects', exports: ['RULES', 'resolveSelect', 'resolveAllSelects'] },
];

await fs.mkdir(outDir, { recursive: true });

for (const t of TARGETS) {
  const srcPath = path.join(root, 'src', t.src);
  const core = await fs.readFile(srcPath, 'utf8');

  if (/^\s*import\s/m.test(core)) {
    console.error(`${t.src} must have no imports -- the extension cannot resolve them.`);
    process.exit(1);
  }

  const body = core.replace(/^export\s+/gm, '');
  const banner = `/* GENERATED FILE -- do not edit.
 * Source: src/${t.src}
 * Regenerate: npm run build:ext
 * The CLI and the extension must share one copy, or only one of them refuses.
 */
`;
  const footer = `
;(function (g) {
  g.__bamboo = g.__bamboo || {};
  g.__bamboo.${t.ns} = { ${t.exports.join(', ')} };
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;

  const outPath = path.join(outDir, t.out);
  await fs.writeFile(outPath, banner + body + footer);
  console.log(`wrote ${path.relative(root, outPath)}`);
}
