/**
 * The durable record of every application, and the rules that keep it honest.
 *
 * This file is the tracker's source of truth; the CSV and the spreadsheet are
 * projections of it and can be deleted and rebuilt. Three properties matter more than
 * anything else here, and each one exists because of a specific way this could go wrong:
 *
 *  1. REPLAY IS FREE. Gmail is fetched with a watermark, but a watermark can be reset, a
 *     sync can be re-run, and the same receipt can arrive twice in a thread. Applying the
 *     same messages again must produce the same file, not a second row for every job.
 *
 *  2. STATUS ONLY MOVES FORWARD. A rejection email frequently opens by thanking you for
 *     applying, and threads are not delivered in order. A later message must never be
 *     able to reopen an application you already know is closed.
 *
 *  3. CONFIDENCE ONLY BUYS UP. A low-confidence guess never overwrites a value we already
 *     pinned down. Same rule as validator.core.js: the weaker claim loses.
 *
 * Nothing here invents a value. A field the email did not supply stays null and the row
 * carries a reason saying so.
 */

import { APPLICATIONS_FILE, TRACKER } from '../config.js';
import { CorruptFileError, readJson, writeJson } from '../store.js';

export const VERSION = 1;

/** The live path, in order. An application walks left to right or stands still. */
export const STATUS_ORDER = ['applied', 'screen', 'interview', 'offer'];

/** Reachable from any live state; nothing leaves them. */
export const TERMINAL_STATUSES = ['rejected', 'withdrawn'];

export const STATUSES = [...STATUS_ORDER, ...TERMINAL_STATUSES];

/**
 * Reasons this module generates itself. They are recomputed on every merge, so a gap a
 * later email fills stops being flagged -- unlike reasons an extractor supplied, which
 * are kept: a grounding failure is a fact about what we saw, not a gap to be closed.
 */
export const REVIEW_REASONS = {
  company: 'company not found in email',
  role: 'role not found in email',
  appliedAt: 'application date missing from email',
  lowConfidence: 'confidence below the trust threshold',
};

const STRUCTURAL = new Set(Object.values(REVIEW_REASONS));

const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 };
const rank = (c) => CONFIDENCE_RANK[c] ?? 0;

/** Fields a later email may fill in or, with more confidence, correct. */
const MERGEABLE = ['company', 'role', 'location', 'source', 'jobUrl'];

/**
 * Legal suffixes are dropped so `Stripe, Inc.` and `stripe` are one company rather than
 * two rows for the same job. Kept deliberately short: every entry here is a word that
 * could also be a real company name, and merging two different employers is worse than
 * splitting one.
 */
const LEGAL_SUFFIXES = new Set(['inc', 'llc', 'ltd', 'corp', 'co']);

