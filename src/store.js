import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Durable JSON reads and writes.
 *
 * Everything in ~/.bamboo goes through here. Three rules, each one earned from a
 * failure mode that existed in this codebase before this module:
 *
 *  1. MISSING IS NOT CORRUPT. A file that does not exist and a file with a trailing
 *     comma are different events. Conflating them let `init` substitute an empty
 *     ledger for an unparseable one and then write it back, destroying every verified
 *     fact from a typo the user made by hand.
 *
 *  2. WRITES ARE ATOMIC. Write to a temp file in the same directory, fsync, then
 *     rename. Rename is atomic on both NTFS and POSIX, so a reader sees either the
 *     old file or the new one -- never a half-written one. Ctrl-C during `watch` used
 *     to be able to truncate state.json.
 *
 *  3. IRREPLACEABLE FILES KEEP A BACKUP. The ledger is the only artifact here a
 *     person verified by hand. It gets a .bak of the previous good contents.
 */

export class CorruptFileError extends Error {
  constructor(file, cause) {
    super(`${file} exists but is not valid JSON: ${cause.message}`);
    this.name = 'CorruptFileError';
    this.file = file;
    this.cause = cause;
  }
}

/**
 * @returns {Promise<{exists: boolean, value: any}>}
 * @throws {CorruptFileError} when the file exists but cannot be parsed -- callers
 *         must decide, never silently substitute a default over real data.
 */
export async function readJson(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, value: undefined };
    throw err;
  }
  try {
    return { exists: true, value: JSON.parse(raw) };
  } catch (err) {
    throw new CorruptFileError(file, err);
  }
}

/** Read where a missing OR corrupt file is genuinely fine (caches, derived state). */
export async function readJsonOr(file, fallback) {
  try {
    const { exists, value } = await readJson(file);
    return exists ? value : fallback;
  } catch (err) {
    if (err instanceof CorruptFileError) return fallback;
    throw err;
  }
}

/**
 * Atomic write. Temp file in the same directory (rename across filesystems is not
 * atomic), fsync before rename so the bytes are on disk, then rename over the target.
 */
export async function writeJson(file, value, { backup = false } = {}) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });

  if (backup) {
    try {
      await fs.copyFile(file, `${file}.bak`);
    } catch (err) {
      // No previous file to back up is normal on first write.
      if (err.code !== 'ENOENT') throw err;
    }
  }

  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
}

/**
 * Read, transform, write -- atomically, and never on top of a file we failed to read.
 * This is the operation `init` was doing by hand when it could destroy the ledger.
 */
export async function updateJson(file, fn, { backup = false, whenMissing } = {}) {
  let current;
  const { exists, value } = await readJson(file); // CorruptFileError propagates by design
  if (exists) current = value;
  else if (whenMissing !== undefined) current = whenMissing;
  else throw Object.assign(new Error(`${file} does not exist`), { code: 'ENOENT' });

  const next = await fn(current);
  await writeJson(file, next, { backup });
  return next;
}
