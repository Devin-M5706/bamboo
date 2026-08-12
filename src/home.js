import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ANSWERS_EXAMPLE,
  ANSWERS_FILE,
  DATA_DIR,
  LEDGER_EXAMPLE,
  LEDGER_FILE,
  PKG_DATA_DIR,
} from './config.js';

/**
 * Bootstrap and care for ~/.bamboo.
 *
 * Everything here is idempotent and never overwrites an existing file. The ledger is
 * the one artifact in this project that cannot be regenerated -- a person verified each
 * entry by hand -- so no code path may clobber it.
 */

const USER_FILES = [
  'ledger.json',
  'answers.json',
  'state.json',
  'queue.json',
  'config.json',
  'boards.json',
];

const exists = (p) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

export async function ensureHome() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

/**
 * Move data out of an old in-package data/ directory into ~/.bamboo.
 *
 * Copies rather than moves, and skips anything already present at the destination, so
 * running it twice cannot lose work. Returns what it actually did.
 */
export async function migrateFromPackage() {
  const moved = [];
  const skipped = [];
  if (path.resolve(PKG_DATA_DIR) === path.resolve(DATA_DIR)) return { moved, skipped };

  await ensureHome();
  for (const name of USER_FILES) {
    const from = path.join(PKG_DATA_DIR, name);
    const to = path.join(DATA_DIR, name);
    if (!(await exists(from))) continue;
    if (await exists(to)) {
      skipped.push(name);
      continue;
    }
    await fs.copyFile(from, to);
    moved.push(name);
  }
  return { moved, skipped };
}

/**
 * Seed a first-time home from the bundled templates. Never overwrites.
 */
export async function seedFromExamples() {
  await ensureHome();
  const created = [];
  for (const [example, target] of [
    [LEDGER_EXAMPLE, LEDGER_FILE],
    [ANSWERS_EXAMPLE, ANSWERS_FILE],
  ]) {
    if (await exists(target)) continue;
    if (!(await exists(example))) continue;
    await fs.copyFile(example, target);
    created.push(path.basename(target));
  }
  return created;
}

/** First-run bootstrap: migrate anything old, then seed whatever is still missing. */
export async function bootstrap() {
  const { moved, skipped } = await migrateFromPackage();
  const created = await seedFromExamples();
  return { home: DATA_DIR, moved, skipped, created };
}

export async function homeStatus() {
  const files = [];
  for (const name of USER_FILES) {
    const p = path.join(DATA_DIR, name);
    files.push({ name, path: p, exists: await exists(p) });
  }
  return { home: DATA_DIR, files };
}
