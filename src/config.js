import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the code lives. Read-only at runtime: templates and bundled data only. */
export const ROOT = path.resolve(here, '..');
export const PKG_DATA_DIR = path.join(ROOT, 'data');
export const LEDGER_EXAMPLE = path.join(PKG_DATA_DIR, 'ledger.example.json');
export const ANSWERS_EXAMPLE = path.join(PKG_DATA_DIR, 'answers.example.json');

/**
 * Where YOUR data lives: ~/.bamboo, overridable with BAMBOO_HOME.
 *
 * This must never be inside the package. Installed globally, the package directory is
 * under node_modules and gets wiped on every reinstall or update -- a ledger stored
 * there would disappear silently the first time you upgraded. The ledger is the one
 * artifact that cannot be regenerated, so it lives in your home directory and survives
 * the code being reinstalled, moved, or deleted.
 */
export const DATA_DIR =
  process.env.BAMBOO_HOME || path.join(os.homedir(), '.bamboo');

export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const BOARDS_FILE = path.join(DATA_DIR, 'boards.json');
export const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');
export const ANSWERS_FILE = path.join(DATA_DIR, 'answers.json');
export const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const SURVEY_FILE = path.join(DATA_DIR, 'questions-survey.json');

// Application tracker. APPLICATIONS_FILE is the durable record and the source of
// truth; the spreadsheet is a projection of it and can be rebuilt at any time.
export const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');
export const APPLICATIONS_CSV = path.join(DATA_DIR, 'applications.csv');
// OAuth refresh token for the tracked mailbox. Secret: never logged, never committed.
export const GOOGLE_TOKEN_FILE = path.join(DATA_DIR, 'google-token.json');

// Source of board tokens. We mine this once for company identity, then poll the
// vendor APIs directly -- the repo itself lags by days and has no true posting time.
export const LISTINGS_URL =
  'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json';

// Live submission is opt-in and gated on a populated ledger. See README "Going live".
export const DRY_RUN_DEFAULT = true;

// Vendor payloads are 2-6 MB per board; 67 boards per cycle is a lot of bandwidth.
// Stagger requests and keep the interval honest rather than hammering.
export const POLL_INTERVAL_MS = 5 * 60 * 1000;
export const REQUEST_STAGGER_MS = 250;
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Application tracker.
 *
 * The trigger is the confirmation email, not the applier. You apply to most jobs by
 * hand, and an employer's "we received your application" receipt is the only signal
 * that exists for every application regardless of how it was submitted. Watching the
 * inbox therefore tracks everything; watching the extension would track a fraction.
 *
 * dryRun is the default here for the same reason it is in the applier: the first run
 * of anything that writes to an external service should show you what it would do.
 */
export const TRACKER = {
  // The address you apply with. Receipts sent anywhere else are not yours to track.
  //
  // This is read from the environment rather than written here. A mailbox address is
  // personal data and this package is published: hardcoding one leaks the maintainer's
  // inbox to every reader and makes the setting wrong for everybody else. Unset means
  // `connect` and `track` refuse with an instruction, which is the same trade this
  // codebase makes everywhere else -- refuse rather than guess.
  trackedEmail: process.env.BAMBOO_TRACKED_EMAIL || null,
  // Print the planned spreadsheet writes; change nothing. Flip with `--live`.
  dryRun: true,
  // Never read mail older than this on a cold start; a first sync should not walk years.
  lookbackDays: 90,
  // Gmail messages fetched per sync. Bounds a cold start's cost.
  maxMessagesPerSync: 200,
  agent: {
    // The agent only sees mail the deterministic detector could not classify.
    // Absent an API key it never runs, and unclassifiable mail is skipped, not guessed.
    enabled: true,
    model: 'claude-opus-5',
    // Classification, not reasoning. Low effort is the right cost/latency point.
    effort: 'low',
    // Below this, the row is written but flagged needs-review rather than trusted.
    minConfidence: 'medium',
  },
  sheets: {
    // Set to an existing spreadsheet id to write there; null creates one on first live run.
    spreadsheetId: null,
    sheetName: 'Applications',
  },
};

// Applied to every posting before it reaches the applier. See src/eligibility.js.
export const ELIGIBILITY = {
  // Set to true if you are a US citizen; lets citizenship-required roles through.
  usCitizen: false,
  // Set to true if you need visa sponsorship now or in the future.
  needsSponsorship: false,
  // Postings whose title matches none of these are dropped. Empty = allow all.
  titleAllow: [/intern/i, /co-?op/i, /new ?grad/i],
  // Postings whose title matches any of these are always dropped.
  titleDeny: [/manager/i, /senior/i, /staff/i, /principal/i, /director/i],
};
