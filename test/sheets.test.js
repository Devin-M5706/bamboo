import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, recordToRow } from '../src/tracker/csv.js';
import {
  a1Range,
  createSpreadsheet,
  ensureHeader,
  quoteSheetName,
  readKeyColumn,
  upsertRecords,
} from '../src/google/sheets.js';
import { record } from './helpers/fixtures.js';

const TOKEN = 'ya29.SECRET-ACCESS-TOKEN';
const SHEET = 'Applications';
const ID = 'sheet-123';


/**
 * Offline fetch. `handler` receives the decoded request and returns
 * {status, body, headers}; every call is recorded so tests can assert request shaping.
 */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const call = {
      url: decodeURIComponent(String(url)),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    calls.push(call);
    const { status = 200, body = {}, headers = {} } = handler(call, calls.length - 1) ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
      json: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
}

const noSleep = async () => {};
const isRead = (c) => c.method === 'GET';
const isWrite = (c) => c.method !== 'GET';
const headerRange = `'${SHEET}'!A1:K1`;
const keyRange = `'${SHEET}'!K1:K`;

/** Sheet whose header row is already correct and whose key column holds `keys`. */
function populatedSheet(keys = [], extra = () => ({})) {
  return (call, i) => {
    if (isRead(call) && call.url.includes(headerRange)) return { body: { values: [[...COLUMNS]] } };
    if (isRead(call) && call.url.includes(keyRange)) {
      return { body: { values: [[COLUMNS[10]], ...keys.map((k) => [k])] } };
    }
    return extra(call, i);
  };
}

test('a1Range quotes sheet names containing spaces', () => {
  assert.equal(a1Range('My Sheet', 'A1:K1'), "'My Sheet'!A1:K1");
});

test('a1Range doubles an apostrophe inside a sheet name', () => {
  assert.equal(quoteSheetName("Bob's Data"), "'Bob''s Data'");
  assert.equal(a1Range("Bob's Data", 'K1:K'), "'Bob''s Data'!K1:K");
});

test('a1Range quotes a name that would otherwise parse as a cell reference', () => {
  // An unquoted sheet named A1 reads a cell, not a sheet, and silently returns wrong data.
  assert.equal(a1Range('A1', 'A1:K1'), "'A1'!A1:K1");
});

test('createSpreadsheet returns the id and a usable url', async () => {
  const fetchImpl = fakeFetch(() => ({
    body: { spreadsheetId: ID, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-123/edit' },
  }));
  const out = await createSpreadsheet({ accessToken: TOKEN, title: 'Applications', sheetName: SHEET, fetchImpl });

  assert.equal(out.spreadsheetId, ID);
  assert.match(out.sheetUrl, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/sheet-123/);
  assert.equal(fetchImpl.calls[0].method, 'POST');
  assert.equal(fetchImpl.calls[0].body.sheets[0].properties.title, SHEET);
});

test('readKeyColumn maps message ids to 1-based row numbers, skipping the header', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { values: [['Message ID'], ['msg-a'], ['msg-b']] } }));
  const map = await readKeyColumn({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, fetchImpl });

  assert.equal(map.get('msg-a'), 2, 'first data row is sheet row 2');
  assert.equal(map.get('msg-b'), 3);
  assert.equal(map.size, 2);
  assert.ok(fetchImpl.calls[0].url.includes(keyRange), 'reads only the key column, not the whole sheet');
});

test('readKeyColumn treats an empty sheet as no rows rather than failing', async () => {
  const fetchImpl = fakeFetch(() => ({ body: {} }));
  const map = await readKeyColumn({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, fetchImpl });
  assert.equal(map.size, 0);
});

test('ensureHeader writes the header row when A1 is empty', async () => {
  const fetchImpl = fakeFetch((call) => (isRead(call) ? { body: {} } : { body: {} }));
  const out = await ensureHeader({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, fetchImpl });

  assert.deepEqual(out, { ok: true, written: true, mismatch: null });
  const write = fetchImpl.calls.find(isWrite);
  assert.equal(write.method, 'PUT');
  assert.deepEqual(write.body.values, [COLUMNS], 'the header is the shared contract, not a local copy');
  assert.match(write.url, /valueInputOption=RAW/);
});

