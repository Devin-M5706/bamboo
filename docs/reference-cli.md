# CLI reference

Every command bamboo accepts. Installed globally these run as `bamboo <command>`; from a
clone they also run as `npm run <command>`.

Global flags work on every command:

| Flag | Effect |
|---|---|
| `--no-color` | Disable all colour. `NO_COLOR=1` and piping to a non-TTY do the same. |

---

## setup

Create `~/.bamboo`, migrate data from an older in-package `data/` directory, and seed
starter files from the bundled templates.

```bash
bamboo setup
```

Idempotent and non-destructive. It **copies** rather than moves, and skips any file that
already exists at the destination, so running it twice cannot lose work.

Output names every file it created, migrated, or left alone.

**Alias:** `bamboo install` runs the same command. Note there is deliberately no npm
script named `install` — npm treats that name as a lifecycle hook and would run it during
`npm install`, before the package is unpacked.

**Related:** [where](#where), [Configuration reference](reference-configuration.md)

---

## where

Print every path bamboo uses on this machine, and whether each file exists yet.

```bash
bamboo where
```

```
  home  C:\Users\you\.bamboo
  code  C:\Users\you\...\bamboo

  ✓ ledger.json
  ✓ answers.json
  · config.json     not created yet
```

`home` is where your data lives and survives reinstalls. `code` is the package, which npm
replaces on every update. Override the home directory with `BAMBOO_HOME`.

---

## init

Interactive setup wizard. Five questions: which boards to watch, polling cadence, your US
work authorization, expected graduation year, and whether to submit automatically.

```bash
bamboo init
```

**Requires a real terminal.** It uses raw-mode keyboard input, so it exits with an error
when stdin is a pipe.

| Key | Action |
|---|---|
| `↑` `↓` | Move the cursor |
| `space` | Toggle a choice (multi-select questions) |
| `enter` | Accept and advance |
| `Ctrl-C` | Cancel; nothing is written |

Writes `config.json`, and merges `workAuthorization` and `graduationYear` into your
ledger's `profile`. Those two are not preferences — they answer the most-required
dropdowns on real forms. See [Data files reference](reference-data-files.md).

The submit question preselects dry run. That default is asserted by a test.

**Related:** [How to write your ledger](howto-write-your-ledger.md)

---

## mine

Extract job-board tokens from the aggregator repository into `boards.json`.

```bash
bamboo mine
```

Reads roughly 400 listings and yields ~65 boards (Greenhouse, Ashby, Lever). Run it once,
then occasionally as companies are added. Boards you add to `boards.json` by hand are
preserved across re-runs.

Workday appears in the aggregator but is never mined — it exposes no public board API.

**Related:** [Architecture](explanation-architecture.md)

---

## poll

Run one polling cycle across every board in `boards.json`.

```bash
bamboo poll
```

Roughly 50 seconds for 65 boards. What it does, in order:

1. Fetch every board from its vendor's public API
2. Diff against seen posting IDs in `state.json`
3. For new Greenhouse postings that pass the title filter, fetch the description
4. Apply [eligibility gates](reference-configuration.md#eligibility)
5. Append survivors to `queue.json`

**The first run is a cold start.** It records every currently-live posting as already-seen
and queues nothing, so you are not handed thousands of stale listings. Every run after
that surfaces only genuinely new postings.

A board that 404s or times out is reported and skipped; it never aborts the cycle.

---

## watch

Run `poll` on a loop until interrupted.

```bash
bamboo watch
```

Interval is `POLL_INTERVAL_MS`, 5 minutes by default. Ctrl-C stops it.

> This is currently a polling loop that prints, not the interactive feed view. The
> keyboard controls shown in `feed` are not yet wired up.

---

## feed

Show the queue as the live-feed layout: timestamp, board, company and role, match score,
verdict.

```bash
bamboo feed [--all]
```

`--all` includes handled postings, not just pending ones.

Score colours: mint at 70 and above, orange 60–69, muted below. Nothing computes scores
yet, so every score currently renders as `—` rather than a made-up number.

---

## ledger

Show your evidence ledger as a table: ID, claim, source, use count.

```bash
bamboo ledger
```

Verified sources render mint with a `✓`. Unverified ones render orange and get a `└` note.
The footer counts entries, verified, and how many still need a source.

**Related:** [How to write your ledger](howto-write-your-ledger.md)

---

## check

Preflight. Reports everything blocking you from going live, and exits non-zero until
nothing is.

```bash
bamboo check
```

```
LEDGER   4 facts, INVALID
         - facts[2] ("coursework-ds"): marked verified:false
ANSWERS  4 entries, 1 refused
         REFUSED strengths: answer declares no derived_from facts
DROPDOWN 2/14 profile fields set
         unset (these questions will be refused): degreeLevel, gpaUndergraduate, ...
QUEUE    0 pending of 0
SUBMIT   DRY RUN (nothing will be submitted)

NOT READY. Fix the above before enabling live submit.
```

| Exit code | Meaning |
|---|---|
| `0` | Ready. Ledger valid, no refusals. |
| `1` | Something is blocking. The output names it. |

`NOT READY` is the tool working correctly, not failing.

---

## queue

Show queued postings as a plain list with URLs and detection lag.

```bash
bamboo queue [--all]
```

Use [feed](#feed) for the visual layout; use `queue` when you want copyable URLs.

---

## survey

Sample real Greenhouse application forms and report which questions actually recur.

```bash
bamboo survey
```

Roughly 2 minutes. Uses Greenhouse's detail endpoint (`?questions=true`), which returns
the real form fields. Writes full results to `questions-survey.json`.

Greenhouse only — Lever and Ashby expose no equivalent endpoint.

Run this **before** writing answers. It is what revealed that the recurring questions are
logistics and dropdowns, not essays. See
[What measurement overturned](explanation-why-it-refuses.md#what-measurement-overturned).

---

## contacts

Find people worth contacting about a posting.

```bash
bamboo contacts <company>
```

Two halves, deliberately different:

- **Engineers** are fetched from GitHub's public organization API. Real names, bios, and
  profile URLs.
- **LinkedIn searches** are *not* fetched. bamboo builds the URLs and you open them
  yourself, logged in.

That split is a boundary, not a limitation. See
[Boundaries](explanation-boundaries.md#linkedin-is-never-fetched).

Set `GITHUB_TOKEN` to raise the API rate limit.

---

## connect

One-time Google authorisation for the tracked mailbox.

```bash
bamboo connect
```

Opens the consent screen in a browser, then stores a refresh token in
`~/.bamboo/google-token.json`. Requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from
an OAuth client you own — see [track](#track) for why the credentials are not bundled.

Scopes requested are `gmail.readonly` and `spreadsheets`. bamboo cannot send, delete, or
modify mail.

The token file grants read access to your inbox. It is gitignored, CI fails if it is ever
tracked, and no token is printed or included in an error message.

---

## track

Read the tracked inbox and update the applications record and spreadsheet.

```bash
bamboo track            # dry run: reports what it would write, writes nothing
bamboo track --live     # actually write
```

The tracked address is `TRACKER.trackedEmail` in `src/config.js`.

**The trigger is the confirmation email, not the applier.** Every employer sends a receipt
to the address you applied with, and that receipt is the only signal that exists for every
application — including the ones you submitted by hand. This is why the tracker watches an
inbox rather than the extension.

What one cycle does, in order:

1. Fetch receipts newer than the stored `internalDate` watermark
2. Classify each with `tracker/detect.js` — deterministic, sender domain plus subject
   template, no model
3. Send only what that could not classify to `tracker/agent.js`
4. Ground every field the model returned against the email text; anything not found becomes
   `null` and the row is flagged `needs-review`
5. Merge into `~/.bamboo/applications.json`, deduping and advancing status forward only
6. Write `~/.bamboo/applications.csv`, and the Google Sheet if one is configured

Re-running over the same messages changes nothing — the sync is idempotent.

| Env var | Effect |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Required. Your own OAuth client. |
| `ANTHROPIC_API_KEY` | Optional. Without it the agent never runs and mail the patterns cannot classify is skipped rather than guessed at. |

The Google credentials are not bundled because this reads your email — the OAuth client
should be one you own and can revoke.

**Related:** [applications](#applications), [Boundaries](explanation-boundaries.md)

---

## applications

Show tracked applications as a table.

```bash
bamboo applications
```

Columns follow the spreadsheet: company, role, status, when you applied, and whether the
row needs review. Missing values render `—`, never `0` and never a guess.

`~/.bamboo/applications.json` is the source of truth; the spreadsheet is a projection of it
and can be deleted and rebuilt.

---

## banner

Print the startup banner.

```bash
bamboo banner
```

Needs a TTY for colour, and 112+ columns to show the panda beside the wordmark. Below that
it prints the wordmark alone. With colour off it prints text only — half-blocks without
colour are noise.

`COLUMNS` overrides the detected width, which is what makes the README images
reproducible.

---

## help

Print the command menu.

```bash
bamboo help
```

Running `bamboo` with no arguments prints the banner followed by this menu.

> `help` lists the intended command surface from the design handoff. Five of its entries —
> `review`, `apply`, `boards`, `status`, `nap` — are not implemented yet.

---

## Development-only

These exist as npm scripts in a clone, not as `bamboo` subcommands.

| Command | Does |
|---|---|
| `npm test` | 108 tests via `node:test`. About 1 second. |
| `npm run build:ext` | Regenerate `extension/vendor/` from the shared cores. Required after editing `validator.core.js`, `selects.js`, or `matching.core.js`. |
| `node scripts/capture-ui.js` | Regenerate the UI screenshots in `docs/ui/`. |

On Windows, `node --test test/` does not resolve a directory. Use the glob, as `npm test`
does.

---

## Related

- [Configuration reference](reference-configuration.md) — every setting and env var
- [Data files reference](reference-data-files.md) — ledger and answer bank schema
- [Getting started](tutorial-getting-started.md) — the guided path
