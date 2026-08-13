# Architecture

How postings get from a job board to a filled form, and why the pieces are arranged this
way.

## The problem

You want to know about an internship posting soon after it exists, and you want the
decision about whether you are eligible to be right.

The obvious source is one of the community-maintained internship repositories on GitHub.
They aggregate thousands of postings, they are free, and everyone building in this space
uses them as a feed.

Measuring one revealed why that is the wrong way to use it:

- **It lags.** Observed gaps of five days and, in one stretch, six weeks with no commits.
- **It has no true posting time.** The `date_posted` field is when the *aggregator* ingested
  the listing, not when the employer published it. There is no field for the latter, so
  the real lag is unmeasurable from the repo alone.
- **It is bursty.** 76 postings landed on one day, 52 on another, and 1–2 on a typical day.

Building a fast pipeline on top of a source that goes quiet for six weeks means your
latency is bounded by someone else's commit habits.

## The approach

**Treat the aggregator as a company directory, not a job feed.**

Mine it once for the set of companies. Extract their job-board tokens from the listing
URLs. Then poll those vendors' own public APIs directly, forever after.

```
  aggregator repo ──mine ONCE──> 65 board tokens
   (lags days)                        │
                                      v
                        ┌─────────────────────────┐
                        │  Greenhouse  Lever  Ashby│  public JSON APIs
                        │  first_published         │  no auth, no scraping
                        └─────────────────────────┘
                                      │
                                  poll cycle
```

This changes two things:

1. **Detection latency drops** from "whenever the aggregator commits" to your polling
   interval.
2. **Latency becomes measurable.** Greenhouse's `first_published` is the employer's real
   timestamp, so `detectionLagMs` on every queue item is a fact rather than a guess. You
   can eventually answer whether applying fast actually helps, instead of assuming it.

All three vendor APIs are public, documented, and unauthenticated. No scraping, no terms
problem.

Coverage is honest about its limits: those three vendors are ~30% of listings in the
aggregator (Ashby 13.4%, Greenhouse 11.8%, Lever 5.1%). Workday is only 6.1% and exposes
no public board API. The remaining 59% is a long tail of 43 bespoke hosts, concentrated in
four: TikTok, Tesla, Jane Street, and Work at a Startup.

## The pipeline

```
miner.js      aggregator listings ──> boards.json (65 tokens)
                    │
sources.js    3 vendor adapters ──> one Posting shape
                    │               (field names read off live responses)
poll.js       diff vs state.json ──> only genuinely new
                    │
questions.js  Greenhouse detail endpoint ──> description + real form fields
                    │
eligibility.js  citizenship / sponsorship / title / deadline
                    │
              queue.json ──> extension ──> matching → validator → selects → fill or REFUSE
```

Each stage has one job and hands a normalized shape to the next. Vendor differences stop
at `sources.js`; nothing downstream branches on which board a posting came from.

### The cold start

The first poll records every currently-live posting as already-seen and queues **nothing**.
About 8,400 postings on a first run.

Without this, a first run hands you thousands of listings from previous cycles as if they
were new. The cold start is also the recovery path: if `state.json` is lost, the next poll
cold-starts rather than flooding you.

### The enrichment step

Greenhouse's board **list** endpoint returns no description. Citizenship and sponsorship
requirements live in the description. So a title-only filter cannot see them.

`poll` fetches the description for Greenhouse postings that already passed the cheap title
filter, then decides. Measured across 32 sampled postings, **12.5% flip from eligible to
ineligible** once the description is readable. On one board, all six sampled internships
required US citizenship and all six were passing.

Queue items carry `eligibilityVerified` so an un-enriched posting is never mistaken for a
checked one.

## The shared cores

Three modules run in two places — the Node CLI and the browser extension:

| Module | Decides |
|---|---|
| `validator.core.js` | Is every claim in this answer traceable? |
| `selects.js` | Does this dropdown resolve from a declared field? |
| `matching.core.js` | Which answer belongs in this field? |

They are written once, have **no imports**, and are copied verbatim into
`extension/vendor/` by `npm run build:ext`. A test fails if a copy goes stale or an import
sneaks in, and CI rebuilds and diffs them on every PR.

This matters because `bamboo check` validates your answer bank in Node while the extension
fills forms in the browser. If those two disagreed about what counts as honest, `check`
would report ready while the extension submitted something else. The failure would be
invisible until an employer read it.

`matchQuestion` was the third of these and, for a while, the exception — it existed as two
hand-written copies that were already textually different. They happened to agree. Nothing
enforced it.

## Trade-offs

**Polling costs bandwidth.** Board payloads are 2–6 MB and all 65 are refetched every
cycle, about 50 seconds. Conditional requests would cut that substantially and are not
implemented.

**`state.json` grows without bound.** Roughly 8,400 entries after a cold start, rewritten
in full every cycle, with no pruning. Fine now, and a real cost at a 5-minute interval over
months.

**Three vendors is 30% coverage.** Chasing the long tail means a bespoke form mapping per
host. The four concentrated hosts are the obvious next targets; the other 39 probably never
pay for themselves.

**The extension needs a browser open.** It rides your real logged-in session, which is what
avoids storing credentials for 40 employer sites. The cost is that nothing submits while
Chrome is closed.

## Alternatives considered

**Headless browser with a persistent profile.** True unattended operation, easier
deterministic testing. Rejected because a persistent profile holding logins for dozens of
employer accounts is a credential store by another name, and this project has no business
owning one.

**Scraping the aggregator's rendered README.** Simpler than the API adapters. Rejected once
measurement showed the repo's staleness — a faster parser of a stale source is still stale.

**Workday integration.** It looks significant from the outside. It is 6.1% of listings,
gives every company a separate tenant, and requires account creation per employer. The
effort-to-coverage ratio is the worst of any option.

## Related

- [Configuration reference](reference-configuration.md) — eligibility and polling settings
- [Why it refuses](explanation-why-it-refuses.md) — the validator's reasoning
- Diagrams: [ingestion](../diagrams/bamboo-ingestion.svg), [refusal gate](../diagrams/bamboo-refusal-gate.svg)
