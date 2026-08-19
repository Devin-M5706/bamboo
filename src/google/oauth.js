import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { GOOGLE_TOKEN_FILE, REQUEST_TIMEOUT_MS } from '../config.js';
import { readJson, writeJson } from '../store.js';

/**
 * Google OAuth 2.0 for an installed ("desktop") app, over plain fetch.
 *
 * No `googleapis`, no `google-auth-library`: this repo has a CI-enforced zero-dependency
 * rule, and the whole of the flow we need is four form-encoded POSTs and a loopback
 * listener. Do not "fix" this by adding the SDK -- the PR will fail.
 *
 * ONE RULE ABOVE THE OTHERS: never log, print, or interpolate a token into an error
 * message. Access tokens, refresh tokens and the client secret never leave this module
 * except as a return value. An error here is read by a human in a terminal, pasted into
 * an issue, and captured by CI logs; a refresh token in that text is a live credential
 * to a mailbox. Errors therefore carry the HTTP status and Google's own `error` field
 * and nothing else from the exchange.
 *
 * Credentials come from the environment. Nothing in this file may ever hold a literal
 * client id or secret -- the repo is public.
 */

/** Read-only mail plus the spreadsheet the tracker projects into. Nothing more. */
export const SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
]);

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Refresh this far before the token actually expires. A token that expires mid-sync
 * fails a request that already cost a page fetch, so we never hand out one with less
 * than a minute left.
 */
export const EXPIRY_SKEW_MS = 60_000;

const CREDENTIALS_HELP = [
  'Create an OAuth 2.0 Client ID of type "Desktop app" at',
  '  https://console.cloud.google.com/apis/credentials',
  'then export the two values before running the tracker:',
  '  GOOGLE_CLIENT_ID=...',
  '  GOOGLE_CLIENT_SECRET=...',
].join('\n');

/**
 * @typedef {object} GoogleToken
 * @property {string|null} accessToken
 * @property {string|null} refreshToken
 * @property {number} expiresAt   epoch ms; 0 when the response carried no expires_in
 * @property {string} scope
 * @property {string} tokenType
 */

/**
 * Resolve the OAuth client credentials, preferring explicit arguments over the
 * environment so tests never depend on the developer's shell.
 *
 * @param {{clientId?: string, clientSecret?: string}} [overrides]
 * @returns {{clientId: string, clientSecret: string}}
 * @throws {Error} naming exactly which variable is missing and where to get it.
 */
