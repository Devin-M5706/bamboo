<!--
Keep this short. The point is to make a reviewer's job fast, not to fill in a form.
Delete any section that genuinely does not apply.
-->

## What changed

<!-- One or two sentences. What does this do that the code did not do before? -->

## Why

<!-- The problem, not the solution. If this came from a review finding, link it:
     "Found by /plan-eng-review (A1, P0)". -->

## How it was verified

<!-- Not "tests pass" — CI says that. What did you actually check?
     e.g. "ran `bamboo poll` against 65 live boards, 0 new queued in 50s" -->

- [ ] `npm test` passes locally
- [ ] Ran the affected command by hand

## Invariant check

This project has hard rules. Confirm the ones this PR touches:

- [ ] **It still refuses.** No new path returns a generated, hedged, or best-guess
      answer when a claim cannot be traced to the ledger.
- [ ] **Dry run is still the default** in `src/config.js`, `extension/content/apply.js`,
      and the `init` wizard.
- [ ] **Shared cores stay import-free.** If I edited `validator.core.js` or
      `selects.js`, I ran `npm run build:ext` and committed the result.
- [ ] **Zero runtime dependencies.** If this adds one, I justified it below.
- [ ] **No personal data.** `ledger.json`, `answers.json` and `config.json` are
      untracked and none of their contents appear in the diff.

<!-- If you unchecked any box, explain here. An unchecked box with a good reason is
     fine; an unchecked box with no explanation will be sent back. -->

## Risk

<!-- What is the worst thing that happens if this is wrong, and who notices?
     "Nothing, it's a docs change" is a valid answer. -->
