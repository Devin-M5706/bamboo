/**
 * Shared test fixtures.
 *
 * Not collected as a suite: `npm test` runs `test/*.test.js`, and this is a directory
 * deeper.
 *
 * Scope is deliberately narrow. What lives here is the boilerplate that was byte-for-byte
 * identical across files and carries no meaning for any individual test -- a message
 * envelope, a fully populated record. What does NOT live here is anything a test is
 * actually asserting about: subjects, bodies, statuses and column values stay at their
 * call sites, passed as overrides, because a test you cannot read without opening a
 * second file is a worse test than a slightly repetitive one.
 */

/**
 * A Gmail message as `normalizeMessage` produces it.
 *
 * The envelope is the shared part. Pass whatever the test is about -- usually `subject`
 * and `body` -- as overrides.
 */
export const mail = (over = {}) => ({
  id: 'm1',
  threadId: 't1',
  from: 'Acme Careers <no-reply@greenhouse.io>',
  fromAddress: 'no-reply@greenhouse.io',
  to: 'you@example.com',
  subject: '',
  internalDate: '1723659000000', // 2024-08-14T18:10:00Z
  snippet: '',
  body: '',
  ...over,
});

/**
 * A fully populated application record.
 *
 * Every field is set, so a test that cares about one of them can override exactly that
 * one and a reader can see which field is under test at a glance. Tests for missing
 * values pass `null` explicitly rather than relying on an absent key.
 */
export const record = (over = {}) => ({
  id: 'stripe::backend-intern',
  messageId: 'msg-1',
  threadId: 'thr-1',
  company: 'Stripe',
  role: 'Backend Intern',
  location: 'Remote',
  source: 'greenhouse',
  jobUrl: 'https://boards.greenhouse.io/stripe/jobs/1',
  appliedAt: '2026-08-01T12:00:00.000Z',
  status: 'applied',
  statusHistory: [],
  confidence: 'high',
  needsReview: false,
  reviewReasons: [],
  extractedBy: 'deterministic',
  updatedAt: '2026-08-02T09:30:00.000Z',
  ...over,
});
