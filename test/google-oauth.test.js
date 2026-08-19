import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AUTH_ENDPOINT,
  SCOPES,
  authorize,
  buildAuthUrl,
  clearTokenCache,
  exchangeCode,
  getAccessToken,
  loadToken,
  readCredentials,
  refreshAccessToken,
  saveToken,
} from '../src/google/oauth.js';
import { CorruptFileError } from '../src/store.js';
import { fakeFetch, jsonResponse } from './helpers/http.js';

/**
 * Offline. The only socket any test here opens is a loopback listener this process
 * started itself, which is the flow under test; nothing talks to Google.
 */

const CLIENT = { clientId: 'test-client-id', clientSecret: 'test-client-secret' };

async function tmpTokenFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bamboo-oauth-'));
  return path.join(dir, 'google-token.json');
}



const formOf = (call) => Object.fromEntries(new URLSearchParams(call.init.body));

// --------------------------------------------------------------- credentials

test('readCredentials names the missing variable and where to create it', () => {
  const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    assert.throws(() => readCredentials(), (err) => {
      assert.match(err.message, /GOOGLE_CLIENT_ID/);
      assert.match(err.message, /GOOGLE_CLIENT_SECRET/);
      assert.match(err.message, /console\.cloud\.google\.com\/apis\/credentials/);
      return true;
    });

    process.env.GOOGLE_CLIENT_ID = 'from-env';
    assert.throws(() => readCredentials(), /GOOGLE_CLIENT_SECRET is not set/);

    process.env.GOOGLE_CLIENT_SECRET = 'secret-from-env';
    assert.deepEqual(readCredentials(), { clientId: 'from-env', clientSecret: 'secret-from-env' });

    assert.deepEqual(readCredentials(CLIENT), CLIENT, 'explicit arguments win over the environment');
  } finally {
    if (saved.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = saved.id;
    if (saved.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = saved.secret;
  }
});

test('no credential is embedded in the source', async () => {
  const src = await fs.readFile(new URL('../src/google/oauth.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.apps\.googleusercontent\.com/, 'a client id must never be committed');
  assert.doesNotMatch(src, /GOCSPX-/, 'a client secret must never be committed');
});

// -------------------------------------------------------------- buildAuthUrl

test('buildAuthUrl requests offline access for both scopes', () => {
  const url = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5000', state: 'st8' }));
  assert.equal(`${url.origin}${url.pathname}`, AUTH_ENDPOINT);
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:5000');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'st8');
  // Without offline+consent Google returns no refresh token and an unattended sync
  // stops working an hour later.
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('scope'), SCOPES.join(' '));
});

test('SCOPES is gmail.readonly plus spreadsheets and nothing wider', () => {
  assert.deepEqual([...SCOPES], [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
});

test('buildAuthUrl refuses without a state value', () => {
  assert.throws(() => buildAuthUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1:1' }), /state/);
});

// ------------------------------------------------------------- token exchange

test('exchangeCode posts a form-encoded authorization_code grant', async () => {
  const impl = fakeFetch([
    jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: SCOPES.join(' '), token_type: 'Bearer' }),
  ]);

  const tok = await exchangeCode({
    ...CLIENT,
    code: 'the-code',
    redirectUri: 'http://127.0.0.1:5000',
    fetchImpl: impl,
    now: 1_000_000,
  });

  assert.deepEqual(tok, {
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: 1_000_000 + 3599 * 1000,
    scope: SCOPES.join(' '),
    tokenType: 'Bearer',
  });

  const call = impl.calls[0];
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(formOf(call), {
    client_id: CLIENT.clientId,
    client_secret: CLIENT.clientSecret,
    code: 'the-code',
    redirect_uri: 'http://127.0.0.1:5000',
    grant_type: 'authorization_code',
  });
});

test('refreshAccessToken returns only the new access token and its expiry', async () => {
  const impl = fakeFetch([jsonResponse({ access_token: 'fresh', expires_in: 3600 })]);
  const out = await refreshAccessToken({ ...CLIENT, refreshToken: 'rt', fetchImpl: impl, now: 0 });

  assert.deepEqual(out, { accessToken: 'fresh', expiresAt: 3_600_000 });
  assert.deepEqual(formOf(impl.calls[0]), {
    client_id: CLIENT.clientId,
    client_secret: CLIENT.clientSecret,
    refresh_token: 'rt',
    grant_type: 'refresh_token',
  });
});

test('a token endpoint failure reports the status without echoing any credential', async () => {
  const impl = fakeFetch([jsonResponse({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 })]);

  await assert.rejects(
    () => refreshAccessToken({ ...CLIENT, refreshToken: 'rt-SECRET-VALUE', fetchImpl: impl }),
    (err) => {
      assert.match(err.message, /HTTP 400/);
      assert.match(err.message, /invalid_grant/, "Google's own reason is what the user needs");
      assert.doesNotMatch(err.message, /rt-SECRET-VALUE/, 'a refresh token must never reach an error message');
      assert.doesNotMatch(err.message, /test-client-secret/, 'a client secret must never reach an error message');
      return true;
    },
  );
});

// -------------------------------------------------------------- token storage

test('saveToken and loadToken round-trip through the store', async () => {
  const tokenFile = await tmpTokenFile();
  assert.equal(await loadToken({ tokenFile }), null, 'never authorized is not an error');

  const tok = { accessToken: 'at', refreshToken: 'rt', expiresAt: 42, scope: 's', tokenType: 'Bearer' };
  await saveToken(tok, { tokenFile });
  assert.deepEqual(await loadToken({ tokenFile }), tok);
});

test('loadToken refuses to read a corrupt token file as "not authorized"', async () => {
  const tokenFile = await tmpTokenFile();
  await fs.writeFile(tokenFile, '{ "accessToken": ');
  await assert.rejects(() => loadToken({ tokenFile }), CorruptFileError);
});

// ------------------------------------------------------------ getAccessToken

test('getAccessToken returns the stored token while it is still valid', async () => {
  clearTokenCache();
  const tokenFile = await tmpTokenFile();
  const now = 1_000_000;
  await saveToken({ accessToken: 'still-good', refreshToken: 'rt', expiresAt: now + 600_000 }, { tokenFile });

  const impl = fakeFetch([]); // any call at all would throw
  assert.equal(await getAccessToken({ tokenFile, fetchImpl: impl, now, ...CLIENT }), 'still-good');
  assert.equal(impl.calls.length, 0);
  clearTokenCache();
});

test('getAccessToken refreshes within 60s of expiry and persists the result', async () => {
  clearTokenCache();
  const tokenFile = await tmpTokenFile();
  const now = 1_000_000;
  await saveToken({ accessToken: 'about-to-die', refreshToken: 'rt', expiresAt: now + 30_000, scope: 'kept' }, { tokenFile });

  const impl = fakeFetch([jsonResponse({ access_token: 'renewed', expires_in: 3600 })]);
  assert.equal(await getAccessToken({ tokenFile, fetchImpl: impl, now, ...CLIENT }), 'renewed');

  const saved = await loadToken({ tokenFile });
  assert.equal(saved.accessToken, 'renewed');
  assert.equal(saved.expiresAt, now + 3_600_000);
  assert.equal(saved.refreshToken, 'rt', 'the refresh token must survive a refresh that omits it');
  assert.equal(saved.scope, 'kept');
  clearTokenCache();
});

test('getAccessToken caches in memory — a sync of 200 messages reads the file once', async () => {
  clearTokenCache();
  const tokenFile = await tmpTokenFile();
  const now = 2_000_000;
  await saveToken({ accessToken: 'expired', refreshToken: 'rt', expiresAt: now - 1 }, { tokenFile });

  const impl = fakeFetch([jsonResponse({ access_token: 'renewed', expires_in: 3600 })]);
  const first = await getAccessToken({ tokenFile, fetchImpl: impl, now, ...CLIENT });
  await fs.rm(tokenFile); // proves the second call touches neither disk nor network
  const second = await getAccessToken({ tokenFile, fetchImpl: impl, now: now + 1000, ...CLIENT });

  assert.equal(first, 'renewed');
  assert.equal(second, 'renewed');
  assert.equal(impl.calls.length, 1);
  clearTokenCache();
});

test('getAccessToken tells the user to authorize when nothing is stored', async () => {
  clearTokenCache();
  const tokenFile = await tmpTokenFile();
  await assert.rejects(
    () => getAccessToken({ tokenFile, fetchImpl: fakeFetch([]), now: 0, ...CLIENT }),
    (err) => {
      assert.match(err.message, /No Google authorization/);
      assert.match(err.message, /google-token\.json/, 'name the file from config, not a guessed path');
      return true;
    },
  );
  clearTokenCache();
});

test('getAccessToken refuses when the stored authorization cannot be renewed', async () => {
  clearTokenCache();
  const tokenFile = await tmpTokenFile();
  await saveToken({ accessToken: 'dead', refreshToken: null, expiresAt: 1 }, { tokenFile });
  await assert.rejects(
    () => getAccessToken({ tokenFile, fetchImpl: fakeFetch([]), now: 1_000, ...CLIENT }),
    /no refresh token/,
  );
  clearTokenCache();
});

// ------------------------------------------------------------------ authorize

/** Drive the loopback callback the way the browser would, and return the flow's result. */
async function runAuthorize({ tamperState = false, extraParams = {} } = {}) {
  clearTokenCache();
  const tokenFile = await tmpTokenFile();
  const printed = [];
  const impl = fakeFetch([
    jsonResponse({ access_token: 'ACCESS-TOKEN-VALUE', refresh_token: 'REFRESH-TOKEN-VALUE', expires_in: 3600 }),
  ]);

  const flow = authorize({ ...CLIENT, tokenFile, fetchImpl: impl, print: (s) => printed.push(s) });
  // Mark the rejection handled now; the tests assert on it several ticks later and an
  // unhandled rejection in between would kill the runner.
  flow.catch(() => {});

  // Wait for the consent URL to be printed; it carries the port and the state.
  while (printed.length < 2) await new Promise((r) => setImmediate(r));
  const authUrl = new URL(printed[1]);
  const redirectUri = authUrl.searchParams.get('redirect_uri');
  const state = authUrl.searchParams.get('state');

  const callback = new URL(redirectUri);
  callback.searchParams.set('code', 'callback-code');
  callback.searchParams.set('state', tamperState ? 'not-the-state' : state);
  for (const [k, v] of Object.entries(extraParams)) callback.searchParams.set(k, v);

  const res = await fetch(callback);
  const bodyText = await res.text();

  return { flow, tokenFile, printed, impl, res, bodyText, state };
}

test('authorize completes the loopback flow and saves the token without printing it', async () => {
  const { flow, tokenFile, printed, impl, res } = await runAuthorize();
  const token = await flow;

  assert.equal(res.status, 200);
  assert.equal(token.accessToken, 'ACCESS-TOKEN-VALUE');
  assert.equal((await loadToken({ tokenFile })).refreshToken, 'REFRESH-TOKEN-VALUE');
  assert.equal(formOf(impl.calls[0]).code, 'callback-code');
  assert.equal(formOf(impl.calls[0]).grant_type, 'authorization_code');

  const output = printed.join('\n');
  assert.doesNotMatch(output, /TOKEN-VALUE/, 'a token must never be printed');
  assert.doesNotMatch(output, /test-client-secret/, 'the client secret must never be printed');
  assert.match(output, /accounts\.google\.com/);
  clearTokenCache();
});

test('authorize rejects a callback whose state does not match — CSRF', async () => {
  const { flow, tokenFile, res } = await runAuthorize({ tamperState: true });

  await assert.rejects(() => flow, /state mismatch/i);
  assert.equal(res.status, 400);
  assert.equal(await loadToken({ tokenFile }), null, 'nothing may be saved from a mismatched callback');
  clearTokenCache();
});

test('authorize reports a denied consent instead of hanging', async () => {
  const { flow, tokenFile } = await runAuthorize({ extraParams: { error: 'access_denied' } });
  await assert.rejects(() => flow, /access_denied/);
  assert.equal(await loadToken({ tokenFile }), null);
  clearTokenCache();
});

test('authorize refuses before opening a listener when credentials are missing', async () => {
  const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    await assert.rejects(() => authorize({ print: () => {} }), /GOOGLE_CLIENT_ID/);
  } finally {
    if (saved.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = saved.id;
    if (saved.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = saved.secret;
  }
});
