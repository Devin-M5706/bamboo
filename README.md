# bamboo
Watches job boards and fills internship applications from a verified evidence ledger.
Refuses to write anything it cannot trace back to a fact you checked.
<img width="1273" height="547" alt="Screenshot 2026-08-12 171004" src="https://github.com/user-attachments/assets/def9b064-b506-4f0d-87ec-de14c5eeaaec" />


## Why it works this way

Most tools in this category generate application text live, at submit time. That is the one
moment where a fabricated detail becomes permanent — in writing, under your name, at an
employer you may interview with six weeks later.

bamboo moves the writing earlier. You write your answers once, offline, and edit them until
each is true. The validator then checks that every number and proper noun in an answer
appears in the ledger facts that answer names. Apply time is pure retrieval: no model in the
hot path, nothing generated, nothing unreviewed.

The same rule covers dropdowns, which turn out to matter more. "I am authorized to work in
the United States for any employer" is a legal assertion, not a preference. It resolves from
a declared profile field or it refuses.

## How it works

**Ingestion — the aggregator is a directory, not a feed**

![Ingestion pipeline](diagrams/bamboo-ingestion.svg)

Mine the aggregator once for board tokens, then poll the vendors directly. Greenhouse's
`first_published` is the true posting time the aggregator does not have. The cold start
records what already exists and queues nothing, so a first run does not flood you with
8,000 stale postings.

**The refusal gate — the part that makes this different**

![Refusal gate](diagrams/bamboo-refusal-gate.svg)

Five paths lead to REFUSE and one leads to a filled field. Free text must trace to a
verified fact, dropdowns must resolve from a declared profile field, custom widgets are
reported rather than faked, and file uploads are always manual. Submitting requires an
explicit opt-in; dry run is the default.

Sources are in `diagrams/*.mmd`, editable scenes in `diagrams/*.excalidraw`.

## What it looks like

The evidence ledger. Mint means a person verified it; orange means it will be refused
until you add a source.

![bamboo ledger](docs/ui/ledger.png)

`check` is the honest one. It tells you exactly what is blocking you, and exits non-zero
until nothing is.

![bamboo check](docs/ui/check.png)

This is what it says before you have written anything — every dropdown unset, so every
form asking one would be refused. Working down this list is the whole setup process.

![bamboo check on a first run](docs/ui/first-run.png)

![bamboo help](docs/ui/help.png)

These are generated, not screenshotted: `npm run capture:ui` re-renders every screen from
real command output and `npm run render:ui` rasterises it, so they cannot drift from what
the CLI actually prints. Rendering needs a Chrome, Chromium or Edge on the machine (set
`CHROME_PATH` if it is somewhere unusual); nothing is installed for it.

## Documentation

Full docs live in [`docs/`](docs/), organised by what you are trying to do.

| | |
|---|---|
| **New here?** | [Getting started](docs/tutorial-getting-started.md) — install to real postings in 15 min |
| **Ready to set up?** | [Write your evidence ledger](docs/howto-write-your-ledger.md) — the gating step |
| **Looking something up?** | [CLI](docs/reference-cli.md) · [Configuration](docs/reference-configuration.md) · [Data files](docs/reference-data-files.md) |
| **Wondering why?** | [Why it refuses](docs/explanation-why-it-refuses.md) · [Architecture](docs/explanation-architecture.md) · [Boundaries](docs/explanation-boundaries.md) |

## Install

Any machine with Node 22+ and access to this repo:

```bash
npm install -g github:Devin-M5706/bamboo
bamboo setup     # creates ~/.bamboo and seeds it from the bundled templates
bamboo init      # asks the questions real forms actually ask
```

`bamboo` then works from any terminal, any directory. To update, run the install again.

**Your data never lives inside the package.** Ledger, answers, config and runtime state all
live in `~/.bamboo` (override with `BAMBOO_HOME`). A global install puts the code under
`node_modules`, which npm wipes on every reinstall — a ledger stored there would vanish the
first time you upgraded. `bamboo where` prints every path.

For development, clone and `npm link` instead; edits then take effect immediately.

## Getting to your first application

