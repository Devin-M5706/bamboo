import fs from 'node:fs/promises';
import { REQUEST_STAGGER_MS, SURVEY_FILE } from './config.js';
import { loadBoards } from './poll.js';
import { fetchBoard } from './sources.js';
import { aggregateQuestions, fetchJobDetail } from './questions.js';
import { checkEligibility } from './eligibility.js';

const sleep = (n) => new Promise((r) => setTimeout(r, n));
// config.js owns every path, so the CLI can print where this landed without guessing.
const OUT = SURVEY_FILE;

/**
 * Sample real internship postings and record which free-text prompts actually appear.
 *
 * This is what turns "write ~20 answers" from a guess into a work list. Greenhouse only,
 * because it is the one vendor whose public API exposes the application form.
 */
export async function survey({ limit = 40, verbose = false } = {}) {
  const boards = (await loadBoards()).filter((b) => b.vendor === 'greenhouse');
  const sampled = [];
  const freeTextPerJob = [];
  const selectPerJob = [];
  const eligibilityFlips = [];

  for (const { board } of boards) {
    if (sampled.length >= limit) break;

    const res = await fetchBoard('greenhouse', board);
    if (!res.ok) continue;

    const interns = res.postings.filter((p) => checkEligibility({ title: p.title }).eligible);
    if (!interns.length) continue;

    const pick = interns[0];
    const detail = await fetchJobDetail(board, pick.id);
    await sleep(REQUEST_STAGGER_MS);
    if (!detail.ok) continue;

    // The list endpoint has no description. Now that we have one, does eligibility
    // change its mind? This measures how much the description gap was costing us.
    const before = checkEligibility({ title: pick.title, description: '' });
    const after = checkEligibility({ title: pick.title, description: detail.description });
    if (before.eligible !== after.eligible) {
      eligibilityFlips.push({ board, title: pick.title, reason: after.reason });
    }

    sampled.push({
      board,
      title: detail.title,
      url: pick.url,
      freeText: detail.questions.freeText.length,
      required: detail.questions.freeText.filter((q) => q.required).length,
    });
    freeTextPerJob.push(detail.questions.freeText);
    selectPerJob.push(detail.questions.other);
    if (verbose) console.log(`  ${board}: ${detail.questions.freeText.length} free-text`);
  }

  const aggregated = aggregateQuestions(freeTextPerJob);
  const aggregatedSelects = aggregateQuestions(selectPerJob);
  // Keep one sample option set per distinct question, so the resolver can be written
  // against the real choices instead of imagined ones.
  const optionSamples = {};
  for (const list of selectPerJob) {
    for (const q of list) {
      const k = q.label
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!optionSamples[k] && q.options?.length) {
        optionSamples[k] = q.options.slice(0, 12).map((o) => o.label);
      }
    }
  }
  const out = {
    surveyedAt: new Date().toISOString(),
    jobsSampled: sampled.length,
    boardsWithInternships: sampled.length,
    eligibilityFlips,
    prompts: aggregated,
    selects: aggregatedSelects,
    selectOptions: optionSamples,
    jobs: sampled,
  };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
  return out;
}
