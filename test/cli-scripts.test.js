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

/**
 * npm runs these automatically during `npm install`. A script named `install` fires
 * BEFORE the package files are in place, so `npm i -g` dies with "Cannot find module
 * src/cli.js". This cost a real debugging round -- never add a script with these names.
 */
const RESERVED_NPM_LIFECYCLE = new Set([
  'install',
  'preinstall',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'publish',
  'postpublish',
  'restart',
  'start',
  'stop',
  'version',
]);

test('every CLI command has a matching npm script', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const missing = (await cliCommands()).filter(
    (c) => !pkg.scripts[c] && !RESERVED_NPM_LIFECYCLE.has(c),
  );
  assert.deepEqual(missing, [], `CLI commands with no npm script: ${missing.join(', ')}`);
});

test('no npm script uses a reserved lifecycle name', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const clashes = Object.keys(pkg.scripts).filter((s) => RESERVED_NPM_LIFECYCLE.has(s));
  assert.deepEqual(
    clashes,
    [],
    `these run automatically during npm install and will break a global install: ${clashes.join(', ')}`,
  );
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

/**
 * The help screen drifted all the way apart from the CLI without anything noticing:
 * it advertised `review`, `apply`, `boards`, `status` and `nap`, none of which were ever
 * built, and omitted the fourteen commands that were. Eight advertised, five of them
 * failing on contact.
 *
 * Nothing caught it because help.js is on neither side of the checks above -- those
 * compare cli.js against package.json, and help.js is a third list. These two tests are
 * that third edge.
 */

/** Aliases: real commands that are deliberately not advertised. */
const UNADVERTISED = new Set([
  // An undocumented alias for `setup`, kept only because it was published once.
  // Advertising it invites the npm lifecycle collision that broke global installs.
  'install',
]);

test('the help screen advertises nothing that does not exist', async () => {
  const { COMMANDS } = await import('../src/ui/help.js');
  const real = new Set(await cliCommands());
  const fictional = COMMANDS.map(([name]) => name).filter((name) => !real.has(name));
  assert.deepEqual(
    fictional,
    [],
    `bamboo help advertises commands the CLI does not have: ${fictional.join(', ')}`,
  );
});

test('the help screen advertises every command that does exist', async () => {
  const { COMMANDS } = await import('../src/ui/help.js');
  const advertised = new Set(COMMANDS.map(([name]) => name));
  const hidden = (await cliCommands()).filter((c) => !advertised.has(c) && !UNADVERTISED.has(c));
  assert.deepEqual(
    hidden,
    [],
    `these commands work but bamboo help does not mention them: ${hidden.join(', ')}`,
  );
});

test('every command name fits the help column', async () => {
  const { COMMAND_WIDTH, COMMANDS } = await import('../src/ui/help.js');
  // Overflow does not wrap, it pushes the description column out and breaks alignment
  // for every row below it.
  const tooLong = COMMANDS.filter(([name]) => name.length > COMMAND_WIDTH).map(([n]) => n);
  assert.deepEqual(tooLong, [], `wider than COMMAND_WIDTH=${COMMAND_WIDTH}: ${tooLong.join(', ')}`);
});

test('the help footer states the submit default that config actually holds', async () => {
  const { help } = await import('../src/ui/help.js');
  const { setColor } = await import('../src/ui/theme.js');
  setColor(false);

  // The footer reads DRY_RUN_DEFAULT rather than restating it, so the two cannot
  // disagree -- but pin both renderings, since this is the one line users rely on to
  // know whether typing a command submits an application.
  assert.match(help({ dryRun: true }), /Dry run is the default/);
  assert.match(help({ dryRun: false }), /LIVE/);
  assert.match(help({ dryRun: false }), /--dry-run/);
});

test('every `npm run X` in the README resolves to a real script', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  const referenced = new Set([...readme.matchAll(/npm run ([\w:]+)/g)].map((m) => m[1]));
  const missing = [...referenced].filter((s) => !pkg.scripts[s]);
  assert.deepEqual(missing, [], `README documents scripts that do not exist: ${missing.join(', ')}`);
});
