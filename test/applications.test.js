import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * BAMBOO_HOME must be set before config.js is evaluated, so the modules under test are
 * imported dynamically. Every write below lands in this temp directory and nowhere near
 * a real ~/.bamboo.
 */
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'bamboo-applications-'));
process.env.BAMBOO_HOME = HOME;

const { APPLICATIONS_FILE } = await import('../src/config.js');
const { CorruptFileError } = await import('../src/store.js');
const {
  REVIEW_REASONS,
  STATUS_ORDER,
  applyExtractions,
  canAdvance,
  createRecord,
  emptyState,
  loadApplications,
  mergeExtraction,
  recordKey,
  saveApplications,
} = await import('../src/tracker/applications.js');

after(async () => {
  await fs.rm(HOME, { recursive: true, force: true });
});

/** Clear the tracker file between the tests that touch disk. */
async function clean() {
  await fs.rm(APPLICATIONS_FILE, { force: true });
  await fs.rm(`${APPLICATIONS_FILE}.bak`, { force: true });
}

const NOW = '2026-08-16T12:00:00.000Z';

const mail = (over = {}) => ({
  id: 'm1',
  threadId: 't1',
  from: 'Greenhouse <no-reply@greenhouse.io>',
  fromAddress: 'no-reply@greenhouse.io',
  to: 'you@example.com',
  subject: 'Thank you for applying to Stripe',
  internalDate: '1723659000000', // 2024-08-14T18:10:00Z
  snippet: '',
  body: 'Thank you for applying to Stripe.',
  ...over,
});

const extraction = (over = {}) => ({
  matched: true,
  company: 'Stripe',
  role: 'Software Engineer Intern',
  location: null,
  source: 'greenhouse',
  jobUrl: null,
  status: 'applied',
  confidence: 'high',
  reviewReasons: [],
  ...over,
});

// ── keys ─────────────────────────────────────────────────────────────────────

test('recordKey folds legal suffixes and punctuation into one company', () => {
  const a = recordKey('Stripe, Inc.', 'Software Engineer Intern', 'm1');
  const b = recordKey('stripe', 'software engineer intern', 'm2');
  assert.equal(a, b, 'Stripe, Inc. and stripe are one employer, not two rows');
  assert.equal(a, 'stripe::softwareengineerintern');
  assert.equal(recordKey('Acme LLC', 'SWE', 'm1'), recordKey('ACME', 'swe', 'm2'));
  assert.notEqual(
    recordKey('Stripe', 'Software Engineer Intern', 'm1'),
    recordKey('Stripe', 'Product Manager Intern', 'm2'),
    'two roles at one company are two applications',
  );
});

test('recordKey keeps a company whose whole name is a legal suffix', () => {
  assert.equal(recordKey('Co', 'Intern', 'm1'), 'co::intern', 'stripping the only token would erase it');
});

test('recordKey falls back to the message id when company or role is unknown', () => {
  const a = recordKey(null, 'Software Engineer Intern', 'm1');
  const b = recordKey(null, null, 'm2');
  assert.equal(a, 'msg::m1');
  assert.notEqual(a, b, 'two unidentified applications must not collide into one row');
});

// ── state machine ────────────────────────────────────────────────────────────

test('canAdvance is forward-only', () => {
  assert.equal(canAdvance('applied', 'screen'), true);
  assert.equal(canAdvance('applied', 'offer'), true);
  assert.equal(canAdvance('interview', 'screen'), false, 'a later email may not move a record backwards');
  assert.equal(canAdvance('offer', 'applied'), false);
  assert.equal(canAdvance('applied', 'applied'), false, 'standing still is not an advance');
});

