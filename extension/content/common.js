/* global window */
/**
 * Form-field mapping for the three ATS vendors.
 *
 * These selectors were written against the public application forms. ATS vendors
 * change markup without notice, so every lookup is defensive and a miss is reported
 * rather than silently skipped -- a silently skipped required field is a failed
 * application you think succeeded.
 */

const JA = (window.__bamboo = window.__bamboo || {});

JA.detectVendor = function detectVendor(host = location.hostname) {
  if (host.includes('greenhouse.io')) return 'greenhouse';
  if (host.includes('ashbyhq.com')) return 'ashby';
  if (host.includes('lever.co')) return 'lever';
  return null;
};

/** Profile fields keyed by canonical name -> candidate selectors, in priority order. */
JA.FIELD_MAP = {
  greenhouse: {
    firstName: ['#first_name', 'input[name="first_name"]', 'input[autocomplete="given-name"]'],
    lastName: ['#last_name', 'input[name="last_name"]', 'input[autocomplete="family-name"]'],
    email: ['#email', 'input[type="email"]', 'input[name="email"]'],
    phone: ['#phone', 'input[type="tel"]', 'input[name="phone"]'],
    resume: ['input[type="file"][name*="resume" i]', 'input[type="file"]'],
    linkedin: ['input[name*="linkedin" i]', 'input[id*="linkedin" i]'],
    github: ['input[name*="github" i]', 'input[id*="github" i]'],
    website: ['input[name*="website" i]', 'input[id*="website" i]'],
  },
  ashby: {
    firstName: ['input[name="_systemfield_name"]', 'input[id*="name" i]'],
    email: ['input[name="_systemfield_email"]', 'input[type="email"]'],
    phone: ['input[name="_systemfield_phone"]', 'input[type="tel"]'],
    resume: ['input[type="file"]'],
    linkedin: ['input[name*="linkedin" i]'],
    github: ['input[name*="github" i]'],
    website: ['input[name*="website" i]'],
  },
  lever: {
    firstName: ['input[name="name"]'],
    email: ['input[name="email"]', 'input[type="email"]'],
    phone: ['input[name="phone"]', 'input[type="tel"]'],
    resume: ['input[type="file"][name="resume"]', 'input[type="file"]'],
    linkedin: ['input[name*="linkedin" i]', 'input[name="urls[LinkedIn]"]'],
    github: ['input[name*="github" i]', 'input[name="urls[GitHub]"]'],
    website: ['input[name*="website" i]', 'input[name="urls[Portfolio]"]'],
  },
};

JA.findField = function findField(selectors) {
  for (const sel of selectors ?? []) {
    const el = document.querySelector(sel);
    if (el && !el.disabled && el.offsetParent !== null) return el;
  }
  return null;
};

/** Set a value the way a human would, so the page's own framework notices. */
JA.setValue = function setValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

/**
 * Collect every free-text question on the page with its textarea.
 * These are the fields that need the answer bank and the validator.
 */
JA.collectFreeText = function collectFreeText() {
  const out = [];
  for (const ta of document.querySelectorAll('textarea')) {
    if (ta.disabled || ta.offsetParent === null) continue;
    const label =
      ta.labels?.[0]?.innerText ||
      ta.closest('label')?.innerText ||
      ta.getAttribute('aria-label') ||
      ta.closest('[class*="field" i], [class*="question" i]')?.innerText ||
      ta.placeholder ||
      '';
    const required =
      ta.required ||
      ta.getAttribute('aria-required') === 'true' ||
      /\*/.test(label.slice(0, 200));
    out.push({ el: ta, question: label.replace(/\s+/g, ' ').trim(), required });
  }
  return out;
};

/**
 * Collect dropdowns on the page, with their real option sets.
 *
 * Only native <select> is handled. Greenhouse and Ashby increasingly render custom
 * combobox widgets, and a script that "fills" one of those by faking clicks can leave
 * the form looking answered while the underlying value is unset. Those are reported as
 * unfillable rather than attempted -- a visibly blank field beats a silently wrong
 * legal assertion.
 */
JA.collectSelects = function collectSelects() {
  const out = [];
  for (const sel of document.querySelectorAll('select')) {
    if (sel.disabled || sel.offsetParent === null) continue;
    const label =
      sel.labels?.[0]?.innerText ||
      sel.closest('label')?.innerText ||
      sel.getAttribute('aria-label') ||
      sel.closest('[class*="field" i], [class*="question" i]')?.innerText ||
      '';
    const options = [...sel.options]
      .filter((o) => o.value !== '' && !/^(please )?select/i.test(o.text))
      .map((o) => ({ label: o.text.replace(/\s+/g, ' ').trim(), value: o.value }));
    out.push({
      el: sel,
      label: label.replace(/\s+/g, ' ').trim(),
      required: sel.required || sel.getAttribute('aria-required') === 'true',
      options,
    });
  }
  return out;
};

/** Custom comboboxes we can see but refuse to fake. */
JA.collectUnfillableSelects = function collectUnfillableSelects() {
  const out = [];
  const nodes = document.querySelectorAll('[role="combobox"], [class*="select__control" i]');
  for (const n of nodes) {
    if (n.closest('select')) continue;
    const label =
      n.getAttribute('aria-label') ||
      n.closest('[class*="field" i], [class*="question" i]')?.innerText ||
      '';
    out.push({ label: label.replace(/\s+/g, ' ').trim().slice(0, 120) });
  }
  return out;
};

JA.setSelect = function setSelect(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value === String(value);
};

JA.findSubmit = function findSubmit() {
  const candidates = [
    'button[type="submit"]',
    'input[type="submit"]',
    '#submit_app',
    'button[data-testid*="submit" i]',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el && !el.disabled) return el;
  }
  return [...document.querySelectorAll('button')].find((b) =>
    /^(submit|submit application|apply)$/i.test(b.innerText.trim()),
  );
};
