import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detect,
  detectSource,
  detectStatus,
  extractCompany,
  extractJobUrl,
  extractRole,
} from '../src/tracker/detect.js';
import { mail } from './helpers/fixtures.js';


const RECEIPT = mail({
  subject: 'Thank you for applying to Acme Robotics',
  body: [
    'Hi Devin,',
    '',
    'Thanks for applying to Acme Robotics! We received your application for the',
    'Software Engineer Intern position and the team will review it shortly.',
    '',
    'Location: Chicago, IL',
    '',
    'View the posting: https://boards.greenhouse.io/acmerobotics/jobs/4012345',
  ].join('\n'),
});

// The case this module exists for. Rejections open by thanking you for applying, so a
// first-match-wins reader files them as brand-new applications and the tracker reports
// progress that is not happening.
const REJECTION = mail({
  fromAddress: 'no-reply@hire.lever.co',
  from: 'Initech Recruiting <no-reply@hire.lever.co>',
  subject: 'Your application to Initech',
  body: [
    'Hi Devin,',
    '',
    'Thank you for applying to Initech and for your interest in the Software Engineer',
    'Intern position. After careful review, we have decided to move forward with other',
    'candidates at this time.',
  ].join('\n'),
});

test('REJECTION is checked before receipt, even when the mail opens by thanking you', () => {
  assert.equal(
    detectStatus(REJECTION),
    'rejected',
    'a rejection that opens with "thank you for applying" must never read as a new application',
  );
  const e = detect(REJECTION);
  assert.equal(e.status, 'rejected');
  assert.equal(e.matched, true);
});

test('"unfortunately" phrasing is a rejection, not a receipt', () => {
  const m = mail({
    subject: 'Update on your application',
    body: 'Thanks for applying to Globex. Unfortunately, we will not be moving forward with your application.',
  });
  assert.equal(detectStatus(m), 'rejected');
});

test('a plain receipt is applied', () => {
  assert.equal(detectStatus(RECEIPT), 'applied');
});

test('interview and offer phrasings outrank the receipt phrasing they carry', () => {
  const interview = mail({
    subject: 'Next steps',
    body: 'Thanks for applying! We would like to schedule an interview with the team next week.',
  });
  assert.equal(detectStatus(interview), 'interview');

  const offer = mail({
    subject: 'Great news',
    body: 'Thank you for applying. We are pleased to offer you the Data Science Intern position at Hooli.',
  });
  assert.equal(detectStatus(offer), 'offer');
});

test('detectStatus returns null when nothing says an application exists', () => {
  const newsletter = mail({
    subject: 'This week in robotics',
    body: 'Five stories about warehouse automation you should read this weekend.',
  });
  assert.equal(detectStatus(newsletter), null, 'null is a refusal, not a default');
});

test('detectSource reads the vendor off the sender domain', () => {
  assert.equal(detectSource(mail({ fromAddress: 'no-reply@greenhouse.io' })), 'greenhouse');
  assert.equal(detectSource(mail({ fromAddress: 'no-reply@hire.lever.co' })), 'lever');
  assert.equal(detectSource(mail({ fromAddress: 'notifications@ashbyhq.com' })), 'ashby');
  assert.equal(detectSource(mail({ fromAddress: 'noreply@myworkday.com' })), 'workday');
  assert.equal(detectSource(mail({ fromAddress: 'careers@acmerobotics.com' })), 'other');
  assert.equal(detectSource(mail({ fromAddress: '', from: 'Acme <jobs@ashbyhq.com>' })), 'ashby');
  assert.equal(detectSource(mail({ fromAddress: '', from: '' })), 'other');
});

test('extractCompany reads the employer out of the ATS template', () => {
  assert.equal(extractCompany(RECEIPT), 'Acme Robotics');
  assert.equal(extractCompany(REJECTION), 'Initech');
});

test('NEVER falls back to the sender domain for the company name', () => {
  // Sent by Greenhouse, for an employer the mail never names. "Greenhouse" here would
  // be every Greenhouse-hosted application filed under one bogus company.
  const anonymous = mail({
    from: 'Greenhouse <no-reply@greenhouse.io>',
    fromAddress: 'no-reply@greenhouse.io',
    subject: 'We received your application',
    body: 'Hi Devin,\n\nWe received your application. Someone will be in touch if there is a match.',
  });

  assert.equal(extractCompany(anonymous), null);

  const e = detect(anonymous);
  assert.equal(e.matched, true, 'it is still a receipt');
  assert.equal(e.company, null);
  assert.equal(e.source, 'greenhouse', 'the vendor is known; that is not the same as the employer');
  assert.ok(e.reviewReasons.includes('company not found in email text'));
  assert.ok(
    !JSON.stringify(e).toLowerCase().includes('"greenhouse robotics"'),
    'sanity: nothing may synthesise a company from the vendor',
  );
});

