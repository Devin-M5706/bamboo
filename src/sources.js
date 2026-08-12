import { REQUEST_TIMEOUT_MS } from './config.js';

/**
 * Vendor adapters for the three public, unauthenticated ATS job-board APIs.
 *
 * Field names here were read off live responses, not guessed:
 *   Greenhouse  jobs[]  { id, title, location.name, absolute_url, first_published, application_deadline }
 *   Lever       []      { id, text, categories.location, hostedUrl, applyUrl, createdAt (ms epoch) }
 *   Ashby       jobs[]  { id, title, location, jobUrl, applyUrl, publishedAt (ISO), isListed }
 *
 * Every adapter normalizes to the same Posting shape so the rest of the pipeline
 * never branches on vendor.
 */

/** @typedef {{
 *   vendor: 'greenhouse'|'lever'|'ashby',
 *   board: string,
 *   id: string,
 *   title: string,
 *   location: string,
 *   url: string,
 *   applyUrl: string,
 *   publishedAt: number|null,
 *   deadline: number|null,
 *   description: string
 * }} Posting
 */

async function getJson(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { accept: 'application/json', 'user-agent': 'jobapplr/0.1 (personal use)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const ms = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

export const VENDORS = {
  greenhouse: {
    url: (board) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs`,
    parse(body, board) {
      const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
      return jobs.map((j) => ({
        vendor: 'greenhouse',
        board,
        id: String(j.id),
        title: j.title ?? '',
        location: j.location?.name ?? '',
        url: j.absolute_url ?? '',
        applyUrl: j.absolute_url ?? '',
        // first_published is the true employer posting time. This is the field the
        // aggregator repo does not have, and the entire reason we poll directly.
        publishedAt: ms(j.first_published) ?? ms(j.updated_at),
        deadline: ms(j.application_deadline),
        description: '',
      }));
    },
  },

  lever: {
    url: (board) => `https://api.lever.co/v0/postings/${board}?mode=json`,
    parse(body, board) {
      const jobs = Array.isArray(body) ? body : [];
      return jobs.map((j) => ({
        vendor: 'lever',
        board,
        id: String(j.id),
        title: j.text ?? '',
        location: j.categories?.location ?? '',
        url: j.hostedUrl ?? '',
        applyUrl: j.applyUrl ?? j.hostedUrl ?? '',
        publishedAt: ms(j.createdAt),
        deadline: null,
        description: j.descriptionPlain ?? '',
      }));
    },
  },

  ashby: {
    url: (board) => `https://api.ashbyhq.com/posting-api/job-board/${board}`,
    parse(body, board) {
      const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
      return jobs
        .filter((j) => j.isListed !== false)
        .map((j) => ({
          vendor: 'ashby',
          board,
          id: String(j.id),
          title: j.title ?? '',
          location: j.location ?? '',
          url: j.jobUrl ?? '',
          applyUrl: j.applyUrl ?? j.jobUrl ?? '',
          publishedAt: ms(j.publishedAt),
          deadline: null,
          description: j.descriptionPlain ?? '',
        }));
    },
  },
};

/**
 * Fetch one board. Never throws -- a single dead board must not stop a poll cycle,
 * because boards get renamed and deleted without warning.
 * @returns {Promise<{ok: boolean, postings: Posting[], error?: string}>}
 */
export async function fetchBoard(vendor, board) {
  const v = VENDORS[vendor];
  if (!v) return { ok: false, postings: [], error: `unknown vendor ${vendor}` };
  try {
    const body = await getJson(v.url(board));
    return { ok: true, postings: v.parse(body, board) };
  } catch (err) {
    return { ok: false, postings: [], error: err.message };
  }
}