test('ensureHeader is a no-op when the header already matches', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { values: [[...COLUMNS]] } }));
  const out = await ensureHeader({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, fetchImpl });

  assert.deepEqual(out, { ok: true, written: false, mismatch: null });
  assert.equal(fetchImpl.calls.filter(isWrite).length, 0);
});

test('ensureHeader REFUSES to overwrite a header a person edited', async () => {
  const edited = ['Applied On', 'Employer', 'Role', 'Location', 'Status', 'Source', 'Job URL', 'Last Update', 'Confidence', 'Needs Review', 'Message ID'];
  const fetchImpl = fakeFetch(() => ({ body: { values: [edited] } }));
  const out = await ensureHeader({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, fetchImpl });

  assert.equal(out.ok, false);
  assert.equal(out.written, false);
  assert.deepEqual(out.mismatch.actual, edited);
  assert.deepEqual(out.mismatch.expected, COLUMNS);
  assert.equal(fetchImpl.calls.filter(isWrite).length, 0, 'a manual column rename must survive a sync');
});

test('ensureHeader under dryRun writes nothing even when the sheet is blank', async () => {
  const fetchImpl = fakeFetch(() => ({ body: {} }));
  const out = await ensureHeader({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, dryRun: true, fetchImpl });

  assert.equal(out.written, false);
  assert.equal(fetchImpl.calls.filter(isWrite).length, 0);
});

test('upsertRecords appends new rows and updates existing ones in two batched writes', async () => {
  const fetchImpl = fakeFetch(populatedSheet(['msg-1']));
  const records = [record(), record({ messageId: 'msg-2', company: 'Ashby' }), record({ messageId: 'msg-3', company: 'Lever' })];
  const out = await upsertRecords({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, records, fetchImpl });

  assert.equal(out.updated, 1);
  assert.equal(out.appended, 2);
  assert.equal(out.headerMismatch, null);

  const writes = fetchImpl.calls.filter(isWrite);
  assert.equal(writes.length, 2, 'one batchUpdate and one append -- never a request per record');

  const batch = writes.find((c) => c.url.includes('values:batchUpdate'));
  assert.equal(batch.body.data.length, 1);
  assert.equal(batch.body.data[0].range, `'${SHEET}'!A2:K2`, 'msg-1 sits in sheet row 2');

  const append = writes.find((c) => c.url.includes(':append'));
  assert.equal(append.body.values.length, 2);
  assert.match(append.url, /insertDataOption=INSERT_ROWS/);
});

test('upsertRecords writes RAW so a formula-shaped value cannot execute in Sheets', async () => {
  const fetchImpl = fakeFetch(populatedSheet([]));
  const records = [record({ company: '=IMPORTXML("http://evil","//x")' })];
  await upsertRecords({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, records, fetchImpl });

  const append = fetchImpl.calls.find((c) => c.url.includes(':append'));
  assert.match(append.url, /valueInputOption=RAW/, 'USER_ENTERED would evaluate this cell');
  assert.equal(append.body.values[0][1], '=IMPORTXML("http://evil","//x")', 'RAW stores it as literal text');
});

test('upsertRecords rows come from the shared recordToRow, so the sinks cannot drift', async () => {
  const fetchImpl = fakeFetch(populatedSheet([]));
  const rec = record({ company: null, location: null });
  await upsertRecords({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, records: [rec], fetchImpl });

  const append = fetchImpl.calls.find((c) => c.url.includes(':append'));
  assert.deepEqual(append.body.values[0], recordToRow(rec));
  assert.equal(append.body.values[0][1], '—', 'a missing value reaches the sheet as an em dash');
});

