/**
 * Deterministic classification of an application receipt. No model, no network.
 *
 * This runs first and is meant to handle the bulk of the mail: ATS receipts are
 * template mail, and a template is a pattern. Only what falls through here reaches
 * tracker/agent.js, which costs money and whose output has to be checked for
 * invention before it can be believed.
 *
 * Two rules earned from what goes wrong when they are missing:
 *
 * 1. Rejection is checked before receipt. A rejection email routinely opens by
 *    thanking you for applying, so a naive first-match records a rejection as a
 *    brand-new application and the tracker quietly reports progress that is not
 *    happening.
 * 2. The sender's domain is never a fallback for the company name. Every
 *    Greenhouse-hosted posting arrives from greenhouse.io, so that fallback would
 *    file every application under "Greenhouse". A null company flagged for review
 *    is a true statement; a plausible wrong one is a corrupted record that looks
 *    fine forever.
 */

/**
 * @typedef {object} Extraction
 * @property {boolean} matched        false = not an application receipt at all
 * @property {string|null} company
 * @property {string|null} role
 * @property {string|null} location
 * @property {string|null} source
 * @property {string|null} jobUrl
 * @property {string}  status
 * @property {'high'|'medium'|'low'} confidence
 * @property {string[]} reviewReasons
 */

/**
 * Carried in `status` when `matched` is false. The field is meaningless there --
 * callers must read `matched` first -- but the shared contract types it as a
 * string, and emitting the machine's initial state keeps that type honest across
 * both producers without inventing a status that was never observed.
 */
const DEFAULT_STATUS = 'applied';

const VENDOR_DOMAINS = [
  ['greenhouse', /(^|\.)greenhouse\.io$/],
  ['lever', /(^|\.)(hire\.)?lever\.co$/],
  ['ashby', /(^|\.)ashbyhq\.com$/],
  ['workday', /(^|\.)(myworkday|workday)\.com$/],
];

// Phrase order is the whole design here. Rejection wins over everything because a
// rejection may contain any of the others' phrasings; receipt is last because its
// phrasings ("thank you for applying") appear in nearly every stage of the funnel.
const STATUS_PHRASES = [
  [
    'rejected',
    [
      'decided to move forward with other candidates',
      'move forward with other candidates',
      'moving forward with other candidates',
      'decided not to move forward',
      'will not be moving forward',
      'not be moving forward',
      'not moving forward',
      'we regret to inform',
      'regret to inform',
      'unfortunately',
      'no longer under consideration',
      'not selected',
      'pursue other candidates',
      'other applicants whose',
      'will not be proceeding',
    ],
  ],
  [
    'withdrawn',
    [
      'you have withdrawn',
      'your application has been withdrawn',
      'application was withdrawn',
      'withdrew your application',
    ],
  ],
  [
    'offer',
    [
      'pleased to offer',
      'happy to offer',
      'excited to offer',
      'we would like to offer',
      'offer of employment',
      'extend an offer',
      'your offer letter',
      'offer letter',
    ],
  ],
  [
    'screen',
    ['phone screen', 'recruiter screen', 'screening call', 'initial screen', 'intro call', 'introductory call'],
  ],
  [
    'interview',
    [
      'schedule an interview',
      'schedule your interview',
      'invite you to interview',
      'invite you to an interview',
      'like to interview',
      'interview invitation',
      'availability for an interview',
      'availability for a call',
      'onsite interview',
      'technical interview',
      'next round',
      'set up a time to talk',
      'move forward with an interview',
    ],
  ],
  [
    'applied',
    [
      'thank you for applying',
      'thanks for applying',
      'we received your application',
      'we have received your application',
      'received your application',
      'your application has been received',
      'application submitted',
      'successfully submitted',
      'successfully applied',
      'thank you for your interest',
      'thanks for your interest',
      'we appreciate your interest',
    ],
  ],
];

// Words that mark a subject fragment as a job title rather than a company. Used only
// to disambiguate the `{Company} - {Role}` subject template, where position alone
// cannot tell you which half is which.
const ROLE_WORDS =
  /\b(intern|interns|internship|co-?op|new\s?grad|engineer|engineering|developer|analyst|scientist|manager|designer|architect|consultant|associate|specialist|coordinator|technician|researcher|swe|sde|software|hardware|data|product|program|marketing|sales|finance|security|research|quality|support|operations)\b/i;

// Candidates that are grammar, not names. Cheap guard against a pattern that matched
// the sentence structure but captured a pronoun or a bare noun.
const NOT_A_NAME = new Set([
  'us',
  'you',
  'we',
  'it',
  'them',
  'me',
  'our team',
  'the team',
  'team',
  'company',
  'position',
  'role',
  'opening',
  'job',
  'application',
  'your application',
  'this',
  'that',
]);

