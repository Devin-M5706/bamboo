# bamboo

Applies to internships from a pre-validated evidence ledger, and refuses to write
anything it cannot trace back to a fact you verified.

## Why it works this way

Most tools in this category generate application text live, at submit time. That is the
one moment where a fabricated detail becomes permanent, in writing, under your name, at
an employer you may interview with six weeks later.

bamboo moves the writing earlier. You write your answers once, offline, and edit them
until each is true. The validator checks that every number and proper noun in each answer
appears in the ledger facts that answer declares it comes from. Apply time is then pure
retrieval: no model in the hot path, nothing generated, nothing unreviewed, and sub-second
fills.

(The design assumed ~20 recurring essay prompts. Measuring 32 real forms showed that is
wrong — see "What the survey overturned" below. The refusal design survived; the shape of
what you write changed.)

Two findings from the design session drive the rest:

**The aggregator repo is a company directory, not a job feed.**
`Summer2027-Internships` lags by days (a five-day gap and a six-week gap were both
observed) and its `date_posted` is ingestion time, not the employer's posting time. So we
mine it once for board tokens and poll the vendors directly. Greenhouse's `first_published`
is the true posting timestamp, which makes detection latency measurable instead of assumed.

**Postings arrive in bursts, not a stream.** 76 postings landed on 2026-07-24 and 52 on
2026-08-04, against 1-2 on a typical day. Whatever you build has to survive the burst day.

## Setup

Requires Node 22+. No dependencies.

```bash
npm run mine     # extract board tokens from the aggregator (65 boards, run occasionally)
npm run poll     # one cycle; the FIRST run is a cold start and queues nothing
npm run survey   # what do real forms actually ask? (run this before writing answers)
npm run check    # preflight: is the ledger valid? do the answers survive the validator?
```

The first `poll` records every currently-live posting as already-seen (8,291 of them) so
you do not wake up to a queue full of listings from 2024. Every poll after that surfaces
only genuinely new postings.

### Write your ledger

```bash
cp data/ledger.example.json data/ledger.json
cp data/answers.example.json data/answers.json
```

Then edit them. This is the part that cannot be automated, because the entire value of the
ledger is that a person checked each entry.

- One atomic claim per fact. Not a paragraph.
- Only things you can defend in an interview.
- Every number, tool name and proper noun you want to use in an answer must appear in a
  fact's `text` or `tags`. The validator can only trace what is there.

Run `npm run check` until nothing is refused. A refusal looks like:

```
REFUSED hardest_problem: answer contains claims not traceable to the ledger
  untraceable: Kubernetes, 90%
```

That means the answer claims something the ledger does not support. Fix it by adding the
fact (if true) or removing the claim (if not). Do not "fix" it by softening the wording.

### Install the extension

1. `npm run build:ext`
2. `chrome://extensions` → enable Developer mode → Load unpacked → select `extension/`
3. Open the extension's options page, paste in `data/ledger.json` and `data/answers.json`
4. Leave **Dry run** checked

Open any Greenhouse, Lever or Ashby application. The extension fills the form and stops.
Check the console (`[bamboo]`) to see what it filled and what it refused.

## Going live

Live mode submits real applications to real employers under your name. Before enabling it:

- `npm run check` passes with zero refusals
- You have watched it dry-run at least five real forms
- You have read every answer in the bank end to end, recently

Then uncheck Dry run on the options page. The options page refuses to enable live mode
with an empty ledger.

**Resume upload is always manual.** Browsers do not let scripts populate file inputs, and
that is a security boundary worth having.

## Commands

