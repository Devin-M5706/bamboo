import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_URL,
  EXTRACTION_SCHEMA,
  MIN_BODY_CHARS,
  SYSTEM_PROMPT,
  buildRequest,
  classify,
  groundExtraction,
  normalizeForGrounding,
} from '../src/tracker/agent.js';

// Every test here is offline. Nothing in this file may open a socket or read a real
// API key: a test suite that needs credentials is a test suite that stops being run.
const NO_NETWORK = () => {
  throw new Error('the network was touched by a test');
};

const MAIL = {
  id: 'm1',
  threadId: 't1',
  from: 'Greenhouse <no-reply@greenhouse.io>',
  fromAddress: 'no-reply@greenhouse.io',
  to: 'you@example.com',
  subject: 'Your application to Initech',
  internalDate: '1723659000000',
  snippet: 'Thanks for applying to Initech',
  body: [
    'Hi Devin,',
    '',
    'Thanks for applying to Initech. We have your application for the Software Engineer',
    'Intern role in Austin, TX and will review it shortly.',
    '',
    'https://jobs.lever.co/initech/9f3c1a20',
  ].join('\n'),
};

const OPTIONS = { apiKey: 'test-key', sleep: async () => {} };

/** A fake fetch that replays a queued list of responses and records every call. */
function fakeFetch(...responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  impl.calls = calls;
  return impl;
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
const fail = (status, retryAfter = null) => ({
  ok: false,
  status,
  headers: { get: () => retryAfter },
  json: async () => ({ error: { type: 'x' } }),
});

const said = (fields, stopReason = 'end_turn') => ({
  stop_reason: stopReason,
  content: [{ type: 'text', text: JSON.stringify(fields) }],
});

const EXTRACTED = {
  matched: true,
  company: 'Initech',
  role: 'Software Engineer Intern',
  location: 'Austin, TX',
  jobUrl: 'https://jobs.lever.co/initech/9f3c1a20',
  status: 'applied',
  confidence: 'high',
};

// --- the grounding check --------------------------------------------------------

test('a hallucinated company is nulled, flagged, and drops confidence to low', async () => {
  const fetchImpl = fakeFetch(ok(said({ ...EXTRACTED, company: 'Globex' })));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl });

  assert.equal(e.company, null, 'a company that is not in the email was invented');
  assert.equal(e.confidence, 'low');
  assert.ok(
    e.reviewReasons.includes('company "Globex" not found in email text'),
    `expected a grounding reason, got ${JSON.stringify(e.reviewReasons)}`,
  );
  // The rest of the extraction survives -- one invented field is not a reason to throw
  // away the fields that are actually in the email.
  assert.equal(e.role, 'Software Engineer Intern');
  assert.equal(e.status, 'applied');
  assert.equal(e.matched, true);
});

test('a fully grounded extraction passes through unchanged', async () => {
  const fetchImpl = fakeFetch(ok(said(EXTRACTED)));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl });

  assert.deepEqual(e, {
    matched: true,
    company: 'Initech',
    role: 'Software Engineer Intern',
    location: 'Austin, TX',
    source: 'greenhouse',
    jobUrl: 'https://jobs.lever.co/initech/9f3c1a20',
    status: 'applied',
    confidence: 'high',
    reviewReasons: [],
  });
});

test('the sender display name does not ground a company name', async () => {
  // The mail is sent by "Greenhouse <no-reply@greenhouse.io>" and the body never says
  // Greenhouse. If the From header counted as email text, the one company name we most
  // need to reject would be the easiest one to accept.
  const fetchImpl = fakeFetch(ok(said({ ...EXTRACTED, company: 'Greenhouse' })));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl });

  assert.equal(e.company, null);
  assert.ok(e.reviewReasons.includes('company "Greenhouse" not found in email text'));
});

test('an expanded value is an invented value', () => {
  const mail = { subject: '', body: 'Thanks for applying to Acme. Your SWE Intern application is in review.' };

  const expanded = groundExtraction(
    { matched: true, company: 'Acme Corporation', role: 'Software Engineer Intern', confidence: 'high', reviewReasons: [] },
    mail,
  );
  assert.equal(expanded.company, null, '"Acme Corporation" is not what the email said');
  assert.equal(expanded.role, null, '"SWE Intern" must not be tidied into a longer title');
  assert.equal(expanded.confidence, 'low');
  assert.equal(expanded.reviewReasons.length, 2);
});