// A captured value ends at punctuation or at a word that starts a new clause. Without
// the clause list, "your application to Acme has been received" captures the whole
// tail of the sentence as the company name.
const VALUE = String.raw`(.{2,60}?)(?=[\n!?.,;:|()\[\]"“”—–]|\s+(?:has|have|was|were|is|are|will|for|regarding|via|through|team|and\s+we|so\s+we|we|you)\b|$)`;

const COMPANY_PATTERNS = [
  new RegExp(String.raw`thank(?:s|\s+you)\s+for\s+applying\s+(?:to|at|with)\s+` + VALUE, 'i'),
  new RegExp(String.raw`thank(?:s|\s+you)\s+for\s+your\s+interest\s+in\s+` + VALUE, 'i'),
  new RegExp(String.raw`your\s+application\s+(?:to|with|at)\s+` + VALUE, 'i'),
  new RegExp(
    String.raw`we(?:'ve|\s+have)?\s+received\s+your\s+application\s+(?:to|at|with)\s+` + VALUE,
    'i',
  ),
  new RegExp(String.raw`application\s+(?:to|at)\s+` + VALUE + String.raw`\s+(?:has\s+been|was)\s+received`, 'i'),
  new RegExp(String.raw`(?:position|role|opening|internship|intern)\s+at\s+` + VALUE, 'i'),
  new RegExp(String.raw`\bat\s+` + VALUE + String.raw`\s+(?:has\s+been|was)\s+received`, 'i'),
];

// "applying to X" names the employer; "applying for X" names the job. That single
// preposition is the whole difference, so `to` is deliberately absent here -- with it,
// "Thank you for applying to Acme" files "Acme" as the role.
const ROLE_PATTERNS = [
  new RegExp(String.raw`\bthe\s+(.{2,80}?)\s+(?:position|role|opening|internship)\b`, 'i'),
  new RegExp(String.raw`\bapply(?:ing|ied)?\s+for\s+(?:the\s+)?(.{2,80}?)(?=\s+at\s|[\n!?.,;:|]|$)`, 'i'),
  new RegExp(String.raw`\bapplication\s+for\s+(?:the\s+)?(.{2,80}?)(?=\s+at\s|[\n!?.,;:|]|$)`, 'i'),
  new RegExp(String.raw`(?:^|\n)\s*(?:position|role|job\s*title)\s*[:\-]\s*(.{2,80}?)\s*(?=\n|$)`, 'i'),
];

const LOCATION_PATTERN = /(?:^|\n)\s*(?:location|office|based\s+in)\s*[:\-]\s*(.{2,60}?)\s*(?=\n|$)/i;

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;
const JOB_URL_HINT = /greenhouse\.io|lever\.co|ashbyhq\.com|workday\.com|\/jobs?\/|\/careers?\/|gh_jid=/i;

const subjectOf = (mail) => stripReplyPrefix(String(mail?.subject ?? ''));
const bodyOf = (mail) => String(mail?.body ?? '');

/**
 * The texts a template pattern is tried against, in order of trust: the subject, the
 * body as sent, then the body with its line wrapping removed.
 *
 * The unwrapped pass is not redundant. Mail wraps at ~75 columns, so "the Software
 * Engineer\nIntern position" is one phrase split across two lines, and a pattern built
 * with `.` never sees it. Raw body still goes first so the line-anchored templates
 * ("Position: ...") keep matching what they were written for.
 */
const searchTexts = (mail) => {
  const body = bodyOf(mail);
  return [subjectOf(mail), body, body.replace(/[ \t]*\n[ \t]*/g, ' ')];
};

function stripReplyPrefix(subject) {
  let s = subject;
  let previous;
  do {
    previous = s;
    s = s.replace(/^\s*(?:re|fw|fwd)\s*:\s*/i, '');
  } while (s !== previous);
  return s.trim();
}