```bash
bamboo setup     # once per machine
bamboo init      # boards, cadence, work authorization, graduation year
bamboo mine      # aggregator repo -> 65 board tokens
bamboo poll      # first run is a cold start: records what exists, queues nothing
bamboo survey    # what do real forms ask? run this BEFORE writing answers
bamboo check     # what is still blocking you
```

The first `poll` records every currently-live posting as already-seen (8,291 of them) so you
do not wake up to a queue full of listings from 2024. Every poll after that surfaces only
genuinely new postings.

### Write your ledger

`bamboo setup` puts starter files in `~/.bamboo`. Edit them:

```bash
bamboo where                      # shows the exact paths
# then open ~/.bamboo/ledger.json and ~/.bamboo/answers.json
```

This is the part that cannot be automated, because the entire value of the ledger is that a
person checked each entry.

- One atomic claim per fact. Not a paragraph.
- Only things you can defend in an interview.
- Every number, tool name and proper noun you want to use in an answer must appear in a
  fact's `text` or `tags`. The validator can only trace what is there.

Run `bamboo check` until nothing is refused. A refusal looks like:

```
REFUSED hardest_problem: answer contains claims not traceable to the ledger
  untraceable: Kubernetes, 90%
```

The answer claims something the ledger does not support. Fix it by adding the fact (if true)
or removing the claim (if not). Do not "fix" it by softening the wording.

### Install the extension

1. `npm run build:ext` (from a clone)
2. `chrome://extensions` → Developer mode → Load unpacked → select `extension/`
3. On the options page, paste in the contents of `~/.bamboo/ledger.json` and
   `~/.bamboo/answers.json`
4. Leave **Dry run** checked

Open any Greenhouse, Lever or Ashby application. The extension fills the form and stops.
The console (`[bamboo]`) shows what it filled and what it refused.

## Going live

Live mode submits real applications to real employers under your name. Before enabling it:

- `bamboo check` passes with zero refusals
- You have watched it dry-run at least five real forms
- You have read every answer in the bank end to end, recently

Then uncheck Dry run on the options page. It refuses to enable live mode with an empty ledger.

**Resume upload is always manual.** Browsers do not let scripts populate file inputs, and
that is a security boundary worth having.

## Tracking what you applied to

Applying is half the problem. The other half is remembering, six weeks later, which company
that recruiter is from. `bamboo track` keeps a spreadsheet of every application, updated
from your inbox.

```bash
export BAMBOO_TRACKED_EMAIL=you@example.com   # the address you apply with
bamboo connect     # one-time Google authorisation for that mailbox
bamboo track       # dry run: shows what it would record, writes nothing
bamboo track --live
bamboo applications   # the table, in the terminal
```

**The trigger is the confirmation email, not the applier.** Every employer sends a "we
received your application" receipt to the address you applied with. That receipt is the
only signal that exists for *every* application — including the ones you submitted by hand,
which is most of them. Watching the extension would track a fraction of reality; watching
the inbox tracks all of it. The tracked address comes from `BAMBOO_TRACKED_EMAIL`; unset,
`connect` and `track` refuse rather than guess which mailbox is yours.

```
Gmail (you@example.com)
  │  google/gmail.js        receipts since the last watermark
  ▼
tracker/detect.js           deterministic: ATS sender domains + subject templates
  │                         handles the recurring cases at zero cost
  ▼  (only what it could not classify)
tracker/agent.js            Claude reads the residue, then must ground every field
  │                         it returns in the email text or that field becomes null
  ▼
tracker/applications.js     dedupe, forward-only status, ~/.bamboo/applications.json
  │
  ├──▶ tracker/csv.js       ~/.bamboo/applications.csv     (always, no auth needed)
  └──▶ google/sheets.js     your Google Sheet               (when configured)
```

### Where the AI agent is, and where it is not

The agent runs in the tracker, never in the apply path. It reads mail that has *already*
been sent and writes to a spreadsheet. It cannot influence what gets submitted to an
employer, and a CI guard greps the apply path to keep it that way — the moment
`answers.js`, `selects.js`, `validator.core.js`, `poll.js` or anything under `extension/`
mentions a model, the build fails.

