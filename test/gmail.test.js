import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuery,
  decodeBase64Url,
  decodeEntities,
  fetchReceipts,
  getMessage,
  listMessageIds,
  normalizeMessage,
  stripHtml,
} from '../src/google/gmail.js';

/**
 * Every test here is offline. Where a request shape matters we inject a fake fetch and
 * a fake sleep, so the suite is deterministic and costs no wall-clock backoff.
 */

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const SPACE = String.fromCharCode(32);

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A fetch that replays a queued script of responses and records every call. */
function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`fake fetch ran out of responses at call ${calls.length}: ${url}`);
    return typeof next === 'function' ? next(url, init) : next;
  };
  impl.calls = calls;
  return impl;
}

function fakeSleep() {
  const slept = [];
  const impl = async (ms) => {
    slept.push(ms);
  };
  impl.slept = slept;
  return impl;
}

// ---------------------------------------------------------------- buildQuery

test('buildQuery restricts to the delivery address and the lookback window', () => {
  assert.equal(
    buildQuery({ trackedEmail: 'you@example.com', lookbackDays: 90 }),
    'deliveredto:you@example.com newer_than:90d',
  );
});

test('buildQuery uses deliveredto, not to — aliases and plus-addressing must still match', () => {
  const q = buildQuery({ trackedEmail: 'a@b.com', lookbackDays: 7 });
  assert.match(q, /^deliveredto:/);
  assert.doesNotMatch(q, /(^|\s)to:/);
});

test('buildQuery refuses without an address rather than searching the whole mailbox', () => {
  assert.throws(() => buildQuery({ trackedEmail: '', lookbackDays: 30 }), /tracked email/);
  assert.throws(() => buildQuery({}), /tracked email/);
});

test('buildQuery floors fractional days and never asks for a zero-day window', () => {
  assert.equal(buildQuery({ trackedEmail: 'a@b.com', lookbackDays: 1.9 }), 'deliveredto:a@b.com newer_than:1d');
  assert.equal(buildQuery({ trackedEmail: 'a@b.com', lookbackDays: 0 }), 'deliveredto:a@b.com newer_than:1d');
  assert.equal(buildQuery({ trackedEmail: 'a@b.com', lookbackDays: -5 }), 'deliveredto:a@b.com newer_than:1d');
});

// ---------------------------------------------------------- base64url decode

test('decodeBase64Url handles the URL alphabet and missing padding', () => {
  // Bytes chosen so standard base64 yields '+' and '/', which Gmail sends as '-' and '_'.
  const raw = Buffer.from([0xfb, 0xff, 0xbf, 0x00]);
  const urlSafe = raw.toString('base64url'); // unpadded, '-' and '_'
  assert.match(urlSafe, /[-_]/, 'fixture must actually exercise the URL alphabet');
  assert.equal(Buffer.from(decodeBase64Url(urlSafe), 'utf8').length > 0, true);

  const text = 'Thanks — we received your application ✅';
  assert.equal(decodeBase64Url(Buffer.from(text, 'utf8').toString('base64url')), text);
  assert.equal(decodeBase64Url(Buffer.from(text, 'utf8').toString('base64')), text, 'padded input must decode too');
  assert.equal(decodeBase64Url(''), '');
  assert.equal(decodeBase64Url(undefined), '');
});

// ------------------------------------------------------------ entity decoding

test('decodeEntities decodes &amp; last so an escaped entity survives', () => {
  assert.equal(decodeEntities('&amp;lt;not a tag&amp;gt;'), '&lt;not a tag&gt;');
  assert.equal(decodeEntities('R&amp;D'), 'R&D');
});

test('decodeEntities covers the entities ATS mail actually sends', () => {
  // A plain space (32), never U+00A0: the detector matches phrases on \s and a
  // non-breaking space in the body silently defeats "thank you for applying".
  const nb = decodeEntities('a&nbsp;b');
  assert.equal(nb.length, 3);
  assert.equal(nb.charCodeAt(1), 32);
  assert.equal(decodeEntities('&quot;Role&quot;'), '"Role"');
  assert.equal(decodeEntities('we&#39;re'), "we're");
  assert.equal(decodeEntities('&lt;b&gt;'), '<b>');
  assert.equal(decodeEntities('don&#8217;t'), 'don’t');
  assert.equal(decodeEntities('&#x2014;'), '—');
});

// ------------------------------------------------------------- HTML stripping