function cleanValue(raw) {
  let v = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  // Trailing brackets are left alone: "Remote (US)" is a location, "Remote (US" is not.
  v = v.replace(/^[\s"'“”\-]+/, '').replace(/[\s"'“”.,;:!?\-]+$/, '');
  v = v.replace(/^the\s+/i, '').trim();
  if (v.length < 2 || v.length > 80) return null;
  if (!/\p{L}/u.test(v)) return null;
  if (NOT_A_NAME.has(v.toLowerCase())) return null;
  return v;
}

function firstMatch(patterns, texts) {
  for (const text of texts) {
    if (!text) continue;
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const value = cleanValue(m[1]);
      if (value) return value;
    }
  }
  return null;
}

/**
 * Split a `{Company} - {Role}` subject. Which half is which is decided by whether it
 * reads like a job title, not by position: real subjects arrive in both orders and
 * guessing by position files half the mail under the wrong name.
 * @returns {{company: string|null, role: string|null}}
 */
function splitDashedSubject(subject) {
  const parts = String(subject ?? '')
    .split(/\s*[—–|]\s*|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return { company: null, role: null };

  const [a, b] = parts;
  const aIsRole = ROLE_WORDS.test(a);
  const bIsRole = ROLE_WORDS.test(b);
  // Both or neither look like a title: we cannot tell, so we do not answer.
  if (aIsRole === bIsRole) return { company: null, role: null };

  const role = cleanValue(aIsRole ? a : b);
  const company = cleanValue(aIsRole ? b : a);
  if (!role || !company) return { company: null, role: null };
  return { company, role };
}

/**
 * Vendor behind a receipt, from the sender's domain.
 * @param {object} mail normalized MailMessage
 * @returns {'greenhouse'|'lever'|'ashby'|'workday'|'other'}
 */
export function detectSource(mail) {
  const raw = String(mail?.fromAddress || mail?.from || '').toLowerCase();
  const address = raw.includes('<') ? (raw.match(/<([^>]+)>/)?.[1] ?? raw) : raw;
  const at = address.lastIndexOf('@');
  const host = at === -1 ? '' : address.slice(at + 1).replace(/[>\s]+$/, '').trim();
  if (!host) return 'other';
  for (const [name, re] of VENDOR_DOMAINS) {
    if (re.test(host)) return name;
  }
  return 'other';
}

/**
 * Status implied by the subject and body phrasing.
 *
 * Returns null when nothing in the mail says an application exists -- that is a
 * refusal, not a default, and it is what makes `detect` able to report
 * `matched: false` instead of inventing an `applied`.
 *
 * @param {object} mail normalized MailMessage
 * @returns {'applied'|'screen'|'interview'|'offer'|'rejected'|'withdrawn'|null}
 */
export function detectStatus(mail) {
  const haystack = flatten(`${subjectOf(mail)} ${bodyOf(mail)}`);
  if (!haystack) return null;
  for (const [status, phrases] of STATUS_PHRASES) {
    for (const phrase of phrases) {
      if (haystack.includes(phrase)) return status;
    }
  }
  return null;
}

/**
 * Company name, from known ATS subject and body templates only.
 *
 * Returns null when no template matched. It deliberately has no sender-domain
 * fallback: see the file header.
 *
 * @param {object} mail normalized MailMessage
 * @returns {string|null}
 */
export function extractCompany(mail) {
  const fromPattern = firstMatch(COMPANY_PATTERNS, searchTexts(mail));
  if (fromPattern) return fromPattern;
  return splitDashedSubject(subjectOf(mail)).company;
}

/**
 * Role title, from known ATS subject and body templates only.
 * @param {object} mail normalized MailMessage
 * @returns {string|null}
 */
export function extractRole(mail) {
  const fromPattern = firstMatch(ROLE_PATTERNS, searchTexts(mail));
  if (fromPattern) return fromPattern;
  return splitDashedSubject(subjectOf(mail)).role;
}

/**
 * Posting URL, taken verbatim from a link in the body. Never constructed.
 * @param {object} mail normalized MailMessage
 * @returns {string|null}
 */
export function extractJobUrl(mail) {
  const found = String(bodyOf(mail)).match(URL_PATTERN) || [];
  for (const raw of found) {
    const url = raw.replace(/[).,;:!?\]]+$/, '');
    if (JOB_URL_HINT.test(url)) return url;
  }
  return null;
}

/**
 * Classify one message deterministically.
 * @param {object} mail normalized MailMessage
 * @returns {Extraction}
 */
export function detect(mail) {
  const source = detectSource(mail);
  const status = detectStatus(mail);

  if (!status) {
    return {
      matched: false,
      company: null,
      role: null,
      location: null,
      source,
      jobUrl: null,
      status: DEFAULT_STATUS,
      confidence: 'low',
      reviewReasons: ['no application phrasing found in subject or body'],
    };
  }

  const company = extractCompany(mail);
  const role = extractRole(mail);
  const location = cleanValue(bodyOf(mail).match(LOCATION_PATTERN)?.[1]);
  const jobUrl = extractJobUrl(mail);

  const reviewReasons = [];
  if (!company) reviewReasons.push('company not found in email text');
  if (!role) reviewReasons.push('role not found in email text');

  // `high` requires both names to have come from a matched template. One of the two
  // means the record is usable but not trustworthy enough to dedupe against.
  const confidence = company && role ? 'high' : company || role ? 'medium' : 'low';

  return {
    matched: true,
    company,
    role,
    location,
    source,
    jobUrl,
    status,
    confidence,
    reviewReasons,
  };
}

// Punctuation-insensitive phrase matching: HTML-stripped mail arrives with stray
// commas, non-breaking spaces and line wraps inside the very sentences we match on.
function flatten(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
