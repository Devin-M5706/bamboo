import test from 'node:test';
import assert from 'node:assert/strict';
import { LINKEDIN_ROLES, draftOutreach, linkedinSearches, orgCandidates } from '../src/contacts.js';
import { contactsScreen } from '../src/ui/contacts-view.js';
import { setColor } from '../src/ui/theme.js';

test('orgCandidates covers the usual company -> github org spellings', () => {
  const c = orgCandidates('Rocket Lab');
  assert.ok(c.includes('rocketlab'));
  assert.ok(c.includes('rocket-lab'));
  assert.ok(c.includes('rocketlabinc'));
});

test('linkedinSearches builds URLs and never fetches anything', () => {
  const s = linkedinSearches('Ramp');
  assert.ok(s.length > 0);
  for (const item of s) {
    assert.match(item.url, /^https:\/\/www\.linkedin\.com\/search\/results\/people\/\?keywords=/);
    assert.ok(item.url.includes('Ramp'), 'company must be in the query');
    assert.ok(Object.keys(LINKEDIN_ROLES).includes(item.role));
  }
});

test('linkedinSearches searches for titles people actually use', () => {
  const kws = linkedinSearches('X').map((s) => s.keyword);
  // "hiring manager" is not a LinkedIn headline; searching it finds nobody.
  assert.ok(!kws.includes('hiring manager'));
  assert.ok(kws.includes('engineering manager'));
  assert.ok(kws.includes('technical recruiter'));
});

test('linkedinSearches can be narrowed to one role', () => {
  const s = linkedinSearches('Ramp', ['recruiters']);
  assert.ok(s.every((x) => x.role === 'recruiters'));
});

const FACTS = [
  { id: 'proj', text: 'I built bamboo, a Node tool that polls three ATS APIs.', tags: ['Node', 'bamboo'] },
];

test('outreach drafts are validated exactly like an application', () => {
  const ok = draftOutreach({
    contact: { name: 'Dana Lee' },
    posting: { title: 'Backend Intern', company: 'Ramp' },
    factIds: ['proj'],
    facts: FACTS,
    template: 'Hi Dana — I built bamboo, a Node tool that polls three ATS APIs.',
  });
  assert.equal(ok.ok, true, `expected pass, got ${ok.reason} ${ok.unsupported}`);
});

test('REFUSES an outreach message claiming something not in the ledger', () => {
  const bad = draftOutreach({
    contact: { name: 'Dana' },
    posting: { title: 'Backend Intern', company: 'Ramp' },
    factIds: ['proj'],
    facts: FACTS,
    template: 'Hi Dana — I scaled Kubernetes to 500 nodes at Google.',
  });
  assert.equal(bad.refused, true, 'a DM claim is easier to get asked about than a form field');
  assert.ok(bad.unsupported.includes('Kubernetes'));
});

test('contacts screen states the LinkedIn boundary in the output itself', () => {
  setColor(false);
  const out = contactsScreen({
    company: 'Ramp',
    engineers: [{ login: 'a', name: 'A Dev', bio: 'SWE', url: 'https://github.com/a' }],
    org: 'ramp',
    searches: linkedinSearches('Ramp', ['recruiters']),
  });
  assert.match(out, /does not fetch LinkedIn/);
  assert.ok(out.includes('@a'));
  assert.ok(out.includes('linkedin.com/search'));
  setColor(true);
});

test('contacts screen degrades honestly when no GitHub org exists', () => {
  setColor(false);
  const out = contactsScreen({
    company: 'Some Private Fund',
    engineers: [],
    reason: 'no public GitHub org found for "Some Private Fund"',
    searches: linkedinSearches('Some Private Fund', ['recruiters']),
  });
  assert.match(out, /no public GitHub org found/);
  assert.ok(out.includes('linkedin.com/search'), 'LinkedIn searches still offered');
  setColor(true);
});
