/**
 * Trace-or-refuse validation. THIS FILE MUST HAVE NO IMPORTS.
 *
 * scripts/build-extension.js copies it verbatim (minus `export` keywords) into the
 * Chrome extension, so the CLI and the extension always share one validator. If they
 * drifted apart, only one of them would refuse -- which is the same as neither.
 *
 * Every specific claim in an answer must appear in the ledger facts that the answer
 * declares it derives from. Untraceable claims cause a REFUSAL. Refusals are never
 * softened, hedged, or rewritten; they queue for a human.
 *
 * Deliberately a dumb string-level check with no model in the loop. A model deciding
 * whether a model hallucinated is not a safeguard.
 */

// Inlined from ledger.js so this file stays import-free.
const indexFacts = (facts) => new Map(facts.map((f) => [f.id, f]));
const factCorpus = (fact) => [fact.text].concat(fact.tags || []).join(' \n ');

// Capitalized words that carry no factual weight, so they never need tracing.
const STOPWORDS = new Set(
  `a an and the i i'm i've my me we our you your it its this that these those of in on at to for
   from with by as is are was were be been being have has had do does did will would can could
   should may might must not no nor but or if then than so such own same very just also about
   into over under again further once here there when where why how all any both each few more
   most other some only than too s t don now d ll m o re ve y
   monday tuesday wednesday thursday friday saturday sunday
   january february march april may june july august september october november december`
    .split(/\s+/)
    .filter(Boolean),
);

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Collapse thousands separators so "1,200" and "1200" compare equal.
    .replace(/(?<=\d)[,_](?=\d)/g, '')
    .replace(/[^\p{L}\p{N}%.+#'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Pull the claims worth checking out of an answer.
 * Two kinds carry real risk of fabrication:
 *   numeric   "40%", "3 years", "1,200 users", "2x"
 *   entity    capitalized or symbol-bearing tokens: React, PostgreSQL, C++, Node.js, MIT
 */
export function extractClaims(text) {
  const claims = [];
  const src = String(text == null ? '' : text);

  for (const m of src.matchAll(/\b\d[\d,._]*\s?(?:%|percent|x\b|k\b|m\b|\+)?/gi)) {
    const raw = m[0].trim();
    if (raw) claims.push({ kind: 'numeric', raw });
  }

  // Token-level entity scan. Skip the first word of each sentence, where capitalization
  // is grammatical rather than meaningful.
  for (const sentence of src.split(/(?<=[.!?])\s+/)) {
    const tokens = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}.+#'-]*/gu) || [];
    tokens.forEach((tok, i) => {
      const bare = tok.replace(/[.'-]+$/, '');
      if (!bare || bare.length < 2) return;
      if (STOPWORDS.has(bare.toLowerCase())) return;
      const capitalized = /^[\p{Lu}]/u.test(bare);
      const symbolic = /[+#.]/.test(bare) && /[\p{L}]/u.test(bare);
      if (i === 0 && !symbolic) return;
      if (!capitalized && !symbolic) return;
      claims.push({ kind: 'entity', raw: bare });
    });
  }

  // De-dupe on normalized form, keep the first spelling seen.
  const out = [];
  const seen = new Set();
  for (const c of claims) {
    const key = c.kind + ':' + normalize(c.raw);
    if (!normalize(c.raw)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function supported(claim, corpus) {
  const n = normalize(claim.raw);
  if (!n) return true;
  if (corpus.includes(n)) return true;
  // "40 %" vs "40%", "3 years" vs "3yr" -- compare digits only for numerics.
  if (claim.kind === 'numeric') {
    const digits = n.replace(/[^\d]/g, '');
    if (digits && corpus.replace(/[^\d]/g, ' ').split(/\s+/).includes(digits)) return true;
  }
  return false;
}

/**
 * @returns {{ok: boolean, refused: boolean, reason?: string, unsupported: string[], traced: number}}
 */
export function validateAnswer(answer, facts) {
  const index = indexFacts(facts);
  const refs = answer && Array.isArray(answer.derived_from) ? answer.derived_from : [];

  if (!answer || !answer.text || !String(answer.text).trim()) {
    return { ok: false, refused: true, reason: 'empty answer text', unsupported: [], traced: 0 };
  }
  if (refs.length === 0) {
    return {
      ok: false,
      refused: true,
      reason: 'answer declares no derived_from facts',
      unsupported: [],
      traced: 0,
    };
  }

  const missingRefs = refs.filter((id) => !index.has(id));
  if (missingRefs.length) {
    return {
      ok: false,
      refused: true,
      reason: 'derived_from references unknown fact(s): ' + missingRefs.join(', '),
      unsupported: [],
      traced: 0,
    };
  }

  const corpus = normalize(refs.map((id) => factCorpus(index.get(id))).join(' \n '));
  const claims = extractClaims(answer.text);
  const unsupported = claims.filter((c) => !supported(c, corpus)).map((c) => c.raw);

  if (unsupported.length) {
    return {
      ok: false,
      refused: true,
      reason: 'answer contains claims not traceable to the ledger',
      unsupported,
      traced: claims.length - unsupported.length,
    };
  }
  return { ok: true, refused: false, unsupported: [], traced: claims.length };
}

/** Validate a whole answer bank against the ledger. Used by `jobapplr check`. */
export function validateBank(answers, facts) {
  const results = [];
  for (const key of Object.keys(answers || {})) {
    results.push(Object.assign({ key }, validateAnswer(answers[key], facts)));
  }
  return {
    ok: results.every((r) => r.ok),
    total: results.length,
    refused: results.filter((r) => r.refused).length,
    results,
  };
}
