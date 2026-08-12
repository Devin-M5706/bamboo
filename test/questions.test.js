import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateQuestions, classifyQuestions, stripHtml } from '../src/questions.js';
import { checkEligibility } from '../src/eligibility.js';

const q = (label, type, required = false) => ({ label, required, fields: [{ type }] });

test('classifyQuestions separates profile fields from free text', () => {
  const r = classifyQuestions([
    q('First Name', 'input_text', true),
    q('Email', 'input_text', true),
    q('Resume/CV', 'input_file', true),
    q('LinkedIn Profile', 'input_text'),
    q('GPA (Undergraduate)', 'multi_value_single_select', true),
    q('Why do you want to work here?', 'textarea', true),
    q('Do you require visa sponsorship?', 'multi_value_single_select', true),
  ]);
  const profileLabels = r.profile.map((x) => x.label);
  assert.ok(profileLabels.includes('First Name'));
  assert.ok(profileLabels.includes('Email'));
  assert.ok(profileLabels.includes('Resume/CV'));
  assert.ok(profileLabels.includes('LinkedIn Profile'));
  assert.ok(profileLabels.includes('GPA (Undergraduate)'));

  assert.deepEqual(
    r.freeText.map((x) => x.label),
    ['Why do you want to work here?'],
  );
  // Select-type questions are neither profile nor free text; they need their own handling.
  assert.deepEqual(
    r.other.map((x) => x.label),
    ['Do you require visa sponsorship?'],
  );
});

test('classifyQuestions ignores blank labels and normalizes whitespace', () => {
  const r = classifyQuestions([q('', 'textarea'), q('  Tell   us  something  ', 'textarea')]);
  assert.equal(r.freeText.length, 1);
  assert.equal(r.freeText[0].label, 'Tell us something');
});

test('aggregateQuestions counts each label once per job', () => {
  const agg = aggregateQuestions([
    [{ label: 'Why us?', required: true }, { label: 'Why us?', required: true }],
    [{ label: 'why us?', required: false }],
    [{ label: 'Other prompt', required: true }],
  ]);
  const why = agg.find((a) => /why us/i.test(a.label));
  assert.equal(why.jobs, 2, 'duplicate label within one job must not double-count');
  assert.equal(why.required, 1);
  assert.equal(agg[0].jobs, 2, 'most common prompt sorts first');
});

test('stripHtml removes tags and decodes entities', () => {
  assert.equal(stripHtml('<p>Must be a U.S.&nbsp;citizen &amp; 18+</p>').replace(/\s+/g, ' ').trim(), 'Must be a U.S. citizen & 18+');
  assert.equal(stripHtml('<div>a</div><div>b</div>'), 'a b');
  assert.equal(stripHtml(null), '');
});

test('a description recovered from HTML drives the citizenship gate', () => {
  // This is the real 12.5% case: title looks fine, description disqualifies.
  const title = 'Avionics Engineering Intern (Fall 2026)';
  const html = '<p>This position requires that the applicant <b>must be a U.S. citizen</b>.</p>';

  assert.equal(checkEligibility({ title, description: '' }).eligible, true);
  const after = checkEligibility({ title, description: stripHtml(html) });
  assert.equal(after.eligible, false);
  assert.match(after.reason, /citizenship/);
});