| Command | Does |
|---|---|
| `npm run init` | Setup wizard: boards, cadence, work authorization, graduation year |
| `npm run mine` | Extract board tokens from the aggregator repo |
| `npm run poll` | One poll cycle across all boards; queues new eligible postings |
| `npm run watch` | Poll on an interval until stopped |
| `npm run check` | Preflight the ledger, answer bank, queue, and detection latency |
| `npm run queue` | Show queued postings (`--all` includes handled) |
| `npm run feed` | The live-feed view of the queue |
| `npm run ledger` | The evidence ledger as a table |
| `npm run banner` | Startup banner |
| `npm run help` | Command list |
| `npm run survey` | Sample real Greenhouse forms; report which prompts actually recur |
| `npm test` | 79 tests, mostly on the validator and the UI layer |
| `npm run build:ext` | Regenerate the extension's copy of the validator |

## Layout

```
src/
  ui/               terminal screens (banner, feed, ledger, init wizard, help)
  config.js         eligibility rules, polling interval, DRY_RUN_DEFAULT
  miner.js          aggregator repo -> board tokens
  sources.js        Greenhouse / Lever / Ashby adapters, normalized to one Posting shape
  poll.js           poll cycle, seen-id diff, apply queue
  eligibility.js    citizenship / sponsorship / title / deadline gates
  ledger.js         load + validate the evidence ledger
  validator.core.js trace-or-refuse (NO IMPORTS -- shared with the extension)
  answers.js        answer bank retrieval
extension/          MV3 extension; content scripts fill and optionally submit
```

`src/validator.core.js` is the single source of truth for refusal logic. `npm run build:ext`
copies it into the extension; `test/extension-sync.test.js` fails if the copy goes stale.

## Coverage, honestly

The three polled vendors are ~30% of active listings in the aggregator (Ashby 13.4%,
Greenhouse 11.8%, Lever 5.1%). Workday is only 6.1%. The remaining 59% is a long tail of
43 bespoke hosts, concentrated in TikTok (34), Tesla (29), Jane Street (16) and Work at a
Startup (13) -- those four are the obvious next integrations, and each needs its own
form mapping.

## What the survey overturned

`npm run survey` samples real Greenhouse internship forms via the detail endpoint
(`?questions=true`), which returns the actual application questions. Run across 32
postings, it contradicted the design's central assumption about answers:

**There is no recurring set of ~20 essay prompts.** Almost every free-text question
appeared exactly once, and they are logistics, not essays: visa status, current location,
competing offer deadlines, alternate email, street address. Exactly one posting in 32
asked anything essay-shaped ("Are you especially proud of any GitHub repositories or
personal projects?").

What that means for your ledger: **structured facts matter more than prose.** Citizenship,
visa status, sponsorship needs, current city, graduation date, earliest start date, and
whether you can commit to a 6-month term will be asked far more often than "describe a
hard problem." Write those into `profile` and into facts before writing essays.

The refusal machinery still matters, and arguably more — a wrong visa status or start date
is a worse thing to auto-submit than a mediocre essay.

**The second finding was a live bug.** 4 of 32 sampled postings (12.5%) flipped from
eligible to ineligible once the description was fetched, all on US-citizenship gates. On
Rocket Lab specifically, all 6 sampled internships require citizenship and all 6 were
passing the filter. `poll` now enriches title-eligible Greenhouse postings with their
description before deciding, and queue items carry `eligibilityVerified` so an
un-enriched posting is never mistaken for a checked one.

## Known gaps

- No live-submit path has been exercised against a real form yet. The field selectors in
  `extension/content/common.js` are written from the public form markup and need a dry run
  on each vendor to confirm.
- Board payloads are 2-6 MB each and are fetched in full every cycle. Conditional requests
  would cut that a lot; a full cycle currently takes ~50s.
- Lever and Ashby have no equivalent of Greenhouse's questions endpoint, so the survey is
  Greenhouse-only and their forms remain unmeasured.
- Many application questions are `multi_value_single_select` (dropdowns), which the
  extension does not fill at all yet. Given the survey, these matter more than textareas.
- Whether applying fast actually improves callback rates is still unmeasured. `npm run check`
  reports median detection lag so you can eventually find out.
