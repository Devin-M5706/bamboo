import fs from 'node:fs/promises';
import { BOARDS_FILE, QUEUE_FILE, REQUEST_STAGGER_MS, STATE_FILE } from './config.js';
import { fetchBoard } from './sources.js';
import { partitionByEligibility } from './eligibility.js';

const sleep = (n) => new Promise((r) => setTimeout(r, n));

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))), {
    recursive: true,
  }).catch(() => {});
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

export async function loadBoards(file = BOARDS_FILE) {
  const data = await readJson(file, null);
  if (!data?.boards?.length) {
    throw new Error(`no boards found in ${file}. Run: npm run mine`);
  }
  return data.boards;
}

/**
 * One poll cycle: fetch every board, diff against seen ids, filter for eligibility,
 * append survivors to the apply queue.
 *
 * The first cycle is a cold start -- everything looks new. We record ids without
 * queueing so you do not wake up to 2,000 "new" postings from 2024.
 */
export async function pollOnce({ verbose = false, coldStart = null } = {}) {
  const boards = await loadBoards();
  const state = await readJson(STATE_FILE, { seen: {}, lastPoll: null, cycles: 0 });
  const queue = await readJson(QUEUE_FILE, { items: [] });

  const isCold = coldStart ?? Object.keys(state.seen).length === 0;
  const started = Date.now();
  const fresh = [];
  const errors = [];

  for (const { vendor, board } of boards) {
    const res = await fetchBoard(vendor, board);
    if (!res.ok) {
      errors.push({ vendor, board, error: res.error });
      if (verbose) console.error(`  ! ${vendor}/${board}: ${res.error}`);
      continue;
    }
    for (const p of res.postings) {
      const key = `${p.vendor}:${p.board}:${p.id}`;
      if (state.seen[key]) continue;
      state.seen[key] = started;
      if (!isCold) fresh.push(p);
    }
    await sleep(REQUEST_STAGGER_MS);
  }

  const { eligible, dropped } = partitionByEligibility(fresh);

  for (const p of eligible) {
    queue.items.push({
      ...p,
      queuedAt: Date.now(),
      // Detection latency against the employer's own timestamp. This is the number
      // that tells you whether the speed thesis is actually paying off.
      detectionLagMs: p.publishedAt ? Date.now() - p.publishedAt : null,
      status: 'pending',
    });
  }

  state.lastPoll = started;
  state.cycles = (state.cycles ?? 0) + 1;
  await writeJson(STATE_FILE, state);
  await writeJson(QUEUE_FILE, queue);

  return {
    coldStart: isCold,
    boards: boards.length,
    errors,
    seenTotal: Object.keys(state.seen).length,
    fresh: fresh.length,
    queued: eligible.length,
    dropped,
    elapsedMs: Date.now() - started,
  };
}