test('grounding ignores punctuation and spacing, like validator.core.js does', () => {
  const mail = { subject: 'Application', body: 'You applied to Stripe, Inc. for the Data  Engineering Intern role.' };
  const e = groundExtraction(
    { matched: true, company: 'stripe,   inc.', role: 'Data Engineering Intern', location: null, confidence: 'high', reviewReasons: [] },
    mail,
  );
  assert.equal(e.company, 'stripe,   inc.', 'same string under normalization, so it stays');
  assert.equal(e.role, 'Data Engineering Intern');
  assert.equal(e.confidence, 'high');
  assert.deepEqual(e.reviewReasons, []);
});

test('groundExtraction does not mutate the extraction it was given', () => {
  const original = { matched: true, company: 'Globex', role: null, location: null, confidence: 'high', reviewReasons: [] };
  const out = groundExtraction(original, { subject: '', body: 'nothing relevant here' });
  assert.equal(original.company, 'Globex');
  assert.deepEqual(original.reviewReasons, []);
  assert.equal(out.company, null);
});

test('jobUrl is grounded as a URL, not as words', () => {
  const mail = { subject: '', body: 'Track it at https://jobs.lever.co/initech/9f3c1a20?src=email please.' };

  const kept = groundExtraction(
    { matched: true, company: null, role: null, location: null, jobUrl: 'https://jobs.lever.co/initech/9f3c1a20?src=email', confidence: 'high', reviewReasons: [] },
    mail,
  );
  assert.equal(kept.jobUrl, 'https://jobs.lever.co/initech/9f3c1a20?src=email');

  const invented = groundExtraction(
    { matched: true, company: null, role: null, location: null, jobUrl: 'https://jobs.lever.co/initech/other-posting', confidence: 'high', reviewReasons: [] },
    mail,
  );
  assert.equal(invented.jobUrl, null);
  assert.equal(invented.confidence, 'low');
  assert.ok(invented.reviewReasons[0].startsWith('jobUrl '));
});

test('normalizeForGrounding mirrors the validator core normalization', () => {
  assert.equal(normalizeForGrounding('  Acme,   Inc.  '), 'acme inc.');
  assert.equal(normalizeForGrounding('“Acme”'), 'acme');
  assert.equal(normalizeForGrounding('1,200 users'), '1200 users');
  assert.equal(normalizeForGrounding(null), '');
});

// --- refusals: no key, disabled, refusal, bad output ------------------------------

test('no API key returns matched:false and never calls the API', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const e = await classify(MAIL, { fetchImpl: NO_NETWORK });
    assert.equal(e.matched, false);
    assert.equal(e.company, null);
    assert.match(e.reviewReasons[0], /ANTHROPIC_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('a disabled agent returns matched:false without a request', async () => {
  const e = await classify(MAIL, { ...OPTIONS, enabled: false, fetchImpl: NO_NETWORK });
  assert.equal(e.matched, false);
  assert.match(e.reviewReasons[0], /disabled/);
});

test('a refusal stop_reason is handled before content is read', async () => {
  // A refusal is HTTP 200 with empty or partial content. Reading content[0] first would
  // parse a truncated answer as a real one.
  const fetchImpl = fakeFetch(ok({ stop_reason: 'refusal', content: [] }));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl });
  assert.equal(e.matched, false);
  assert.match(e.reviewReasons[0], /refused/);
});

test('unparseable output is a refusal, not a guess', async () => {
  const fetchImpl = fakeFetch(ok({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'sure! here you go' }] }));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl });
  assert.equal(e.matched, false);
  assert.equal(e.company, null);
  assert.match(e.reviewReasons[0], /parseable/);
});

test('a status outside the state machine is rejected', async () => {
  const fetchImpl = fakeFetch(ok(said({ ...EXTRACTED, status: 'ghosted' })));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl });
  assert.equal(e.matched, false);
  assert.match(e.reviewReasons[0], /unknown status/);
});

test('the model reporting matched:false is passed through as matched:false', async () => {
  const fetchImpl = fakeFetch(ok(said({ ...EXTRACTED, matched: false })));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl });
  assert.equal(e.matched, false);
  assert.equal(e.source, 'greenhouse');
});

// --- transport ------------------------------------------------------------------

test('a 400 is never retried', async () => {
  const fetchImpl = fakeFetch(fail(400));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl });
  assert.equal(fetchImpl.calls.length, 1, 'a 400 is our bug; retrying spends quota to be told twice');
  assert.equal(e.matched, false);
  assert.match(e.reviewReasons[0], /HTTP 400/);
});

