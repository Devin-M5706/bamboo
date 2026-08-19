import { BOARDS_FILE, QUEUE_FILE, REQUEST_STAGGER_MS, STATE_FILE } from './config.js';
import { readJson, writeJson } from './store.js';
import { fetchBoard } from './sources.js';
import { checkEligibility, partitionByEligibility } from './eligibility.js';
import { fetchJobDetail } from './questions.js';

const sleep = (n) => new Promise((r) => setTimeout(r, n));

/**
 * Read a state file, treating "missing" and "corrupt" as the different events they are.
 *
 * This module used to carry its own readJson that caught everything and returned a
 * fallback. That is the exact failure store.js exists to prevent: a state.json with a
 * truncated tail silently became `{seen:{}}`, which reads as a cold start, and the cycle
 * then wrote that empty object back over the real one. Every posting you had already seen
 * was forgotten in a way nothing reported.
 *
 * Missing is fine and means first run. Corrupt propagates as CorruptFileError, which
 * aborts the cycle with the file untouched.
 */
async function readState(file, whenMissing) {
  const { exists, value } = await readJson(file);
  return exists ? value : whenMissing;
}

export async function loadBoards(file = BOARDS_FILE) {
  // readJsonOr is wrong here too: a corrupt boards.json should say so, not be reported as
  // "no boards found. Run: npm run mine", which sends you off to re-mine 65 boards over a
  // trailing comma.
  const { exists, value } = await readJson(file);
  if (!exists || !value?.boards?.length) {
    throw new Error(`no boards found in ${file}. Run: npm run mine`);
  }
  return value.boards;
}

/**
 * Fetch descriptions for Greenhouse postings that survived the title filter.
 *
 * Lever and Ashby already return descriptionPlain in their list endpoints, so only
 * Greenhouse needs the extra round trip. A failed enrichment leaves the posting
 * un-enriched rather than dropping it -- but see the note in the queue: an
 * un-enriched Greenhouse posting has NOT been checked for citizenship gates.
 */
export async function enrichGreenhouse(
  postings,
  { verbose = false, fetchDetail = fetchJobDetail, sleepImpl = sleep } = {},
) {
  const out = [];
  for (const p of postings) {
    if (p.vendor !== 'greenhouse' || p.description) {
      out.push(p);
      continue;
    }
    if (!checkEligibility({ title: p.title, description: '' }).eligible) {
      out.push(p); // already failing on title; no point spending a request
      continue;
    }
    const detail = await fetchDetail(p.board, p.id);
    await sleepImpl(REQUEST_STAGGER_MS);
    if (detail.ok) {
      out.push({
        ...p,
        description: detail.description,
        deadline: p.deadline ?? detail.deadline,
        questions: detail.questions,
        enriched: true,
      });
    } else {
      if (verbose) console.error(`  ! detail ${p.board}/${p.id}: ${detail.error}`);
      out.push({ ...p, enriched: false });
    }
  }
  return out;
}

/**
 * One poll cycle: fetch every board, diff against seen ids, filter for eligibility,
 * append survivors to the apply queue.
 *
 * The first cycle is a cold start -- everything looks new. We record ids without
 * queueing so you do not wake up to 2,000 "new" postings from 2024.
 */
export async function pollOnce({
  verbose = false,
  coldStart = null,
  boardsFile = BOARDS_FILE,
  stateFile = STATE_FILE,
  queueFile = QUEUE_FILE,
  fetchBoardImpl = fetchBoard,
  fetchDetail = fetchJobDetail,
  sleepImpl = sleep,
} = {}) {
  const boards = await loadBoards(boardsFile);
  // Corrupt propagates. Losing `seen` means re-queueing thousands of old postings, and
  // losing `queue` means losing work that has not been applied to yet -- neither is a
  // thing to paper over with an empty object.
  const state = await readState(stateFile, { seen: {}, lastPoll: null, cycles: 0 });
  const queue = await readState(queueFile, { items: [] });

  const isCold = coldStart ?? Object.keys(state.seen).length === 0;
  const started = Date.now();
  const fresh = [];
  const errors = [];

  for (const { vendor, board } of boards) {
    const res = await fetchBoardImpl(vendor, board);
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
    await sleepImpl(REQUEST_STAGGER_MS);
  }

  // Greenhouse's board LIST endpoint returns no description, so citizenship and
  // sponsorship gates are invisible at this point. Measured on a 32-posting survey,
  // 12.5% of title-eligible Greenhouse postings flip to ineligible once the
  // description is fetched. So enrich before deciding -- but only for postings that
  // already passed the cheap title filter, to keep this to a handful of requests.
  const enriched = await enrichGreenhouse(fresh, { verbose, fetchDetail, sleepImpl });

  const { eligible, dropped } = partitionByEligibility(enriched);

  for (const p of eligible) {
    queue.items.push({
      ...p,
      queuedAt: Date.now(),
      // Detection latency against the employer's own timestamp. This is the number
      // that tells you whether the speed thesis is actually paying off.
      detectionLagMs: p.publishedAt ? Date.now() - p.publishedAt : null,
      // false means we could not read the description, so eligibility was decided on
      // the title alone. Treat these as unverified before applying.
      eligibilityVerified: p.vendor !== 'greenhouse' || p.enriched === true,
      status: 'pending',
    });
  }

  state.lastPoll = started;
  state.cycles = (state.cycles ?? 0) + 1;
  // Atomic: temp file, fsync, rename. Ctrl-C during `watch` used to truncate state.json.
  await writeJson(stateFile, state);
  await writeJson(queueFile, queue);

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