test('upsertRecords with dryRun reads everything and writes nothing', async () => {
  const fetchImpl = fakeFetch(populatedSheet(['msg-1']));
  const records = [record(), record({ messageId: 'msg-2' })];
  const out = await upsertRecords({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, records, dryRun: true, fetchImpl });

  assert.equal(fetchImpl.calls.filter(isWrite).length, 0, 'dry run must issue zero writes');
  assert.equal(fetchImpl.calls.filter(isRead).length, 2, 'but still performs the reads the plan depends on');

  assert.equal(out.updated, 1);
  assert.equal(out.appended, 1);
  assert.equal(out.planned.length, 2);
  assert.deepEqual(
    out.planned.map((p) => [p.action, p.messageId, p.range]),
    [['update', 'msg-1', `'${SHEET}'!A2:K2`], ['append', 'msg-2', null]],
  );
  assert.deepEqual(out.planned[0].row, recordToRow(records[0]), 'the plan carries the exact rows it would write');
});

test('upsertRecords REFUSES to write into a sheet whose header does not match', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { values: [['Date', 'Employer', 'Notes']] } }));
  const out = await upsertRecords({
    accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, records: [record()], fetchImpl,
  });

  assert.equal(out.appended, 0);
  assert.equal(out.updated, 0);
  assert.deepEqual(out.planned, []);
  assert.ok(out.refusedReason.includes('header'), 'the refusal has to say why');
  assert.deepEqual(out.headerMismatch.actual, ['Date', 'Employer', 'Notes']);
  assert.equal(fetchImpl.calls.filter(isWrite).length, 0);
});

test('upsertRecords does not append the same message id twice within one batch', async () => {
  const fetchImpl = fakeFetch(populatedSheet([]));
  const records = [record({ status: 'applied' }), record({ status: 'interview' })];
  const out = await upsertRecords({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, records, dryRun: true, fetchImpl });

  assert.equal(out.appended, 1, 'the key column is the identity; one key is one row');
  assert.equal(out.planned[0].row[4], 'interview', 'the later record wins');
});

test('an empty record set issues no writes at all', async () => {
  const fetchImpl = fakeFetch(populatedSheet([]));
  const out = await upsertRecords({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, records: [], fetchImpl });

  assert.deepEqual([out.appended, out.updated], [0, 0]);
  assert.equal(fetchImpl.calls.filter(isWrite).length, 0);
});

test('a 429 is retried and honours Retry-After', async () => {
  const seen = [];
  const fetchImpl = fakeFetch((call, i) =>
    (i === 0 ? { status: 429, headers: { 'retry-after': '2' }, body: { error: { message: 'rate limit' } } } : { body: {} }));
  const map = await readKeyColumn({
    accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, fetchImpl,
    sleep: async (ms) => { seen.push(ms); },
  });

  assert.equal(fetchImpl.calls.length, 2, 'the first attempt must be retried');
  assert.deepEqual(seen, [2000], 'Retry-After is in seconds and the server means it');
  assert.equal(map.size, 0);
});

test('a 400 is never retried -- a malformed request will not become valid', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 400, body: { error: { message: 'Unable to parse range' } } }));
  await assert.rejects(
    () => readKeyColumn({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, fetchImpl, sleep: noSleep }),
    (err) => err.status === 400 && /Unable to parse range/.test(err.message),
  );
  assert.equal(fetchImpl.calls.length, 1);
});

test('a persistent 500 gives up after three retries', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 500, body: {} }));
  await assert.rejects(() => readKeyColumn({
    accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, fetchImpl, sleep: noSleep,
  }));
  assert.equal(fetchImpl.calls.length, 4, 'one attempt plus three retries');
});

test('the access token never appears in an error message', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 403, body: { error: { message: 'insufficient scope' } } }));
  await assert.rejects(
    () => readKeyColumn({ accessToken: TOKEN, spreadsheetId: ID, sheetName: SHEET, fetchImpl, sleep: noSleep }),
    (err) => {
      assert.ok(!err.message.includes(TOKEN), 'a leaked bearer token is the mailbox itself');
      assert.ok(!err.stack.includes(TOKEN));
      return true;
    },
  );
  assert.equal(fetchImpl.calls[0].headers.authorization, `Bearer ${TOKEN}`, 'it is sent, just never surfaced');
});
