import { setTimeout as delay } from 'node:timers/promises';
import { REQUEST_TIMEOUT_MS } from '../config.js';

/**
 * Gmail API v1 over plain fetch: list the receipts, fetch each one, hand the rest of the
 * tracker a flat MailMessage it never has to know Gmail's shape to read.
 *
 * No `googleapis` -- CI fails the PR on a new runtime dependency, and the three
 * endpoints we touch are ordinary GETs.
 *
 * Read-only by construction: the token carries gmail.readonly, and nothing here issues
 * anything but GET.
 *
 * Errors report the status and the endpoint. They never carry the access token; the
 * token travels in the Authorization header and must not appear in any message a user
 * pastes into an issue.
 */

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Gmail caps a list page at 500 ids regardless of what we ask for. */
const MAX_PAGE = 500;

/** 429 and 5xx are the transient ones. A 401/403/404 is a fact, and retrying it is noise. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** One initial attempt plus this many retries. */
const RETRIES = 3;

const BACKOFF_BASE_MS = 500;

/**
 * @typedef {object} MailMessage
 * @property {string} id
 * @property {string} threadId
 * @property {string} from          e.g. 'Greenhouse <no-reply@greenhouse.io>'
 * @property {string} fromAddress   e.g. 'no-reply@greenhouse.io', lowercased
 * @property {string} to
 * @property {string} subject
 * @property {string} internalDate  millisecond epoch, as a string
 * @property {string} snippet
 * @property {string} body          plain text, HTML stripped, entities decoded
 */

function backoffMs(attempt) {
  return BACKOFF_BASE_MS * 2 ** attempt;
}

/**
 * Honour Retry-After when Google sends one -- it knows when the quota window resets and
 * a shorter local backoff just burns another 429 against the same quota.
 */
function retryDelayMs(res, attempt) {
  const header = res?.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const until = Date.parse(header);
    if (!Number.isNaN(until)) return Math.max(0, until - Date.now());
  }
  return backoffMs(attempt);
}

/** Google's error envelope, when there is one. Never includes credentials. */
async function errorDetail(res) {
  try {
    const body = await res.json();
    const message = body?.error?.message ?? body?.error_description ?? body?.error;
    return typeof message === 'string' && message ? ` (${message})` : '';
  } catch {
    return '';
  }
}

/**
 * The one place a Gmail request is made: 20s timeout, retry 429/5xx with exponential
 * backoff. Every caller goes through it so a fix to the retry policy is a fix
 * everywhere, and so no endpoint can quietly ship without a timeout -- an unattended
 * sync that hangs forever on a half-open socket is the failure this prevents.
 *
 * @param {string} url
 * @param {{accessToken: string, fetchImpl?: typeof fetch, retries?: number,
 *          sleepImpl?: (ms: number) => Promise<void>}} opts
 * @returns {Promise<any>} the parsed JSON body
 */
async function apiGet(url, { accessToken, fetchImpl = fetch, retries = RETRIES, sleepImpl = delay }) {
  if (!accessToken) throw new Error('a Google access token is required to call the Gmail API');
  const endpoint = url.split('?')[0];

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout or a dropped socket is exactly what the retries are for.
      if (attempt >= retries) throw new Error(`Gmail request to ${endpoint} failed: ${err.message}`);
      await sleepImpl(backoffMs(attempt));
      continue;
    }

    if (res.ok) return await res.json();

    if (!RETRYABLE.has(res.status) || attempt >= retries) {
      throw new Error(`Gmail API returned HTTP ${res.status} for ${endpoint}${await errorDetail(res)}`);
    }
    await sleepImpl(retryDelayMs(res, attempt));
  }
}

/**
 * The Gmail search that finds this mailbox's application receipts.
 *
 * `deliveredto:` and not `to:` -- it matches the address the message was actually
 * delivered to, which is what "I applied with this address" means. `to:` misses every
 * receipt sent to an alias or a plus-address, and matches mail that merely CC'd you.
 *
 * @param {{trackedEmail: string, lookbackDays?: number}} opts
 * @returns {string}
 */
export function buildQuery({ trackedEmail, lookbackDays = 90 }) {
  const email = String(trackedEmail ?? '').trim();
  if (!email) throw new Error('buildQuery requires the tracked email address');
  const days = Math.max(1, Math.floor(Number(lookbackDays) || 0) || 1);
  return `deliveredto:${email} newer_than:${days}d`;
}