export function readCredentials(overrides = {}) {
  const clientId = overrides.clientId || process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = overrides.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';
  const missing = [];
  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (missing.length) {
    throw new Error(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set.\n${CREDENTIALS_HELP}`);
  }
  return { clientId, clientSecret };
}

/**
 * The URL the user opens to grant access.
 *
 * `access_type=offline` with `prompt=consent` because Google returns a refresh token
 * only on a fresh consent -- without it a re-authorization yields an access token that
 * dies in an hour and an unattended sync that stops working overnight.
 *
 * @param {{clientId: string, redirectUri: string, scopes?: string[], state: string}} opts
 * @returns {string}
 */
export function buildAuthUrl({ clientId, redirectUri, scopes = SCOPES, state }) {
  if (!clientId) throw new Error('buildAuthUrl requires a clientId');
  if (!redirectUri) throw new Error('buildAuthUrl requires a redirectUri');
  if (!state) throw new Error('buildAuthUrl requires a state value (CSRF protection)');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [...scopes].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * One form-encoded POST to the token endpoint.
 *
 * The request body carries the client secret and either an authorization code or a
 * refresh token, so a failure reports the status and Google's `error` fields only --
 * never the body, never the response verbatim.
 */
async function tokenRequest(form, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }

  if (!res.ok) {
    const detail = [body?.error, body?.error_description].filter(Boolean).join(': ');
    throw new Error(`Google token endpoint returned HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
  }
  return body ?? {};
}

/**
 * Normalize Google's snake_case token response.
 *
 * A refresh response omits `refresh_token`; carrying the previous one forward is what
 * keeps a long-lived authorization alive instead of silently downgrading to a token
 * that cannot be renewed.
 */
function toToken(body, { previous = {}, now = Date.now() } = {}) {
  const expiresIn = Number(body?.expires_in);
  return {
    accessToken: body?.access_token ?? null,
    refreshToken: body?.refresh_token ?? previous.refreshToken ?? null,
    expiresAt: Number.isFinite(expiresIn) ? now + expiresIn * 1000 : 0,
    scope: body?.scope ?? previous.scope ?? '',
    tokenType: body?.token_type ?? 'Bearer',
  };
}

/**
 * Trade an authorization code for tokens.
 *
 * @param {{clientId: string, clientSecret: string, code: string, redirectUri: string,
 *          fetchImpl?: typeof fetch, now?: number}} opts
 * @returns {Promise<GoogleToken>}
 */
export async function exchangeCode({ clientId, clientSecret, code, redirectUri, fetchImpl = fetch, now = Date.now() }) {
  if (!code) throw new Error('exchangeCode requires an authorization code');
  const body = await tokenRequest(
    {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    },
    { fetchImpl },
  );
  return toToken(body, { now });
}

/**
 * Exchange a refresh token for a new access token.
 *
 * @param {{clientId: string, clientSecret: string, refreshToken: string,
 *          fetchImpl?: typeof fetch, now?: number}} opts
 * @returns {Promise<{accessToken: string|null, expiresAt: number}>}
 */
export async function refreshAccessToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch, now = Date.now() }) {
  if (!refreshToken) throw new Error('refreshAccessToken requires a refresh token');
  const body = await tokenRequest(
    {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    },
    { fetchImpl },
  );
  const tok = toToken(body, { previous: { refreshToken }, now });
  return { accessToken: tok.accessToken, expiresAt: tok.expiresAt };
}

/**
 * Read the stored token, or null when this machine has never authorized.
 *
 * A corrupt token file propagates as CorruptFileError rather than reading as "not
 * authorized": the difference between "you never signed in" and "something wrote
 * garbage over your credentials" is worth telling the user about.
 *
 * @param {{tokenFile?: string}} [opts]
 * @returns {Promise<GoogleToken|null>}
 */
export async function loadToken({ tokenFile = GOOGLE_TOKEN_FILE } = {}) {
  const { exists, value } = await readJson(tokenFile);
  return exists ? value : null;
}

/**
 * Persist the token through store.js so the write is atomic -- a Ctrl-C mid-write that
 * truncates this file costs a full re-authorization.
 *
 * @param {GoogleToken} token
 * @param {{tokenFile?: string}} [opts]
 * @returns {Promise<void>}
 */
export async function saveToken(token, { tokenFile = GOOGLE_TOKEN_FILE } = {}) {
  await writeJson(tokenFile, token);
}

// Process-lifetime cache. A sync makes hundreds of Gmail calls; re-reading and
// re-validating the token file for each one is pure I/O for no information.
let cached = null;

/** Drop the in-memory access token. Called after re-authorization, and by tests. */
export function clearTokenCache() {
  cached = null;
}

/**
 * A currently-valid access token, refreshing when the stored one is within
 * EXPIRY_SKEW_MS of expiry. Cached in memory for the life of the process.
 *
 * @param {{tokenFile?: string, fetchImpl?: typeof fetch, now?: number,
 *          clientId?: string, clientSecret?: string}} [opts]
 * @returns {Promise<string>}
 */
