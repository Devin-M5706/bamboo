/**
 * Find people worth contacting about a posting.
 *
 * Deliberate boundary: this module does NOT scrape LinkedIn.
 *
 * LinkedIn's User Agreement prohibits automated access, and enforcement is account
 * restriction -- the account you need most during a job hunt. So the split is:
 *
 *   engineers   fetched from GitHub's public API, which is documented, allowed, and
 *               returns exactly the people who write the code you'd work on
 *   recruiters  NOT fetched. We build the LinkedIn search URLs and you click them,
 *               logged in, as a human. One click, no automation, no risk.
 *
 * The outreach draft goes through the same validator as an application, because a
 * message that claims something you did not do is worse in a DM than on a form -- a
 * recruiter can ask you about it in the next message.
 */
import { validateAnswer } from './validator.core.js';

const GH = 'https://api.github.com';

async function gh(path) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'bamboo/0.2' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`${GH}${path}`, { headers });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: await res.json() };
}

/** Companies rarely name their GitHub org exactly like the job board does. */
export function orgCandidates(company) {
  const base = String(company).trim();
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hyphen = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [...new Set([slug, hyphen, `${slug}inc`, `${slug}hq`, `${slug}-eng`])].filter(Boolean);
}

/**
 * Public members of a company's GitHub org, enriched with their public profile.
 * Only returns what GitHub publishes; nothing here requires a login or a cookie.
 */
export async function findEngineers(company, { limit = 8 } = {}) {
  for (const org of orgCandidates(company)) {
    const members = await gh(`/orgs/${org}/public_members?per_page=${limit}`);
    if (!members.ok) continue;
    if (!Array.isArray(members.body) || !members.body.length) continue;

    const people = [];
    for (const m of members.body.slice(0, limit)) {
      const u = await gh(`/users/${m.login}`);
      if (!u.ok) continue;
      people.push({
        login: u.body.login,
        name: (u.body.name || u.body.login).replace(/\s+/g, ' ').trim(),
        // Bios contain newlines and break the column layout if passed through raw.
        bio: (u.body.bio || '').replace(/\s+/g, ' ').trim(),
        location: (u.body.location || '').replace(/\s+/g, ' ').trim(),
        blog: u.body.blog || '',
        url: u.body.html_url,
        repos: u.body.public_repos,
      });
    }
    return { ok: true, org, people };
  }
  return { ok: false, people: [], reason: `no public GitHub org found for "${company}"` };
}

/**
 * LinkedIn search URLs for YOU to click. We never fetch these.
 *
 * Keyword sets chosen because they are what these people actually put in their headline;
 * "hiring manager" is not a LinkedIn title, so searching for it finds nothing.
 */
export const LINKEDIN_ROLES = {
  recruiters: ['technical recruiter', 'university recruiter', 'talent acquisition', 'recruiting coordinator'],
  hiring_managers: ['engineering manager', 'director of engineering', 'head of engineering', 'VP engineering'],
  engineers: ['software engineer', 'backend engineer', 'infrastructure engineer', 'platform engineer'],
};

export function linkedinSearches(company, roles = Object.keys(LINKEDIN_ROLES)) {
  const out = [];
  for (const role of roles) {
    for (const kw of LINKEDIN_ROLES[role] ?? []) {
      const q = encodeURIComponent(`${kw} ${company}`);
      out.push({
        role,
        keyword: kw,
        url: `https://www.linkedin.com/search/results/people/?keywords=${q}`,
      });
    }
  }
  return out;
}

/**
 * Draft an outreach message from ledger facts, then validate it.
 *
 * Returns the refusal rather than a softened message when a claim cannot be traced.
 * Same rule as an application: if it is not in the ledger, you do not say it.
 */
export function draftOutreach({ contact, posting, factIds, facts, template }) {
  const name = String(contact?.name ?? '').split(' ')[0] || 'there';
  const role = posting?.title ?? 'the role';
  const company = posting?.company ?? posting?.board ?? 'your team';

  const body =
    template ??
    `Hi ${name} — I applied for ${role} at ${company}. ` +
      `${(factIds ?? []).map((id) => facts.find((f) => f.id === id)?.text ?? '').join(' ')} ` +
      `Happy to share more if it is useful.`;

  /**
   * The recipient's name, the company and the role are proper nouns, but they are not
   * claims ABOUT YOU -- they come from the posting and the contact. Feed them in as a
   * verified context fact rather than loosening the validator, so the rule that every
   * claim must trace to something verified stays exactly as strict as it was.
   */
  const context = {
    id: '__outreach_context',
    text: [contact?.name ?? '', name, role, company].filter(Boolean).join(' '),
    tags: [],
  };

  const answer = { text: body, derived_from: [...(factIds ?? []), context.id] };
  const check = validateAnswer(answer, [...(facts ?? []), context]);
  return { message: body, ...check };
}
