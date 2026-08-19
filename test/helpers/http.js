/**
 * Offline HTTP fakes.
 *
 * Every test in this repo runs without a network and without credentials. A suite that
 * needs either is a suite that stops being run, and these modules all talk to Google or
 * Anthropic over raw fetch -- so the fake is the seam.
 *
 * Not collected as a suite: `npm test` runs `test/*.test.js`.
 */

/**
 * Fail loudly if anything opens a socket.
 *
 * Pass as `fetchImpl` to a module that is supposed to stay local on this path. A
 * regression that starts calling an API then fails the test rather than billing for it.
 */
export const NO_NETWORK = () => {
  throw new Error('the network was touched by a test');
};

/** A real `Response`, so the code under test parses what the platform would hand it. */
export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * A fetch that replays a queued script of responses, recording every call.
 *
 * Each entry is either a `Response` or a function `(url, init) => Response`, which is how
 * a test asserts on the request before choosing its reply. Running out of responses
 * throws with the call index rather than returning undefined, because a module that made
 * one more request than expected is exactly the bug worth seeing.
 *
 * `impl.calls` holds `{url, init}` in order.
 */
export function fakeFetch(responses) {
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
