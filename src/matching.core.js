/**
 * Answer-bank retrieval. THIS FILE MUST HAVE NO IMPORTS.
 *
 * Third member of the shared-core family, alongside validator.core.js and selects.js.
 * scripts/build-extension.js copies it verbatim into the extension so the CLI and the
 * browser cannot disagree about WHICH answer belongs in a given form field.
 *
 * That disagreement was possible before this file existed: `bamboo check` validated the
 * answer bank with one hand-written implementation while the extension filled forms with
 * another. Both picked the longest match, but nothing enforced it and nothing would have
 * reported a drift. Check would say ready; the extension would submit a different answer.
 */

/**
 * Find the bank entry whose match patterns fit a form question.
 *
 * Returns null rather than guessing. An unmatched question is a refusal, and refusals
 * are the point -- filling a field with the closest-looking answer is exactly the
 * behaviour this project exists to avoid.
 *
 * Longest match wins: "why do you want to work at" beats a bare "why", so a specific
 * pattern always outranks a generic one regardless of declaration order.
 */
export function matchQuestion(question, answers) {
  const q = String(question == null ? '' : question).trim();
  if (!q) return null;

  let best = null;
  for (const key of Object.keys(answers || {})) {
    const entry = answers[key];
    for (const pattern of entry.match || []) {
      let re;
      try {
        re = new RegExp(pattern, 'i');
      } catch {
        // A malformed pattern in the bank must not take down the whole match pass.
        continue;
      }
      const m = q.match(re);
      if (!m) continue;
      const score = m[0].length;
      if (!best || score > best.score) best = { key, entry, score };
    }
  }
  return best ? Object.assign({ key: best.key }, best.entry) : null;
}
