import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchQuestion } from '../src/matching.core.js';
import { matchQuestion as viaAnswers } from '../src/answers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BANK = {
  generic: { match: ['why'], text: 'generic' },
  specific: { match: ['why do you want to work at'], text: 'specific' },
  culture: { match: ['team culture', 'culture fit'], text: 'culture' },
};

test('longest match wins regardless of declaration order', () => {
  assert.equal(matchQuestion('Why do you want to work at Acme?', BANK).key, 'specific');
});

test('returns null rather than guessing at an unmatched question', () => {
  assert.equal(matchQuestion('Describe your ideal manager.', BANK), null);
  assert.equal(matchQuestion('', BANK), null);
  assert.equal(matchQuestion(null, BANK), null);
});

test('a malformed pattern does not break the whole pass', () => {
  const bank = { bad: { match: ['('], text: 'x' }, good: { match: ['culture'], text: 'y' } };
  assert.equal(matchQuestion('team culture?', bank).key, 'good');
});

test('tolerates an empty or missing bank', () => {
  assert.equal(matchQuestion('anything', {}), null);
  assert.equal(matchQuestion('anything', null), null);
});

test('returns the entry fields alongside the key', () => {
  const m = matchQuestion('culture fit?', BANK);
  assert.equal(m.key, 'culture');
  assert.equal(m.text, 'culture');
});

test('answers.js re-exports the core rather than reimplementing it', () => {
  assert.equal(viaAnswers, matchQuestion, 'must be the same function object, not a copy');
});

test('the extension shares the identical implementation — A2 regression guard', async () => {
  const src = await fs.readFile(path.join(root, 'extension', 'vendor', 'matching.js'), 'utf8');
  const g = {};
  new Function('globalThis', 'window', src).call(g, g, g);
  const ext = g.__bamboo.matching.matchQuestion;

  // Same answers for the same questions, including the tie-break that used to be
  // implemented twice by hand.
  for (const q of [
    'Why do you want to work at Acme?',
    'why?',
    'team culture?',
    'Describe your ideal manager.',
    '',
  ]) {
    const a = matchQuestion(q, BANK);
    const b = ext(q, BANK);
    assert.deepEqual(b, a, `CLI and extension disagree on: ${JSON.stringify(q)}`);
  }
});

test('extension no longer carries its own matchQuestion implementation', async () => {
  const apply = await fs.readFile(path.join(root, 'extension', 'content', 'apply.js'), 'utf8');
  assert.ok(
    !/function matchQuestion\s*\(/.test(apply),
    'apply.js must delegate to the shared core, not redefine it',
  );
});

test('manifest loads matching.js before apply.js', async () => {
  const m = JSON.parse(await fs.readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  const js = m.content_scripts[0].js;
  assert.ok(js.includes('vendor/matching.js'));
  assert.ok(js.indexOf('vendor/matching.js') < js.indexOf('content/apply.js'));
});