test('stripHtml removes script and style content, not just their tags', () => {
  const html = '<style>.c{color:red}</style><script>var company="Acme";</script><p>Thank you for applying</p>';
  const text = stripHtml(html).replace(/\s+/g, SPACE).trim();
  assert.equal(text, 'Thank you for applying');
  assert.doesNotMatch(text, /Acme/, 'a name that only appears in a script is not in the email');
});

test('stripHtml leaves a separator where a tag was', () => {
  assert.match(stripHtml('<p>Hello</p><p>World</p>'), /Hello\s+World/);
});

// ---------------------------------------------------------- normalizeMessage

function message(overrides = {}) {
  return {
    id: 'm1',
    threadId: 't1',
    internalDate: '1723659000000',
    snippet: 'Thanks &amp; welcome',
    payload: {
      headers: [
        { name: 'From', value: 'Greenhouse <No-Reply@Greenhouse.io>' },
        { name: 'To', value: 'you@example.com' },
        { name: 'Subject', value: 'Thank you for applying to Acme' },
      ],
      mimeType: 'text/plain',
      body: { data: b64('Thank you for applying to Acme.') },
    },
    ...overrides,
  };
}

test('normalizeMessage reads headers case-insensitively', () => {
  const m = normalizeMessage(
    message({
      payload: {
        headers: [
          { name: 'from', value: 'Lever <no-reply@hire.lever.co>' },
          { name: 'SUBJECT', value: 'Your application to Stripe' },
          { name: 'tO', value: 'you@example.com' },
        ],
        mimeType: 'text/plain',
        body: { data: b64('body') },
      },
    }),
  );
  assert.equal(m.subject, 'Your application to Stripe');
  assert.equal(m.from, 'Lever <no-reply@hire.lever.co>');
  assert.equal(m.to, 'you@example.com');
});

test('normalizeMessage extracts and lowercases the sender address', () => {
  assert.equal(normalizeMessage(message()).fromAddress, 'no-reply@greenhouse.io');
  const bare = normalizeMessage(message({ payload: { headers: [{ name: 'From', value: 'No-Reply@Ashbyhq.com' }] } }));
  assert.equal(bare.fromAddress, 'no-reply@ashbyhq.com', 'an address without a display name still parses');
});

test('normalizeMessage keeps internalDate a string', () => {
  const m = normalizeMessage(message());
  assert.equal(typeof m.internalDate, 'string');
  assert.equal(m.internalDate, '1723659000000');
});

test('normalizeMessage decodes the HTML-escaped snippet Gmail returns', () => {
  assert.equal(normalizeMessage(message()).snippet, 'Thanks & welcome');
});

test('normalizeMessage walks nested multipart and prefers text/plain', () => {
  const raw = message({
    payload: {
      mimeType: 'multipart/mixed',
      headers: [{ name: 'From', value: 'a@b.com' }],
      parts: [
        {
          mimeType: 'multipart/related',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                { mimeType: 'text/html', body: { data: b64('<p>HTML version</p>') } },
                { mimeType: 'text/plain', body: { data: b64('Plain version') } },
              ],
            },
          ],
        },
      ],
    },
  });
  assert.equal(normalizeMessage(raw).body, 'Plain version');
});

test('normalizeMessage falls back to the HTML part, stripped and decoded', () => {
  const raw = message({
    payload: {
      mimeType: 'multipart/alternative',
      headers: [{ name: 'From', value: 'a@b.com' }],
      parts: [
        {
          mimeType: 'text/html; charset=UTF-8',
          body: {
            data: b64(
              '<html><body><h1>Acme &amp; Co</h1>\n\n<p>We&#39;ve received\tyour&nbsp;application.</p></body></html>',
            ),
          },
        },
      ],
    },
  });
  assert.equal(normalizeMessage(raw).body, "Acme & Co We've received your application.");
});

test('normalizeMessage ignores attachments when choosing the body', () => {
  const raw = message({
    payload: {
      mimeType: 'multipart/mixed',
      headers: [{ name: 'From', value: 'a@b.com' }],
      parts: [
        { mimeType: 'text/plain', filename: 'resume.txt', body: { data: b64('RESUME TEXT') } },
        { mimeType: 'text/html', body: { data: b64('<p>Real body</p>') } },
      ],
    },
  });
  assert.equal(normalizeMessage(raw).body, 'Real body');
});

