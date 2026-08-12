/* GENERATED FILE -- do not edit.
 * Source: src/selects.js
 * Regenerate: npm run build:ext
 * The CLI and the extension must share one copy, or only one of them refuses.
 */
/**
 * Dropdown resolution. THIS FILE MUST HAVE NO IMPORTS (shared with the extension).
 *
 * Surveying 32 real internship forms, the recurring dropdowns are almost all factual
 * claims about you: work authorization (4/32, always required), expected graduation year,
 * highest degree, state, GPA, FINRA registration, security clearance. Getting one of
 * these wrong and auto-submitting it is worse than a mediocre essay -- "I am authorized
 * to work in the United States for any employer" is a legal assertion.
 *
 * So the rule is the same as the text validator: resolve from a declared profile fact, or
 * REFUSE. Never default, never pick the first option, never guess a plausible-looking one.
 *
 * Company-specific questions ("How did you hear about CTC?") have no generic answer and
 * always refuse unless you supply an explicit override in answers.json.
 */

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Work authorization is an enum rather than a boolean because the real option sets
 * distinguish "any employer" from "present employer only" from "requires sponsorship",
 * and collapsing those would put a false legal statement on an application.
 */
const WORK_AUTH_PATTERNS = {
  authorized_any: [/authorized to work .* for any employer/, /eligible to work .* no restrictions/, /^yes$/],
  authorized_current_employer_only: [/for my (present|current) employer only/],
  requires_sponsorship: [/require .*sponsorship/, /will require visa sponsorship/],
  not_authorized: [/^i am not authorized/, /^no$/],
};

/**
 * Rules are ordered; the first whose `match` hits the question label wins.
 * `from` names the ledger profile field the answer must come from.
 */
const RULES = [
  {
    id: 'work_authorization',
    match: /legally authorized to work|work authoriz|eligible to work in the (united states|us)\b|require .*sponsorship/i,
    from: 'workAuthorization',
    strategy: 'enum',
    patterns: WORK_AUTH_PATTERNS,
  },
  { id: 'graduation_year', match: /expected graduation year|graduation year/i, from: 'graduationYear', strategy: 'exact' },
  { id: 'graduation_month', match: /expected graduation month|graduation month/i, from: 'graduationMonth', strategy: 'exact' },
  { id: 'degree_level', match: /highest degree|degree level.*pursuing|current degree/i, from: 'degreeLevel', strategy: 'exact' },
  { id: 'gpa_undergrad', match: /gpa \(?undergrad/i, from: 'gpaUndergraduate', strategy: 'prefix' },
  { id: 'gpa_graduate', match: /gpa \(?grad/i, from: 'gpaGraduate', strategy: 'prefix' },
  { id: 'sat', match: /^sat score/i, from: 'satScore', strategy: 'prefix' },
  { id: 'act', match: /^act score/i, from: 'actScore', strategy: 'prefix' },
  { id: 'state', match: /^state\b/i, from: 'state', strategy: 'exact' },
  { id: 'country', match: /^country\b/i, from: 'country', strategy: 'exact' },
  { id: 'finra', match: /registered with finra|finra registration/i, from: 'finraRegistered', strategy: 'boolean' },
  { id: 'security_clearance', match: /security clearance|security licen[cs]e/i, from: 'securityClearance', strategy: 'boolean' },
  { id: 'us_citizen', match: /are you a (u\.?s\.?|united states) citizen/i, from: 'usCitizen', strategy: 'boolean' },
  { id: 'criminal_history', match: /convicted|indicted|criminal (history|record)/i, from: 'criminalHistory', strategy: 'boolean' },
];

const findOption = (options, predicate) => {
  const hits = (options ?? []).filter(predicate);
  return hits.length === 1 ? hits[0] : null;
};

/**
 * @param {{label: string, required?: boolean, options?: {label: string, value: any}[]}} question
 * @param {object} profile   ledger.profile
 * @param {object} overrides answers.json selectOverrides, keyed by normalized label
 * @returns {{ok: true, option: object, rule: string} | {ok: false, refused: true, reason: string}}
 */
function resolveSelect(question, profile = {}, overrides = {}) {
  const label = String(question?.label ?? '').trim();
  const options = question?.options ?? [];

  if (!label) return { ok: false, refused: true, reason: 'question has no label' };
  if (!options.length) return { ok: false, refused: true, reason: 'question has no options' };

  // An explicit override always wins -- you told us what to pick for this exact question.
  const key = norm(label);
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    const wanted = norm(overrides[key]);
    const opt = findOption(options, (o) => norm(o.label) === wanted);
    if (!opt) {
      return {
        ok: false,
        refused: true,
        reason: `override "${overrides[key]}" matches no option on this form`,
      };
    }
    return { ok: true, option: opt, rule: 'override' };
  }

  const rule = RULES.find((r) => r.match.test(label));
  if (!rule) {
    return {
      ok: false,
      refused: true,
      reason: 'no rule for this question; add a selectOverrides entry if you want it answered',
    };
  }

  const value = profile?.[rule.from];
  if (value === undefined || value === null || value === '') {
    return { ok: false, refused: true, reason: `profile.${rule.from} is not set` };
  }

  let opt = null;
  switch (rule.strategy) {
    case 'boolean': {
      if (typeof value !== 'boolean') {
        return { ok: false, refused: true, reason: `profile.${rule.from} must be true or false` };
      }
      const want = value ? /^yes\b/ : /^no\b/;
      opt = findOption(options, (o) => want.test(norm(o.label)));
      break;
    }
    case 'enum': {
      const patterns = rule.patterns?.[value];
      if (!patterns) {
        return {
          ok: false,
          refused: true,
          reason: `profile.${rule.from} value "${value}" is not one of: ${Object.keys(rule.patterns ?? {}).join(', ')}`,
        };
      }
      opt = findOption(options, (o) => patterns.some((p) => p.test(norm(o.label))));
      break;
    }
    case 'exact': {
      const want = norm(value);
      opt = findOption(options, (o) => norm(o.label) === want);
      break;
    }
    case 'prefix': {
      const want = norm(value);
      opt = findOption(options, (o) => norm(o.label).startsWith(want));
      break;
    }
    default:
      return { ok: false, refused: true, reason: `unknown strategy ${rule.strategy}` };
  }

  if (!opt) {
    return {
      ok: false,
      refused: true,
      reason: `profile.${rule.from} = "${value}" matched no single option (rule ${rule.id})`,
    };
  }
  return { ok: true, option: opt, rule: rule.id };
}

/** Resolve a whole form's selects. Used by `check` and by the extension. */
function resolveAllSelects(questions, profile, overrides) {
  const filled = [];
  const refusals = [];
  for (const q of questions ?? []) {
    const r = resolveSelect(q, profile, overrides);
    if (r.ok) filled.push({ label: q.label, chose: r.option.label, rule: r.rule, name: q.name });
    else refusals.push({ label: q.label, required: Boolean(q.required), reason: r.reason });
  }
  return { filled, refusals, blocking: refusals.filter((r) => r.required) };
}

;(function (g) {
  g.__jobapplr = g.__jobapplr || {};
  g.__jobapplr.selects = { RULES, resolveSelect, resolveAllSelects };
})(typeof globalThis !== 'undefined' ? globalThis : window);