/**
 * Message ids matching a query, following nextPageToken until Gmail runs out or we hit
 * maxResults. Bounded on purpose: a cold start on a busy mailbox is otherwise unbounded
 * work against a quota.
 *
 * @param {{accessToken: string, query: string, maxResults?: number,
 *          fetchImpl?: typeof fetch, sleepImpl?: (ms: number) => Promise<void>}} opts
 * @returns {Promise<string[]>}
 */
export async function listMessageIds({ accessToken, query, maxResults = 200, fetchImpl = fetch, sleepImpl = delay }) {
  const limit = Math.max(0, Math.floor(Number(maxResults) || 0));
  const ids = [];
  let pageToken;

  while (ids.length < limit) {
    const params = new URLSearchParams({
      q: String(query ?? ''),
      maxResults: String(Math.min(MAX_PAGE, limit - ids.length)),
    });
    if (pageToken) params.set('pageToken', pageToken);

    const body = await apiGet(`${GMAIL_API}/messages?${params.toString()}`, { accessToken, fetchImpl, sleepImpl });
    for (const m of body?.messages ?? []) {
      if (m?.id) ids.push(String(m.id));
    }

    pageToken = body?.nextPageToken;
    if (!pageToken) break;
  }

  return ids.slice(0, limit);
}

/**
 * One raw message, full format (headers plus the MIME tree).
 *
 * @param {{accessToken: string, id: string, fetchImpl?: typeof fetch,
 *          sleepImpl?: (ms: number) => Promise<void>}} opts
 * @returns {Promise<any>}
 */
export async function getMessage({ accessToken, id, fetchImpl = fetch, sleepImpl = delay }) {
  if (!id) throw new Error('getMessage requires a message id');
  const url = `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`;
  return await apiGet(url, { accessToken, fetchImpl, sleepImpl });
}

/**
 * Decode Gmail's base64url payloads.
 *
 * Gmail uses the URL alphabet and strips padding. Feeding that straight to a standard
 * base64 decoder mangles any body containing a `-` or `_`, which is most of them once a
 * tracking URL is involved.
 *
 * @param {string} data
 * @returns {string} UTF-8 text
 */