test('normalizeMessage collapses whitespace in body, subject and from', () => {
  const raw = message({
    payload: {
      headers: [
        { name: 'Subject', value: 'Thank you   for\r\n applying' },
        { name: 'From', value: 'Greenhouse\n <no-reply@greenhouse.io>' },
      ],
      mimeType: 'text/plain',
      body: { data: b64('line one\r\n\r\n   line   two\t\tend') },
    },
  });
  const m = normalizeMessage(raw);
  assert.equal(m.subject, 'Thank you for applying');
  assert.equal(m.from, 'Greenhouse <no-reply@greenhouse.io>');
  assert.equal(m.body, 'line one line two end');
});

test('normalizeMessage strips zero-width characters injected by mail templates', () => {
  const zw = String.fromCharCode(0x200b);
  const raw = message({ payload: { mimeType: 'text/plain', body: { data: b64(`Thank you for a${zw}pplying`) } } });
  assert.equal(normalizeMessage(raw).body, 'Thank you for applying');
});

test('normalizeMessage survives a message with no payload or headers', () => {
  const m = normalizeMessage({ id: 'x', threadId: 'y' });
  assert.deepEqual(m, {
    id: 'x',
    threadId: 'y',
    from: '',
    fromAddress: '',
    to: '',
    subject: '',
    internalDate: '',
    snippet: '',
    body: '',
  });
  assert.doesNotThrow(() => normalizeMessage(undefined));
});

test('normalizeMessage handles a single-part HTML message with no parts array', () => {
  const raw = message({
    payload: {
      headers: [{ name: 'From', value: 'a@b.com' }],
      mimeType: 'text/html',
      body: { data: b64('<div>Application received</div>') },
    },
  });
  assert.equal(normalizeMessage(raw).body, 'Application received');
});

// --------------------------------------------------------- listMessageIds