export async function getAccessToken({
  tokenFile = GOOGLE_TOKEN_FILE,
  fetchImpl = fetch,
  now = Date.now(),
  clientId,
  clientSecret,
} = {}) {
  if (cached && cached.expiresAt - now > EXPIRY_SKEW_MS) return cached.accessToken;

  const stored = await loadToken({ tokenFile });
  if (!stored) {
    throw new Error(
      `No Google authorization stored in ${tokenFile}. Authorize this machine before syncing the tracker.`,
    );
  }

  if (stored.accessToken && Number(stored.expiresAt) - now > EXPIRY_SKEW_MS) {
    cached = { accessToken: stored.accessToken, expiresAt: Number(stored.expiresAt) };
    return cached.accessToken;
  }

  if (!stored.refreshToken) {
    throw new Error(
      `The stored Google authorization has expired and carries no refresh token (${tokenFile}). Authorize again.`,
    );
  }

  const creds = readCredentials({ clientId, clientSecret });
  const refreshed = await refreshAccessToken({
    ...creds,
    refreshToken: stored.refreshToken,
    fetchImpl,
    now,
  });
  await saveToken({ ...stored, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt }, { tokenFile });
  cached = { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  return cached.accessToken;
}

/**
 * The interactive loopback flow.
 *
 * Listens on 127.0.0.1 with port 0 (the OS picks a free one -- a fixed port collides
 * with whatever else the developer is running), prints the consent URL, waits for
 * Google to redirect the browser back with the code, exchanges it, and saves.
 *
 * The `state` parameter is generated per run and compared on return. Without that check
 * any page the user visits while this server is listening could drive the callback and
 * plant an attacker's authorization code in this machine's token file.
 *
 * @param {{clientId?: string, clientSecret?: string, scopes?: string[],
 *          tokenFile?: string, fetchImpl?: typeof fetch, print?: (s: string) => void}} [opts]
 * @returns {Promise<GoogleToken>} the saved token. Never printed.
 */
export async function authorize({
  clientId,
  clientSecret,
  scopes = SCOPES,
  tokenFile = GOOGLE_TOKEN_FILE,
  fetchImpl = fetch,
  print = console.log,
} = {}) {
  const creds = readCredentials({ clientId, clientSecret });
  const state = randomBytes(16).toString('hex');
  const server = http.createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    const redirectUri = `http://127.0.0.1:${port}`;
    const authUrl = buildAuthUrl({ clientId: creds.clientId, redirectUri, scopes, state });

    print('Open this URL to authorize bamboo to read the tracked mailbox:');
    print(authUrl);

    const code = await new Promise((resolve, reject) => {
      server.on('request', (req, res) => {
        const url = new URL(req.url, redirectUri);
        // Browsers ask for /favicon.ico beside the callback; ignoring it keeps us waiting
        // for the real redirect instead of resolving on the wrong request.
        if (url.pathname !== '/') {
          res.writeHead(404, { connection: 'close' }).end();
          return;
        }

        // Settle only once the reply has been flushed. Resolving first lets the finally
        // block below destroy the socket while the browser is still reading, and the
        // user sees a connection error on a flow that actually succeeded.
        const reply = (status, message, done) => {
          res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
          res.end(`${message}\n`, done);
        };

        const error = url.searchParams.get('error');
        if (error) {
          reply(400, `Authorization failed: ${error}`, () =>
            reject(new Error(`Google authorization was refused: ${error}`)));
          return;
        }

        if (url.searchParams.get('state') !== state) {
          reply(400, 'State mismatch. Nothing was saved.', () =>
            reject(
              new Error(
                'OAuth state mismatch — the callback did not come from the URL bamboo printed. Nothing was saved.',
              ),
            ));
          return;
        }

        const returned = url.searchParams.get('code');
        if (!returned) {
          reply(400, 'No authorization code in the callback.', () =>
            reject(new Error('The Google callback carried no authorization code.')));
          return;
        }

        reply(200, 'bamboo is authorized. You can close this tab and return to the terminal.', () =>
          resolve(returned));
      });
    });

    const token = await exchangeCode({ ...creds, code, redirectUri, fetchImpl });
    await saveToken(token, { tokenFile });
    clearTokenCache();
    return token; // deliberately not printed or logged
  } finally {
    // closeAllConnections first: the browser keeps the callback socket alive and
    // server.close() alone would hang the CLI waiting for it.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}
