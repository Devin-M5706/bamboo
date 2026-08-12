import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const BOARDS_FILE = path.join(DATA_DIR, 'boards.json');
export const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');
export const ANSWERS_FILE = path.join(DATA_DIR, 'answers.json');
export const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

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
