# bamboo documentation

Organised by what you are trying to do, following
[Diataxis](https://diataxis.fr/): learning, doing, looking up, understanding.

## Start here

**[Getting started](tutorial-getting-started.md)** — install to real job postings in about
15 minutes. Start here if you have never run bamboo.

## How-to guides

Task-oriented. You know the basics and want to accomplish something.

| Guide | For when you want to |
|---|---|
| [Write your evidence ledger](howto-write-your-ledger.md) | Give bamboo facts it is allowed to claim. **The gating step.** |
| [Turn off dry run](howto-go-live.md) | Actually submit applications. Read the checklist first. |
| [Add a dropdown rule](howto-add-a-dropdown-rule.md) | Teach bamboo a dropdown it currently refuses. |

## Reference

Complete and factual. For looking something up.

| Document | Covers |
|---|---|
| [CLI](reference-cli.md) | Every command, flag, and exit code |
| [Configuration](reference-configuration.md) | Env vars, paths, eligibility gates, all 14 dropdown rules |
| [Data files](reference-data-files.md) | Ledger and answer-bank schemas, and the files bamboo maintains |

## Explanation

Why things work this way. Read these when a constraint feels arbitrary.

| Document | Answers |
|---|---|
| [Why bamboo refuses](explanation-why-it-refuses.md) | Why it would rather write nothing than something plausible |
| [Architecture](explanation-architecture.md) | Why the aggregator is a directory and not a feed |
| [Boundaries](explanation-boundaries.md) | Why LinkedIn is never scraped, and three other things it won't do |

## Diagrams

- [Ingestion pipeline](../diagrams/bamboo-ingestion.svg) — aggregator to queue
- [Refusal gate](../diagrams/bamboo-refusal-gate.svg) — what happens at a real form

Sources are `.mmd`; editable scenes are `.excalidraw` and open at excalidraw.com.

## Other files

| File | Contents |
|---|---|
| [README](../README.md) | The pitch and the 60-second path |
| [CONTRIBUTING](../CONTRIBUTING.md) | Setup, branch naming, the invariants CI enforces |
| [SECURITY](../SECURITY.md) | What bamboo holds, and reporting a vulnerability |
| [CHANGELOG](../CHANGELOG.md) | What changed and why |
| [CLAUDE.md](../CLAUDE.md) | Guidance for AI agents working in this repo |

---

## If you read one thing

[Why bamboo refuses](explanation-why-it-refuses.md). Every other constraint in this project
follows from it, and the tool makes considerably more sense once you know why writing your
own facts is the price of admission.
