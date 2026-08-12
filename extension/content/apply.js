/* global chrome, window */
/**
 * The applier.
 *
 * Fills an application from the ledger and the pre-validated answer bank, then either
 * stops for you (dry run, the default) or submits (live mode).
 *
 * Design rule that everything else follows from: this file never generates text. It
 * retrieves text that was written and validated in advance. If the answer bank has no
 * entry for a question, or the validator refuses the entry, the application is ABANDONED
 * and reported -- never filled with a best guess.
 */

const JA = window.__jobapplr;

const log = (...a) => console.log('[jobapplr]', ...a);

async function getConfig() {
  const { ledger, answers, settings } = await chrome.storage.local.get([
    'ledger',
    'answers',
    'settings',
  ]);
  return {
    ledger: ledger ?? { facts: [], profile: {} },
    answers: answers ?? {},
    settings: { dryRun: true, ...(settings ?? {}) },
  };
}

function matchQuestion(question, answers) {
  const q = String(question ?? '').trim();
  if (!q) return null;
  let best = null;
  for (const [key, entry] of Object.entries(answers ?? {})) {
    for (const pattern of entry.match ?? []) {
      let re;
      try {
        re = new RegExp(pattern, 'i');
      } catch {
        continue;
      }
      const m = q.match(re);
      if (m && (!best || m[0].length > best.score)) best = { key, entry, score: m[0].length };
    }
  }
  return best ? { key: best.key, ...best.entry } : null;
}

function fillProfile(vendor, profile) {
  const map = JA.FIELD_MAP[vendor] ?? {};
  const filled = [];
  const missing = [];

  const values = {
    firstName: vendor === 'greenhouse' ? profile.name?.split(' ')[0] : profile.name,
    lastName: profile.name?.split(' ').slice(1).join(' '),
    email: profile.email,
    phone: profile.phone,
    linkedin: profile.linkedin,
    github: profile.github,
    website: profile.website,
  };

  for (const [field, selectors] of Object.entries(map)) {
    if (field === 'resume') continue; // file inputs cannot be set programmatically
    const value = values[field];
    if (!value) continue;
    const el = JA.findField(selectors);
    if (!el) {
      missing.push(field);
      continue;
    }
    JA.setValue(el, value);
    filled.push(field);
  }
  return { filled, missing };
}

async function run() {
  const vendor = JA.detectVendor();
  if (!vendor) return;

  const { ledger, answers, settings } = await getConfig();

  if (!ledger.facts?.length) {
    log('ABORT: evidence ledger is empty. Load data/ledger.json on the options page.');
    return;
  }

  const freeText = JA.collectFreeText();
  const report = { vendor, url: location.href, filled: [], refusals: [], submitted: false };

  // Resolve every free-text question BEFORE touching the form. If any required one
  // cannot be answered honestly, we abandon without a half-filled form behind us.
  const resolved = [];
  for (const f of freeText) {
    const entry = matchQuestion(f.question, answers);
    if (!entry) {
      if (f.required) report.refusals.push({ question: f.question, reason: 'no answer bank entry' });
      continue;
    }
    const v = JA.validator.validateAnswer(entry, ledger.facts);
    if (!v.ok) {
      report.refusals.push({
        question: f.question,
        reason: v.reason,
        untraceable: v.unsupported,
        answerKey: entry.key,
      });
      continue;
    }
    if (entry.maxLength && entry.text.length > entry.maxLength) {
      report.refusals.push({ question: f.question, reason: `answer exceeds ${entry.maxLength} chars` });
      continue;
    }
    resolved.push({ el: f.el, text: entry.text, key: entry.key });
  }

  const blocking = report.refusals.filter((r) =>
    freeText.find((f) => f.question === r.question && f.required),
  );

  if (blocking.length) {
    log('ABANDONED: required questions could not be answered from the ledger.');
    blocking.forEach((r) => log(`  refused "${r.question.slice(0, 80)}": ${r.reason}`, r.untraceable ?? ''));
    chrome.runtime.sendMessage({ type: 'jobapplr:report', report }).catch(() => {});
    return;
  }

  const profileResult = fillProfile(vendor, ledger.profile ?? {});
  report.filled = profileResult.filled;
  report.missingFields = profileResult.missing;

  for (const r of resolved) {
    JA.setValue(r.el, r.text);
    report.filled.push(`answer:${r.key}`);
  }

  if (settings.dryRun) {
    log('DRY RUN -- form filled, nothing submitted.');
    log(`  filled: ${report.filled.join(', ') || 'nothing'}`);
    if (report.refusals.length) log(`  ${report.refusals.length} optional question(s) left blank (refused)`);
    log('  Resume upload is always manual -- browsers do not let scripts set file inputs.');
  } else {
    const btn = JA.findSubmit();
    if (!btn) {
      log('ABORT: live mode but no submit button found.');
    } else {
      btn.click();
      report.submitted = true;
      log('SUBMITTED.');
    }
  }

  chrome.runtime.sendMessage({ type: 'jobapplr:report', report }).catch(() => {});
}

run().catch((err) => log('failed:', err));
