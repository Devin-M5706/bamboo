# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                      # 31 tests, node:test, no deps
node --test test/validator.test.js   # single file
npm run build:ext             # regenerate extension/vendor/validator.js -- REQUIRED after
                              # any edit to src/validator.core.js, or tests fail
npm run mine                  # aggregator repo -> data/boards.json (65 board tokens)
npm run poll                  # one poll cycle (~50s across 65 boards)
npm run check                 # preflight: ledger validity, answer traceability, queue, latency
```

Node 22+, ESM, zero runtime dependencies. Keep it that way — this runs unattended and every
dependency is a thing that can break while nobody is watching.

`node --test test/` does not work on Windows; use the glob (`test/*.test.js`) as `npm test` does.

## The one invariant

**The validator refuses; it never softens.** `src/validator.core.js` checks that every
number and proper noun in an answer appears in the ledger facts that answer declares in
`derived_from`. If a claim cannot be traced, the answer is refused and the application is
abandoned. Nothing anywhere should "fall back" to a generated or hedged answer — that
converts this tool into the thing it was built not to be.

Consequences for anyone editing:
- No LLM call belongs in the apply path. Answers are written offline and validated ahead of time.
- `src/validator.core.js` must have **no imports**. `scripts/build-extension.js` copies it
  verbatim into the extension so the CLI and the browser share one validator.
  `test/extension-sync.test.js` fails if the copy goes stale or an import sneaks in.
- Dry run is the default in both `src/config.js` and `extension/content/apply.js`, and a
  test asserts it. Do not flip a default to make a demo easier.

## Architecture

The aggregator repo (`vanshb03/Summer2027-Internships`) is treated as a **company
directory, not a job feed** — it lags by days and its `date_posted` is ingestion time, not
the employer's. `miner.js` extracts board tokens from listing URLs once; `sources.js` then
polls the vendors' own public APIs, where Greenhouse's `first_published` gives the true
posting timestamp.

Pipeline: `miner` → `sources` (per-vendor adapters normalize to one `Posting` shape) →
`poll` (seen-id diff, cold start records without queueing) → `eligibility` (hard gates) →
queue → extension applier (`answers` retrieval → `validator` → fill or refuse).

Vendor adapter field names were read off live responses, not guessed. If you add a vendor,
verify the real payload shape first — `test/pipeline.test.js` has parser tests to extend.

## Files that hold personal data

`data/ledger.json` and `data/answers.json` are gitignored and contain the user's real
experience and application answers. Never commit them, never paste their contents into a
report, and never send them anywhere. The `.example.json` files are the committed templates.

## Design doc

Full rationale, measured ATS distribution, and open questions:
`~/.gstack/projects/Devin-M5706-bamboo/dmyer-main-design-20260811-233658.md`

## Terminal UI

Screens are implemented from `design_handoff_bamboo_cli/README.md`, which declares its
colors, copy, column widths and spacing **final**. Match them; don't improvise.

- `src/ui/theme.js` owns the palette and every escape code. No raw ANSI anywhere else —
  that's what makes `--no-color`, `NO_COLOR` and non-TTY pipes a single switch
  (`setColor()`), and a test asserts every screen goes plain when it's off.
- `src/ui/banner.js` is ported from the handoff's runnable `banner.js`. The glyph maps,
  panda grid, gradient stops and extrude offset are **copied verbatim** — adapt plumbing,
  never the art. Below 112 columns the panda drops and the wordmark prints alone.
- Column widths in `feed.js` (8/11/flex/3/9) and the score thresholds (mint ≥70, orange
  60–69) come straight from the handoff. Tests pin them.
- **Pad outside `paint()`, not inside**, for a row's last column. Padding inside leaves
  trailing spaces before the reset escape where `trimEnd()` can't reach, and colored rows
  silently grow wider than plain ones.
- Color semantics: orange = bamboo speaking or asking, mint = verified or safe, faint =
  metadata. Never color body copy anything else.

`bamboo init` asks for `workAuthorization` and `graduationYear` because those feed
`src/selects.js` directly and are the most-required dropdowns on real forms. The choice
values must stay identical to `WORK_AUTH_PATTERNS`; a test enforces it.
