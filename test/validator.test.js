import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClaims, validateAnswer, validateBank } from '../src/validator.js';

const FACTS = [
  {
    id: 'proj-a',
    text: 'I built a scheduling tool in React that cut our club’s planning time by 40%.',
    tags: ['React', 'scheduling'],
  },
  {
    id: 'school',
    text: 'I study computer science at Purdue and graduate in 2028.',
    tags: ['Purdue', '2028'],
  },
];

test('extractClaims finds numbers and entities, skips grammatical capitals', () => {
  const claims = extractClaims('I built a tool in React that saved 40% of the time.');
  const raws = claims.map((c) => c.raw.trim());
  assert.ok(raws.includes('React'), 'should catch React');
  assert.ok(
    raws.some((r) => r.startsWith('40')),
    'should catch 40%',
  );
  assert.ok(!raws.includes('I'), 'should not treat sentence-initial I as a claim');
});

test('extractClaims catches symbol-bearing tech names anywhere in the sentence', () => {
  const raws = extractClaims('We used C++ and Node.js heavily.').map((c) => c.raw);
  assert.ok(raws.includes('C++'));
  assert.ok(raws.some((r) => r.startsWith('Node.js')));
});

test('accepts an answer whose claims all trace to referenced facts', () => {
  const r = validateAnswer(
    { text: 'I built a scheduling tool in React that cut planning time by 40%.', derived_from: ['proj-a'] },
    FACTS,
  );
  assert.equal(r.ok, true, `expected pass, got: ${r.reason} ${r.unsupported}`);
  assert.equal(r.refused, false);
});

test('REFUSES a fabricated technology', () => {
  const r = validateAnswer(
    { text: 'I built a scheduling tool in Kubernetes that cut planning time by 40%.', derived_from: ['proj-a'] },
    FACTS,
  );
  assert.equal(r.refused, true);
  assert.ok(r.unsupported.includes('Kubernetes'));
});

test('REFUSES an inflated number', () => {
  const r = validateAnswer(
    { text: 'I built a scheduling tool in React that cut planning time by 90%.', derived_from: ['proj-a'] },
    FACTS,
  );
  assert.equal(r.refused, true);
  assert.ok(r.unsupported.some((u) => u.startsWith('90')));
});

test('REFUSES a claim supported only by a fact that was not referenced', () => {
  const r = validateAnswer({ text: 'I study at Purdue.', derived_from: ['proj-a'] }, FACTS);
  assert.equal(r.refused, true, 'referencing the wrong fact must not pass');
  assert.ok(r.unsupported.includes('Purdue'));
});

test('REFUSES an answer with no derived_from', () => {
  const r = validateAnswer({ text: 'Anything at all.', derived_from: [] }, FACTS);
  assert.equal(r.refused, true);
  assert.match(r.reason, /no derived_from/);
});

test('REFUSES a reference to a nonexistent fact id', () => {
  const r = validateAnswer({ text: 'Something.', derived_from: ['ghost'] }, FACTS);
  assert.equal(r.refused, true);
  assert.match(r.reason, /unknown fact/);
});

test('REFUSES empty text', () => {
  const r = validateAnswer({ text: '   ', derived_from: ['proj-a'] }, FACTS);
  assert.equal(r.refused, true);
});

test('tags count as support', () => {
  const r = validateAnswer({ text: 'I go to Purdue.', derived_from: ['school'] }, FACTS);
  assert.equal(r.ok, true, `expected tag support, got ${r.unsupported}`);
});

test('numeric matching tolerates formatting differences', () => {
  const facts = [{ id: 'f', text: 'I processed 1,200 records.', tags: [] }];
  const r = validateAnswer({ text: 'I processed 1200 records.', derived_from: ['f'] }, facts);
  assert.equal(r.ok, true, `expected 1200 to match 1,200, got ${r.unsupported}`);
});

test('validateBank aggregates and reports refusals', () => {
  const bank = {
    good: { text: 'I go to Purdue.', derived_from: ['school'] },
    bad: { text: 'I go to Stanford.', derived_from: ['school'] },
  };
  const v = validateBank(bank, FACTS);
  assert.equal(v.total, 2);
  assert.equal(v.refused, 1);
  assert.equal(v.ok, false);
});
