# Configuration reference

Every setting bamboo reads, where it comes from, and what it does. Values shown are the
shipped defaults from `src/config.js`.

---

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `BAMBOO_HOME` | `~/.bamboo` | Where your data lives. Everything writable goes here. |
| `NO_COLOR` | unset | Any value disables colour everywhere. |
| `FORCE_COLOR` | unset | Any value forces colour on, even when piping. |
| `COLUMNS` | terminal width | Override the detected width. Required when piping, since `process.stdout.columns` is undefined there. |
| `GITHUB_TOKEN` | unset | Raises the GitHub API rate limit for `bamboo contacts`. |
| `BAMBOO_NAME` | `bamboo` | Rebrand the CLI name in output. The wordmark font covers A–Z. |
| `GOOGLE_CLIENT_ID` | unset | Required by `bamboo connect` / `track`. Your own OAuth client. |
| `GOOGLE_CLIENT_SECRET` | unset | Required by `bamboo connect` / `track`. |
| `ANTHROPIC_API_KEY` | unset | Optional. Enables the tracker's extraction agent. Unset, the agent never runs and unclassifiable mail is skipped rather than guessed at. |

---

## Paths

Two roots, and the distinction matters.

**Your data** — `BAMBOO_HOME`, default `~/.bamboo`:

| File | Contents | Regenerable? |
|---|---|---|
| `ledger.json` | Verified facts and typed profile | **No.** A person checked each entry. |
| `answers.json` | Your written answers | **No.** You wrote them. |
| `config.json` | What `init` collected | Yes, re-run `init`. |
| `state.json` | Seen posting IDs (dedup) | Yes, at the cost of a cold start. |
| `queue.json` | Pending applications | Yes, by polling again. |
| `boards.json` | Mined board tokens | Yes, `bamboo mine`. |
| `questions-survey.json` | Last survey results | Yes, `bamboo survey`. |
| `applications.json` | Tracked applications | Partly — only from mail still in the inbox. |
| `applications.csv` | Spreadsheet projection | Yes, from `applications.json`. |
| `google-token.json` | OAuth refresh token for the mailbox | Yes, `bamboo connect`. **Secret.** |
| `.env` | API keys, if you set any | No. |

**The package** — read-only at runtime, replaced on every update:

| File | Contents |
|---|---|
| `data/ledger.example.json` | Template `setup` seeds from |
| `data/answers.example.json` | Template `setup` seeds from |

This split exists because a global install puts the package under `node_modules`, which
npm wipes on reinstall. A ledger stored there would vanish on the first update.

---

## Polling

```js
export const POLL_INTERVAL_MS = 5 * 60 * 1000;  // watch loop interval
export const REQUEST_STAGGER_MS = 250;          // delay between board fetches
export const REQUEST_TIMEOUT_MS = 20_000;       // per-request abort
```

`REQUEST_STAGGER_MS` is politeness, not performance. Board payloads are 2–6 MB each and
these are free public APIs; hammering 65 of them without a gap is how you get rate-limited.

A full cycle takes about 50 seconds at these values.

---

## Submission

```js
export const DRY_RUN_DEFAULT = true;
```

Dry run means the extension fills a form and stops. Nothing is submitted.

This default is set in **three** places and CI asserts all three:

1. `src/config.js` — `DRY_RUN_DEFAULT`
2. `extension/content/apply.js` — the `settings` fallback
3. `src/ui/init.js` — the preselected answer on the submit question

Changing one without the others is caught by `npm test` and by the `invariant guards` CI
job. See [How to go live](howto-go-live.md).

---

## Eligibility

Hard filters applied before a posting can reach the applier. Edit `ELIGIBILITY` in
`src/config.js`.

```js
export const ELIGIBILITY = {
  usCitizen: false,
  needsSponsorship: false,
  titleAllow: [/intern/i, /co-?op/i, /new ?grad/i],
  titleDeny: [/manager/i, /senior/i, /staff/i, /principal/i, /director/i],
};
```

| Setting | Type | Default | Effect |
|---|---|---|---|
| `usCitizen` | boolean | `false` | When `false`, postings requiring US citizenship are dropped. **Set this to `true` if you are a citizen**, or you will silently lose eligible roles. |
| `needsSponsorship` | boolean | `false` | When `true`, postings that explicitly do not sponsor are dropped. |
| `titleAllow` | RegExp[] | intern / co-op / new grad | A posting whose title matches none of these is dropped. Empty array allows all. |
| `titleDeny` | RegExp[] | manager / senior / staff / principal / director | A posting matching any of these is always dropped, even if it also matches an allow pattern. |

Deny is checked before allow.

A posting is also dropped when `application_deadline` has already passed.

