import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOne, sync } from '../src/tracker/sync.js';
import { emptyState } from '../src/tracker/applications.js';

/**
 * sync.js is the tracker's orchestrator and was the only module here with no coverage,
 * because driving it used to mean standing up OAuth, Gmail and Sheets. It now takes its
 * collaborators as `deps`, so every test below is offline and injects fakes.
 *
 * The rules under test are the ones that corrupt data silently rather than loudly: the
 * status precedence, the watermark, and the write ordering. None of them throw when they
 * are wrong -- they just quietly lose or reopen an application.
 */

const NO_NETWORK = () => {
  throw new Error('the network was touched by a test');
};

const mail = (over = {}) => ({
  id: 'm1',
  threadId: 't1',
  from: 'Acme Careers <no-reply@greenhouse.io>',
  fromAddress: 'no-reply@greenhouse.io',
  to: 'you@example.com',
  subject: 'Thank you for applying to Acme',
  internalDate: '1723659000000',
  snippet: '',
  body: 'Thank you for applying to Acme for the Software Engineer Intern role.',
  ...over,
});

/**
 * A recorder around the real-shaped dependency surface. Every fake returns the minimum
 * the orchestrator needs, and `calls` preserves the order so tests can assert that
 * records are durable before the spreadsheet is touched.
 */
function harness({ messages = [mail()], extract, state = emptyState(), upsert } = {}) {
  const calls = [];
  const saved = [];
  const deps = {
    getAccessToken: async () => {
      calls.push('getAccessToken');
      return 'token';
    },
    fetchReceipts: async () => {
      calls.push('fetchReceipts');
      return messages;
    },
    extractOne:
      extract ??
      (async (m) => ({
        extraction: { matched: true, company: 'Acme', role: 'SWE Intern', status: 'applied', source: 'greenhouse' },
        consultedAgent: false,
        extractedBy: 'deterministic',
        _id: m.id,
      })),
    loadApplications: async () => {
      calls.push('loadApplications');
      return state;
    },
    saveApplications: async (s) => {
      calls.push('saveApplications');
      saved.push(s);
    },
    writeCsv: async () => {
      calls.push('writeCsv');
    },
    upsertRecords:
      upsert ??
      (async () => {
        calls.push('upsertRecords');
        return { appended: 1, updated: 0 };
      }),
  };
  return { deps, calls, saved };
}

test('a full cycle reports what it did', async () => {
  const { deps } = harness();
  const r = await sync({ dryRun: false, deps });

  assert.equal(r.scanned, 1);
  assert.equal(r.matched, 1);
  assert.equal(r.created, 1);
  assert.equal(r.dryRun, false);
});

test('dry run writes no records', async () => {
  const { deps, calls, saved } = harness();
  const r = await sync({ dryRun: true, deps });

  assert.ok(!calls.includes('saveApplications'), 'a dry run must not persist records');
  assert.equal(saved.length, 0);
  assert.equal(r.dryRun, true);
  // It still reports what it *would* have done, or the dry run tells you nothing.
  assert.equal(r.created, 1);
});

test('records are durable before the spreadsheet is touched', async () => {
  const { deps, calls } = harness();
  await sync({ dryRun: false, sheets: { spreadsheetId: 'sheet-1', sheetName: 'Applications' }, deps });

  const save = calls.indexOf('saveApplications');
  const upsert = calls.indexOf('upsertRecords');
  assert.ok(save !== -1 && upsert !== -1, 'both writes should have happened');
  assert.ok(
    save < upsert,
    'applications.json is the source of truth and the sheet is a projection; writing the sheet first means a crash between them loses the record but leaves the row',
  );
});

test('a failing sheet write does not cost the records', async () => {
  const { deps, saved } = harness({
    upsert: async () => {
      throw new Error('429 rate limited');
    },
  });

  await assert.rejects(
    () => sync({ dryRun: false, sheets: { spreadsheetId: 'sheet-1', sheetName: 'Applications' }, deps }),
    /429/,
  );
  assert.equal(saved.length, 1, 'the records were already saved when the sheet failed');
  assert.equal(saved[0].records.length, 1);
});

test('no spreadsheet configured means no sheet call at all', async () => {
  const { deps, calls } = harness();
  const r = await sync({ dryRun: false, sheets: { spreadsheetId: null, sheetName: 'Applications' }, deps });

  assert.ok(!calls.includes('upsertRecords'));
  assert.equal(r.sheet, null);
});

test('unmatched mail is skipped, never recorded with invented fields', async () => {
  const { deps, saved } = harness({
    messages: [mail({ id: 'm1' }), mail({ id: 'm2', subject: 'Weekly newsletter' })],
    extract: async (m) =>
      m.id === 'm1'
        ? {
            extraction: { matched: true, company: 'Acme', role: 'SWE Intern', status: 'applied' },
            consultedAgent: false,
            extractedBy: 'deterministic',
          }
        : { extraction: { matched: false }, consultedAgent: false, extractedBy: 'deterministic' },
  });

  const r = await sync({ dryRun: false, deps });
  assert.equal(r.scanned, 2);
  assert.equal(r.matched, 1, 'only the receipt counts as an application');
  assert.equal(saved[0].records.length, 1);
});

