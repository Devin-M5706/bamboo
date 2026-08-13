# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                              # 108 tests, node:test, no deps, ~0.2s
node --test test/selects.test.js      # a single file
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
npm run banner    # startup banner (needs a TTY for colour)
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
  ahead of time; apply-time is pure retrieval.
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

Screenshots in `docs/ui/` are generated by `node scripts/capture-ui.js` from real command
output, so they cannot drift from what the CLI prints. Re-run it after changing a screen.

## Landing a change

`main` is protected; everything goes through a PR (see `CONTRIBUTING.md` for the branch
prefixes and commit format — bodies explain *why* and what was measured). CI runs tests on
Node 22/24 × Linux/Windows and enforces four invariants: `extension/vendor/` not stale,
`DRY_RUN_DEFAULT = true` plus `dryRun: true` in the extension, cores import-free, and no
personal data tracked. Windows is the primary dev platform and has already produced two
platform-specific bugs, which is why it's in the matrix.

Tests assert **behaviour and properties**, not implementation — the best one here asserts
that after a failed `init` against a hand-edited ledger the file's bytes are unchanged. A
bug fix lands with the test that would have caught it.

## Status — what exists

| Area | State |
|---|---|
| Token miner, poller, seen-id diff, cold start | Working, verified live (65 boards, 8,291 postings) |
| Eligibility gates + Greenhouse enrichment | Working, fixed a real 12.5% leak |
| Form survey (`questions.js`, `survey.js`) | Working, Greenhouse only |
| Text validator (trace-or-refuse) | Working |
| Dropdown resolver (14 profile fields) | Working |
| Shared answer matching (`matching.core.js`) | Working, one implementation for CLI + extension |
| Durable store (`store.js`) + `~/.bamboo` home | Working, atomic writes, ledger backup |
| Contacts (GitHub engineers, LinkedIn handoff) | Working |
| Chrome MV3 extension | Written, **never run against a real form** |
| CLI screens | Working |
| Docs (Diataxis set in `docs/`) + diagrams | Written |

## Status — what still needs adding

**Blocked on the user, not on code:**
1. `~/.bamboo/ledger.json` — the atomic verified facts. Cannot be automated; its whole
   value is that a person checked each entry. Everything else waits on this.
2. `~/.bamboo/answers.json` — free-text answers. Note the survey finding below before
   writing.
3. The 14 dropdown profile fields. `init` collects 2 of them; the rest are manual.

**Command surface drift.** `src/ui/help.js` lists the handoff's intended surface; five of
those do not exist: **`review`, `apply`, `boards`, `status`, `nap`**. Conversely `setup`,
`where`, `mine`, `poll`, `watch`, `feed`, `check`, `queue`, `survey`, `contacts`, `banner`
are implemented but unadvertised there. No test catches this — `test/cli-scripts.test.js`
only checks CLI-vs-npm-scripts.

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
