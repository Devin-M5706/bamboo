import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBoards } from '../src/miner.js';
import { checkEligibility, partitionByEligibility } from '../src/eligibility.js';
import { matchQuestion } from '../src/answers.js';
import { VENDORS } from '../src/sources.js';

test('extractBoards pulls tokens from all three vendor URL shapes', () => {
  const boards = extractBoards([
    { url: 'https://job-boards.greenhouse.io/spacex/jobs/123', company_name: 'SpaceX' },
    { url: 'https://boards.greenhouse.io/verkada/jobs/9', company_name: 'Verkada' },
    { url: 'https://jobs.lever.co/palantir/abc-def', company_name: 'Palantir' },
    { url: 'https://jobs.ashbyhq.com/notion/xyz', company_name: 'Notion' },
    { url: 'https://cnoinc.wd5.myworkdayjobs.com/careers/job/x', company_name: 'CNO' },
  ]);
  const keys = boards.map((b) => `${b.vendor}:${b.board}`);
  assert.ok(keys.includes('greenhouse:spacex'));
  assert.ok(keys.includes('greenhouse:verkada'));
  assert.ok(keys.includes('lever:palantir'));
  assert.ok(keys.includes('ashby:notion'));
  assert.equal(boards.length, 4, 'Workday has no public board API, so it must not be mined');
});

test('extractBoards dedupes and counts repeat listings per board', () => {
  const boards = extractBoards([
    { url: 'https://job-boards.greenhouse.io/spacex/jobs/1' },
    { url: 'https://job-boards.greenhouse.io/spacex/jobs/2' },
    { url: 'https://job-boards.greenhouse.io/spacex/jobs/3' },
  ]);
  assert.equal(boards.length, 1);
  assert.equal(boards[0].listings, 3);
});

test('extractBoards survives malformed records', () => {
  const boards = extractBoards([{ url: null }, {}, { url: 'not a url' }, { url: 'https://x.com/y' }]);
  assert.equal(boards.length, 0);
});

test('eligibility drops non-intern titles', () => {
  assert.equal(checkEligibility({ title: 'Senior Software Engineer' }).eligible, false);
  assert.equal(checkEligibility({ title: 'Engineering Manager, Platform' }).eligible, false);
  assert.equal(checkEligibility({ title: 'Software Engineer Intern' }).eligible, true);
  assert.equal(checkEligibility({ title: 'Co-op, Hardware' }).eligible, true);
});

test('eligibility blocks citizenship-gated roles unless you are a citizen', () => {
  const posting = {
    title: 'Software Engineer Intern',
    description: 'Applicants must be a U.S. citizen due to contract requirements.',
  };
  const asNonCitizen = checkEligibility(posting, {
    usCitizen: false,
    needsSponsorship: false,
    titleAllow: [/intern/i],
    titleDeny: [],
  });
  assert.equal(asNonCitizen.eligible, false);
  assert.match(asNonCitizen.reason, /citizenship/);

  const asCitizen = checkEligibility(posting, {
    usCitizen: true,
    needsSponsorship: false,
    titleAllow: [/intern/i],
    titleDeny: [],
  });
  assert.equal(asCitizen.eligible, true);
});

test('eligibility blocks no-sponsorship roles when you need sponsorship', () => {
  const posting = {
    title: 'Software Engineer Intern',
    description: 'We are unable to sponsor visas for this role.',
  };
  const r = checkEligibility(posting, {
    usCitizen: false,
    needsSponsorship: true,
    titleAllow: [/intern/i],
    titleDeny: [],
  });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /sponsor/);
});

test('eligibility drops postings past their deadline', () => {
  const r = checkEligibility({ title: 'Software Engineer Intern', deadline: Date.now() - 1000 });
  assert.equal(r.eligible, false);
  assert.match(r.reason, /deadline/);
});

test('partitionByEligibility splits and records reasons', () => {
  const { eligible, dropped } = partitionByEligibility([
    { title: 'Software Engineer Intern', description: '' },
    { title: 'Staff Engineer', description: '' },
  ]);
  assert.equal(eligible.length, 1);
  assert.equal(dropped.length, 1);
  assert.ok(dropped[0].dropReason);
});

test('matchQuestion prefers the longer, more specific pattern', () => {
  const answers = {
    generic: { match: ['why'], text: 'generic' },
    specific: { match: ['why do you want to work at'], text: 'specific' },
  };
  const m = matchQuestion('Why do you want to work at Acme?', answers);
  assert.equal(m.key, 'specific');
});

test('matchQuestion returns null rather than guessing', () => {
  const answers = { a: { match: ['^why'], text: 'x' } };
  assert.equal(matchQuestion('Describe your ideal team culture.', answers), null);
  assert.equal(matchQuestion('', answers), null);
});

test('matchQuestion ignores invalid regex without throwing', () => {
  const answers = { bad: { match: ['('], text: 'x' }, good: { match: ['culture'], text: 'y' } };
  assert.equal(matchQuestion('team culture?', answers).key, 'good');
});

test('vendor parsers normalize real-shaped payloads', () => {
  const gh = VENDORS.greenhouse.parse(
    { jobs: [{ id: 7, title: 'Intern', location: { name: 'Remote' }, absolute_url: 'u', first_published: '2026-08-01T00:00:00Z' }] },
    'spacex',
  );
  assert.equal(gh[0].id, '7');
  assert.equal(gh[0].location, 'Remote');
  assert.equal(typeof gh[0].publishedAt, 'number');

  const lv = VENDORS.lever.parse(
    [{ id: 'a', text: 'Intern', categories: { location: 'NYC' }, hostedUrl: 'u', createdAt: 1711403416463 }],
    'palantir',
  );
  assert.equal(lv[0].title, 'Intern');
  assert.equal(lv[0].location, 'NYC');

  const ash = VENDORS.ashby.parse(
    { jobs: [{ id: 'b', title: 'Intern', location: 'SF', jobUrl: 'u', publishedAt: '2026-04-02T21:00:55.755+00:00', isListed: true }] },
    'notion',
  );
  assert.equal(ash[0].vendor, 'ashby');
  assert.equal(typeof ash[0].publishedAt, 'number');
});

test('ashby parser drops unlisted jobs', () => {
  const out = VENDORS.ashby.parse({ jobs: [{ id: 'x', title: 'T', isListed: false }] }, 'b');
  assert.equal(out.length, 0);
});

test('parsers tolerate empty or malformed bodies', () => {
  assert.deepEqual(VENDORS.greenhouse.parse({}, 'b'), []);
  assert.deepEqual(VENDORS.lever.parse(null, 'b'), []);
  assert.deepEqual(VENDORS.ashby.parse({ jobs: null }, 'b'), []);
});