test('rejected and withdrawn are reachable from anywhere and nothing leaves them', () => {
  for (const from of STATUS_ORDER) {
    assert.equal(canAdvance(from, 'rejected'), true, `${from} -> rejected`);
    assert.equal(canAdvance(from, 'withdrawn'), true, `${from} -> withdrawn`);
  }
  for (const to of [...STATUS_ORDER, 'withdrawn']) {
    assert.equal(canAdvance('rejected', to), false, `rejected must not reopen as ${to}`);
  }
  assert.equal(canAdvance('withdrawn', 'rejected'), false);
});

test('canAdvance refuses a status it does not recognise', () => {
  assert.equal(canAdvance('applied', 'ghosted'), false);
  assert.equal(canAdvance('ghosted', 'offer'), false);
});

// ── records ──────────────────────────────────────────────────────────────────

test('a receipt becomes a record with nothing invented', () => {
  const r = createRecord(extraction({ role: null, confidence: 'medium' }), mail(), { now: NOW });
  assert.equal(r.company, 'Stripe');
  assert.equal(r.role, null, 'an unknown role is null, never guessed from the company');
  assert.equal(r.location, null);
  assert.equal(r.appliedAt, '2024-08-14T18:10:00.000Z', 'appliedAt comes from internalDate');
  assert.equal(r.messageId, 'm1');
  assert.equal(r.threadId, 't1');
  assert.equal(r.extractedBy, 'deterministic');
  assert.equal(r.needsReview, true);
  assert.ok(r.reviewReasons.includes(REVIEW_REASONS.role), 'the gap is named, not hidden');
  assert.deepEqual(r.statusHistory, [
    { status: 'applied', at: '2024-08-14T18:10:00.000Z', messageId: 'm1' },
  ]);
});

test('a low-confidence extraction is flagged for review rather than trusted', () => {
  const r = createRecord(extraction({ confidence: 'low' }), mail(), { now: NOW });
  assert.equal(r.needsReview, true);
  assert.ok(r.reviewReasons.includes(REVIEW_REASONS.lowConfidence));
});

test('a later email fills a field the first one left null', () => {
  const first = createRecord(extraction({ location: null, jobUrl: null }), mail(), { now: NOW });
  const next = mergeExtraction(
    first,
    extraction({ location: 'Remote — US', jobUrl: 'https://boards.greenhouse.io/stripe/jobs/1' }),
    mail({ id: 'm2', internalDate: '1723745400000' }),
    { now: NOW },
  );
  assert.equal(next.location, 'Remote — US');
  assert.equal(next.jobUrl, 'https://boards.greenhouse.io/stripe/jobs/1');
  assert.equal(first.location, null, 'mergeExtraction must not mutate the record it was given');
});

test('a low-confidence value never overwrites a high-confidence one', () => {
  const first = createRecord(extraction({ company: 'Stripe', confidence: 'high' }), mail(), { now: NOW });
  const next = mergeExtraction(
    first,
    extraction({ company: 'Greenhouse', role: 'Intern', confidence: 'low' }),
    mail({ id: 'm2' }),
    { now: NOW },
  );
  assert.equal(next.company, 'Stripe', 'the weaker claim loses, always');
  assert.equal(next.role, 'Software Engineer Intern');
  assert.equal(next.confidence, 'high', 'confidence describes the values held, so it does not fall');
});

test('a more confident extraction does correct a value', () => {
  const first = createRecord(extraction({ company: 'Stripe Payments', confidence: 'low' }), mail(), {
    now: NOW,
  });
  const next = mergeExtraction(
    first,
    extraction({ company: 'Stripe', confidence: 'high' }),
    mail({ id: 'm2' }),
    { now: NOW },
  );
  assert.equal(next.company, 'Stripe');
  assert.equal(next.confidence, 'high');
});

