# How to write your evidence ledger

You will end up with 15–25 verified facts that bamboo is allowed to claim about you, and a
`bamboo check` that passes.

This is the one part nothing can automate. The entire value of the ledger is that a person
checked each entry.

## Prerequisites

- bamboo installed and `bamboo setup` run once
- 45–90 minutes, and your resume open for reference

Confirm where your files are:

```bash
bamboo where
```

## Steps

### 1. See what forms actually ask, before you write anything

```bash
bamboo survey
```

Takes about 2 minutes. It samples real Greenhouse forms and reports which questions recur.

Do this first. It is what revealed that essays are rare and dropdowns are common — writing
five polished essays before checking is how people waste an evening.

### 2. Fill in the structured profile fields

Open `~/.bamboo/ledger.json` and complete `profile`. These answer dropdowns, which are the
most-asked questions on real forms.

```json
"profile": {
  "name": "Your Name",
  "email": "you@example.com",
  "phone": "+1 555 0100",
  "school": "Your University",
  "workAuthorization": "authorized_any",
  "usCitizen": true,
  "graduationYear": "2028",
  "degreeLevel": "Bachelor's Degree",
  "gpaUndergraduate": "3.7",
  "state": "PA",
  "country": "United States",
  "finraRegistered": false,
  "securityClearance": false,
  "criminalHistory": false
}
```

`workAuthorization` takes exactly one of four values:

| Value | Means |
|---|---|
| `authorized_any` | Any employer, no restrictions |
| `authorized_current_employer_only` | Tied to your present employer |
| `requires_sponsorship` | You need sponsorship now or later |
| `not_authorized` | Not authorized to work in the US |

Booleans must be real JSON booleans. `"no"` is refused, not coerced — these are legal
questions.

Leave a field out and every form asking it gets refused. That is correct behaviour, and
`bamboo check` will tell you which ones.

### 3. Write your facts

Replace the example `facts` with true things about you.

```json
{
  "id": "proj-scheduler",
  "text": "I built a scheduling tool in React that cut our club's planning time by 40%.",
  "tags": ["React", "scheduling", "40%"],
  "verified": true
}
```

Four rules:

- **One atomic claim per fact.** Not a paragraph. "I built X" and "X did Y" are two facts.
- **Only what you can defend in an interview** six weeks from now.
- **Put every number and proper noun in `text` or `tags`.** The validator can only trace
  what is written down.
- **Delete anything you are unsure about.** A missing fact costs a sentence. A wrong one
  costs the interview.

Aim for 15–25. Cover: projects with outcomes, technologies you can actually discuss,
coursework that produced something, and any measurable result.

### 4. Write answers for the questions that recur

Open `~/.bamboo/answers.json`. Use the survey output from step 1 to decide which to write.

```json
"hardest_problem": {
  "match": ["(hardest|most difficult) (technical )?(problem|project)"],
  "text": "I built a scheduling tool in React that cut our club's planning time by 40%.",
  "derived_from": ["proj-scheduler"],
  "maxLength": 2000
}
```

`derived_from` is the mechanism. Every number and proper noun in `text` must appear in the
`text` or `tags` of a fact listed there.

### 5. Run check until it stops refusing

```bash
bamboo check
```

```
REFUSED hardest_problem: answer contains claims not traceable to the ledger
  untraceable: Kubernetes, 90%
```

Read that as: your answer claims Kubernetes and 90%, and no referenced fact supports either.

Two legitimate fixes:

- **The claim is true** → add it to a fact's `text` or `tags`
- **The claim is not supported** → remove it from the answer

There is no third fix. Do not soften the wording to slip past the check — the check is the
product.

### 6. Repeat until ready

```bash
bamboo check
```

```
LEDGER   18 facts, valid
ANSWERS  12 entries, 0 refused
DROPDOWN 14/14 profile fields set
SUBMIT   DRY RUN (nothing will be submitted)

Ready.
```

## Verification

`bamboo check` exits `0`. Confirm with:

```bash
bamboo check && echo "READY"
```

Then view your ledger as a table:

```bash
bamboo ledger
```

Every row should show a mint `✓` source. Orange rows still need one.

## Troubleshooting

**`REFUSED <key>: answer declares no derived_from facts`**
The entry has an empty `derived_from`. Every answer must name at least one fact.

**`derived_from references unknown fact(s): proj-x`**
Typo in a fact ID, or you renamed a fact and did not update the answer.

**A claim is refused even though the fact exists**
You referenced the wrong fact. Traceability is per-answer: the fact must be in *that*
answer's `derived_from`, not merely present in the ledger.

**`profile.finraRegistered must be true or false`**
You wrote `"no"` instead of `false`. Booleans are real booleans here.

**`facts[2] ("coursework-ds"): marked verified:false`**
An example entry is still marked unverified. Replace it with something true and set
`verified: true`, or delete it.

**`ledger.json exists but is not valid JSON`**
A trailing comma or missing quote. bamboo **refuses to write over a file it could not
read**, so your facts are intact — fix the syntax and re-run. `ledger.json.bak` holds the
last good version.

## Related

- [Data files reference](reference-data-files.md) — the full schema
- [Why it refuses](explanation-why-it-refuses.md) — why this is worth the hour
- [How to go live](howto-go-live.md) — next step
