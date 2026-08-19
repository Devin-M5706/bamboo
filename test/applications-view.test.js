import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, setColor, width } from '../src/ui/theme.js';
import {
  COLS,
  DESC_COL,
  EM_DASH,
  FLAG,
  applicationRow,
  renderApplications,
  statusColor,
} from '../src/ui/applications-view.js';

const ANSI = /\x1b\[[0-9;]*m/;

const record = (over = {}) => ({
  id: 'stripe::softwareengineerintern',
  messageId: 'm1',
  threadId: 't1',
  company: 'Stripe',
  role: 'Software Engineer Intern',
  location: 'New York, NY',
  source: 'greenhouse',
  jobUrl: null,
  appliedAt: '2024-08-14T18:10:00.000Z',
  status: 'applied',
  statusHistory: [{ status: 'applied', at: '2024-08-14T18:10:00.000Z', messageId: 'm1' }],
  confidence: 'high',
  needsReview: false,
  reviewReasons: [],
  extractedBy: 'deterministic',
  updatedAt: '2026-08-16T12:00:00.000Z',
  ...over,
});

const WIDTHS = { company: 24, role: 36 };

// ── colour ───────────────────────────────────────────────────────────────────

test('setColor(false) strips every escape code from the applications screen', () => {
  setColor(false);
  const screens = [
    renderApplications(
      [
        record(),
        record({ id: 'x', company: null, role: null, needsReview: true, reviewReasons: ['role not found in email'] }),
        record({ id: 'y', status: 'offer', company: 'Ramp' }),
      ],
      { width: 100 },
    ),
    renderApplications([], { width: 100 }),
  ];
  for (const s of screens) {
    assert.ok(!ANSI.test(s), `escape codes leaked: ${JSON.stringify(s.slice(0, 80))}`);
  }
  setColor(true);
});

test('coloured and plain rows occupy exactly the same columns', () => {
  // The bug this pins: padding the last column INSIDE paint() puts the trailing spaces
  // before the reset escape, where trimEnd() cannot reach them, so the coloured row ends
  // up wider than the plain one and every column below it drifts.
  setColor(false);
  const plain = applicationRow(record(), WIDTHS);
  setColor(true);
  const coloured = applicationRow(record(), WIDTHS);

  assert.ok(plain.endsWith('applied'), 'the plain row is trimmed to its content');
  assert.equal(width(coloured), plain.length, 'a coloured row must not grow');
  setColor(true);
});

test('only an offer is mint; a closed application is muted', () => {
  assert.equal(statusColor('offer'), PALETTE.mint);
  assert.equal(statusColor('rejected'), PALETTE.muted);
  assert.equal(statusColor('withdrawn'), PALETTE.muted);
  assert.equal(statusColor('applied'), PALETTE.textDim);
  assert.equal(statusColor('interview'), PALETTE.textDim);
  assert.equal(statusColor(null), PALETTE.muted);
});

// ── content ──────────────────────────────────────────────────────────────────

test('a missing value prints an em dash, never a zero and never a guess', () => {
  setColor(false);
  const row = applicationRow(
    record({ company: null, role: null, source: null, appliedAt: null }),
    WIDTHS,
  );
  assert.equal(row.match(new RegExp(EM_DASH, 'g')).length, 4, 'every unknown field says so');
  assert.ok(!/\b0\b/.test(row), 'must not invent a zero');
  setColor(true);
});

test('the date column is the ISO day, so it cannot drift with the machine locale', () => {
  setColor(false);
  const row = applicationRow(record(), WIDTHS);
  assert.match(row, /^\s{3}2024-08-14 {2}Stripe/);
  setColor(true);
});

test('a needsReview row is flagged and says why underneath', () => {
  setColor(false);
  const out = renderApplications(
    [
      record({
        role: null,
        needsReview: true,
        reviewReasons: ['role not found in email', 'company "Acme" not found in email text'],
      }),
    ],
    { width: 100 },
  );
  const lines = out.split('\n');
  const row = lines.find((l) => l.includes('Stripe'));
  assert.ok(row.startsWith(FLAG), 'the flag is the first thing on the row');
  assert.ok(out.includes('└ role not found in email'));
  assert.ok(out.includes('company "Acme" not found in email text'));

  const reason = lines.find((l) => l.includes('└'));
  assert.equal(reason.indexOf('└'), DESC_COL, 'reasons indent to the company column');
  setColor(true);
});

test('an unflagged row carries no marker', () => {
  setColor(false);
  const out = renderApplications([record()], { width: 100 });
  assert.ok(!out.includes(FLAG));
  assert.ok(!out.includes('└'));
  setColor(true);
});

// ── layout ───────────────────────────────────────────────────────────────────

test('long values truncate instead of pushing the status column out', () => {
  setColor(false);
  const out = renderApplications(
    [
      record({
        company: 'C'.repeat(200),
        role: 'R'.repeat(200),
        source: 'greenhouse-enterprise-eu',
        needsReview: true,
        reviewReasons: ['x'.repeat(300)],
      }),
    ],
    { width: 100 },
  );
  for (const line of out.split('\n')) {
    assert.ok(line.length <= 100, `line overflowed (${line.length}): ${line}`);
  }
  assert.ok(out.includes('…'));
  setColor(true);
});

test('columns land at fixed offsets regardless of content length', () => {
  setColor(false);
  const short = applicationRow(record({ company: 'Ramp', role: 'SWE' }), WIDTHS);
  const long = applicationRow(
    record({ company: 'A Very Long Company Name Ltd', role: 'Software Engineering Intern, Payments' }),
    WIDTHS,
  );
  const companyAt = COLS.flag + COLS.gap + COLS.applied + COLS.gap;
  for (const row of [short, long]) {
    assert.equal(row.slice(3, 13), '2024-08-14');
    assert.equal(row.slice(companyAt, companyAt + 1).trim().length, 1, 'company starts at a fixed column');
    assert.equal(row.slice(companyAt + WIDTHS.company + COLS.gap, companyAt + WIDTHS.company + COLS.gap + 1), 'S');
  }
  setColor(true);
});

test('the header names every column over a rule', () => {
  setColor(false);
  const lines = renderApplications([record()], { width: 100 }).split('\n');
  for (const label of ['APPLIED', 'COMPANY', 'ROLE', 'SOURCE', 'STATUS']) {
    assert.ok(lines[0].includes(label), `missing header: ${label}`);
  }
  assert.equal(lines[1].length, 100, 'the rule spans the table');
  setColor(true);
});

test('the footer counts honestly', () => {
  setColor(false);
  const out = renderApplications(
    [
      record(),
      record({ id: 'b', status: 'offer' }),
      record({ id: 'c', status: 'rejected', needsReview: true, reviewReasons: ['role not found in email'] }),
    ],
    { width: 100 },
  );
  const footer = out.split('\n').pop();
  assert.match(footer, /3 applications/);
  assert.match(footer, /1 applied/);
  assert.match(footer, /1 offer/);
  assert.match(footer, /1 rejected/);
  assert.match(footer, /1 need review/);
  setColor(true);
});

// ── empty ────────────────────────────────────────────────────────────────────

test('the empty state says how to populate it rather than printing a blank table', () => {
  setColor(false);
  const out = renderApplications([], { width: 100 });
  assert.match(out, /bamboo track/, 'the one command that fills this screen');
  assert.ok(!out.includes('APPLIED'), 'no header over nothing');
  assert.ok(!/\b0\b/.test(out), 'an empty screen does not report a zero either');
  setColor(true);
});

test('the empty-state prompt is orange, because it is bamboo asking', () => {
  setColor(true);
  const out = renderApplications([], { width: 100 });
  const fg = `\x1b[38;2;${[
    parseInt(PALETTE.orange.slice(1, 3), 16),
    parseInt(PALETTE.orange.slice(3, 5), 16),
    parseInt(PALETTE.orange.slice(5, 7), 16),
  ].join(';')}m`;
  assert.ok(out.includes(`${fg}Run bamboo track`), 'orange = bamboo speaking');
});

test('a non-array argument renders the empty state rather than throwing', () => {
  setColor(false);
  assert.equal(renderApplications(undefined), renderApplications([]));
  setColor(true);
});
