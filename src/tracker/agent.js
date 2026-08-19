/**
 * The extraction agent: Claude, over raw `fetch`, for the receipts tracker/detect.js
 * could not classify.
 *
 * We call https://api.anthropic.com/v1/messages directly instead of using
 * `@anthropic-ai/sdk` because this repo has a CI-enforced zero-dependency rule --
 * `package.json` gaining a dependency fails the PR. That is the reason; it is not an
 * oversight, so please do not "fix" it by adding the SDK.
 *
 * This file is a read-only path. Nothing here may be imported by the apply path
 * (poll.js, answers.js, selects.js, validator.core.js, matching.core.js, or the
 * extension); CI greps for it. An answer written by a model is exactly what this tool
 * exists not to submit.
 *
 * THE GROUNDING CHECK IS THE POINT OF THIS FILE. Everything the model returns passes
 * through groundExtraction before it is believed. A company, role or location that
 * does not appear in the email under the same normalization src/validator.core.js
 * uses was invented by the model, and an invented value is nulled and flagged -- never
 * repaired, never re-prompted for. This is the same ethic as validator.core.js: a dumb
 * string-level check with no model in the loop, because a model deciding whether a
 * model hallucinated is not a safeguard.
 */

import { TRACKER, REQUEST_TIMEOUT_MS } from '../config.js';
import { detectSource } from './detect.js';

/** @typedef {import('./detect.js').Extraction} Extraction */

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';

const STATUSES = ['applied', 'screen', 'interview', 'offer', 'rejected', 'withdrawn'];
const CONFIDENCES = ['high', 'medium', 'low'];

/** See detect.js: `status` is meaningless when `matched` is false. */
const DEFAULT_STATUS = 'applied';

/**
 * Below this many characters of body there is nothing to extract from, and a request
 * would be spent to be told so. Cost guard, not a correctness rule.
 */
export const MIN_BODY_CHARS = 40;

/**
 * Strict structured-output schema. `additionalProperties: false` with every field in
 * `required` means the model cannot answer with a shape we did not ask for, so parsing
 * never has to guess. Nullable fields are typed `["string","null"]` so "I could not
 * find it" is expressible -- without that the model has to invent something to fill a
 * required string, which is the failure this whole file is built against.
 */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matched', 'company', 'role', 'location', 'jobUrl', 'status', 'confidence'],
  properties: {
    matched: {
      type: 'boolean',
      description: 'True only if this email is about a job application the recipient submitted.',
    },
    company: {
      type: ['string', 'null'],
      description:
        'The employer being applied to, copied verbatim from the email. Null if the email does not name it. Never the applicant tracking vendor (Greenhouse, Lever, Ashby, Workday) unless that vendor is itself the employer.',
    },
    role: {
      type: ['string', 'null'],
      description: 'The job title, copied verbatim from the email. Null if the email does not name it.',
    },
    location: {
      type: ['string', 'null'],
      description: 'The role location, copied verbatim from the email. Null if the email does not state it.',
    },
    jobUrl: {
      type: ['string', 'null'],
      description: 'A link to the posting, copied verbatim from the email. Null if there is none.',
    },
    status: {
      type: 'string',
      enum: STATUSES,
      description: 'The furthest stage this email indicates. A rejection is "rejected" even if it thanks the applicant for applying.',
    },
    confidence: {
      type: 'string',
      enum: CONFIDENCES,
      description: 'How certain the extraction is, based only on how explicit the email was.',
    },
  },
};

export const SYSTEM_PROMPT = [
  'You read a single email and report what job application, if any, it is about.',
  '',
  'Copy values out of the email verbatim. Every value you report is checked against the',
  'email text afterwards; a value that does not appear there is discarded and the record',
  'is flagged for a human. Guessing therefore cannot help you, and costs the user a row',
  'they have to fix by hand.',
  '',
  'Rules:',
  '- If the email does not state a field, the field is null. Null is a correct answer.',
  '- Do not infer the company from the sender address or the applicant tracking system.',
  '  Mail for a Greenhouse-hosted posting comes from greenhouse.io; the company is the',
  '  employer named in the email, not Greenhouse.',
  '- Do not expand, tidy, translate or complete a value. "Acme" does not become',
  '  "Acme Corporation"; "SWE Intern" does not become "Software Engineer Intern".',
  '- Rejections often open by thanking the applicant for applying. Report the outcome the',
  '  email actually conveys, not the phrasing it opens with.',
  '- If the email is not about an application the recipient submitted (a newsletter, a job',
  '  alert, a recruiter cold email), set matched to false.',
  '- confidence is "high" only when the email states the value plainly, "medium" when it is',
  '  clear from context, and "low" otherwise.',
].join('\n');

