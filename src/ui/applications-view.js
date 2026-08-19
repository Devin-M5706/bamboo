/**
 * Screen 5 — tracked applications (`bamboo applications`).
 *
 * A left gutter flag, then five aligned columns, two spaces between them:
 *
 *   flag        1   orange ⚑ when the row needs a human
 *   applied    10   faint, YYYY-MM-DD
 *   company  flex   text, muted once the application is closed
 *   role     flex   text, muted once the application is closed
 *   source     10   faint (metadata)
 *   status      9   mint for an offer, muted when closed, dim otherwise
 *
 * Colour follows the handoff's rule and nothing else: mint = verified or safe (an offer),
 * orange = bamboo speaking or asking (the review flag, the empty state), faint = metadata.
 * A flagged row gets its reasons on `└ ` lines underneath, because "needs review" without
 * the reason just moves the question rather than answering it.
 */
import { PALETTE, columns, padEnd, paint, rule, width } from './theme.js';
import { STATUS_ORDER, TERMINAL_STATUSES } from '../tracker/applications.js';

export const COLS = { flag: 1, applied: 10, source: 10, status: 9, gap: 2 };

/** Column where company starts -- reason lines indent to here. */
export const DESC_COL = COLS.flag + COLS.gap + COLS.applied + COLS.gap;

/** A value the email did not supply. Never a zero, never a plausible default. */
export const EM_DASH = '—';

export const FLAG = '⚑';

const ALL_STATUSES = [...STATUS_ORDER, ...TERMINAL_STATUSES];

const g = ' '.repeat(COLS.gap);

/**
 * Status colour. Only an offer is mint: mint means verified or safe, and it is the one
 * status that is unambiguously good news.
 * @param {string|null|undefined} status
 * @returns {string} a PALETTE hex
 */
export function statusColor(status) {
  if (status === 'offer') return PALETTE.mint;
  if (TERMINAL_STATUSES.includes(status)) return PALETTE.muted;
  if (STATUS_ORDER.includes(status)) return PALETTE.textDim;
  return PALETTE.muted;
}

/** Trim before painting so an ellipsis never lands inside an escape sequence. */
const clip = (text, n) => (text.length > n ? text.slice(0, Math.max(1, n - 1)) + '…' : text);

function layout(total) {
  const fixed =
    COLS.flag + COLS.applied + COLS.source + COLS.status + COLS.gap * 5;
  const flex = Math.max(24, total - fixed);
  const company = Math.max(10, Math.round(flex * 0.4));
  return { company, role: Math.max(12, flex - company) };
}

/**
 * One application row.
 * @param {object} record ApplicationRecord
 * @param {{company: number, role: number}} widths
 * @returns {string}
 */
export function applicationRow(record, widths) {
  const closed = TERMINAL_STATUSES.includes(record.status);
  const body = closed ? PALETTE.muted : PALETTE.text;

  const flag = record.needsReview ? paint(FLAG, PALETTE.orange) : ' ';
  const applied = paint(
    padEnd(record.appliedAt ? String(record.appliedAt).slice(0, 10) : EM_DASH, COLS.applied),
    PALETTE.faint,
  );
  const company = padEnd(paint(clip(record.company ?? EM_DASH, widths.company), body), widths.company);
  const role = padEnd(paint(clip(record.role ?? EM_DASH, widths.role), body), widths.role);
  const source = padEnd(paint(clip(record.source ?? EM_DASH, COLS.source), PALETTE.faint), COLS.source);

  const statusText = ALL_STATUSES.includes(record.status) ? record.status : EM_DASH;
  // Last column: pad OUTSIDE the paint. Trailing spaces inside land before the reset
  // escape, where trimEnd() cannot reach them, so coloured rows grow wider than plain
  // ones and every column below drifts. This has already happened in this codebase.
  const status = padEnd(paint(statusText, statusColor(record.status)), COLS.status);

  return `${padEnd(flag, COLS.flag)}${g}${applied}${g}${company}${g}${role}${g}${source}${g}${status}`.trimEnd();
}

/** The `└ ` line under a flagged row saying what could not be traced to the email. */
export function reviewLine(reason, total = columns()) {
  const room = Math.max(10, total - DESC_COL - 2);
  return ' '.repeat(DESC_COL) + paint(`└ ${clip(String(reason), room)}`, PALETTE.faint);
}

/**
 * What to print when nothing has been tracked yet. Orange, because this is bamboo asking
 * you for something rather than reporting a result.
 */
function emptyScreen() {
  return [
    paint('No applications tracked yet.', PALETTE.muted),
    paint('Run bamboo track to read your inbox for application receipts.', PALETTE.orange),
  ].join('\n');
}

function footer(records) {
  const counts = new Map();
  for (const r of records) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const flagged = records.filter((r) => r.needsReview).length;

  const parts = [paint(`${records.length} applications`, PALETTE.muted)];
  for (const status of ALL_STATUSES) {
    const n = counts.get(status);
    if (!n) continue;
    parts.push(`${paint(String(n), statusColor(status))} ${paint(status, PALETTE.muted)}`);
  }
  if (flagged) {
    parts.push(`${paint(String(flagged), PALETTE.orange)} ${paint('need review', PALETTE.muted)}`);
  }
  return parts.join(paint(' · ', PALETTE.faint));
}

/**
 * Render the tracked applications as a table.
 *
 * @param {object[]} records ApplicationRecord[]
 * @param {{width?: number}} [opts]
 * @returns {string}
 */
export function renderApplications(records, { width: total = columns() } = {}) {
  const list = Array.isArray(records) ? records : [];
  if (!list.length) return emptyScreen();

  const widths = layout(total);
  const out = [];

  const header =
    ' '.repeat(COLS.flag) +
    g +
    paint(padEnd('APPLIED', COLS.applied), PALETTE.faint) +
    g +
    paint(padEnd('COMPANY', widths.company), PALETTE.faint) +
    g +
    paint(padEnd('ROLE', widths.role), PALETTE.faint) +
    g +
    paint(padEnd('SOURCE', COLS.source), PALETTE.faint) +
    g +
    padEnd(paint('STATUS', PALETTE.faint), COLS.status);
  out.push(header.trimEnd());
  out.push(rule(Math.min(total, width(header))));

  for (const record of list) {
    out.push(applicationRow(record, widths));
    if (!record.needsReview) continue;
    for (const reason of record.reviewReasons ?? []) out.push(reviewLine(reason, total));
  }

  out.push('');
  out.push(footer(list));
  return out.join('\n');
}
