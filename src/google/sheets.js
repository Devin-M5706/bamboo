import { REQUEST_TIMEOUT_MS } from '../config.js';
import { COLUMNS, KEY_INDEX, recordToRow } from '../tracker/csv.js';

/**
 * Google Sheets API v4 over raw fetch.
 *
 * No `googleapis` package: this repo has a CI-enforced zero-dependency rule, and the
 * official client pulls in a tree of transitive packages to do what four fetch calls do
 * here. Do not "fix" this by installing it.
 *
 * The sheet is a PROJECTION of applications.json. It can be deleted and rebuilt at any
 * time, and nothing in this file ever reads it back as truth -- the only thing we read
 * from the sheet is where each row lives, so an upsert lands on the right one.
 *
 * COLUMNS and recordToRow are imported from tracker/csv.js rather than restated here.
 * Two copies of a column order drift; a drifted column order silently writes roles into
 * the location column.
 */

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Quote a sheet name for an A1 reference.
 *
 * Unconditionally quoted, and internal apostrophes doubled. The predicate for "does this
 * name need quoting" is a trap: spaces need it, apostrophes need it, and so does a sheet
 * innocently named `A1` or `2026`, which unquoted parses as a cell reference and silently
 * reads the wrong range. Quoting always is correct for every name and costs two bytes.
 *
 * @param {string} sheetName
 * @returns {string}
 */
export function quoteSheetName(sheetName) {
  return `'${String(sheetName).replaceAll("'", "''")}'`;
}

/**
 * Build a full A1 range, e.g. `'My Sheet'!A2:K2`.
 * @param {string} sheetName
 * @param {string} range a1 range within the sheet, e.g. `A1:K1`
 * @returns {string}
 */
export function a1Range(sheetName, range) {
  return `${quoteSheetName(sheetName)}!${range}`;
}

/** Last column letter covered by COLUMNS, so the ranges follow the contract, not a guess. */
const LAST_COL = String.fromCharCode('A'.charCodeAt(0) + COLUMNS.length - 1);

/** Column letter of the upsert key, derived from the shared contract for the same reason. */
const KEY_COL = String.fromCharCode('A'.charCodeAt(0) + KEY_INDEX);

/**
 * One request against the Sheets API, with a timeout and bounded retries.
 *
 * NEVER put the access token in a thrown message or a log line. Errors from this module
 * end up in terminal output and bug reports, and a leaked bearer token is a mailbox and a
 * Drive handed to whoever reads it.
 */
async function sheetsFetch(url, {
  accessToken,
  method = 'GET',
  body,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  retries = 3,
} = {}) {
  let lastStatus = 0;
  let lastDetail = '';

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.ok) return await res.json();

    lastStatus = res.status;
    lastDetail = await readErrorDetail(res);

    if (!RETRY_STATUS.has(res.status) || attempt === retries) break;

    // Honour Retry-After when the server states one; it knows its own quota window.
    const stated = Number.parseInt(res.headers?.get?.('retry-after') ?? '', 10);
    const backoff = Number.isFinite(stated) ? stated * 1000 : 500 * 2 ** attempt;
    await sleep(backoff);
  }

  const err = new Error(`Sheets API ${method} failed: HTTP ${lastStatus}${lastDetail ? ` — ${lastDetail}` : ''}`);
  err.status = lastStatus;
  throw err;
}

async function readErrorDetail(res) {
  try {
    const parsed = await res.json();
    return parsed?.error?.message ?? '';
  } catch {
    return '';
  }
}

const valuesUrl = (spreadsheetId, range, suffix = '') =>
  `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}${suffix}`;

/**
 * Create a spreadsheet with a single sheet named `sheetName`.
 * @param {{accessToken: string, title: string, sheetName: string, fetchImpl?: Function, sleep?: Function}} options
 * @returns {Promise<{spreadsheetId: string, sheetUrl: string}>}
 */
export async function createSpreadsheet({ accessToken, title, sheetName, fetchImpl, sleep }) {
  const body = {
    properties: { title },
    sheets: [{ properties: { title: sheetName } }],
  };
  const created = await sheetsFetch(API, { accessToken, method: 'POST', body, fetchImpl, sleep });
  return {
    spreadsheetId: created.spreadsheetId,
    sheetUrl: created.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
  };
}

/**
 * Read the upsert key column and map each message id to its 1-based row number.
 *
 * This is the only read that matters for correctness: without it an upsert appends a
 * second row for a record that is already there, and the sheet grows a duplicate every
 * time a status changes.
 *
 * @param {{accessToken: string, spreadsheetId: string, sheetName: string, fetchImpl?: Function, sleep?: Function}} options
 * @returns {Promise<Map<string, number>>}
 */
export async function readKeyColumn({ accessToken, spreadsheetId, sheetName, fetchImpl, sleep }) {
  const range = a1Range(sheetName, `${KEY_COL}1:${KEY_COL}`);
  const body = await sheetsFetch(valuesUrl(spreadsheetId, range), { accessToken, fetchImpl, sleep });
  const rows = Array.isArray(body?.values) ? body.values : [];

  const map = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const key = rows[i]?.[0];
    // Row 1 is the header; a blank cell is a gap, not a key.
    if (i === 0 || !key || key === COLUMNS[KEY_INDEX]) continue;
    map.set(String(key), i + 1);
  }
  return map;
}

