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
