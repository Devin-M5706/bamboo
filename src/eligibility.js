import { ELIGIBILITY } from './config.js';

/**
 * Hard filter applied before anything reaches the applier.
 *
 * 19% of active listings in the aggregator carry citizenship or sponsorship gates.
 * Applying to a role you are categorically ineligible for wastes the application and
 * puts your name on it. Cheaper to drop it here.
 */

const CITIZEN_RE =
  /\b(u\.?s\.?\s*citizen(ship)?|must be a (?:u\.?s\.?|united states) citizen|security clearance|are you a us citizen)\b/i;

const NO_SPONSOR_RE =
  /\b(will not sponsor|unable to sponsor|no(?:t)? (?:able to )?(?:provide|offer) (?:visa )?sponsorship|without (?:the need for )?sponsorship|not eligible for sponsorship)\b/i;

/**
 * @param {{title?: string, description?: string, deadline?: number|null}} posting
 * @param {object} rules
 * @returns {{eligible: boolean, reason?: string}}
 */
export function checkEligibility(posting, rules = ELIGIBILITY) {
  const title = posting?.title ?? '';
  const haystack = `${title}\n${posting?.description ?? ''}`;

  if (posting?.deadline && posting.deadline < Date.now()) {
    return { eligible: false, reason: 'application deadline has passed' };
  }

  const deny = rules.titleDeny ?? [];
  if (deny.some((re) => re.test(title))) {
    return { eligible: false, reason: 'title matched a deny pattern' };
  }

  const allow = rules.titleAllow ?? [];
  if (allow.length && !allow.some((re) => re.test(title))) {
    return { eligible: false, reason: 'title matched no allow pattern' };
  }

  if (!rules.usCitizen && CITIZEN_RE.test(haystack)) {
    return { eligible: false, reason: 'role requires US citizenship' };
  }

  if (rules.needsSponsorship && NO_SPONSOR_RE.test(haystack)) {
    return { eligible: false, reason: 'employer does not sponsor and you need sponsorship' };
  }

  return { eligible: true };
}

export function partitionByEligibility(postings, rules = ELIGIBILITY) {
  const eligible = [];
  const dropped = [];
  for (const p of postings) {
    const r = checkEligibility(p, rules);
    if (r.eligible) eligible.push(p);
    else dropped.push({ ...p, dropReason: r.reason });
  }
  return { eligible, dropped };
}
