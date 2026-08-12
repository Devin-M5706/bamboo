import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The CLI and the extension must run the same validator. If they drift, one of them
 * stops refusing and you find out from an employer. These tests fail loudly instead.
 */

test('validator.core.js has no imports, so the extension can use it verbatim', async () => {
  const core = await fs.readFile(path.join(root, 'src', 'validator.core.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(core), 'core validator must stay import-free');
});

test('generated extension validator is in sync with the core source', async () => {
  const core = await fs.readFile(path.join(root, 'src', 'validator.core.js'), 'utf8');
  const built = await fs.readFile(path.join(root, 'extension', 'vendor', 'validator.js'), 'utf8');
  const expectedBody = core.replace(/^export\s+/gm, '');
  assert.ok(
    built.includes(expectedBody),
    'extension/vendor/validator.js is stale -- run: npm run build:ext',
  );
});

test('generated validator refuses an untraceable claim in a browser-like global', async () => {
  const src = await fs.readFile(path.join(root, 'extension', 'vendor', 'validator.js'), 'utf8');
  const g = {};
  new Function('globalThis', 'window', src).call(g, g, g);
  const v = g.__jobapplr?.validator;
  assert.ok(v, 'build must expose window.__jobapplr.validator');

  const facts = [{ id: 'f', text: 'I built a tool in React.', tags: ['React'] }];
  assert.equal(v.validateAnswer({ text: 'I built a tool in React.', derived_from: ['f'] }, facts).ok, true);

  const bad = v.validateAnswer({ text: 'I built a tool in Rust.', derived_from: ['f'] }, facts);
  assert.equal(bad.refused, true);
  assert.deepEqual(bad.unsupported, ['Rust']);
});

test('manifest content_scripts load the validator before the applier', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  const js = manifest.content_scripts[0].js;
  assert.ok(
    js.indexOf('vendor/validator.js') < js.indexOf('content/apply.js'),
    'apply.js depends on the validator global being present',
  );
});

test('the shipped default is dry run', async () => {
  const apply = await fs.readFile(path.join(root, 'extension', 'content', 'apply.js'), 'utf8');
  assert.ok(/dryRun:\s*true/.test(apply), 'dryRun must default to true in the content script');

  const config = await fs.readFile(path.join(root, 'src', 'config.js'), 'utf8');
  assert.ok(/DRY_RUN_DEFAULT\s*=\s*true/.test(config), 'CLI must report dry run by default');
});