test('status advances forward, appending history; a backwards status is ignored', () => {
  const applied = createRecord(extraction(), mail(), { now: NOW });
  const interviewing = mergeExtraction(
    applied,
    extraction({ status: 'interview' }),
    mail({ id: 'm2', internalDate: '1723745400000' }),
    { now: NOW },
  );
  assert.equal(interviewing.status, 'interview');
  assert.equal(interviewing.statusHistory.length, 2);
  assert.deepEqual(interviewing.statusHistory[1], {
    status: 'interview',
    at: '2024-08-15T18:10:00.000Z',
    messageId: 'm2',
  });

  const late = mergeExtraction(interviewing, extraction({ status: 'applied' }), mail({ id: 'm3' }), {
    now: NOW,
  });
  assert.equal(late.status, 'interview', 'a stray receipt must not reopen an interviewing record');
  assert.equal(late.statusHistory.length, 2, 'and must not add a history entry');
});

test('a rejection closes the record for good', () => {
  const applied = createRecord(extraction(), mail(), { now: NOW });
  const rejected = mergeExtraction(applied, extraction({ status: 'rejected' }), mail({ id: 'm2' }), {
    now: NOW,
  });
  assert.equal(rejected.status, 'rejected');
  const reopened = mergeExtraction(rejected, extraction({ status: 'interview' }), mail({ id: 'm3' }), {
    now: NOW,
  });
  assert.equal(reopened.status, 'rejected');
});

test('the earliest receipt owns appliedAt even when it arrives second', () => {
  const later = createRecord(extraction(), mail({ internalDate: '1723745400000' }), { now: NOW });
  const merged = mergeExtraction(later, extraction(), mail({ id: 'm0', internalDate: '1723659000000' }), {
    now: NOW,
  });
  assert.equal(merged.appliedAt, '2024-08-14T18:10:00.000Z');
});

// ── applyExtractions ─────────────────────────────────────────────────────────

const BATCH = [
  { mail: mail({ id: 'a1', threadId: 'ta' }), extraction: extraction() },
  {
    mail: mail({ id: 'a2', threadId: 'tb', internalDate: '1723745400000' }),
    extraction: extraction({ company: 'Ramp', role: 'Backend Intern', source: 'ashby' }),
  },
  {
    mail: mail({ id: 'a3', threadId: 'tc', internalDate: '1723831800000' }),
    extraction: extraction({ company: null, role: null, confidence: 'low' }),
  },
];

test('replaying the same messages creates no duplicate records', () => {
  const first = applyExtractions(emptyState(), BATCH, { now: NOW });
  assert.equal(first.created, 3);
  assert.equal(first.updated, 0);
  assert.equal(first.state.records.length, 3);

  const second = applyExtractions(first.state, BATCH, { now: NOW });
  assert.equal(second.created, 0, 'a replay must create nothing');
  assert.equal(second.updated, 0, 'and must change nothing');
  assert.equal(second.skipped, 3);
  assert.equal(second.state.records.length, 3);
  assert.deepEqual(second.state, first.state, 'the file after a replay is byte-identical');

  const third = applyExtractions(second.state, BATCH, { now: NOW });
  assert.deepEqual(third.state.records, first.state.records);
});

test('replay survives a round trip through disk', async () => {
  await clean();
  const first = applyExtractions(emptyState(), BATCH, { now: NOW });
  await saveApplications(first.state);

  const reloaded = await loadApplications();
  const again = applyExtractions(reloaded, BATCH, { now: NOW });
  assert.equal(again.created, 0, 'JSON round tripping must not lose the identity of a record');
  assert.equal(again.updated, 0);
  assert.equal(again.state.records.length, 3);
});

test('a thread that progresses updates the record it already has', () => {
  const first = applyExtractions(emptyState(), BATCH, { now: NOW });
  const progressed = applyExtractions(
    first.state,
    [
      {
        mail: mail({ id: 'a4', threadId: 'ta', internalDate: '1723918200000' }),
        extraction: extraction({ status: 'interview', location: 'New York, NY' }),
      },
    ],
    { now: NOW },
  );
  assert.equal(progressed.created, 0);
  assert.equal(progressed.updated, 1);
  assert.equal(progressed.state.records.length, 3);
  const stripe = progressed.state.records.find((r) => r.company === 'Stripe');
  assert.equal(stripe.status, 'interview');
  assert.equal(stripe.location, 'New York, NY');
  assert.equal(stripe.messageId, 'a1', 'messageId still points at the email that created the record');
});