It also inherits the project's one invariant. After the model returns an extraction, every
company, role and location it produced must actually appear in the email text under the
same normalisation `validator.core.js` uses. A value that is not in the email was invented:
that field is set to `null`, the row is flagged `needs-review`, and confidence drops to
low. It is never repaired and the model is never asked again. A model checking its own
work is not a safeguard, so it does not get to.

The deterministic detector runs first and handles the recurring ATS templates, so the agent
only ever sees what patterns could not classify. With no `ANTHROPIC_API_KEY` set the agent
never runs at all, and unclassifiable mail is skipped rather than guessed at.

### Setup

The Google credentials are yours, not bundled — this reads your email, so the OAuth client
should belong to you:

1. Create an OAuth client (Desktop app) at
   [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials),
   with the Gmail and Sheets APIs enabled.
2. Export `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. `bamboo connect` — opens the consent screen, stores a refresh token in
   `~/.bamboo/google-token.json`.
4. Optional: `export ANTHROPIC_API_KEY=...` to enable the agent for mail the patterns miss.
5. Optional: set `TRACKER.sheets.spreadsheetId` in `src/config.js` to write to an existing
   sheet. Left `null`, the CSV at `~/.bamboo/applications.csv` is still written and imports
   into Sheets or Excel directly.

Scopes are `gmail.readonly` and `spreadsheets`. bamboo cannot send, delete or modify mail.

`~/.bamboo/google-token.json` grants read access to your inbox. It is gitignored, CI fails
if it is ever tracked, and no token is ever printed or included in an error message.

### What it records

Columns: `Applied On`, `Company`, `Role`, `Location`, `Status`, `Source`, `Job URL`,
`Last Update`, `Confidence`, `Needs Review`, `Message ID`.

Status moves forward only — `applied → screen → interview → offer`, with `rejected` and
`withdrawn` reachable from anywhere and terminal. A later email cannot reopen a closed
application, and re-running `track` over the same messages changes nothing.

`~/.bamboo/applications.json` is the source of truth; the spreadsheet is a projection of
it. Delete the sheet and the next sync rebuilds it. Missing values render as `—`, never
`0` and never a plausible guess.

## Commands

Installed globally as `bamboo <command>`; from a clone, `npm run <command>`.

| Command | Does |
|---|---|
| `setup` | Create `~/.bamboo`, migrate old data, seed templates. Safe to re-run |
| `where` | Print every path on this machine |
| `init` | Setup wizard: boards, cadence, work authorization, graduation year |
| `mine` | Extract board tokens from the aggregator repo |
| `poll` | One poll cycle across all boards; queues new eligible postings |
| `watch` | Poll on an interval until stopped |
| `check` | Preflight: ledger, answer traceability, dropdown fields, latency |
| `queue` | Queued postings as a list (`--all` includes handled) |
| `feed` | Queued postings as the live-feed view |
| `ledger` | The evidence ledger as a table |
| `survey` | Sample real Greenhouse forms; report which prompts recur |
| `connect` | One-time Google authorisation for the tracked mailbox |
| `track` | Read the tracked inbox; update the applications record and spreadsheet (`--live` to write) |
| `applications` | Tracked applications as a table |
| `banner` | Startup banner (needs a TTY for colour) |
| `help` | Command list |

Dev-only: `npm test` (80 tests, ~1s) and `npm run build:ext`.

`--no-color` works everywhere, as do `NO_COLOR` and piping to a non-TTY.

## Layout

```
src/
  config.js         paths, eligibility rules, polling interval, DRY_RUN_DEFAULT
  home.js           ~/.bamboo bootstrap, migration, seeding
  miner.js          aggregator repo -> board tokens
  sources.js        Greenhouse / Lever / Ashby adapters -> one Posting shape
  poll.js           poll cycle, seen-id diff, Greenhouse enrichment, apply queue
  questions.js      Greenhouse detail endpoint: descriptions + real form fields
  survey.js         aggregate what real forms ask
  eligibility.js    citizenship / sponsorship / title / deadline gates
  ledger.js         load + validate the evidence ledger
  validator.core.js trace-or-refuse for text  (NO IMPORTS — shared with the extension)
  selects.js        trace-or-refuse for dropdowns  (NO IMPORTS — shared)
  answers.js        answer bank retrieval
  google/           oauth.js, gmail.js, sheets.js — raw REST, no SDKs (zero deps)
  tracker/          detect.js, agent.js, applications.js, csv.js, sync.js
  ui/               theme, banner, feed, ledger table, init wizard, help
