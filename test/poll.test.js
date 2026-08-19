import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enrichGreenhouse, loadBoards, pollOnce } from '../src/poll.js';
import { CorruptFileError } from '../src/store.js';

/**
 * The poll cycle is the top of the pipeline and had no test at all. `test/pipeline.test.js`
 * covers the vendor parsers and the eligibility gates underneath it; nothing covered the
 * cycle that ties them together, decides what is new, and writes the two state files.
 *
 * Everything here is offline: `pollOnce` takes its board fetch, its detail fetch and its
 * sleep as parameters, and every file path points into a temp directory.
 */

const dirs = [];
async function tmp() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'bamboo-poll-'));
  dirs.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of dirs) {
    try {
      fs.rm(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

const posting = (over = {}) => ({
  vendor: 'lever',
  board: 'acme',
  id: '1',
  title: 'Software Engineer Intern',
  location: 'Remote',
  url: 'https://jobs.lever.co/acme/1',
  description: 'Build things. No citizenship requirement.',
  publishedAt: Date.now() - 60_000,
  ...over,
});

/** A workspace with boards.json already written, since every cycle needs one. */
async function workspace({ boards = [{ vendor: 'lever', board: 'acme' }] } = {}) {
  const dir = await tmp();
  const boardsFile = path.join(dir, 'boards.json');
  const stateFile = path.join(dir, 'state.json');
  const queueFile = path.join(dir, 'queue.json');
  await fs.writeFile(boardsFile, JSON.stringify({ boards }));
  return { dir, boardsFile, stateFile, queueFile };
}

const run = (ws, opts = {}) =>
  pollOnce({
    boardsFile: ws.boardsFile,
    stateFile: ws.stateFile,
    queueFile: ws.queueFile,
    sleepImpl: async () => {},
    fetchBoardImpl: async () => ({ ok: true, postings: [posting()] }),
    fetchDetail: async () => ({ ok: false, error: 'not called in this test' }),
    ...opts,
  });

const readJsonFile = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));

// ── the cold start ───────────────────────────────────────────────────────────

test('a cold start records every id and queues nothing', async () => {
  const ws = await workspace();
  const r = await run(ws, {
    fetchBoardImpl: async () => ({
      ok: true,
      postings: [posting({ id: '1' }), posting({ id: '2' }), posting({ id: '3' })],
    }),
  });

  assert.equal(r.coldStart, true);
  assert.equal(r.seenTotal, 3);
  assert.equal(r.queued, 0, 'a first run must not queue the whole back catalogue');
  assert.deepEqual((await readJsonFile(ws.queueFile)).items, []);
});

test('the second cycle queues only what it has not seen', async () => {
  const ws = await workspace();
  await run(ws, { fetchBoardImpl: async () => ({ ok: true, postings: [posting({ id: '1' })] }) });

  const r = await run(ws, {
    fetchBoardImpl: async () => ({ ok: true, postings: [posting({ id: '1' }), posting({ id: '2' })] }),
  });

  assert.equal(r.coldStart, false);
  assert.equal(r.fresh, 1);
  assert.equal(r.queued, 1);
  const items = (await readJsonFile(ws.queueFile)).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, '2');
});

test('re-polling the same postings queues nothing the second time', async () => {
  const ws = await workspace();
  await run(ws);
  await run(ws);
  const r = await run(ws);

  assert.equal(r.fresh, 0);
  assert.equal(r.queued, 0);
  assert.equal((await readJsonFile(ws.queueFile)).items.length, 0);
});

test('the same id on two vendors is two postings, not one', async () => {
  const ws = await workspace({
    boards: [
      { vendor: 'lever', board: 'acme' },
      { vendor: 'greenhouse', board: 'acme' },
    ],
  });
  const r = await run(ws, {
    coldStart: false,
    fetchBoardImpl: async (vendor) => ({
      ok: true,
      // Same board and same id; only the vendor differs. The seen-key must keep them apart
      // or one vendor's posting silently suppresses the other's.
      postings: [posting({ vendor, id: '1', description: 'Open to all.' })],
    }),
    fetchDetail: async () => ({ ok: true, description: 'Open to all.', deadline: null, questions: [] }),
  });

  assert.equal(r.fresh, 2);
});

// ── corrupt state refuses ────────────────────────────────────────────────────

test('a corrupt state file aborts the cycle instead of resetting it', async () => {
  const ws = await workspace();
  await run(ws); // establish a real state.json
  const before = await fs.readFile(ws.stateFile, 'utf8');

  await fs.writeFile(ws.stateFile, before.slice(0, before.length / 2)); // truncated write
  const corrupt = await fs.readFile(ws.stateFile, 'utf8');

  await assert.rejects(() => run(ws), CorruptFileError);

  assert.equal(
    await fs.readFile(ws.stateFile, 'utf8'),
    corrupt,
    'the bytes must be untouched: the old code parsed this as {} and wrote that back, forgetting every posting it had seen',
  );
});

test('a corrupt queue file aborts the cycle instead of dropping the queue', async () => {
  const ws = await workspace();
  await run(ws);
  await fs.writeFile(ws.queueFile, '{"items": [ {');
  const corrupt = await fs.readFile(ws.queueFile, 'utf8');

  await assert.rejects(() => run(ws), CorruptFileError);
  assert.equal(await fs.readFile(ws.queueFile, 'utf8'), corrupt);
});

test('a missing state file is a first run, not an error', async () => {
  const ws = await workspace();
  const r = await run(ws);
  assert.equal(r.coldStart, true);
});