**Order of evaluation:**

```
deadline passed?  ──yes──> drop
      │ no
titleDeny match?  ──yes──> drop
      │ no
titleAllow match? ──no───> drop
      │ yes
citizenship gate? ──fail─> drop
      │ pass
sponsorship gate? ──fail─> drop
      │ pass
                   queue
```

### The description gap

Greenhouse's board **list** endpoint returns no description, so citizenship and sponsorship
requirements are invisible there. `poll` fetches the description for title-eligible
Greenhouse postings before deciding.

Measured across 32 sampled postings, **12.5% flip from eligible to ineligible** once the
description is read. On one board, all six sampled internships required citizenship and
all six were passing the title-only filter.

Queue items carry `eligibilityVerified`. When `false`, eligibility was decided on the title
alone — treat that posting as unchecked.

---

## Tracker

`TRACKER` in `src/config.js`. Governs `bamboo track`.

| Setting | Default | Effect |
|---|---|---|
| `trackedEmail` | unset | Read from `BAMBOO_TRACKED_EMAIL`. The address you apply with; receipts delivered anywhere else are ignored. Unset, `connect` and `track` refuse rather than guess a mailbox. |
| `dryRun` | `true` | Report the writes; make none. `--live` overrides for one run. |
| `lookbackDays` | `90` | How far back a cold start reads. Bounds a first sync. |
| `maxMessagesPerSync` | `200` | Ceiling on messages fetched per cycle. |
| `agent.enabled` | `true` | Whether the model sees mail the patterns could not classify. |
| `agent.model` | `claude-opus-5` | |
| `agent.effort` | `low` | This is classification, not reasoning. |
| `agent.minConfidence` | `medium` | Below this the row is written but flagged `needs-review`. |
| `sheets.spreadsheetId` | `null` | Set to write to an existing sheet. Left null, only the CSV is written. |
| `sheets.sheetName` | `Applications` | Tab name within the spreadsheet. |

`dryRun: true` is asserted by a test, for the same reason `DRY_RUN_DEFAULT` is: the first
run of anything that writes to a document you own should show you the writes first.

The agent is the only model call in this codebase and it is confined to this path. It reads
mail that has already been sent, and every field it returns must appear in the email text
or that field is discarded. See [Why it refuses](explanation-why-it-refuses.md).

---

## Dropdown resolution

14 rules map form dropdowns to typed profile fields. A field that is not set causes a
**refusal**, not a guess.

| Rule | Profile field | Strategy |
|---|---|---|
| `work_authorization` | `workAuthorization` | enum |
| `graduation_year` | `graduationYear` | exact |
| `graduation_month` | `graduationMonth` | exact |
| `degree_level` | `degreeLevel` | exact |
| `gpa_undergrad` | `gpaUndergraduate` | prefix |
| `gpa_graduate` | `gpaGraduate` | prefix |
| `sat` | `satScore` | prefix |
| `act` | `actScore` | prefix |
| `state` | `state` | exact |
| `country` | `country` | exact |
| `finra` | `finraRegistered` | boolean |
| `security_clearance` | `securityClearance` | boolean |
| `us_citizen` | `usCitizen` | boolean |
| `criminal_history` | `criminalHistory` | boolean |

**Strategies:**

| Strategy | Matching |
|---|---|
| `exact` | Normalized profile value must equal an option label exactly. |
| `prefix` | Option label must start with the value. `"3.7"` finds `"3.7 out of 4.0"`. |
| `boolean` | `true` picks an option starting `Yes`; `false` picks `No`. The profile value must be a real boolean, not the string `"no"`. |
| `enum` | Value selects a pattern set matched against option labels. Only `work_authorization` uses this. |

### workAuthorization values

Exactly four. Anything else refuses.

| Value | Means |
|---|---|
| `authorized_any` | Authorized to work for any employer, no restrictions |
| `authorized_current_employer_only` | Authorized, tied to your present employer |
| `requires_sponsorship` | You need visa sponsorship now or in the future |
| `not_authorized` | Not authorized to work in the US |

This is an enum rather than a boolean because collapsing `requires_sponsorship` into
`authorized_any` would put a **false legal statement** on a real application. It is asked
on 4 of every 32 forms sampled, always required.

### Company-specific questions

Questions like "How did you hear about us?" have no generic answer and always refuse. Supply
an explicit override in `answers.json` under `selectOverrides`, keyed by the normalized
question text. See [Data files](reference-data-files.md#selectoverrides).

---

## Related

- [CLI reference](reference-cli.md)
- [Data files reference](reference-data-files.md)
- [How to add a dropdown rule](howto-add-a-dropdown-rule.md)