extension/          MV3 extension; content scripts fill and optionally submit
```

`src/tracker/` and `src/google/` are the tracker path. Nothing in the apply path imports
them, and CI enforces that — an LLM belongs nowhere near a form submission.

`validator.core.js` and `selects.js` are the single source of truth for refusal logic.
`npm run build:ext` copies them into the extension verbatim;
`test/extension-sync.test.js` fails if a copy goes stale or an import sneaks in.

## Coverage, honestly

The three polled vendors are ~30% of active listings (Ashby 13.4%, Greenhouse 11.8%, Lever
5.1%). Workday is only 6.1%. The remaining 59% is a long tail of 43 bespoke hosts,
concentrated in TikTok (34), Tesla (29), Jane Street (16) and Work at a Startup (13) — those
four are the obvious next integrations, and each needs its own form mapping.

## What measurement overturned

`bamboo survey` samples real Greenhouse forms via the detail endpoint (`?questions=true`),
which returns the actual application fields. Across 32 postings it contradicted the design's
central assumption:

**There is no recurring set of ~20 essay prompts.** Almost every free-text question appeared
exactly once, and they are logistics, not essays: visa status, current location, competing
offer deadlines, alternate email, street address. Exactly one posting in 32 asked anything
essay-shaped.

What recurs instead is dropdowns, and they are factual: work authorization (4 of 32, always
required), expected graduation year, highest degree, GPA, FINRA registration, security
clearance. So **structured facts matter more than prose** — fill your profile fields before
writing essays. The refusal machinery matters more under this finding, not less: a wrong
visa status auto-submitted is worse than a mediocre essay.

**The second finding was a live bug.** 4 of 32 sampled postings (12.5%) flipped from eligible
to ineligible once the description was fetched, all US-citizenship gates. On Rocket Lab, all
6 sampled internships require citizenship and all 6 were passing the filter. `poll` now
enriches title-eligible Greenhouse postings before deciding, and queue items carry
`eligibilityVerified` so an un-enriched posting is never mistaken for a checked one.

## Known gaps

- **`help` advertises five commands that do not exist**: `review`, `apply`, `boards`,
  `status`, `nap`. That list is the design handoff's intended surface; those are unbuilt.
- **`watch` has no interactive view.** The feed renders (`bamboo feed`), but the raw-mode
  keyboard loop — `d`/`f`/`q`, in-place status bar, clean Ctrl-C — is unwritten.
- **Nothing computes a match score.** The feed has the column and the colour thresholds;
  every score is currently `null`, which correctly prints `—` rather than a made-up number.
- **The extension has never touched a real form.** Selectors in
  `extension/content/common.js` come from public markup and are unverified.
- **The tracker has never read a real inbox.** Every test runs against fixtures with an
  injected `fetch`. The subject-line patterns in `tracker/detect.js` come from public ATS
  templates; expect to add patterns once real mail goes through it, and expect the agent
  to carry more of the load until you do. Rows it cannot fully trace are flagged
  `needs-review` rather than quietly filled, so the failure mode is visible.
- **Custom combobox widgets are refused, not filled.** Greenhouse and Ashby increasingly use
  React selects; faking clicks on one can leave a form looking answered while the value is
  unset, so they are reported for manual handling instead.
- Lever and Ashby expose no questions endpoint, so their forms are unmeasured.
- Board payloads are 2–6 MB each, refetched in full every cycle (~50s). Conditional requests
  would cut that substantially.
- Whether applying fast actually improves callback rates is still unmeasured. `bamboo check`
  reports median detection lag so you can eventually find out.
