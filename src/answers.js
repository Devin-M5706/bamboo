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
 * Retrieval lives in matching.core.js so the extension can share it verbatim.
 * Do not reimplement it here -- two copies is how the CLI and the browser end up
 * disagreeing about which answer belongs in a field.
 */
export { matchQuestion } from './matching.core.js';
