# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                              # whole suite, node:test, no deps, well under a second
npm run test:coverage                 # the same suite with node:test coverage + the CI floor
node --test test/selects.test.js      # a single file
node --test --test-name-pattern refuses test/*.test.js   # a single test, by name
npm run build:ext                     # REQUIRED after editing any shared core
                                      # (validator.core.js, selects.js, matching.core.js)
                                      # or extension-sync tests and CI fail

npm run setup     # create ~/.bamboo, migrate old in-package data, seed templates
npm run where     # print every path on this machine
npm run init      # setup wizard (needs a real TTY)
npm run mine      # aggregator repo -> ~/.bamboo/boards.json (65 board tokens)
npm run poll      # one poll cycle, ~50s across 65 boards
npm run watch     # poll on POLL_INTERVAL_MS forever (non-interactive; see gaps)
npm run survey    # sample real Greenhouse forms, ~2min
npm run check     # preflight: ledger, answer traceability, dropdown fields, latency
npm run queue     # queued postings as a list (--all includes handled)
npm run feed      # live-feed view of the queue
npm run ledger    # evidence ledger table
npm run contacts  # GitHub engineers for a company + LinkedIn URLs you click yourself
npm run connect   # one-time Google OAuth for the tracked mailbox (needs a browser)
npm run track     # one tracker sync: inbox -> records -> spreadsheet (dry run by default)
npm run applications  # tracked applications as a table
npm run banner    # startup banner (needs a TTY for colour)

npm run capture:ui  # re-render docs/ui/*.html from real command output
npm run render:ui   # rasterise those to PNG (drives Chrome over CDP; CHROME_PATH to override)
```

Node 22+, ESM, **zero runtime dependencies**. Keep it that way — this runs unattended and
every dependency is something that can break while nobody is watching. CI fails the PR if
`package.json` gains one.

Gotchas that have already cost time:
- `node --test test/` does not work on Windows. Use the glob, as `npm test` does.
- Do not edit `.js` files via shell heredocs or `node -e` with template literals — the
  escaping mangles regexes and backticks. Use Write/Edit. This has broken `survey.js` and
  `cli.js` once each.
- `src/cli.js` contains literal ESC bytes in some strings; anchor edits away from them.
- **Never add an npm script named `install`.** It is a reserved lifecycle hook: it fires
  before the package is unpacked and broke `npm i -g` once already (see CHANGELOG 0.2.0).
  `install` survives as a CLI alias for `setup` in `src/cli.js`, which is a different thing.
- This checkout sits in an iCloud folder. Files can be dataless reparse points, so a
  recursive `Get-ChildItem` may silently omit real files. Use Glob/Grep, not shell listings.

Nothing is read from a `.env` file; every switch is a real environment variable:

| Variable | Read by | Effect |
|---|---|---|
| `BAMBOO_HOME` | `config.js` | Moves the whole data dir off `~/.bamboo`. Use it in tests and scratch runs |
| `ANTHROPIC_API_KEY` | `tracker/agent.js` | Unset ⇒ the agent never runs and unclassifiable mail is skipped, not guessed |
| `BAMBOO_TRACKED_EMAIL` | `config.js` | The mailbox `track` reads. Unset ⇒ `connect` and `track` refuse. Never hardcode an address here: this package is published |
| `GOOGLE_CLIENT_ID` / `_SECRET` | `google/oauth.js` | Your own OAuth client; nothing is bundled |
| `GITHUB_TOKEN` | `contacts.js` | Optional; raises the public API rate limit |
| `CHROME_PATH` | `scripts/render-ui.js` | Overrides Chrome/Chromium/Edge discovery |
| `NO_COLOR` / `FORCE_COLOR` / `COLUMNS` | `ui/theme.js` | Colour and width, alongside `--no-color` |
| `BAMBOO_NAME` | `cli.js` | Rebrands the wordmark (A–Z only) |

Flags: `--all` (`queue`, `feed`), `--live` (`track` only — the single way to leave dry run
from the CLI), `--no-color` (everywhere). The help screen's command list is pinned against
`COMMANDS` in `cli.js` by `test/cli-scripts.test.js`, in both directions, and its footer
reads `DRY_RUN_DEFAULT` rather than restating it — so neither can drift again.

## The one invariant

**It refuses; it never softens.** Three enforcement points, same rule:

- `src/validator.core.js` — every number and proper noun in an answer must appear in the
  ledger facts that answer names in `derived_from`. Untraceable claim ⇒ answer refused,
  application abandoned.
- `src/selects.js` — every dropdown resolves from a declared profile field or refuses.
  Never default, never pick the first option. Several of these are legal assertions
  ("I am authorized to work in the United States for any employer"), not preferences.
- `src/matching.core.js` — which bank answer belongs to a form question. Longest pattern
  match wins; no match returns `null`, which is a refusal. It exists because `check` and
  the extension each had their own hand-written copy of this logic, so `check` could say
  ready while the extension filled a different answer.

Nothing anywhere may "fall back" to a generated, hedged, or best-guess answer. That
converts this tool into the thing it was built not to be.

Consequences for anyone editing:
- **No LLM call belongs in the apply path.** Answers are written offline and validated
  ahead of time; apply-time is pure retrieval. There *is* a model in this repo now — see
  "The tracker" below — but it lives on a separate, read-only path and CI greps the apply
  path to keep it there.
- The three shared cores must have **no imports** — `scripts/build-extension.js` copies
  them verbatim into `extension/vendor/` so the CLI and browser share one implementation.
  `test/extension-sync.test.js` and CI fail if a copy goes stale or an import sneaks in.
- Dry run is the default in `src/config.js`, `extension/content/apply.js`, and the `init`
  wizard. Tests and a CI grep assert all three. Never flip a default to make a demo easier.
- A missing value prints `—`, never `0`. Don't invent numbers, for the same reason.

## Where the user's data lives

`~/.bamboo` (override with `BAMBOO_HOME`), never inside the package — a global install
puts the code under `node_modules`, which npm wipes on every update, and the ledger is the
one artifact here that cannot be regenerated. `src/config.js` owns every path;
`src/home.js` does the bootstrap, one-time migration out of the old in-package `data/`, and
seeding from `data/*.example.json`. All of it is idempotent and never overwrites.

Read and write those files only through `src/store.js`, which enforces three rules earned
from real failures:

1. **Missing is not corrupt.** `readJson` returns `{exists:false}` for ENOENT and throws
   `CorruptFileError` for a parse failure, so no caller can substitute an empty ledger for
   an unparseable one and write it back. Use `readJsonOr` only where a missing *or* corrupt
   file genuinely doesn't matter (caches, derived state).
2. **Writes are atomic.** Temp file in the same dir, fsync, rename. Ctrl-C during `watch`
   used to truncate `state.json`.
3. **Irreplaceable files keep a `.bak`.** The ledger only.

`data/ledger.json`, `data/answers.json`, `data/config.json` (and the runtime state files)
are gitignored leftovers from before the migration; the `.example.json` files are the
committed templates. Never commit real data, never paste its contents into a report, never
send it anywhere. CI fails if any becomes tracked.

## Architecture

The aggregator repo (`vanshb03/Summer2027-Internships`) is a **company directory, not a
job feed** — it lags by days (five-day and six-week gaps observed) and its `date_posted`
is ingestion time, not the employer's. `miner.js` extracts board tokens from listing URLs
once; `sources.js` then polls the vendors' own public APIs, where Greenhouse's
`first_published` is the true posting timestamp.

```
miner ──> sources ──> poll ──> eligibility ──> queue ──> extension applier
          (3 vendor    (seen-id  (citizenship/            (answers → matching → validator
           adapters,    diff,     sponsorship/             selects → fill or REFUSE)
           one Posting  cold      title/deadline)
           shape)       start)
             ▲
        questions.js — Greenhouse detail endpoint (?questions=true) gives descriptions
                       AND the real form fields. survey.js aggregates them.
```

Two things field-verified against live APIs, not assumed:
- Vendor adapter field names were read off real responses. Adding a vendor means checking
  the real payload first; `test/pipeline.test.js` has parser tests to extend.
- Greenhouse's list endpoint has **no description**, so citizenship gates are invisible
  there. `poll` enriches title-eligible Greenhouse postings before deciding. Measured:
  12.5% of them flip to ineligible once the description is read. Queue items carry
  `eligibilityVerified` — an un-enriched posting is not a checked one.

## The tracker

`bamboo track` reads confirmation emails from `TRACKER.trackedEmail` and projects them into
a spreadsheet. It is the only place in this codebase that calls a model.

```
gmail.js ──> detect.js ──────────────> applications.js ──> csv.js
             (deterministic)      ▲         (dedupe,        sheets.js
                  │               │          forward-only
                  └─> agent.js ───┘          status)
                      (only the residue, and every field it
                       returns must be grounded in the email)
```

**Complete, and covered.** Every module here has a test file that imports it and drives
the logic: `detect.js` (17), `agent.js` (24), `applications.js` (25), `csv.js` (15),
`sheets.js` (21), `sync.js` (15), plus Gmail (31) and OAuth (19) underneath. All offline —
no test opens a socket or reads a credential, and the agent's tests install a `fetch` that
throws, so a regression that starts calling the API fails rather than bills.
`test/tracker-boundary.test.js` still reads `src/tracker/` as *text*, but it now checks the
boundary greps only; it is no longer the sole thing standing behind this directory.

Still true: **none of it has run against a real inbox.** The patterns come from public ATS
templates, and real mail will need more of them.

Five rules, and they are the reason this is acceptable at all given the invariant above:

1. **The apply path never imports it.** Not `poll.js`, not `answers.js`, not the cores, not
   `extension/`. CI greps those files for `anthropic|claude` and fails the build. The model
   reads mail that has already been sent; it cannot reach a form.
2. **Deterministic first.** `detect.js` handles the recurring ATS templates from sender
   domain and subject patterns. `agent.js` only sees what it could not classify. No API key
   means the agent never runs and unclassifiable mail is skipped, not guessed.
3. **Grounding, not trust.** `groundExtraction` in `agent.js` checks every company, role and
   location the model returned against the email text under `validator.core.js`-style
   normalization. Not present ⇒ the field becomes `null`, the record is flagged
   `needsReview`, confidence drops to low. Never repaired, never re-prompted — the same
   reason `validator.core.js` is a dumb string check: a model adjudicating a model is not a
   safeguard.
4. **The boundary runs both ways.** The tracker must never read the ledger or answer bank
   (`loadLedger`, `loadAnswers`, `LEDGER_FILE`, `ANSWERS_FILE` are all banned under
   `src/tracker/`). Those hold verified personal facts, none of which are needed to work out
   which company sent a receipt, and anything the tracker reads can end up in a model
   prompt. `test/tracker-boundary.test.js` pins this direction along with rule 1.
5. **Records are truth; the sheet is a projection.** `~/.bamboo/applications.json` is
   authoritative and written before any sheet call. Deleting the spreadsheet loses nothing.

Two things that will bite you:
- `detectStatus` must test rejection phrasing **before** receipt phrasing. Rejection emails
  routinely open by thanking you for applying, and a first-match-wins order records them as
  new applications. Pinned by `test/detect.test.js:55`, which is the test that would have
  caught it.
- Never fall back to the sender's domain for the company name. Every Greenhouse-hosted
  posting would be recorded as "Greenhouse". Return `null` and flag it.

No SDKs: `googleapis` and `@anthropic-ai/sdk` would both violate the zero-dependency rule,
so `src/google/` and `agent.js` are raw `fetch` against the REST APIs. This is deliberate
and commented at each call site; do not "modernise" it without removing the CI guard first.

`~/.bamboo/google-token.json` holds a live OAuth refresh token for the mailbox. Gitignored,
CI-guarded, and never printed or included in an error message.

`src/contacts.js` has a deliberate boundary: engineers come from GitHub's public API;
recruiters are **not** fetched. LinkedIn's terms prohibit automated access and the penalty
is losing the account you most need mid-job-hunt, so bamboo builds the search URL and you
click it as a human. Outreach drafts go through the same validator as an application.

## Terminal UI

Implemented from `design_handoff_bamboo_cli/README.md`, which declares its colours, copy,
column widths and spacing **final**. Match them; don't improvise.

- `src/ui/theme.js` owns the palette and every escape code. No raw ANSI anywhere else —
  that's what makes `--no-color`, `NO_COLOR` and non-TTY pipes one switch (`setColor()`).
  A test asserts every screen emits zero escapes when colour is off.
- `src/ui/banner.js` is ported from the handoff's runnable `banner.js`. Glyph maps, the
  56×21 panda grid, gradient stops and the 2px extrude are **copied verbatim** — adapt
  plumbing, never the art. Below 112 columns the panda drops.
- Column widths in `feed.js` (8/11/flex/3/9) and score thresholds (mint ≥70, orange 60–69)
  come from the handoff. Tests pin them.
- **Pad outside `paint()`, not inside**, for a row's last column. Inside, trailing spaces
  sit before the reset escape where `trimEnd()` can't reach, so coloured rows grow wider
  than plain ones and alignment drifts.
- Colour semantics: orange = bamboo speaking or asking, mint = verified or safe, faint =
  metadata. Never colour body copy anything else.

`init` asks for `workAuthorization` and `graduationYear` because they feed `selects.js`
directly and are the most-required dropdowns on real forms. Its choice values must stay
identical to `WORK_AUTH_PATTERNS`; a test enforces it.

Screenshots in `docs/ui/` are generated from real command output, so they cannot drift from
what the CLI prints. Re-run both after changing a screen: `capture:ui` writes the HTML,
`render:ui` rasterises it by driving Chrome over the DevTools protocol on Node 22's built-in
WebSocket. Each PNG is clipped to `#shot`, not the viewport — that is why the committed
images have five different widths, and why a viewport screenshot is not a substitute.

## Landing a change

`main` is protected; everything goes through a PR (see `CONTRIBUTING.md` for the branch
prefixes and commit format — bodies explain *why* and what was measured). CI runs tests on
Node 22/24 × Linux/Windows and enforces eight invariants: zero runtime dependencies,
`extension/vendor/` not stale, `DRY_RUN_DEFAULT = true` plus `dryRun: true` in the
extension, cores import-free, no personal data tracked, no consumer mailbox hardcoded in
`src/` or `extension/`, the apply path model-free, and a coverage floor.
Windows is the primary dev platform and has already produced two platform-specific bugs,
which is why it's in the matrix.

The guards that are pure greps also run under `npm test` (`test/tracker-boundary.test.js`),
which is where you'll actually see one fail — a CI-only guard tells you after the push.
Adding a guard to `.github/workflows/ci.yml` means adding it in both places. The two copies
diverged once and are now identical, with a comment on each pointing at the other; keep
them that way.

The coverage floor is 90% lines / 78% branches / 85% functions on `src/`, against an actual
94.95 / 83.92 / 90.37. It is deliberately set below where the suite sits: a threshold pinned
to the current number fails on unrelated PRs and gets raised by whoever is unlucky, which
teaches people to ignore it.

Tests assert **behaviour and properties**, not implementation — the best one here asserts
that after a failed `init` against a hand-edited ledger the file's bytes are unchanged. A
bug fix lands with the test that would have caught it.

## Status — what exists

| Area | State |
|---|---|
| Token miner, poller, seen-id diff, cold start | Working, verified live (65 boards, 8,291 postings), 18 tests |
| Eligibility gates + Greenhouse enrichment | Working, fixed a real 12.5% leak |
| Form survey (`questions.js`, `survey.js`) | Working, Greenhouse only |
| Text validator (trace-or-refuse) | Working |
| Dropdown resolver (14 profile fields) | Working |
| Shared answer matching (`matching.core.js`) | Working, one implementation for CLI + extension |
| Durable store (`store.js`) + `~/.bamboo` home | Working, atomic writes, ledger backup |
| Contacts (GitHub engineers, LinkedIn handoff) | Working |
| Chrome MV3 extension | Written, **never run against a real form** |
| Application tracker (Gmail → records → Sheets/CSV) | Working and covered (167 tests across the tracker + Google clients). **Never run against a real inbox** |
| Tracker AI agent + grounding check | Working, 24 tests — `groundExtraction` covered for present, absent and near-miss fields |
| CLI screens | Working |
| Docs (Diataxis set in `docs/`) + diagrams | Written |

## Status — what still needs adding

**Blocked on the user, not on code:**
1. `~/.bamboo/ledger.json` — the atomic verified facts. Cannot be automated; its whole
   value is that a person checked each entry. Everything else waits on this.
2. `~/.bamboo/answers.json` — free-text answers. Note the survey finding below before
   writing.
3. The 14 dropdown profile fields. `init` collects 2 of them; the rest are manual.

**Command surface drift — fixed, and pinned.** `src/ui/help.js` used to list the handoff's
intended surface, five commands of which were never built (`review`, `apply`, `boards`,
`status`, `nap`), while hiding the fourteen that were. `help.js` now lists the real surface
in workflow order, and `test/cli-scripts.test.js` pins it against `COMMANDS` in `cli.js`
from both directions. `install` stays deliberately unadvertised — it is an alias for
`setup`, kept only because it was published once, and advertising it invites the npm
lifecycle collision that broke global installs in 0.2.0.

When a message names a data file, print the constant from `config.js` (`LEDGER_FILE`,
`BOARDS_FILE`, `SURVEY_FILE`, …), never a literal `data/…` path — under `BAMBOO_HOME` a
hardcoded path is simply wrong, and a batch of these survived the `~/.bamboo` migration
telling users to edit files nothing reads. Extension copy is the exception: it can't
resolve paths, so it says `~/.bamboo/…` and points at `bamboo where`.

**Known gaps, roughly by value:**
- `watch` is a bare poll loop with no interactive TTY view. The feed *renders*
  (`npm run feed`), but the raw-mode keyboard loop (`d`/`f`/`q`, in-place status-bar
  redraw, clean Ctrl-C) is unwritten.
- Nothing computes a match score. The feed has the column and the colour thresholds; every
  score is currently `null`, which correctly prints `—`.
- The extension has never touched a real form. Selectors in
  `extension/content/common.js` are written from public markup and are unverified.
- The tracker has never read a real inbox. `detect.js` patterns come from public ATS
  templates; real mail will need more of them. Until then the agent covers the gap and
  anything it cannot ground is flagged `needsReview`, so the failure is visible rather
  than silent.
- Custom combobox widgets are detected and refused, never filled. Given the survey, these
  matter more than textareas.
- Lever and Ashby expose no questions endpoint, so their forms are unmeasured.
- Board payloads are 2–6 MB each, refetched in full every cycle. Conditional requests would
  cut a ~50s cycle substantially.
- The long tail is 59% of listings, concentrated in four hosts: TikTok (34), Tesla (29),
  Jane Street (16), Work at a Startup (13). Each needs its own form mapping.

**A design premise that measurement overturned.** The original plan assumed ~20 recurring
essay prompts. Surveying 32 real forms found almost every free-text question appearing
exactly once, and overwhelmingly logistical (visa status, current location, competing offer
deadlines). Structured facts matter more than prose. The corpus-level-review design
survives; what you write into the ledger changes. Don't rebuild the answer bank around
essays.

**Still open from the design session:** P2 (the refusal premise) was assumed, not confirmed.
The timing evidence behind prioritising latency was asserted but never written down.

## Design doc

Full rationale, measured ATS distribution, premises, and post-build findings:
`~/.gstack/projects/Devin-M5706-jobapplr/dmyer-main-design-20260811-233658.md`
(the gstack project slug still says `jobapplr`; the repo is now `bamboo`).
