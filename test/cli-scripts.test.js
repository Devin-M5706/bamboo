import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The README tells people to run `npm run <cmd>`. If a CLI command exists without a
 * matching script, that instruction is a lie and you find out by typing it. This test
 * exists because exactly that happened with `banner`.
 */

async function cliCommands() {
  const src = await fs.readFile(path.join(root, 'src', 'cli.js'), 'utf8');
  const block = src.match(/const COMMANDS = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'could not find the COMMANDS map in cli.js');
  return [...block[1].matchAll(/^\s*(\w[\w:]*)\s*:/gm)].map((m) => m[1]);
}

test('every CLI command has a matching npm script', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const missing = (await cliCommands()).filter((c) => !pkg.scripts[c]);
  assert.deepEqual(missing, [], `CLI commands with no npm script: ${missing.join(', ')}`);
});

test('every npm script that wraps the CLI names a real command', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const commands = await cliCommands();
  for (const [name, script] of Object.entries(pkg.scripts)) {
    const m = script.match(/src\/cli\.js\s+(\w+)/);
    if (!m) continue;
    assert.ok(commands.includes(m[1]), `npm run ${name} calls unknown CLI command "${m[1]}"`);
  }
});

test('every `npm run X` in the README resolves to a real script', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  const referenced = new Set([...readme.matchAll(/npm run ([\w:]+)/g)].map((m) => m[1]));
  const missing = [...referenced].filter((s) => !pkg.scripts[s]);
  assert.deepEqual(missing, [], `README documents scripts that do not exist: ${missing.join(', ')}`);
});
