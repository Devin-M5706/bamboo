import fs from 'node:fs/promises';
import { ANSWERS_FILE } from './config.js';

/**
 * The answer bank: pre-written, pre-validated responses to the free-text prompts
 * that recur across these forms.
 *
 * The whole latency argument rests on this file. Because these are written and
 * validated days before a posting exists, apply-time is pure retrieval -- no model
 * call, no generation latency, and nothing submitted that you have not read.
 *
 * Entry shape:
 *   match         array of regex source strings tested against the form's question
 *   text          the answer, in your words
 *   derived_from  ledger fact ids this answer's claims trace to
 *   maxLength     optional; retrieval prefers a variant that fits the field
 */

export async function loadAnswers(file = ANSWERS_FILE) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return { ok: true, answers: parsed.answers ?? {} };
  } catch (err) {
    return { ok: false, answers: {}, error: err.message };
  }
}

/**
 * Find the bank entry whose match patterns fit a form question.
 * Returns null rather than guessing -- an unmatched question is a refusal, and
 * refusals are the point.
 */
export function matchQuestion(question, answers) {
  const q = String(question ?? '').trim();
  if (!q) return null;

  let best = null;
  for (const [key, entry] of Object.entries(answers ?? {})) {
    for (const pattern of entry.match ?? []) {
      let re;
      try {
        re = new RegExp(pattern, 'i');
      } catch {
        continue;
      }
      const m = q.match(re);
      if (!m) continue;
      // Longer matches win: "why do you want to work at" beats "why".
      const score = m[0].length;
      if (!best || score > best.score) best = { key, entry, score };
    }
  }
  return best ? { key: best.key, ...best.entry } : null;
}
