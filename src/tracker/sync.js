/**
 * One tracker sync cycle: inbox -> extraction -> records -> spreadsheet.
 *
 * The trigger is the employer's confirmation email, not the applier. Most applications
 * are submitted by hand, and the receipt in the tracked mailbox is the only signal that
 * exists for all of them. Watching the extension would track a fraction of reality.
 *
 * This path is read-only with respect to job applications. It never fills a form, never
 * writes an answer, and is never imported by the apply path -- see the "apply path must
 * stay model-free" guard in CI. The model here reads mail that has already been sent;
 * it cannot influence what gets submitted.
 */

import { APPLICATIONS_CSV, APPLICATIONS_FILE, TRACKER } from '../config.js';
import { getAccessToken } from '../google/oauth.js';
import { fetchReceipts } from '../google/gmail.js';
import { detect } from './detect.js';
import { classify } from './agent.js';
import { advanceWatermark, applyExtractions, loadApplications, saveApplications } from './applications.js';
import { writeCsv } from './csv.js';
import { upsertRecords } from '../google/sheets.js';

/**
 * Deterministic first, model second.
 *
 * `detect` handles the recurring ATS templates, which is most of the volume, at zero cost
 * and with no chance of invention. The agent only ever sees the residue: mail the
 * patterns could not classify, or classified without pinning down company and role.
 *
 * Status is taken from `detect` whenever it matched, even when the agent supplied the
 * company and role. Status comes from fixed phrasing ("we have decided to move forward
 * with other candidates"), which a pattern reads more reliably than a model, and getting
 * it wrong silently reopens a closed application.
 *
 * `consultedAgent` counts what we spent; `extractedBy` records where the data actually
 * came from. They differ when the agent was asked and its answer was discarded, and
 * conflating them would label a purely pattern-derived row as model-extracted.
 *
 * @param {import('../google/gmail.js').MailMessage} mail
 * @param {{agentEnabled?: boolean, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{extraction: object, consultedAgent: boolean, extractedBy: 'deterministic'|'agent'}>}
 */
export async function extractOne(mail, { agentEnabled = TRACKER.agent.enabled, fetchImpl } = {}) {
  const deterministic = detect(mail);

  const complete = deterministic.matched && deterministic.company && deterministic.role;
  if (complete || !agentEnabled) {
    return { extraction: deterministic, consultedAgent: false, extractedBy: 'deterministic' };
  }

  const fromAgent = await classify(mail, { fetchImpl });
  if (!fromAgent.matched) {
    // The agent could not identify it either. Keep whatever the patterns found; if they
    // found nothing, this message is not an application receipt and is skipped upstream.
    return { extraction: deterministic, consultedAgent: true, extractedBy: 'deterministic' };
  }

  return {
    extraction: {
      ...fromAgent,
      status: deterministic.matched ? deterministic.status : fromAgent.status,
      source: deterministic.source ?? fromAgent.source,
      reviewReasons: [...(deterministic.reviewReasons ?? []), ...(fromAgent.reviewReasons ?? [])],
    },
    consultedAgent: true,
    extractedBy: 'agent',
  };
}

/**
 * Everything `sync` reaches outside itself, in one place.
 *
 * Not architecture for its own sake: without it `sync` is the one module in the tracker
 * that no test can drive, because exercising it means standing up OAuth, Gmail and
 * Sheets. It was the only module here with zero coverage for exactly that reason, while
 * carrying the ordering rules that are silent corruption when wrong -- the status
 * precedence below, and the watermark. `extractOne` already took its collaborators this
 * way; this is the same shape one level up.
 */
const REAL_DEPS = {
  getAccessToken,
  fetchReceipts,
  extractOne,
  loadApplications,
  saveApplications,
  writeCsv,
  upsertRecords,
};

/**
 * Run a full sync.
 *
 * Dry run is the default, matching the applier. The first run of anything that writes to
 * a spreadsheet you own should show you the writes rather than make them.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.verbose]
 * @param {(msg: string) => void} [opts.log]
 * @param {Partial<typeof REAL_DEPS>} [opts.deps] Overrides for tests; real ones by default.
 * @returns {Promise<{scanned:number, matched:number, created:number, updated:number,
 *   skipped:number, usedAgent:number, needsReview:number, sheet:object|null,
 *   csvPath:string, dryRun:boolean}>}
 */
export async function sync({
  dryRun = TRACKER.dryRun,
  verbose = false,
  log = console.log,
  sheets = TRACKER.sheets,
  deps: overrides = {},
} = {}) {
  const deps = { ...REAL_DEPS, ...overrides };
  const say = (msg) => {
    if (verbose) log(msg);
  };

  const state = await deps.loadApplications();

  say(`Reading mail delivered to ${TRACKER.trackedEmail}...`);
  const accessToken = await deps.getAccessToken();
  const mail = await deps.fetchReceipts({
    accessToken,
    trackedEmail: TRACKER.trackedEmail,
    lookbackDays: TRACKER.lookbackDays,
    maxMessages: TRACKER.maxMessagesPerSync,
    sinceInternalDate: state.lastInternalDate,
  });
  say(`  ${mail.length} message(s) since the last sync`);

  const items = [];
  let usedAgent = 0;
  for (const m of mail) {
    const { extraction, consultedAgent, extractedBy } = await deps.extractOne(m);
    if (consultedAgent) usedAgent += 1;
    // An unmatched message is not an application receipt. It is skipped, never recorded
    // as an application with invented fields.
    if (!extraction.matched) continue;
    // Provenance is per record so a reviewer can tell which rows a model touched.
    items.push({ mail: m, extraction, extractedBy });
  }
  say(`  ${items.length} application receipt(s); ${usedAgent} needed the agent`);

  const applied = applyExtractions(state, items);
  const next = applied.state;
  next.lastSyncedAt = new Date().toISOString();

  // applyExtractions advances the watermark too, but it only ever sees matched receipts.
  // The watermark has to clear every message we READ, or the newsletters and recruiter
  // spam that will never match are re-fetched on every sync forever.
  //
  // Fold each message through the same helper applyExtractions uses rather than taking
  // the last element: that shortcut was correct only because fetchReceipts happens to
  // sort oldest-first, so a change over in gmail.js would have silently started skipping
  // mail here. advanceWatermark takes the maximum and ignores undated messages, which
  // holds whatever order they arrive in.
  for (const m of mail) advanceWatermark(next, m);

  // Records are the source of truth and are written first. The spreadsheet is a
  // projection: if a sheet write fails, the next sync still has everything it needs to
  // rebuild it, and nothing has been lost.
  if (!dryRun) await deps.saveApplications(next);

  await deps.writeCsv(next.records, { dryRun });

  let sheet = null;
  if (sheets.spreadsheetId) {
    sheet = await deps.upsertRecords({
      accessToken,
      spreadsheetId: sheets.spreadsheetId,
      sheetName: sheets.sheetName,
      records: next.records,
      dryRun,
    });
  }

  const needsReview = next.records.filter((r) => r.needsReview).length;

  return {
    scanned: mail.length,
    matched: items.length,
    created: applied.created,
    updated: applied.updated,
    skipped: applied.skipped,
    usedAgent,
    needsReview,
    sheet,
    csvPath: APPLICATIONS_CSV,
    recordsPath: APPLICATIONS_FILE,
    dryRun,
  };
}