test('the watermark clears every message read, not only the ones that matched', async () => {
  // The newsletter is the newest message and will never match. If the watermark only
  // advanced over matched receipts it would sit below this message forever, and every
  // future sync would re-fetch it -- unbounded work that grows with your inbox.
  const { deps, saved } = harness({
    messages: [
      mail({ id: 'm1', internalDate: '1000' }),
      mail({ id: 'm2', internalDate: '2000', subject: 'Weekly newsletter' }),
    ],
    extract: async (m) =>
      m.id === 'm1'
        ? {
            extraction: { matched: true, company: 'Acme', role: 'SWE Intern', status: 'applied' },
            consultedAgent: false,
            extractedBy: 'deterministic',
          }
        : { extraction: { matched: false }, consultedAgent: false, extractedBy: 'deterministic' },
  });

  await sync({ dryRun: false, deps });
  assert.equal(saved[0].lastInternalDate, '2000');
});

test('the watermark takes the maximum, not the last message in the array', async () => {
  // sync used to read mail[mail.length - 1], which was correct only because fetchReceipts
  // happens to sort oldest-first. That made a change in gmail.js able to silently skip
  // mail here. Hand it an unsorted batch: the high-water mark must still be the maximum.
  const { deps, saved } = harness({
    messages: [
      mail({ id: 'm1', internalDate: '9000' }),
      mail({ id: 'm2', internalDate: '3000' }),
    ],
  });

  await sync({ dryRun: false, deps });
  assert.equal(saved[0].lastInternalDate, '9000');
});

test('an undated message cannot move the watermark', async () => {
  const { deps, saved } = harness({
    messages: [mail({ id: 'm1', internalDate: '5000' }), mail({ id: 'm2', internalDate: undefined })],
  });

  await sync({ dryRun: false, deps });
  assert.equal(saved[0].lastInternalDate, '5000');
});

test('the sync resumes from the stored watermark', async () => {
  let passed = null;
  const { deps } = harness({ state: { ...emptyState(), lastInternalDate: '4242' } });
  deps.fetchReceipts = async (args) => {
    passed = args;
    return [];
  };

  await sync({ dryRun: false, deps });
  assert.equal(passed.sinceInternalDate, '4242', 'a sync that re-reads from zero costs a full inbox walk every time');
});

test('usedAgent counts what was spent, not what was kept', async () => {
  const { deps } = harness({
    extract: async () => ({
      // The agent was consulted and its answer was then discarded in favour of the
      // patterns. Conflating the two would label a pattern-derived row model-extracted.
      extraction: { matched: true, company: 'Acme', role: 'SWE Intern', status: 'applied' },
      consultedAgent: true,
      extractedBy: 'deterministic',
    }),
  });

  const r = await sync({ dryRun: false, deps });
  assert.equal(r.usedAgent, 1);
});

test('needsReview records are surfaced in the result', async () => {
  const { deps } = harness({
    extract: async () => ({
      extraction: {
        matched: true,
        company: 'Acme',
        role: null,
        status: 'applied',
        reviewReasons: ['role could not be grounded in the email'],
      },
      consultedAgent: true,
      extractedBy: 'agent',
    }),
  });

  const r = await sync({ dryRun: false, deps });
  assert.equal(r.needsReview, 1, 'an ungrounded field must be visible, not silent');
});

test('verbose logging is off by default and never prints on its own', async () => {
  const lines = [];
  const { deps } = harness();
  await sync({ dryRun: false, deps, log: (m) => lines.push(m) });
  assert.deepEqual(lines, [], 'sync must stay quiet unless asked; the CLI owns presentation');
});

/* extractOne: deterministic first, and the status precedence that reopens closed rows. */

test('extractOne does not consult the agent when the patterns were complete', async () => {
  const r = await extractOne(
    mail({
      subject: 'Thank you for applying to Acme',
      body: 'Thank you for applying to Acme for the Software Engineer Intern position.',
    }),
    { fetchImpl: NO_NETWORK },
  );
  assert.equal(r.consultedAgent, false);
  assert.equal(r.extractedBy, 'deterministic');
});

test('extractOne never consults the agent when the agent is disabled', async () => {
  const r = await extractOne(mail({ subject: 'something the patterns cannot place', body: 'hello' }), {
    agentEnabled: false,
    fetchImpl: NO_NETWORK,
  });
  assert.equal(r.consultedAgent, false);
  assert.equal(r.extractedBy, 'deterministic');
});
