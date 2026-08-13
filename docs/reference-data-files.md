# Data files reference

Schemas for the two files you write by hand, and the four bamboo maintains. All live in
`~/.bamboo` (or `BAMBOO_HOME`).

---

## ledger.json

The evidence ledger. **The only file here that cannot be regenerated**, because its value
is that a person verified each entry.

```json
{
  "profile": { "...": "typed fields, see below" },
  "facts": [
    {
      "id": "proj-bamboo",
      "text": "I built bamboo, a Node tool that polls three ATS APIs across 65 boards.",
      "tags": ["Node", "bamboo", "65"],
      "verified": true
    }
  ]
}
```

### facts[]

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable slug. Answers reference it in `derived_from`. Must be unique. |
| `text` | string | yes | One atomic claim, in your words, literally true. |
| `tags` | string[] | no | Extra strings that count as supported when they appear in an answer. |
| `verified` | boolean | no | `false` makes `bamboo check` fail. Omitted means verified. |

**The `tags` field is how you make the validator accept variations.** The validator can
only trace what is written down. If a fact says "three ATS APIs" but your answer says
"Greenhouse", add `Greenhouse` to `tags` or the answer is refused.

Rules that make this work:

- One atomic claim per fact. Not a paragraph, not a story.
- Only things you can defend in an interview six weeks from now.
- Every number, tool name, and proper noun you intend to use must appear in some fact's
  `text` or `tags`.
- Delete anything you are unsure about. A missing fact costs you a sentence; a wrong fact
  costs you the interview.

### profile

Answers dropdowns and mechanical form fields. An unset field means that question gets
refused on every form that asks it.

**Identity:**

| Field | Type | Used for |
|---|---|---|
| `name` | string | First/last name fields |
| `email` | string | Email |
| `phone` | string | Phone |
| `school` | string | Institution |
| `linkedin`, `github`, `website` | string | Profile URL fields |
| `resumePath` | string | Reference only — browsers forbid scripted file upload |

**Dropdown fields** — see [Configuration](reference-configuration.md#dropdown-resolution)
for how each is matched:

| Field | Type | Example |
|---|---|---|
| `workAuthorization` | enum | `"authorized_any"` |
| `usCitizen` | boolean | `true` |
| `graduationYear` | string | `"2028"` |
| `graduationMonth` | string | `"May"` |
| `degreeLevel` | string | `"Bachelor's Degree"` |
| `gpaUndergraduate` | string | `"3.7"` |
| `gpaGraduate` | string | `"3.9"` |
| `satScore` | string | `"1500"` |
| `actScore` | string | `"34"` |
| `state` | string | `"PA"` |
| `country` | string | `"United States"` |
| `finraRegistered` | boolean | `false` |
| `securityClearance` | boolean | `false` |
| `criminalHistory` | boolean | `false` |

Booleans must be real JSON booleans. The string `"no"` is refused, not coerced — a legal
question deserves an unambiguous answer.

### Safety

`bamboo init` writes this file through an atomic update that **refuses when the existing
file is present but unparseable**. A hand-edit typo surfaces as an error instead of
replacing your facts with `{}`. The previous good contents are kept at `ledger.json.bak`.

---

## answers.json

Pre-written, pre-validated responses. Written offline, validated ahead of time, retrieved
at apply time with no model in the loop.

```json
{
  "answers": {
    "hardest_problem": {
      "match": [
        "(hardest|most (difficult|challenging)) (technical )?(problem|project)",
        "tell us about a time you (solved|debugged|overcame)"
      ],
      "text": "I built bamboo, a Node tool that polls three ATS APIs across 65 boards.",
      "derived_from": ["proj-bamboo"],
      "maxLength": 2000
    }
  },
  "selectOverrides": {
    "how did you hear about us": "Campus Career Center"
  }
}
```

### answers[key]

| Field | Type | Required | Meaning |
|---|---|---|---|
| `match` | string[] | yes | Regex sources tested case-insensitively against the form's question text. |
| `text` | string | yes | The answer, in your words. |
| `derived_from` | string[] | yes | Ledger fact IDs whose content supports every claim in `text`. |
| `maxLength` | number | no | Answer is refused if longer, rather than truncated mid-sentence. |

**Matching:** the longest match wins, so a specific pattern beats a generic one regardless
of declaration order. `"why do you want to work at"` outranks a bare `"why"`. A question
matching nothing is a refusal — bamboo does not fill a field with the closest-looking
answer.

An invalid regex is skipped rather than crashing the pass.

### derived_from is the whole mechanism

Every number and proper noun in `text` must appear in the `text` or `tags` of a fact listed
in `derived_from`. Referencing the *wrong* fact fails even when the right fact exists
elsewhere in the ledger.

```
REFUSED hardest_problem: answer contains claims not traceable to the ledger
  untraceable: Kubernetes, 90%
```

Fix it by adding the fact (if true) or removing the claim (if not). Do not fix it by
softening the wording.

An answer with an empty `derived_from` is always refused.

### selectOverrides

Explicit answers for company-specific dropdowns that have no generic rule. Keys are the
question text, lowercased with punctuation stripped and whitespace collapsed.

```json
"selectOverrides": {
  "how did you hear about us": "Campus Career Center",
  "what is your preferred start date": "June 2027"
}
```

The value must match one of the form's actual option labels exactly, or it refuses. An
override that matches nothing is a refusal, not a fallback.

---

## Files bamboo maintains

Do not hand-edit these; they are regenerated.

### boards.json

```json
{
  "minedAt": "2026-08-12T18:00:00.000Z",
  "source": "https://raw.githubusercontent.com/.../listings.json",
  "count": 65,
  "boards": [{ "vendor": "greenhouse", "board": "spacex", "company": "SpaceX", "listings": 4 }]
}
```

Boards you add by hand **are** preserved across `bamboo mine` runs.

### state.json

```json
{ "seen": { "greenhouse:spacex:123456": 1786500000000 }, "lastPoll": 1786500000000, "cycles": 3 }
```

Keys are `vendor:board:id`; values are first-seen timestamps. Currently grows without
bound — around 8,400 entries after the first cold start.

Deleting it causes the next poll to cold-start: it re-records everything and queues
nothing. You lose dedup history but are not flooded.

### queue.json

```json
{
  "items": [{
    "vendor": "greenhouse",
    "board": "virtu",
    "title": "2027 Internship",
    "location": "Dublin, Ireland",
    "url": "https://...",
    "publishedAt": 1786500000000,
    "detectionLagMs": 42000,
    "eligibilityVerified": true,
    "status": "pending"
  }]
}
```

| Field | Meaning |
|---|---|
| `detectionLagMs` | Time between the employer's `first_published` and when bamboo saw it. `null` when the vendor gives no true timestamp. |
| `eligibilityVerified` | `false` means eligibility was decided on the title alone. Treat as unchecked. |
| `status` | `pending`, `drafted`, `skipped`, `expired` |

### config.json

```json
{ "boards": ["greenhouse", "ashby", "lever"], "intervalMinutes": 5, "forReal": false, "savedAt": "..." }
```

Written by `bamboo init`.

---

## What is never committed

`ledger.json`, `answers.json` and `config.json` hold real personal data: work
authorization, employment history, application answers. They are gitignored, and CI fails
if any becomes tracked.

Never paste their contents into an issue, a PR, or a commit message.

---

## Related

- [How to write your ledger](howto-write-your-ledger.md) — the guided version
- [Configuration reference](reference-configuration.md) — dropdown rules and eligibility
- [Why it refuses](explanation-why-it-refuses.md) — the reasoning