test('a 401 is not retried either', async () => {
  const fetchImpl = fakeFetch(fail(401));
  await classify(MAIL, { ...OPTIONS, fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
});

test('429 backs off and retries, then succeeds', async () => {
  const slept = [];
  const fetchImpl = fakeFetch(fail(429, '2'), ok(said(EXTRACTED)));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl, sleep: async (ms) => slept.push(ms) });

  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(slept, [2000], 'Retry-After is honoured');
  assert.equal(e.matched, true);
  assert.equal(e.company, 'Initech');
});

test('a 5xx that never clears gives up after maxAttempts without guessing', async () => {
  const fetchImpl = fakeFetch(fail(500));
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl, maxAttempts: 3 });
  assert.equal(fetchImpl.calls.length, 3);
  assert.equal(e.matched, false);
  assert.equal(e.company, null);
});

test('a thrown fetch is retried and then refused', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('ECONNRESET');
  };
  const e = await classify(MAIL, { ...OPTIONS, fetchImpl, maxAttempts: 2 });
  assert.equal(calls, 2);
  assert.equal(e.matched, false);
});

test('a body under the cost guard is skipped without a request', async () => {
  const e = await classify({ ...MAIL, body: 'too short' }, { ...OPTIONS, fetchImpl: NO_NETWORK });
  assert.equal(e.matched, false);
  assert.match(e.reviewReasons[0], /too short/);
  assert.ok(MIN_BODY_CHARS > 0);
});

// --- request shape --------------------------------------------------------------

test('the request uses structured outputs, no prefill, and no thinking config', () => {
  const req = buildRequest(MAIL);

  assert.equal(req.model, 'claude-opus-5');
  assert.equal(req.max_tokens, 1024);
  assert.equal(req.output_config.effort, 'low');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.format.schema, EXTRACTION_SCHEMA);

  // Prefill returns a 400 on this model, and `thinking` is adaptive by default on
  // Opus 5, which is what we want here.
  assert.ok(!('thinking' in req), 'thinking must be left unset');
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0].role, 'user');
  assert.ok(!req.messages.some((m) => m.role === 'assistant'), 'no assistant prefill');
  assert.equal(typeof req.system, 'string');
  assert.ok(req.messages[0].content.includes(MAIL.subject), 'the email is passed through, clearly delimited');
});

test('the request carries the documented headers and endpoint', async () => {
  const fetchImpl = fakeFetch(ok(said(EXTRACTED)));
  await classify(MAIL, { ...OPTIONS, fetchImpl });

  const [call] = fetchImpl.calls;
  assert.equal(call.url, API_URL);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['x-api-key'], 'test-key');
  assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.init.headers['content-type'], 'application/json');
});

test('EXTRACTION_SCHEMA is strict', () => {
  assert.equal(EXTRACTION_SCHEMA.type, 'object');
  assert.equal(
    EXTRACTION_SCHEMA.additionalProperties,
    false,
    'without this the model can answer in a shape parsing has to guess at',
  );

  const properties = Object.keys(EXTRACTION_SCHEMA.properties);
  assert.deepEqual(
    [...properties].sort(),
    [...EXTRACTION_SCHEMA.required].sort(),
    'every field must be required, so "not stated" is expressed as null rather than omitted',
  );

  for (const field of ['company', 'role', 'location', 'jobUrl']) {
    assert.deepEqual(
      EXTRACTION_SCHEMA.properties[field].type,
      ['string', 'null'],
      `${field} must be nullable or the model has to invent something to fill it`,
    );
  }

  assert.deepEqual(EXTRACTION_SCHEMA.properties.status.enum, [
    'applied',
    'screen',
    'interview',
    'offer',
    'rejected',
    'withdrawn',
  ]);
  assert.deepEqual(EXTRACTION_SCHEMA.properties.confidence.enum, ['high', 'medium', 'low']);
  assert.equal(EXTRACTION_SCHEMA.properties.matched.type, 'boolean');
});

test('the system prompt tells the model that null is a correct answer', () => {
  assert.ok(SYSTEM_PROMPT.length > 200);
  assert.match(SYSTEM_PROMPT, /verbatim/i);
  assert.match(SYSTEM_PROMPT, /null is a correct answer/i);
  assert.match(SYSTEM_PROMPT, /greenhouse/i, 'the vendor-as-company trap is named explicitly');
});
