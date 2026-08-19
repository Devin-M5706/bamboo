import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The tracker introduced the first model call in this codebase. These tests are the
 * boundary that makes that acceptable.
 *
 * The product's whole thesis is that apply-time is pure retrieval: answers are written
 * offline, validated against the ledger, and submitted unchanged. A model anywhere in
 * that path converts this tool into the thing it was built not to be. The tracker reads
 * mail that has already been sent and writes to a spreadsheet, so it cannot influence a
 * submission -- but only for as long as the two paths stay disconnected.
 *
 * CI runs the same greps. These run on every `npm test`, which is where you will actually
 * see them fail.
 */

/** Files that run at or before form submission. None of them may reach a model. */
const APPLY_PATH = [
  'src/validator.core.js',
  'src/selects.js',
  'src/matching.core.js',
  'src/answers.js',
  'src/ledger.js',
  'src/poll.js',
  'src/eligibility.js',
  'src/sources.js',
  'extension/content/apply.js',
  'extension/content/common.js',
  'extension/background.js',
];

const MODEL_MENTION = /anthropic|claude|api\.anthropic\.com|openai|gpt-4|gemini/i;

test('the apply path never references a model', async () => {
  const offenders = [];
  for (const rel of APPLY_PATH) {
    const src = await fs.readFile(path.join(root, rel), 'utf8');
    if (MODEL_MENTION.test(src)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `these files run at apply time and must not reach a model: ${offenders.join(', ')}`,
  );
});

test('the apply path never imports the tracker', async () => {
  const offenders = [];
  for (const rel of APPLY_PATH) {
    const src = await fs.readFile(path.join(root, rel), 'utf8');
    // Both static and dynamic import, since a dynamic one would evade the first test.
    if (/(?:from|import\s*\()\s*['"][^'"]*(?:tracker|google)\//.test(src)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `these files must not import tracker or google modules: ${offenders.join(', ')}`,
  );
});

/**
 * The inverse direction. The tracker reading the ledger would be a privacy leak into a
 * model prompt: the ledger holds verified personal facts, and none of them are needed to
 * work out which company sent a confirmation email.
 */
test('the tracker never reads the evidence ledger or answer bank', async () => {
  const dir = path.join(root, 'src', 'tracker');
  const files = await fs.readdir(dir).catch(() => []);
  const offenders = [];
  for (const f of files.filter((n) => n.endsWith('.js'))) {
    const src = await fs.readFile(path.join(dir, f), 'utf8');
    if (/\b(loadLedger|loadAnswers|LEDGER_FILE|ANSWERS_FILE)\b/.test(src)) {
      offenders.push(`src/tracker/${f}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the tracker must not touch the ledger or answer bank: ${offenders.join(', ')}`,
  );
});

/**
 * `TRACKER.trackedEmail` was a literal `<name>@gmail.com` in src/config.js, in a package
 * published to npm from a public repo. The existing personal-data guard only checks
 * whether files under data/ became tracked, so a real mailbox sitting in source went
 * straight past it.
 *
 * Consumer mail domains only. ATS sender addresses like `no-reply@greenhouse.io` are
 * legitimate pattern data in detect.js, and matching every email-shaped string would
 * make this guard noise that someone eventually deletes.
 */
const CONSUMER_MAILBOX =
  /[a-z0-9._%+-]+@(?:gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|aol)\.[a-z.]{2,}/i;

test('no personal mailbox is hardcoded in the source', async () => {
  const offenders = [];
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.name.endsWith('.js')) {
        const m = (await fs.readFile(full, 'utf8')).match(CONSUMER_MAILBOX);
        if (m) offenders.push(`${path.relative(root, full)}: ${m[0]}`);
      }
    }
  };
  await walk(path.join(root, 'src'));
  await walk(path.join(root, 'extension'));

  assert.deepEqual(
    offenders,
    [],
    `a real mailbox address must not ship in source -- read it from BAMBOO_TRACKED_EMAIL instead: ${offenders.join(', ')}`,
  );
});

test('the tracked mailbox comes from the environment, never a default', async () => {
  const src = await fs.readFile(path.join(root, 'src', 'config.js'), 'utf8');
  assert.match(
    src,
    /trackedEmail:\s*process\.env\.BAMBOO_TRACKED_EMAIL\s*\|\|\s*null/,
    'trackedEmail must read the environment and fall back to null, so track refuses rather than reading the wrong inbox',
  );
});

test('dry run is the tracker default too', async () => {
  const src = await fs.readFile(path.join(root, 'src', 'config.js'), 'utf8');
  assert.match(
    src,
    /dryRun:\s*true/,
    'TRACKER.dryRun must default to true -- the first run of anything that writes to a spreadsheet should show you the writes first',
  );
});