test('an unmatched message is skipped, never recorded with invented fields', () => {
  const r = applyExtractions(
    emptyState(),
    [{ mail: mail({ id: 'n1' }), extraction: { matched: false, reviewReasons: [] } }],
    { now: NOW },
  );
  assert.equal(r.created, 0);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.state.records, []);
});

test('the watermark advances to the newest message and stays a string', () => {
  const r = applyExtractions(emptyState(), BATCH, { now: NOW });
  assert.equal(r.state.lastInternalDate, '1723831800000');
  assert.equal(typeof r.state.lastInternalDate, 'string', 'Gmail returns it as a string; keep it one');

  // Out-of-order delivery must not rewind it.
  const older = applyExtractions(
    r.state,
    [{ mail: mail({ id: 'z1', internalDate: '1700000000000' }), extraction: extraction({ matched: false }) }],
    { now: NOW },
  );
  assert.equal(older.state.lastInternalDate, '1723831800000');
});

test('applyExtractions does not mutate the state it was handed', () => {
  const before = emptyState();
  applyExtractions(before, BATCH, { now: NOW });
  assert.deepEqual(before, emptyState(), 'callers must be able to compare before and after');
});

// ── persistence ──────────────────────────────────────────────────────────────

test('loadApplications returns an empty state when nothing has synced yet', async () => {
  await clean();
  const state = await loadApplications();
  assert.deepEqual(state, emptyState());
});

test('REFUSES to read a corrupt applications file, and the file survives', async () => {
  await clean();
  const original = '{ "version": 1, "records": [ {"id":"stripe::swe"} ], }'; // trailing comma
  await fs.mkdir(path.dirname(APPLICATIONS_FILE), { recursive: true });
  await fs.writeFile(APPLICATIONS_FILE, original);

  await assert.rejects(
    () => loadApplications(),
    CorruptFileError,
    'substituting {records: []} here would delete every application on the next save',
  );
  assert.equal(await fs.readFile(APPLICATIONS_FILE, 'utf8'), original, 'the bytes must be untouched');
});

test('valid JSON of the wrong shape is corrupt too', async () => {
  await clean();
  await fs.mkdir(path.dirname(APPLICATIONS_FILE), { recursive: true });
  await fs.writeFile(APPLICATIONS_FILE, '["not", "a", "tracker file"]');
  await assert.rejects(() => loadApplications(), CorruptFileError);
});

test('saveApplications round-trips and keeps a .bak of the previous contents', async () => {
  await clean();
  const first = applyExtractions(emptyState(), BATCH, { now: NOW });
  await saveApplications(first.state);
  assert.deepEqual(await loadApplications(), first.state);

  const second = applyExtractions(
    first.state,
    [
      {
        mail: mail({ id: 'a5', threadId: 'ta', internalDate: '1724004600000' }),
        extraction: extraction({ status: 'rejected' }),
      },
    ],
    { now: NOW },
  );
  await saveApplications(second.state);

  const current = await loadApplications();
  assert.equal(current.records.find((r) => r.company === 'Stripe').status, 'rejected');
  const backup = JSON.parse(await fs.readFile(`${APPLICATIONS_FILE}.bak`, 'utf8'));
  assert.equal(
    backup.records.find((r) => r.company === 'Stripe').status,
    'applied',
    'the previous version must be recoverable',
  );
});

test('saveApplications leaves no temp files behind', async () => {
  await clean();
  await saveApplications(emptyState());
  const left = (await fs.readdir(HOME)).filter((f) => f.includes('.tmp'));
  assert.deepEqual(left, [], 'temp files must be renamed away, not orphaned');
});
