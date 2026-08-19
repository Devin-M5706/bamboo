# Contributing

## The rule everything else serves

**bamboo refuses; it never softens.** Every number and proper noun it writes must trace
to a fact a person verified. Every dropdown it picks must resolve from a declared profile
field. When it cannot, it abandons the application and says so.

A change that adds a fallback, a hedge, a "best guess", or a default option is not a
feature. It converts this tool into the thing it was built not to be. If you think you
need one, open an issue first and make the case.

## Setup

```bash
git clone https://github.com/Devin-M5706/bamboo.git
cd bamboo
npm link          # `bamboo` now points at your checkout; edits apply immediately
npm test          # ~1s, no install step, no dependencies
```

Node 22+. There is no `npm install` because there is nothing to install.

## Branches

One branch per change, named for what it does:

| Prefix | For |
|---|---|
| `feat/` | New capability |
| `fix/` | Something behaved wrongly |
| `refactor/` | Same behaviour, better structure |
| `perf/` | Same behaviour, less time or memory |
| `docs/` | Documentation only |
| `chore/` | Tooling, CI, repo plumbing |

`main` is protected. Everything lands through a pull request, including your own.

## Commits

Conventional commits: `type(scope): imperative summary`.

The body matters more than the subject. Explain **why**, and what you measured. This
repo's history is the design record — several commits document findings that changed the
architecture, and they are worth more than the diffs they carry.

```
fix(store): refuse to overwrite a corrupt ledger; make all writes atomic

saveInit read ledger.json inside a try/catch that treated "file does not exist"
and "file has a trailing comma" as the same event...
```

## Before you open a PR

```bash
npm test              # all green
npm run test:coverage # still above the floor
npm run build:ext     # if you touched any of the three shared cores
```

CI will fail the PR if any of these breaks:

1. Tests pass on Node 22 and 24, on Linux and Windows
2. `extension/vendor/` is not stale
3. Dry run is still the default in all three places
4. The shared cores are still import-free
5. No personal data is tracked, and no consumer mailbox address appears in `src/` or
   `extension/` — a real gmail address shipped inside `src/config.js` once, where the
   file-path check could not see it
6. `package.json` has no runtime dependencies
7. The apply path reaches no model
8. Coverage stays above 90% lines / 78% branches / 85% functions on `src/`

The greps in (4), (5) and (7) also run under `npm test`, which is where you will actually
see one fail. If you add a guard, add it in both places -- the two copies drifted apart
once already.

## Testing

`node:test`, no framework. `npm test` runs `test/*.test.js`.

Note: `node --test test/` does not resolve a directory on Windows. Use the glob.

Tests assert **behaviour and properties**, not implementation. The best test in this
repo asserts that after a failed `init` against a hand-edited ledger, the file's bytes
are unchanged — that is a property worth defending. Aim for that.

If you fix a bug, the PR includes the test that would have caught it. No exceptions:
every bug found so far in this project was found by a test that did not exist yet.

## Editing gotchas

- **Do not edit `.js` with shell heredocs or `node -e` and template literals.** The
  escaping mangles regexes and backticks. It has broken `survey.js` and `cli.js` once
  each. Use a real editor.
- `src/validator.core.js` and `src/selects.js` must have **no imports** — they are copied
  verbatim into the browser extension.
- Pad **outside** `paint()` for a row's last column, never inside. Inside, the trailing
  spaces sit before the reset escape where `trimEnd()` cannot reach them, and coloured
  rows silently grow wider than plain ones.

## Data that is never committed

`~/.bamboo/ledger.json`, `answers.json` and `config.json` hold real personal
information: work authorization, application answers, employment history. They live
outside the repo and are gitignored inside it. CI fails if any becomes tracked.

Never paste their contents into an issue, a PR, or a commit message.