test('extractRole reads the title, and "applying to X" is not a title', () => {
  assert.equal(extractRole(RECEIPT), 'Software Engineer Intern');
  assert.equal(extractRole(REJECTION), 'Software Engineer Intern');

  const companyOnly = mail({
    subject: 'Thank you for applying to Acme Robotics',
    body: 'Thanks for applying to Acme Robotics. We will be in touch soon about next steps.',
  });
  assert.equal(extractRole(companyOnly), null, '"applying to Acme" names an employer, not a job');
});

test('a labelled Position: line is read as the role', () => {
  const m = mail({
    subject: 'Application received',
    body: 'We received your application.\n\nPosition: Backend Engineering Intern\nLocation: Remote (US)\n',
  });
  assert.equal(extractRole(m), 'Backend Engineering Intern');
  assert.equal(detect(m).location, 'Remote (US)');
});

test('the {Company} - {Role} subject template is split by which half reads like a title', () => {
  const m = mail({
    subject: 'Acme Robotics — Software Engineer Intern',
    body: 'Your application has been received. We will review it shortly and get back to you.',
  });
  assert.equal(extractCompany(m), 'Acme Robotics');
  assert.equal(extractRole(m), 'Software Engineer Intern');
});

test('a dashed subject that could be either way round is refused, not guessed', () => {
  const m = mail({
    subject: 'Your application — an update',
    body: 'Thank you for applying. We will be in touch with you about next steps shortly.',
  });
  assert.equal(extractCompany(m), null);
  assert.equal(extractRole(m), null);
});

test('extractJobUrl takes a link verbatim and never builds one', () => {
  assert.equal(extractJobUrl(RECEIPT), 'https://boards.greenhouse.io/acmerobotics/jobs/4012345');
  assert.equal(extractJobUrl(mail({ body: 'No links here at all, just prose about the role.' })), null);
});

test('detect returns the full extraction for a clean receipt', () => {
  const e = detect(RECEIPT);
  assert.deepEqual(e, {
    matched: true,
    company: 'Acme Robotics',
    role: 'Software Engineer Intern',
    location: 'Chicago, IL',
    source: 'greenhouse',
    jobUrl: 'https://boards.greenhouse.io/acmerobotics/jobs/4012345',
    status: 'applied',
    confidence: 'high',
    reviewReasons: [],
  });
});

test('confidence is high only when company AND role both matched a pattern', () => {
  assert.equal(detect(RECEIPT).confidence, 'high');

  const companyOnly = mail({
    subject: 'Thank you for applying to Acme Robotics',
    body: 'Thanks for applying to Acme Robotics. We will be in touch soon about next steps.',
  });
  const one = detect(companyOnly);
  assert.equal(one.confidence, 'medium');
  assert.deepEqual(one.reviewReasons, ['role not found in email text']);

  const neither = mail({
    subject: 'We received your application',
    body: 'We received your application and will be in touch if there is a match for you.',
  });
  const none = detect(neither);
  assert.equal(none.confidence, 'low');
  assert.deepEqual(none.reviewReasons, [
    'company not found in email text',
    'role not found in email text',
  ]);
});

test('detect reports matched:false for mail that is not an application receipt', () => {
  const e = detect(
    mail({
      subject: 'This week in robotics',
      body: 'Five stories about warehouse automation you should read this weekend.',
    }),
  );
  assert.equal(e.matched, false);
  assert.equal(e.company, null);
  assert.equal(e.role, null);
  assert.equal(e.jobUrl, null);
  assert.ok(e.reviewReasons.length > 0);
});

test('detect survives an empty or malformed message', () => {
  for (const m of [{}, { subject: null, body: null }, mail()]) {
    const e = detect(m);
    assert.equal(e.matched, false);
    assert.equal(typeof e.status, 'string', 'status stays a string so the shared contract holds');
  }
});