/**
 * Write the header row when the sheet has none. Never overwrite a header that differs.
 *
 * A person may have renamed a column, reordered them, or added notes above the table. We
 * do not know what that means, and clobbering it would destroy work no backup of ours
 * covers. Report the mismatch and let a human resolve it.
 *
 * @param {{accessToken: string, spreadsheetId: string, sheetName: string, dryRun?: boolean, fetchImpl?: Function, sleep?: Function}} options
 * @returns {Promise<{ok: boolean, written: boolean, mismatch: {expected: string[], actual: string[]}|null}>}
 */
export async function ensureHeader({ accessToken, spreadsheetId, sheetName, dryRun = false, fetchImpl, sleep }) {
  const range = a1Range(sheetName, `A1:${LAST_COL}1`);
  const body = await sheetsFetch(valuesUrl(spreadsheetId, range), { accessToken, fetchImpl, sleep });
  const actual = (Array.isArray(body?.values) ? body.values[0] : null) ?? [];

  const isEmpty = actual.every((v) => v === null || v === undefined || String(v).trim() === '');
  if (!isEmpty) {
    const matches = COLUMNS.length === actual.length && COLUMNS.every((c, i) => c === actual[i]);
    return matches
      ? { ok: true, written: false, mismatch: null }
      : { ok: false, written: false, mismatch: { expected: [...COLUMNS], actual: actual.map(String) } };
  }

  if (dryRun) return { ok: true, written: false, mismatch: null };

  await sheetsFetch(valuesUrl(spreadsheetId, range, '?valueInputOption=RAW'), {
    accessToken,
    method: 'PUT',
    body: { range, majorDimension: 'ROWS', values: [[...COLUMNS]] },
    fetchImpl,
    sleep,
  });
  return { ok: true, written: true, mismatch: null };
}

/**
 * Upsert records into the sheet, keyed on Message ID (column K).
 *
 * Two write calls at most: one values:batchUpdate carrying every changed row, one
 * values:append carrying every new one. A request per record turns a 200-message cold
 * start into 200 round trips and a rate-limit error.
 *
 * @param {{accessToken: string, spreadsheetId: string, sheetName: string, records: object[],
 *          dryRun?: boolean, fetchImpl?: Function, sleep?: Function}} options
 * @returns {Promise<{appended: number, updated: number, planned: Array<{action: 'append'|'update', messageId: string, range: string|null, row: string[]}>, headerMismatch: object|null, refusedReason: string|null}>}
 *          Under dryRun every read still happens and `planned` is the exact plan, but no
 *          write is issued and `appended`/`updated` are the counts that plan would produce.
 */
export async function upsertRecords({
  accessToken,
  spreadsheetId,
  sheetName,
  records,
  dryRun = false,
  fetchImpl,
  sleep,
}) {
  const header = await ensureHeader({ accessToken, spreadsheetId, sheetName, dryRun, fetchImpl, sleep });
  if (!header.ok) {
    // No plan is offered here on purpose: with unknown columns we cannot say which cell
    // any value belongs in, and a plan we cannot stand behind is worse than none.
    return {
      appended: 0,
      updated: 0,
      planned: [],
      headerMismatch: header.mismatch,
      refusedReason: `sheet header does not match the expected columns (found: ${header.mismatch.actual.join(', ') || 'blank'})`,
    };
  }

  const existing = await readKeyColumn({ accessToken, spreadsheetId, sheetName, fetchImpl, sleep });

  /** @type {Map<string, {action: 'append'|'update', messageId: string, range: string|null, row: string[]}>} */
  const plan = new Map();
  for (const record of records ?? []) {
    const row = recordToRow(record);
    const messageId = row[KEY_INDEX];
    const rowNumber = existing.get(messageId);
    // Keyed by message id so a repeat within one batch replaces the earlier entry rather
    // than appending the same application twice.
    plan.set(messageId, rowNumber
      ? { action: 'update', messageId, range: a1Range(sheetName, `A${rowNumber}:${LAST_COL}${rowNumber}`), row }
      : { action: 'append', messageId, range: null, row });
  }

  const planned = [...plan.values()];
  const updates = planned.filter((p) => p.action === 'update');
  const appends = planned.filter((p) => p.action === 'append');
  const result = {
    appended: appends.length,
    updated: updates.length,
    planned,
    headerMismatch: null,
    refusedReason: null,
  };

  if (dryRun) return result;

  if (updates.length > 0) {
    await sheetsFetch(`${API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      accessToken,
      method: 'POST',
      body: {
        // RAW, never USER_ENTERED. USER_ENTERED evaluates a cell beginning with `=` or
        // `-` as a formula -- the same injection csv.js guards with an apostrophe. RAW is
        // the Sheets-side mitigation, which is why the rows are not apostrophe-prefixed
        // here: the values land as literal text.
        valueInputOption: 'RAW',
        data: updates.map((u) => ({ range: u.range, majorDimension: 'ROWS', values: [u.row] })),
      },
      fetchImpl,
      sleep,
    });
  }

  if (appends.length > 0) {
    const anchor = a1Range(sheetName, `A1:${LAST_COL}1`);
    await sheetsFetch(valuesUrl(spreadsheetId, anchor, ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), {
      accessToken,
      method: 'POST',
      body: { majorDimension: 'ROWS', values: appends.map((a) => a.row) },
      fetchImpl,
      sleep,
    });
  }

  return result;
}
