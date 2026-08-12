import fs from 'node:fs/promises';
import { BOARDS_FILE, LISTINGS_URL } from './config.js';

/**
 * The aggregator repo is a company directory, not a job feed.
 *
 * It lags by days (five-day gaps observed) and its date_posted is ingestion time,
 * not employer posting time. So we mine it exactly once for the set of board tokens,
 * then poll those vendors directly for the rest of time.
 */

const PATTERNS = [
  // job-boards.greenhouse.io/token/jobs/123 and boards.greenhouse.io/token/jobs/123
  [/(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)/i, 'greenhouse'],
  [/jobs\.lever\.co\/([^/?#]+)/i, 'lever'],
  [/jobs\.ashbyhq\.com\/([^/?#]+)/i, 'ashby'],
];

/** Extract {vendor, board} pairs from aggregator listing records. */
export function extractBoards(listings) {
  const seen = new Map();
  for (const item of listings) {
    const url = item?.url;
    if (typeof url !== 'string') continue;
    for (const [re, vendor] of PATTERNS) {
      const m = url.match(re);
      if (!m) continue;
      const board = decodeURIComponent(m[1]).trim();
      // "embed" and "jobs" are path artifacts, not company tokens.
      if (!board || board === 'embed' || board === 'jobs') continue;
      const key = `${vendor}:${board}`;
      if (!seen.has(key)) {
        seen.set(key, { vendor, board, company: item.company_name ?? '', listings: 0 });
      }
      seen.get(key).listings += 1;
    }
  }
  return [...seen.values()].sort(
    (a, b) => b.listings - a.listings || a.board.localeCompare(b.board),
  );
}

export async function mine({ url = LISTINGS_URL, out = BOARDS_FILE } = {}) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`could not fetch listings: HTTP ${res.status}`);
  const listings = await res.json();
  const boards = extractBoards(listings);

  // Preserve any boards added by hand; the aggregator is a starting point, not a cage.
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(out, 'utf8')).boards ?? [];
  } catch {
    // first run
  }
  const merged = [...boards];
  for (const e of existing) {
    if (!merged.some((b) => b.vendor === e.vendor && b.board === e.board)) merged.push(e);
  }

  await fs.mkdir(new URL('.', `file://${out.replace(/\\/g, '/')}`), { recursive: true }).catch(
    () => {},
  );
  await fs.writeFile(
    out,
    JSON.stringify(
      { minedAt: new Date().toISOString(), source: url, count: merged.length, boards: merged },
      null,
      2,
    ) + '\n',
  );

  const byVendor = merged.reduce((acc, b) => ({ ...acc, [b.vendor]: (acc[b.vendor] ?? 0) + 1 }), {});
  return { total: merged.length, byVendor, listings: listings.length, boards: merged };
}