test('listMessageIds follows nextPageToken and sends a bearer token', async () => {
  const impl = fakeFetch([
    jsonResponse({ messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' }),
    jsonResponse({ messages: [{ id: 'c' }] }),
  ]);
  const ids = await listMessageIds({
    accessToken: 'secret-token',
    query: 'deliveredto:a@b.com newer_than:90d',
    maxResults: 10,
    fetchImpl: impl,
    sleepImpl: fakeSleep(),
  });

  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.equal(impl.calls.length, 2);
  assert.equal(impl.calls[0].init.headers.authorization, 'Bearer secret-token');
  assert.match(impl.calls[0].url, /q=deliveredto%3Aa%40b\.com\+newer_than%3A90d/);
  assert.match(impl.calls[1].url, /pageToken=p2/);
});

test('listMessageIds never returns more than maxResults', async () => {
  const impl = fakeFetch([jsonResponse({ messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], nextPageToken: 'p2' })]);
  const ids = await listMessageIds({
    accessToken: 't',
    query: 'q',
    maxResults: 2,
    fetchImpl: impl,
    sleepImpl: fakeSleep(),
  });
  assert.deepEqual(ids, ['a', 'b']);
  assert.equal(impl.calls.length, 1, 'a satisfied budget must not fetch another page');
  assert.match(impl.calls[0].url, /maxResults=2/);
});

// ------------------------------------------------------------- retry policy

test('a 429 is retried after Retry-After seconds, then succeeds', async () => {
  const sleep = fakeSleep();
  const impl = fakeFetch([
    jsonResponse({}, { status: 429, headers: { 'retry-after': '2' } }),
    jsonResponse({ messages: [{ id: 'a' }] }),
  ]);
  const ids = await listMessageIds({ accessToken: 't', query: 'q', maxResults: 5, fetchImpl: impl, sleepImpl: sleep });

  assert.deepEqual(ids, ['a']);
  assert.deepEqual(sleep.slept, [2000], 'Retry-After must win over the local backoff');
});

test('5xx is retried three times with exponential backoff, then reports the status', async () => {
  const sleep = fakeSleep();
  const impl = fakeFetch(
    Array.from({ length: 4 }, () => () => jsonResponse({ error: { message: 'backend error' } }, { status: 503 })),
  );

  await assert.rejects(
    () => listMessageIds({ accessToken: 't', query: 'q', maxResults: 5, fetchImpl: impl, sleepImpl: sleep }),
    /HTTP 503/,
  );
  assert.equal(impl.calls.length, 4, 'one attempt plus three retries');
  assert.deepEqual(sleep.slept, [500, 1000, 2000]);
});

test('a 404 is not retried — it is a fact, not a transient failure', async () => {
  const impl = fakeFetch([jsonResponse({ error: { message: 'Not Found' } }, { status: 404 })]);
  await assert.rejects(
    () => getMessage({ accessToken: 't', id: 'missing', fetchImpl: impl, sleepImpl: fakeSleep() }),
    /HTTP 404/,
  );
  assert.equal(impl.calls.length, 1);
});

test('an API error never leaks the access token', async () => {
  const token = 'ya29.SUPER-SECRET-ACCESS-TOKEN';
  const impl = fakeFetch([jsonResponse({ error: { message: 'Invalid Credentials' } }, { status: 401 })]);
  await assert.rejects(
    () => getMessage({ accessToken: token, id: 'm1', fetchImpl: impl, sleepImpl: fakeSleep() }),
    (err) => {
      assert.doesNotMatch(err.message, /SUPER-SECRET/, 'a token must never reach an error message');
      assert.match(err.message, /HTTP 401/);
      return true;
    },
  );
});

test('a network failure is retried and finally reported without the token', async () => {
  const sleep = fakeSleep();
  const impl = fakeFetch(
    Array.from({ length: 4 }, () => () => {
      throw new Error('fetch failed');
    }),
  );
  await assert.rejects(
    () => getMessage({ accessToken: 'ya29.secret', id: 'm1', fetchImpl: impl, sleepImpl: sleep }),
    (err) => {
      assert.match(err.message, /fetch failed/);
      assert.doesNotMatch(err.message, /ya29/);
      return true;
    },
  );
  assert.equal(impl.calls.length, 4);
});

// -------------------------------------------------------------- fetchReceipts

function listAndMessages(messages) {
  return [jsonResponse({ messages: messages.map((m) => ({ id: m.id })) }), ...messages.map((m) => jsonResponse(m))];
}

test('fetchReceipts skips everything at or before the watermark', async () => {
  const impl = fakeFetch(
    listAndMessages([
      message({ id: 'old', internalDate: '1000' }),
      message({ id: 'same', internalDate: '2000' }),
      message({ id: 'new', internalDate: '3000' }),
    ]),
  );

  const out = await fetchReceipts({
    accessToken: 't',
    trackedEmail: 'a@b.com',
    lookbackDays: 90,
    maxMessages: 10,
    sinceInternalDate: '2000',
    fetchImpl: impl,
    sleepImpl: fakeSleep(),
  });

  assert.deepEqual(
    out.map((m) => m.id),
    ['new'],
    'the watermark is exclusive',
  );
});

test('fetchReceipts returns oldest first so the status machine replays forward', async () => {
  const impl = fakeFetch(
    listAndMessages([
      message({ id: 'c', internalDate: '3000' }),
      message({ id: 'a', internalDate: '1000' }),
      message({ id: 'b', internalDate: '2000' }),
    ]),
  );

  const out = await fetchReceipts({
    accessToken: 't',
    trackedEmail: 'a@b.com',
    maxMessages: 10,
    fetchImpl: impl,
    sleepImpl: fakeSleep(),
  });

  assert.deepEqual(
    out.map((m) => m.id),
    ['a', 'b', 'c'],
  );
});

test('fetchReceipts with no watermark returns everything, normalized', async () => {
  const impl = fakeFetch(listAndMessages([message({ id: 'only', internalDate: '5' })]));
  const out = await fetchReceipts({
    accessToken: 't',
    trackedEmail: 'a@b.com',
    sinceInternalDate: null,
    fetchImpl: impl,
    sleepImpl: fakeSleep(),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].body, 'Thank you for applying to Acme.');
  assert.equal(out[0].fromAddress, 'no-reply@greenhouse.io');
});

test('fetchReceipts bounds the number of messages it fetches', async () => {
  const impl = fakeFetch([
    jsonResponse({ messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
    jsonResponse(message({ id: 'a', internalDate: '1' })),
  ]);
  const out = await fetchReceipts({
    accessToken: 't',
    trackedEmail: 'a@b.com',
    maxMessages: 1,
    fetchImpl: impl,
    sleepImpl: fakeSleep(),
  });
  assert.equal(out.length, 1);
  assert.equal(impl.calls.length, 2, 'one list call plus one message fetch');
});