const tokenize = (value) =>
  String(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Company name reduced to its identity: lowercase, legal suffix dropped, punctuation and
 * spacing collapsed.
 * @param {string|null|undefined} value
 * @returns {string} '' when there is nothing to normalize
 */
export function normalizeCompany(value) {
  if (value == null) return '';
  const tokens = tokenize(value);
  // Never strip the only token: a company literally named "Co" still needs an identity.
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join('');
}

/**
 * Role title reduced the same way, minus the suffix rule -- "Co-op Intern" is not a
 * limited company.
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function normalizeRole(value) {
  return value == null ? '' : tokenize(value).join('');
}

/**
 * The stable record id: `${normalizedCompany}::${normalizedRole}`.
 *
 * Where either half is unknown there is nothing stable to key on, so the message id is
 * used instead. That gives an unidentified application its own row rather than letting
 * every unidentified application in the mailbox collide into one.
 *
 * @param {string|null} company
 * @param {string|null} role
 * @param {string} [messageId] Gmail message id, the fallback key
 * @returns {string}
 */
export function recordKey(company, role, messageId) {
  const c = normalizeCompany(company);
  const r = normalizeRole(role);
  if (!c || !r) return `msg::${messageId ?? 'unknown'}`;
  return `${c}::${r}`;
}

/**
 * May a record at `from` move to `to`? Forward-only along STATUS_ORDER; rejected and
 * withdrawn are reachable from any live state and are terminal.
 *
 * Standing still is not an advance, which is what makes replaying the same receipt a
 * no-op instead of a duplicate statusHistory entry.
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canAdvance(from, to) {
  if (!STATUSES.includes(from) || !STATUSES.includes(to)) return false;
  if (TERMINAL_STATUSES.includes(from)) return false;
  if (TERMINAL_STATUSES.includes(to)) return true;
  return STATUS_ORDER.indexOf(to) > STATUS_ORDER.indexOf(from);
}

/** Gmail's internalDate (ms epoch, as a string) as an ISO timestamp, or null. */
function mailDate(mail) {
  const raw = mail?.internalDate;
  if (raw == null || !/^\d+$/.test(String(raw))) return null;
  const d = new Date(Number(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const extractedByOf = (extraction) => (extraction?.extractedBy === 'agent' ? 'agent' : 'deterministic');

/**
 * Reasons a human should look at this record. Structural reasons are recomputed from the
 * merged record; anything an extractor reported is carried forward unchanged.
 */
function reviewReasonsFor(record, extraction, extra = []) {
  const carried = (record.reviewReasons ?? []).filter((r) => !STRUCTURAL.has(r));
  const reasons = [...carried, ...(extraction?.reviewReasons ?? []), ...extra];
  if (!record.company) reasons.push(REVIEW_REASONS.company);
  if (!record.role) reasons.push(REVIEW_REASONS.role);
  if (!record.appliedAt) reasons.push(REVIEW_REASONS.appliedAt);
  if (rank(record.confidence) < rank(TRACKER.agent.minConfidence)) {
    reasons.push(REVIEW_REASONS.lowConfidence);
  }
  return [...new Set(reasons)];
}

/**
 * A status we do not recognise is recorded as `applied` -- the receipt did arrive -- and
 * flagged, never silently mapped to something more interesting.
 */
function statusOf(extraction, extra) {
  if (STATUSES.includes(extraction?.status)) return extraction.status;
  extra.push(`status ${JSON.stringify(extraction?.status ?? null)} not recognised`);
  return 'applied';
}

/**
 * A new record from the first email that identified this application.
 *
 * @param {object} extraction Extraction from detect.js or agent.js
 * @param {object} mail MailMessage that produced it
 * @param {{now?: string}} [opts]
 * @returns {object} ApplicationRecord
 */
export function createRecord(extraction, mail, { now = new Date().toISOString() } = {}) {
  const extra = [];
  const appliedAt = mailDate(mail);
  const status = statusOf(extraction, extra);
  const at = appliedAt ?? now;

  const record = {
    id: recordKey(extraction.company, extraction.role, mail?.id),
    messageId: mail?.id ?? null,
    threadId: mail?.threadId ?? null,
    company: extraction.company ?? null,
    role: extraction.role ?? null,
    location: extraction.location ?? null,
    source: extraction.source ?? null,
    jobUrl: extraction.jobUrl ?? null,
    appliedAt,
    status,
    statusHistory: [{ status, at, messageId: mail?.id ?? null }],
    confidence: CONFIDENCE_RANK[extraction.confidence] ? extraction.confidence : 'low',
    needsReview: false,
    reviewReasons: [],
    extractedBy: extractedByOf(extraction),
    updatedAt: now,
  };

  record.reviewReasons = reviewReasonsFor(record, extraction, extra);
  record.needsReview = record.reviewReasons.length > 0;
  return record;
}

/**
 * Fold a later email into an existing record.
 *
 * Fills nulls, advances status forward only, appends to statusHistory, refreshes
 * updatedAt. A non-null value is replaced only by one from a strictly more confident
 * extraction -- a low-confidence guess never overwrites something we already pinned down,
 * and equal confidence leaves the earlier reading alone rather than churning between two
 * equally good answers.
 *
 * `existing` may be null, in which case this creates the record.
 *
 * @param {object|null} existing ApplicationRecord
 * @param {object} extraction Extraction
 * @param {object} mail MailMessage
 * @param {{now?: string}} [opts]
 * @returns {object} the updated ApplicationRecord (a new object; `existing` is untouched)
 */
export function mergeExtraction(existing, extraction, mail, { now = new Date().toISOString() } = {}) {
  if (!existing) return createRecord(extraction, mail, { now });

  const extra = [];
  const incomingStatus = statusOf(extraction, extra);
  const record = {
    ...existing,
    statusHistory: [...(existing.statusHistory ?? [])],
    reviewReasons: [...(existing.reviewReasons ?? [])],
  };
  let touched = false;

  for (const field of MERGEABLE) {
    const incoming = extraction?.[field] ?? null;
    if (incoming === null) continue;
    const current = record[field] ?? null;
    if (current === incoming) continue;
    if (current !== null && rank(extraction.confidence) <= rank(record.confidence)) continue;
    record[field] = incoming;
    touched = true;
  }

  const at = mailDate(mail) ?? now;
  if (canAdvance(record.status, incomingStatus)) {
    record.status = incomingStatus;
    record.statusHistory.push({ status: incomingStatus, at, messageId: mail?.id ?? null });
    touched = true;
  }

  // The earliest receipt is the one that says when you applied; mail does not arrive in
  // order, so a later-processed message with an earlier date wins.
  const date = mailDate(mail);
  if (date && (!record.appliedAt || date < record.appliedAt)) {
    record.appliedAt = date;
    touched = true;
  }

  // Confidence describes the values we are holding, and those only ever get replaced by
  // more confident ones -- so it rises and never falls.
  if (rank(extraction?.confidence) > rank(record.confidence)) {
    record.confidence = extraction.confidence;
    touched = true;
  }

  const reasons = reviewReasonsFor(record, extraction, extra);
  if (reasons.length !== record.reviewReasons.length ||
      reasons.some((r, i) => r !== record.reviewReasons[i])) {
    touched = true;
  }
  record.reviewReasons = reasons;
  record.needsReview = reasons.length > 0;

  if (touched) {
    record.extractedBy = extractedByOf(extraction);
    record.updatedAt = now;
  }
  return record;
}

/** The shape of a tracker file nobody has written yet. */
export function emptyState() {
  return { version: VERSION, lastSyncedAt: null, lastInternalDate: null, records: [] };
}

/**
 * Advance the Gmail watermark. Kept as a decimal string, never a Number: it is what Gmail
 * returns and what the next query sends back, and a round trip through a float is a
 * silent way to re-read or skip a day of mail.
 */
function advanceWatermark(state, mail) {
  const raw = mail?.internalDate;
  if (raw == null || !/^\d+$/.test(String(raw))) return;
  const next = String(raw);
  const current = state.lastInternalDate;
  if (current == null || !/^\d+$/.test(String(current)) || BigInt(next) > BigInt(String(current))) {
    state.lastInternalDate = next;
  }
}

/**
 * Fold a batch of `{mail, extraction}` into the state.
 *
 * Idempotent: applying the same messages again matches them onto the records they already
 * created, changes nothing, and counts them as skipped. That is the property that keeps a
 * re-run or a reset watermark from filling the spreadsheet with duplicates.
 *
 * @param {object} state loaded tracker state
 * @param {Array<{mail: object, extraction: object, extractedBy?: string}>} items
 * @param {{now?: string}} [opts]
 * @returns {{state: object, created: number, updated: number, skipped: number}}
 */
export function applyExtractions(state, items, { now = new Date().toISOString() } = {}) {
  const next = { ...emptyState(), ...(state ?? {}), records: [...(state?.records ?? [])] };
  const index = new Map(next.records.map((r, i) => [r.id, i]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items ?? []) {
    const mail = item?.mail;
    // The watermark advances over everything we looked at, matched or not, or every sync
    // re-reads the same unmatchable mail forever.
    advanceWatermark(next, mail);

    const extraction = item?.extractedBy
      ? { ...item.extraction, extractedBy: item.extractedBy }
      : item?.extraction;

    // Not an application receipt. Skipped, never recorded with invented fields.
    if (!extraction?.matched) {
      skipped += 1;
      continue;
    }

    const id = recordKey(extraction.company, extraction.role, mail?.id);
    const at = index.get(id);
    if (at === undefined) {
      const record = createRecord(extraction, mail, { now });
      index.set(id, next.records.length);
      next.records.push(record);
      created += 1;
      continue;
    }

    const before = next.records[at];
    const after = mergeExtraction(before, extraction, mail, { now });
    if (JSON.stringify(after) === JSON.stringify(before)) {
      skipped += 1;
      continue;
    }
    next.records[at] = after;
    updated += 1;
  }

  next.lastSyncedAt = now;
  return { state: next, created, updated, skipped };
}

/**
 * Read the applications file.
 *
 * Missing is fine -- nobody has synced yet. Corrupt is NOT: `readJsonOr` would hand back
 * `{records: []}` and the next save would write that over a file recording real
 * applications, which is precisely the failure store.js exists to prevent. The
 * CorruptFileError propagates so a person decides.
 *
 * @param {{file?: string}} [opts]
 * @returns {Promise<object>} the tracker state
 * @throws {CorruptFileError} when the file exists but is not a readable tracker file
 */
export async function loadApplications({ file = APPLICATIONS_FILE } = {}) {
  const { exists, value } = await readJson(file);
  if (!exists) return emptyState();

  // Valid JSON of the wrong shape is just as dangerous to write over as invalid JSON.
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.records)) {
    throw new CorruptFileError(file, new Error('expected { version, records: [] }'));
  }
  return { ...emptyState(), ...value };
}

/**
 * Write the applications file atomically, keeping a .bak of the previous contents.
 *
 * This file is irreplaceable for the same reason the ledger is: it is the only record
 * that an application happened at all, and no API can reconstruct it once the receipts
 * age out of the mailbox.
 *
 * @param {object} state
 * @param {{file?: string}} [opts]
 * @returns {Promise<object>} the state as written
 */
export async function saveApplications(state, { file = APPLICATIONS_FILE } = {}) {
  const value = { ...emptyState(), ...(state ?? {}) };
  await writeJson(file, value, { backup: true });
  return value;
}