test('loadBoards reports a corrupt boards file as corrupt, not as missing', async () => {
  const ws = await workspace();
  await fs.writeFile(ws.boardsFile, '{"boards": [,]}');
  // "no boards found. Run: npm run mine" would send you off to re-mine 65 boards over a
  // trailing comma.
  await assert.rejects(() => loadBoards(ws.boardsFile), CorruptFileError);
});

test('loadBoards still asks for a mine when the file is genuinely absent', async () => {
  const dir = await tmp();
  await assert.rejects(() => loadBoards(path.join(dir, 'nope.json')), /npm run mine/);
});

// ── eligibility and enrichment ───────────────────────────────────────────────

test('an un-enriched Greenhouse posting is queued unverified', async () => {
  const ws = await workspace({ boards: [{ vendor: 'greenhouse', board: 'acme' }] });
  const gh = () => posting({ vendor: 'greenhouse', description: undefined });
  const r = await run(ws, {
    coldStart: false,
    fetchBoardImpl: async () => ({ ok: true, postings: [gh()] }),
    // The detail endpoint failed, so the description was never read and the citizenship
    // gate was never applied. Measured: 12.5% of these flip to ineligible once it is.
    fetchDetail: async () => ({ ok: false, error: '502' }),
  });

  assert.equal(r.queued, 1);
  const [item] = (await readJsonFile(ws.queueFile)).items;
  assert.equal(item.eligibilityVerified, false, 'eligibility decided on the title alone must be flagged');
});

test('an enriched Greenhouse posting is queued verified', async () => {
  const ws = await workspace({ boards: [{ vendor: 'greenhouse', board: 'acme' }] });
  const r = await run(ws, {
    coldStart: false,
    fetchBoardImpl: async () => ({
      ok: true,
      postings: [posting({ vendor: 'greenhouse', description: undefined })],
    }),
    fetchDetail: async () => ({ ok: true, description: 'Open to all applicants.', deadline: null, questions: [] }),
  });

  assert.equal(r.queued, 1);
  assert.equal((await readJsonFile(ws.queueFile)).items[0].eligibilityVerified, true);
});

test('a non-Greenhouse posting is verified without an extra request', async () => {
  const ws = await workspace();
  let details = 0;
  const r = await run(ws, {
    coldStart: false,
    fetchDetail: async () => {
      details += 1;
      return { ok: true, description: '', deadline: null, questions: [] };
    },
  });

  assert.equal(details, 0, 'Lever and Ashby return the description in the list endpoint already');
  assert.equal((await readJsonFile(ws.queueFile)).items[0].eligibilityVerified, true);
  assert.equal(r.queued, 1);
});

test('enrichGreenhouse spends no request on a posting already failing the title filter', async () => {
  let details = 0;
  const out = await enrichGreenhouse(
    [
      posting({ vendor: 'greenhouse', title: 'Senior Staff Engineer', description: undefined }),
      posting({ vendor: 'greenhouse', id: '2', title: 'Software Engineer Intern', description: undefined }),
    ],
    {
      fetchDetail: async () => {
        details += 1;
        return { ok: true, description: 'ok', deadline: null, questions: [] };
      },
      sleepImpl: async () => {},
    },
  );

  assert.equal(details, 1, 'the title gate is free; the detail request is not');
  assert.equal(out.length, 2, 'the rejected posting is still returned, to be dropped by the gate');
});

test('an ineligible posting is dropped with a reason rather than queued', async () => {
  const ws = await workspace();
  const r = await run(ws, {
    coldStart: false,
    fetchBoardImpl: async () => ({
      ok: true,
      postings: [posting({ title: 'Director of Engineering' })],
    }),
  });

  assert.equal(r.queued, 0);
  assert.equal(r.dropped.length, 1);
  assert.ok(r.dropped[0].dropReason, 'a drop without a reason is unreviewable');
});

// ── errors and durability ────────────────────────────────────────────────────

test('a failing board is collected, and the rest of the cycle still runs', async () => {
  const ws = await workspace({
    boards: [
      { vendor: 'lever', board: 'broken' },
      { vendor: 'lever', board: 'acme' },
    ],
  });
  const r = await run(ws, {
    coldStart: false,
    fetchBoardImpl: async (vendor, board) =>
      board === 'broken'
        ? { ok: false, error: 'ETIMEDOUT' }
        : { ok: true, postings: [posting({ id: '9' })] },
  });

  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].board, 'broken');
  assert.equal(r.queued, 1, 'one unreachable board must not cost the whole cycle');
});

test('the queue accumulates across cycles rather than being replaced', async () => {
  const ws = await workspace();
  await run(ws, { coldStart: false, fetchBoardImpl: async () => ({ ok: true, postings: [posting({ id: 'a' })] }) });
  await run(ws, { coldStart: false, fetchBoardImpl: async () => ({ ok: true, postings: [posting({ id: 'b' })] }) });

  const items = (await readJsonFile(ws.queueFile)).items;
  assert.deepEqual(items.map((i) => i.id), ['a', 'b']);
});

test('the cycle counter and last poll time advance', async () => {
  const ws = await workspace();
  await run(ws);
  await run(ws);
  const state = await readJsonFile(ws.stateFile);

  assert.equal(state.cycles, 2);
  assert.ok(state.lastPoll > 0);
});

test('queued items carry the detection lag, and null rather than zero when unknown', async () => {
  const ws = await workspace();
  const r = await run(ws, {
    coldStart: false,
    fetchBoardImpl: async () => ({
      ok: true,
      postings: [posting({ id: 'a' }), posting({ id: 'b', publishedAt: null })],
    }),
  });

  assert.equal(r.queued, 2);
  const items = (await readJsonFile(ws.queueFile)).items;
  assert.ok(items[0].detectionLagMs >= 0);
  assert.equal(items[1].detectionLagMs, null, 'a missing value is null, never a fabricated 0');
});
