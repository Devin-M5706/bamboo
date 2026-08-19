import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { APPLICATIONS_CSV } from '../src/config.js';
import { COLUMNS, KEY_INDEX, MISSING, escapeCsvField, recordToRow, toCsv, writeCsv } from '../src/tracker/csv.js';
import { record } from './helpers/fixtures.js';

async function tmpdir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'bamboo-csv-'));
}


/** Minimal RFC 4180 reader, so the tests assert what a spreadsheet would actually read. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(field); field = ''; rows.push(row); row = []; i += 1; }
    else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

test('COLUMNS is the fixed contract both sinks share', () => {
  assert.deepEqual(COLUMNS, [
    'Applied On', 'Company', 'Role', 'Location', 'Status', 'Source',
    'Job URL', 'Last Update', 'Confidence', 'Needs Review', 'Message ID',
  ]);
  assert.equal(KEY_INDEX, 10, 'Message ID must be column K -- it is the upsert key');
});

test('recordToRow places every field in its contracted column', () => {
  const row = recordToRow(record());
  assert.equal(row.length, COLUMNS.length);
  assert.deepEqual(row, [
    '2026-08-01T12:00:00.000Z', 'Stripe', 'Backend Intern', 'Remote', 'applied',
    'greenhouse', 'https://boards.greenhouse.io/stripe/jobs/1', '2026-08-02T09:30:00.000Z',
    'high', 'no', 'msg-1',
  ]);
});

test('a missing value renders an em dash, never 0 and never blank', () => {
  const row = recordToRow(record({ company: null, role: null, location: '', jobUrl: undefined, source: null }));
  assert.equal(row[COLUMNS.indexOf('Company')], MISSING);
  assert.equal(row[COLUMNS.indexOf('Role')], MISSING);
  assert.equal(row[COLUMNS.indexOf('Location')], MISSING);
  assert.equal(row[COLUMNS.indexOf('Job URL')], MISSING);
  assert.equal(row[COLUMNS.indexOf('Source')], MISSING);
  assert.ok(!row.includes('0'), 'a missing value must never become a zero');
  assert.ok(!row.includes(''), 'a missing value must never become an empty cell');
});

test('needsReview distinguishes a real false from an unknown', () => {
  assert.equal(recordToRow(record({ needsReview: true }))[9], 'yes');
  assert.equal(recordToRow(record({ needsReview: false }))[9], 'no');
  assert.equal(recordToRow(record({ needsReview: undefined }))[9], MISSING);
});

test('FORMULA INJECTION: = + - @ are neutralised with a leading apostrophe', () => {
  // Each of these is live code in Excel or Sheets if written through unguarded.
  assert.equal(escapeCsvField('=1+1'), "'=1+1");
  assert.equal(escapeCsvField('+44 20 7946 0000'), "'+44 20 7946 0000");
  assert.equal(escapeCsvField('-Foo'), "'-Foo");
  assert.equal(escapeCsvField('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(escapeCsvField('Stripe'), 'Stripe', 'ordinary values must not be mangled');
});

test('FORMULA INJECTION: a company literally named -Foo is inert in the written file', () => {
  const csv = toCsv([record({ company: '-Foo', role: '=HYPERLINK("http://evil","x")' })]);
  const [, row] = parseCsv(csv);
  assert.equal(row[COLUMNS.indexOf('Company')], "'-Foo");
  assert.equal(row[COLUMNS.indexOf('Role')], '\'=HYPERLINK("http://evil","x")');
  for (const field of row) {
    assert.ok(!/^[=+\-@]/.test(field), `field "${field}" would evaluate as a formula`);
  }
});

test('FORMULA INJECTION: the guard survives quoting when the value also needs quotes', () => {
  // Guard first, quote second. Quoting first would strand the apostrophe outside.
  assert.equal(escapeCsvField('-Foo, Inc'), '"\'-Foo, Inc"');
  const [, row] = parseCsv(toCsv([record({ company: '-Foo, Inc' })]));
  assert.equal(row[COLUMNS.indexOf('Company')], "'-Foo, Inc");
});

test('RFC 4180 quoting: commas, quotes, newlines and edge whitespace', () => {
  assert.equal(escapeCsvField('a,b'), '"a,b"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeCsvField(' padded '), '" padded "');
  assert.equal(escapeCsvField('plain'), 'plain');
});

test('values containing separators round-trip through a real CSV reader', () => {
  const csv = toCsv([record({ company: 'Acme, Inc.', role: 'Say "Hello"', location: 'Berlin\nGermany' })]);
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], COLUMNS, 'header row first');
  assert.equal(rows[1][COLUMNS.indexOf('Company')], 'Acme, Inc.');
  assert.equal(rows[1][COLUMNS.indexOf('Role')], 'Say "Hello"');
  assert.equal(rows[1][COLUMNS.indexOf('Location')], 'Berlin\nGermany');
  assert.equal(rows.length, 2);
});

test('toCsv uses CRLF terminators and ends with one', () => {
  const csv = toCsv([record()]);
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.split('\r\n').length - 1, 2, 'header + one record, each CRLF-terminated');
  assert.ok(!/[^\r]\n/.test(csv), 'no bare LF line terminators');
});

test('an empty record set still writes the header', () => {
  assert.equal(toCsv([]), COLUMNS.join(',') + '\r\n');
});

test('writeCsv with dryRun performs zero writes but returns the plan', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'applications.csv');
  const plan = await writeCsv([record()], { dryRun: true, file });

  assert.equal(plan.written, false);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.rows, 1);
  assert.ok(plan.bytes > 0, 'the plan states what it would have written');
  await assert.rejects(() => fs.readFile(file), { code: 'ENOENT' }, 'dry run must not touch the disk');
  assert.deepEqual(await fs.readdir(dir), [], 'not even a temp file');
});

test('writeCsv defaults to the APPLICATIONS_CSV constant, never a literal path', async () => {
  const plan = await writeCsv([], { dryRun: true });
  assert.equal(plan.file, APPLICATIONS_CSV);
});

test('writeCsv is atomic and leaves no temp files behind', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'applications.csv');
  const records = [record(), record({ messageId: 'msg-2', company: 'Ashby' })];

  const plan = await writeCsv(records, { file });
  assert.equal(plan.written, true);
  assert.equal(await fs.readFile(file, 'utf8'), toCsv(records));
  assert.deepEqual(await fs.readdir(dir), ['applications.csv'], 'temp file must be renamed away');
});

test('writeCsv creates missing parent directories and overwrites cleanly', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'nested', 'applications.csv');
  await writeCsv([record()], { file });
  await writeCsv([], { file });
  assert.equal(await fs.readFile(file, 'utf8'), toCsv([]), 'the projection is rebuildable, not appended to');
});