/**
 * Normalization for the grounding check. Mirrors `normalize` in src/validator.core.js
 * so both refusals agree on what "the same string" means.
 *
 * It is copied rather than imported: validator.core.js must stay import-free and does
 * not export its normalizer, and scripts/build-extension.js copies that file verbatim
 * into the extension, so adding an export there would ripple into a file this change
 * has no business touching.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function normalizeForGrounding(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/(?<=\d)[,_](?=\d)/g, '')
    .replace(/[^\p{L}\p{N}%.+#'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

function canonicalUrl(value) {
  try {
    const u = new URL(String(value).replace(/[).,;:!?\]]+$/, ''));
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * The email text a value must be found in.
 *
 * Subject, body and snippet only -- deliberately NOT the From header. A receipt for a
 * Greenhouse-hosted posting is sent by "Greenhouse <no-reply@greenhouse.io>", so
 * including the sender would ground the one company name we most need to reject.
 */
function corpusOf(mail) {
  return `${mail?.subject ?? ''} \n ${mail?.body ?? ''} \n ${mail?.snippet ?? ''}`;
}

/**
 * Discard anything the model reported that is not actually in the email.
 *
 * company, role and location must appear in the email text under
 * `normalizeForGrounding`. jobUrl must match a link that is actually in the email,
 * compared as a URL rather than as words. A field that fails is set to null, its
 * reason is appended to reviewReasons, and confidence drops to 'low'. Nothing is
 * repaired and nothing is re-requested: a model that invented one value has told you
 * what its answers are worth.
 *
 * @param {Extraction} extraction
 * @param {object} mail normalized MailMessage
 * @returns {Extraction} a new extraction; the input is not mutated
 */
export function groundExtraction(extraction, mail) {
  const out = {
    ...extraction,
    reviewReasons: Array.isArray(extraction?.reviewReasons) ? [...extraction.reviewReasons] : [],
  };
  const text = corpusOf(mail);
  const corpus = normalizeForGrounding(text);
  let invented = false;

  for (const field of ['company', 'role', 'location']) {
    const value = out[field];
    if (value == null) continue;
    const needle = normalizeForGrounding(value);
    if (needle && corpus.includes(needle)) continue;
    out[field] = null;
    out.reviewReasons.push(`${field} ${JSON.stringify(String(value))} not found in email text`);
    invented = true;
  }

  if (out.jobUrl != null) {
    const wanted = canonicalUrl(out.jobUrl);
    const present = new Set((text.match(URL_PATTERN) || []).map(canonicalUrl).filter(Boolean));
    if (!wanted || !present.has(wanted)) {
      out.jobUrl = null;
      out.reviewReasons.push(`jobUrl ${JSON.stringify(String(extraction.jobUrl))} not found in email text`);
      invented = true;
    }
  }

  if (invented) out.confidence = 'low';
  return out;
}

/**
 * The refusal shape. Every failure path returns this: no key, disabled, non-2xx,
 * refusal, unparseable, or a status the schema should have prevented. None of them
 * produce a guess.
 * @returns {Extraction}
 */
function unmatched(reason, source) {
  return {
    matched: false,
    company: null,
    role: null,
    location: null,
    source: source ?? null,
    jobUrl: null,
    status: DEFAULT_STATUS,
    confidence: 'low',
    reviewReasons: [reason],
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (status) => status === 429 || status === 529 || (status >= 500 && status < 600);

function backoffMs(attempt, retryAfterHeader) {
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(500 * 2 ** attempt, 8_000);
}

/**
 * Build the request body. Exported so a test can assert its shape without a network
 * call.
 *
 * Structured outputs (`output_config.format`) rather than an assistant prefill: prefill
 * returns a 400 on this model. `thinking` is left unset because it is adaptive by
 * default on Opus 5, which is what we want for a classification this small.
 *
 * @param {object} mail normalized MailMessage
 * @param {{model?: string, effort?: string}} [options]
 * @returns {object}
 */
export function buildRequest(mail, options = {}) {
  const { model = TRACKER.agent.model, effort = TRACKER.agent.effort } = options;
  return {
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: {
      effort,
      format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          '<email>',
          `<from>${mail?.from ?? ''}</from>`,
          `<subject>${mail?.subject ?? ''}</subject>`,
          '<body>',
          String(mail?.body ?? ''),
          '</body>',
          '</email>',
        ].join('\n'),
      },
    ],
  };
}