export function decodeBase64Url(data) {
  if (!data) return '';
  const b64 = String(data).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

const NAMED_ENTITIES = {
  '&nbsp;': ' ',
  '&quot;': '"',
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

function codePoint(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/**
 * Decode the entities that actually appear in ATS mail.
 *
 * `&amp;` is decoded LAST. Decoding it first turns `&amp;lt;` into `&lt;` and then into
 * `<`, which is how a literal "&lt;" written in an email body becomes a tag the
 * stripper eats along with the sentence after it.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  return String(text)
    .replace(/&(?:nbsp|quot|apos|lt|gt);/g, (m) => NAMED_ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * HTML body to readable text.
 *
 * Script and style content is removed with its tags -- otherwise a tracking script's
 * source ends up in the text the detector and the agent's grounding check read, and a
 * company name can "appear in the email" only because it was in a CSS class.
 *
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  const text = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(text);
}

/**
 * Zero-width characters, built from code points rather than written literally so they
 * stay visible to anyone reading this file. Marketing templates inject them mid-word,
 * and "thank you for applying" must still match the detector's phrases when it does.
 */
const ZERO_WIDTH = new RegExp(`[${String.fromCharCode(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff)}]`, 'g');

function collapse(text) {
  return String(text).replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
}

/**
 * Header lookup that does not care about casing. Gmail returns `From` on one message
 * and `FROM` on the next depending on what the sender wrote; a case-sensitive lookup
 * loses the sender on a subset of mail and looks like a parsing bug much later.
 */
function headerMap(headers) {
  const map = new Map();
  for (const h of Array.isArray(headers) ? headers : []) {
    const name = String(h?.name ?? '').toLowerCase();
    // First occurrence wins: a forwarded message can repeat From.
    if (name && !map.has(name)) map.set(name, String(h?.value ?? ''));
  }
  return map;
}

/** 'Greenhouse <No-Reply@Greenhouse.io>' -> 'no-reply@greenhouse.io' */
function addressOf(from) {
  const raw = String(from ?? '');
  const angled = raw.match(/<([^>]*)>/);
  const address = (angled ? angled[1] : raw).trim().replace(/^["']|["']$/g, '');
  return address.toLowerCase();
}

/**
 * Depth-first search for a body part of the given MIME type.
 *
 * Recursive because real ATS mail nests: multipart/mixed wrapping multipart/related
 * wrapping multipart/alternative, with the text/plain three levels down. A one-level
 * scan of payload.parts finds nothing, and every such message then looks like an empty
 * body the detector cannot classify.
 *
 * Parts with a filename are attachments -- a text/plain resume is not the message body.
 */
function findPart(node, mimeType) {
  if (!node || node.filename) return null;
  const mt = String(node.mimeType ?? '').toLowerCase().split(';')[0].trim();
  if (mt === mimeType && node.body?.data) return node;
  for (const child of Array.isArray(node.parts) ? node.parts : []) {
    const hit = findPart(child, mimeType);
    if (hit) return hit;
  }
  return null;
}

/** text/plain wins over text/html: it is what the sender wrote, not a rendering of it. */
function extractBody(payload) {
  const plain = findPart(payload, 'text/plain');
  if (plain) return collapse(decodeBase64Url(plain.body.data));

  const html = findPart(payload, 'text/html');
  if (html) return collapse(stripHtml(decodeBase64Url(html.body.data)));

  // Single-part messages carry the body on the payload itself, sometimes with no usable
  // mimeType at all, so sniff rather than trust it.
  const data = payload?.body?.data;
  if (data) {
    const text = decodeBase64Url(data);
    return collapse(/<[a-z!/]/i.test(text) ? stripHtml(text) : text);
  }
  return '';
}

/**
 * Gmail's raw message to the flat MailMessage the rest of the tracker consumes.
 *
 * Pure and total: a message with no payload, no headers or an unknown MIME shape
 * returns empty strings rather than throwing. One malformed message must not abort a
 * sync of two hundred.
 *
 * @param {any} raw
 * @returns {MailMessage}
 */
export function normalizeMessage(raw) {
  const payload = raw?.payload ?? {};
  const headers = headerMap(payload.headers);
  const from = collapse(headers.get('from') ?? '');

  return {
    id: raw?.id == null ? '' : String(raw.id),
    threadId: raw?.threadId == null ? '' : String(raw.threadId),
    from,
    fromAddress: addressOf(from),
    to: collapse(headers.get('delivered-to') ?? headers.get('to') ?? ''),
    subject: collapse(headers.get('subject') ?? ''),
    // A string on purpose: this is the watermark written to applications.json, and a
    // round trip through Number is a precision decision we have no reason to make.
    internalDate: raw?.internalDate == null ? '' : String(raw.internalDate),
    // Gmail HTML-escapes the snippet ("Thanks &amp; welcome"), so it needs decoding even
    // though it never contains tags.
    snippet: collapse(decodeEntities(raw?.snippet ?? '')),
    body: extractBody(payload),
  };
}

/**
 * Everything delivered to the tracked address since the watermark, oldest first.
 *
 * Oldest first because the status state machine is forward-only: replaying a thread's
 * receipt before its rejection records applied then rejected, while the reverse order
 * would try to move a rejected record backwards and drop the update.
 *
 * The watermark is exclusive (strictly newer than sinceInternalDate) so the last
 * message of the previous sync is not reprocessed on every run.
 *
 * @param {{accessToken: string, trackedEmail: string, lookbackDays?: number,
 *          maxMessages?: number, sinceInternalDate?: string|null,
 *          fetchImpl?: typeof fetch, sleepImpl?: (ms: number) => Promise<void>}} opts
 * @returns {Promise<MailMessage[]>}
 */
export async function fetchReceipts({
  accessToken,
  trackedEmail,
  lookbackDays = 90,
  maxMessages = 200,
  sinceInternalDate = null,
  fetchImpl = fetch,
  sleepImpl = delay,
}) {
  const query = buildQuery({ trackedEmail, lookbackDays });
  const ids = await listMessageIds({ accessToken, query, maxResults: maxMessages, fetchImpl, sleepImpl });

  const watermark = Number(sinceInternalDate);
  const hasWatermark =
    sinceInternalDate !== null && sinceInternalDate !== undefined && sinceInternalDate !== '' && Number.isFinite(watermark);

  const messages = [];
  for (const id of ids) {
    const mail = normalizeMessage(await getMessage({ accessToken, id, fetchImpl, sleepImpl }));
    const at = Number(mail.internalDate);
    // An undated message is kept rather than dropped: losing a real receipt is worse
    // than carrying one the caller has to flag, and it cannot move the watermark.
    if (hasWatermark && Number.isFinite(at) && at <= watermark) continue;
    messages.push(mail);
  }

  return messages.sort((a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0));
}
