import { REQUEST_TIMEOUT_MS } from './config.js';

/**
 * Greenhouse's job detail endpoint returns the actual application form -- every
 * question, its type, and whether it is required -- plus the full job description.
 *
 *   GET /v1/boards/{board}/jobs/{id}?questions=true
 *
 * Two things fall out of that:
 *   1. `content` gives eligibility something to read. The board LIST endpoint has no
 *      description, so citizenship and sponsorship gates were invisible without this.
 *   2. `questions` tells you which free-text prompts actually recur across real
 *      internship forms, so the answer bank is built from evidence instead of a guess.
 */

/** Labels that map to profile fields, not to answer-bank entries. */
const PROFILE_LABELS =
  /^(preferred )?(first|last|full)? ?name$|^email|^phone|^resume|^cover letter|^portfolio|^linkedin|^github|^website|^address|^city|^state|^zip|^country|^pronouns|^how did you hear|^please specify$|^gpa\b|^school$|^degree$|^discipline$|^start date|^graduation/i;

const FREE_TEXT_TYPES = new Set(['textarea', 'input_text']);

const decodeEntities = (s) =>
  String(s ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

export const stripHtml = (html) =>
  decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

export async function fetchJobDetail(board, jobId) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}?questions=true`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { accept: 'application/json', 'user-agent': 'jobapplr/0.1 (personal use)' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    return {
      ok: true,
      title: body.title ?? '',
      description: stripHtml(body.content),
      deadline: body.application_deadline ? Date.parse(body.application_deadline) : null,
      questions: classifyQuestions(body.questions ?? []),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Split a form's questions into the ones the profile answers and the ones that need
 * a written, validated answer.
 */
export function classifyQuestions(questions) {
  const profile = [];
  const freeText = [];
  const other = [];

  for (const q of questions) {
    const label = String(q?.label ?? '').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const field = q?.fields?.[0] ?? {};
    const type = field.type ?? '';
    const entry = { label, required: Boolean(q?.required), type };
    // Selects carry their option set; the resolver needs it to map a fact to a choice.
    if (/select/.test(type)) {
      entry.options = (field.values ?? []).map((v) => ({
        label: String(v.label ?? '').trim(),
        value: v.value,
      }));
      entry.name = field.name;
    }

    if (/select/.test(type)) other.push(entry);
    else if (PROFILE_LABELS.test(label)) profile.push(entry);
    else if (FREE_TEXT_TYPES.has(type)) freeText.push(entry);
    else profile.push(entry);
  }
  return { profile, freeText, other };
}

/**
 * Aggregate free-text prompts across many postings so you can see which ones are
 * worth writing an answer for. Normalizes trivial wording differences.
 */
export function aggregateQuestions(perJobFreeText) {
  const counts = new Map();
  for (const list of perJobFreeText) {
    // Count each distinct label once per job.
    const seen = new Set();
    for (const q of list) {
      const key = q.label.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const rec = counts.get(key) ?? { label: q.label, jobs: 0, required: 0 };
      rec.jobs += 1;
      if (q.required) rec.required += 1;
      counts.set(key, rec);
    }
  }
  return [...counts.values()].sort((a, b) => b.jobs - a.jobs || a.label.localeCompare(b.label));
}