function firstJsonText(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) return block.text;
  }
  return null;
}

/**
 * Classify one message with the model, then ground every value it reported.
 *
 * @param {object} mail normalized MailMessage
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] injected fetch; defaults to global fetch
 * @param {string} [options.apiKey] defaults to process.env.ANTHROPIC_API_KEY
 * @param {boolean} [options.enabled] defaults to TRACKER.agent.enabled
 * @param {string} [options.model] defaults to TRACKER.agent.model
 * @param {string} [options.effort] defaults to TRACKER.agent.effort
 * @param {number} [options.maxAttempts] total tries for a retryable failure
 * @param {Function} [options.sleep] injected delay, so tests do not wait
 * @returns {Promise<Extraction>}
 */
export async function classify(mail, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    apiKey = process.env.ANTHROPIC_API_KEY,
    enabled = TRACKER.agent.enabled,
    model = TRACKER.agent.model,
    effort = TRACKER.agent.effort,
    maxAttempts = 3,
    sleep = wait,
  } = options;

  const source = detectSource(mail);

  if (!enabled) return unmatched('agent disabled in config', source);
  if (!apiKey) return unmatched('ANTHROPIC_API_KEY is not set; skipped rather than guessed', source);
  if (typeof fetchImpl !== 'function') return unmatched('no fetch implementation available', source);

  const body = String(mail?.body ?? '');
  if (body.trim().length < MIN_BODY_CHARS) {
    return unmatched('email body too short to classify', source);
  }

  const request = buildRequest(mail, { model, effort });
  let response = null;
  let lastError = '';

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let res;
    try {
      res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = `request failed: ${err?.message ?? err}`;
      if (attempt + 1 < maxAttempts) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      return unmatched(`agent ${lastError}`, source);
    }

    if (res?.ok) {
      response = res;
      break;
    }

    const status = res?.status ?? 0;
    // A 400 is our bug -- a malformed request or a rejected schema. Retrying it just
    // spends the rate limit to be told the same thing three times.
    if (!isRetryable(status)) {
      return unmatched(`agent request rejected with HTTP ${status}`, source);
    }
    lastError = `HTTP ${status}`;
    if (attempt + 1 >= maxAttempts) {
      return unmatched(`agent request failed after ${maxAttempts} attempts (${lastError})`, source);
    }
    await sleep(backoffMs(attempt, res?.headers?.get?.('retry-after')));
  }

  if (!response) return unmatched(`agent request failed (${lastError || 'no response'})`, source);

  let payload;
  try {
    payload = await response.json();
  } catch {
    return unmatched('agent response was not JSON', source);
  }

  // Checked before content: a refusal comes back as a normal 200 with empty or partial
  // content, so reading content[0] first would parse a truncated answer as a real one.
  if (payload?.stop_reason === 'refusal') {
    return unmatched('agent refused to classify this email', source);
  }

  const text = firstJsonText(payload);
  if (!text) return unmatched('agent returned no content', source);

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return unmatched('agent output was not parseable JSON', source);
  }

  if (raw?.matched !== true) {
    return unmatched('agent found no application receipt in this email', source);
  }
  if (!STATUSES.includes(raw?.status)) {
    return unmatched(`agent returned an unknown status ${JSON.stringify(raw?.status ?? null)}`, source);
  }

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  return groundExtraction(
    {
      matched: true,
      company: str(raw.company),
      role: str(raw.role),
      location: str(raw.location),
      source,
      jobUrl: str(raw.jobUrl),
      status: raw.status,
      confidence: CONFIDENCES.includes(raw?.confidence) ? raw.confidence : 'low',
      reviewReasons: [],
    },
    mail,
  );
}
