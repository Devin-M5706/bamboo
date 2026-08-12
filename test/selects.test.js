import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAllSelects, resolveSelect } from '../src/selects.js';

// Option sets copied verbatim from real forms sampled by `npm run survey`.
const WORK_AUTH = {
  label: 'Are you legally authorized to work in the United States?',
  required: true,
  options: [
    { label: 'I am authorized to work in the United States for any employer', value: 1 },
    { label: 'I am authorized to work in the United States for my present employer only', value: 2 },
    { label: 'I require sponsorship to work in the United States', value: 3 },
    { label: 'I am not authorized to work in the United States', value: 4 },
    { label: 'My status to work in the United States is unknown', value: 5 },
  ],
};

const GRAD_YEAR = {
  label: 'What is your expected graduation year?',
  required: true,
  options: ['2026', '2027', '2028', '2029', '2030'].map((l, i) => ({ label: l, value: i })),
};

const DEGREE = {
  label: 'What is the highest degree level you are currently pursuing?',
  required: true,
  options: [
    "High School Diploma",
    "Associate's Degree",
    "Bachelor's Degree",
    "Master's Degree",
    'Doctor of Philosophy (Ph.D.)',
  ].map((l, i) => ({ label: l, value: i })),
};

const GPA = {
  label: 'GPA (Undergraduate)',
  required: true,
  options: ['Not applicable/Do not recall', '4.0 out of 4.0', '3.8 out of 4.0', '3.7 out of 4.0'].map(
    (l, i) => ({ label: l, value: i }),
  ),
};

const FINRA = {
  label: 'Are you currently registered with FINRA?',
  required: true,
  options: [{ label: 'Yes', value: 1 }, { label: 'No', value: 2 }],
};

const HEARD = {
  label: 'How did you hear about CTC?',
  required: true,
  options: ['AfroTech', 'Blind', 'Campus Career Center', 'CTC Employee'].map((l, i) => ({ label: l, value: i })),
};

test('work authorization resolves to the exact legal statement, not a guess', () => {
  const r = resolveSelect(WORK_AUTH, { workAuthorization: 'authorized_any' });
  assert.equal(r.ok, true);
  assert.equal(r.option.value, 1);
});

test('work authorization distinguishes sponsorship from authorization', () => {
  const r = resolveSelect(WORK_AUTH, { workAuthorization: 'requires_sponsorship' });
  assert.equal(r.ok, true);
  assert.equal(r.option.value, 3, 'must not collapse into "authorized for any employer"');
});

test('REFUSES work authorization when the profile does not say', () => {
  const r = resolveSelect(WORK_AUTH, {});
  assert.equal(r.refused, true);
  assert.match(r.reason, /workAuthorization is not set/);
});

test('REFUSES an unrecognized work authorization value instead of picking one', () => {
  const r = resolveSelect(WORK_AUTH, { workAuthorization: 'probably fine' });
  assert.equal(r.refused, true);
  assert.match(r.reason, /is not one of/);
});

test('graduation year matches exactly', () => {
  assert.equal(resolveSelect(GRAD_YEAR, { graduationYear: '2028' }).option.label, '2028');
});

test('REFUSES a graduation year the form does not offer', () => {
  const r = resolveSelect(GRAD_YEAR, { graduationYear: '2031' });
  assert.equal(r.refused, true);
  assert.match(r.reason, /matched no single option/);
});

test('degree level matches an exact option label', () => {
  const r = resolveSelect(DEGREE, { degreeLevel: "Bachelor's Degree" });
  assert.equal(r.ok, true);
  assert.equal(r.option.label, "Bachelor's Degree");
});

test('GPA matches by prefix so "3.7" finds "3.7 out of 4.0"', () => {
  const r = resolveSelect(GPA, { gpaUndergraduate: '3.7' });
  assert.equal(r.ok, true);
  assert.equal(r.option.label, '3.7 out of 4.0');
});

test('boolean questions map true/false onto Yes/No', () => {
  assert.equal(resolveSelect(FINRA, { finraRegistered: false }).option.label, 'No');
  assert.equal(resolveSelect(FINRA, { finraRegistered: true }).option.label, 'Yes');
});

test('REFUSES a boolean question when the profile value is not a boolean', () => {
  const r = resolveSelect(FINRA, { finraRegistered: 'no' });
  assert.equal(r.refused, true);
  assert.match(r.reason, /must be true or false/);
});

test('REFUSES company-specific questions with no generic answer', () => {
  const r = resolveSelect(HEARD, { name: 'x' });
  assert.equal(r.refused, true);
  assert.match(r.reason, /no rule|selectOverrides/);
});

test('an override answers a company-specific question', () => {
  const r = resolveSelect(HEARD, {}, { 'how did you hear about ctc': 'Campus Career Center' });
  assert.equal(r.ok, true);
  assert.equal(r.option.label, 'Campus Career Center');
  assert.equal(r.rule, 'override');
});

test('REFUSES an override that matches no option on this form', () => {
  const r = resolveSelect(HEARD, {}, { 'how did you hear about ctc': 'Career Fair' });
  assert.equal(r.refused, true);
  assert.match(r.reason, /matches no option/);
});

test('REFUSES rather than picking when options are missing entirely', () => {
  assert.equal(resolveSelect({ label: 'Anything', options: [] }, {}).refused, true);
  assert.equal(resolveSelect({ label: '', options: [{ label: 'Yes' }] }, {}).refused, true);
});

test('never silently defaults to the first option', () => {
  // The single most important property in this file.
  for (const q of [WORK_AUTH, GRAD_YEAR, DEGREE, GPA, FINRA, HEARD]) {
    const r = resolveSelect(q, {}, {});
    assert.equal(r.ok, undefined === r.ok ? undefined : false, 'empty profile must never resolve');
    assert.equal(r.refused, true, `${q.label} resolved with an empty profile`);
  }
});

test('resolveAllSelects separates blocking refusals from optional ones', () => {
  const optional = { ...HEARD, required: false };
  const r = resolveAllSelects([WORK_AUTH, optional], { workAuthorization: 'authorized_any' }, {});
  assert.equal(r.filled.length, 1);
  assert.equal(r.refusals.length, 1);
  assert.equal(r.blocking.length, 0, 'an optional refusal must not block the application');

  const r2 = resolveAllSelects([WORK_AUTH, HEARD], {}, {});
  assert.equal(r2.blocking.length, 2, 'required refusals must block');
});
