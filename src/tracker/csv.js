import fs from 'node:fs/promises';
import path from 'node:path';
import { APPLICATIONS_CSV } from '../config.js';

/**
 * CSV projection of the application records, and the column contract both sinks share.
 *
 * The spreadsheet -- Google or CSV -- is a PROJECTION of applications.json, never the
 * source of truth. Deleting it and rebuilding it must lose nothing.
 *
 * COLUMNS and recordToRow live here rather than in each sink because two hand-written
 * copies of a column order drift, and a drifted column order writes the role into the
 * location column of a sheet a person has been reading for a month. src/google/sheets.js
 * imports both from this file, so the two sinks physically cannot disagree.
 *
 * The apostrophe guard below is NOT duplicated in sheets.js on purpose: see the note on
 * valueInputOption there. Same vulnerability, two mitigations, each correct for its sink.
 */

/** Fixed column order. Column K (Message ID) is the upsert key in both sinks. */
export const COLUMNS = [
  'Applied On',
  'Company',
  'Role',
  'Location',
  'Status',
  'Source',
  'Job URL',
  'Last Update',
  'Confidence',
  'Needs Review',
  'Message ID',
];

/** Index of the upsert key within a row. Column K, zero-based. */
export const KEY_INDEX = COLUMNS.indexOf('Message ID');

/**
 * A missing value prints an em dash, never `0` and never an empty cell that could be
 * mistaken for "no". The rest of this codebase does the same for the same reason: a
 * blank looks like a measurement, an em dash looks like the absence of one.
 */
export const MISSING = '—';

const cell = (v) => (v === null || v === undefined || v === '' ? MISSING : String(v));

/**
 * Project one ApplicationRecord onto the fixed column order.
 *
 * Timestamps go out as the stored ISO 8601 string rather than a friendlier local format.
 * Locale and timezone formatting differs per machine, and a projection that renders
 * differently on the laptop than in CI is a projection that produces spurious diffs on
 * every sync.
 *
 * @param {object} record ApplicationRecord (see the tracker typedef)
 * @returns {string[]} one value per entry in COLUMNS, in that order
 */
export function recordToRow(record) {
  const r = record ?? {};
  return [
    cell(r.appliedAt),
    cell(r.company),
    cell(r.role),
    cell(r.location),
    cell(r.status),
    cell(r.source),
    cell(r.jobUrl),
    cell(r.updatedAt),
    cell(r.confidence),
    // A boolean false is a real answer ("reviewed, fine"), not a missing value.
    typeof r.needsReview === 'boolean' ? (r.needsReview ? 'yes' : 'no') : MISSING,
    cell(r.messageId),
  ];
}

/**
 * Leading characters that make a spreadsheet treat a cell as a formula rather than text.
 * A company literally named `-Foo`, or a role pasted as `=VLOOKUP(...)` by a careless
 * ATS template, becomes live code the moment the CSV is opened in Excel or Sheets.
 * CR and TAB are here too: Excel strips them and then evaluates what follows.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * RFC 4180 field escaping plus the spreadsheet formula guard.
 *
 * Order matters: guard first, quote second. `-Foo, Inc` must become `"'-Foo, Inc"` --
 * quoting first would leave the apostrophe outside the quotes and corrupt the field.
 *
 * @param {string} value
 * @returns {string} the field exactly as it should appear in the file
 */
export function escapeCsvField(value) {
  let s = String(value ?? '');
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  const mustQuote = /[",\r\n]/.test(s) || s !== s.trim();
  if (!mustQuote) return s;
  return `"${s.replaceAll('"', '""')}"`;
}

/**
 * Serialize records to an RFC 4180 document, header row included.
 * Line terminator is CRLF, as RFC 4180 requires; this is byte-identical on every OS.
 *
 * @param {object[]} records ApplicationRecord[]
 * @returns {string}
 */
export function toCsv(records) {
  const rows = [COLUMNS, ...(records ?? []).map(recordToRow)];
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + '\r\n';
}

/**
 * Write the CSV projection atomically.
 *
 * Temp file in the same directory, fsync, rename -- the same discipline store.js applies
 * to JSON, for the same reason: an interrupted write must leave the previous good file
 * intact rather than a truncated one. This does not go through store.js only because
 * store.js is a JSON interface and this artifact is not JSON.
 *
 * @param {object[]} records ApplicationRecord[]
 * @param {{dryRun?: boolean, file?: string}} [options] `file` exists so tests can write
 *        somewhere other than the user's real home; production always uses the default.
 * @returns {Promise<{file: string, rows: number, bytes: number, written: boolean, dryRun: boolean}>}
 */
export async function writeCsv(records, { dryRun = false, file = APPLICATIONS_CSV } = {}) {
  const list = records ?? [];
  const text = toCsv(list);
  const bytes = Buffer.byteLength(text, 'utf8');
  const plan = { file, rows: list.length, bytes, written: false, dryRun: Boolean(dryRun) };

  if (dryRun) return plan;

  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);

  return { ...plan, written: true };
}
