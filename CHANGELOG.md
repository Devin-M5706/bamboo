# Changelog

Notable changes. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
This project is pre-1.0; the CLI surface may change between minor versions.

## [Unreleased]

### Added
- `bamboo contacts <company>` — engineers from GitHub's public org API, plus LinkedIn
  search URLs for you to open yourself. Outreach drafts run through the same validator
  as an application.
- Repo infrastructure: CI matrix (Node 22/24 × Linux/Windows), invariant guards,
  PR and issue templates, CODEOWNERS, Dependabot.

### Fixed
- **`bamboo init` could destroy the ledger.** `saveInit` treated "file missing" and
  "file has a trailing comma" as the same event, substituting an empty ledger on a parse
  error and writing it over the real one. All writes are now atomic (temp + fsync +
  rename), corrupt files refuse rather than default, and the ledger keeps a `.bak`.
  Found by `/plan-eng-review` (A1, P0).

## [0.2.0] - 2026-08-12

### Added
- Five terminal screens from the design handoff: banner, live feed, evidence ledger,
  `init` wizard, help. Truecolor with plain-text fallback under `NO_COLOR`, `--no-color`,
  or a non-TTY pipe.
- Dropdown resolver (`src/selects.js`) with trace-or-refuse across four strategies.
  Work authorization is an enum, not a boolean, because collapsing "requires sponsorship"
  into "authorized for any employer" would put a false legal statement on an application.
- `bamboo survey` — samples real Greenhouse forms via the detail endpoint.
- `bamboo setup` / `where` — user data moved to `~/.bamboo` so a global install survives
  updates.

### Fixed
- **Citizenship gate was leaking.** Greenhouse's board list endpoint returns no
  description, so citizenship requirements were invisible and title-eligible postings
  passed the filter. Measured: 12.5% of sampled postings flip to ineligible once the
  description is fetched. On Rocket Lab, all 6 sampled internships require citizenship
  and all 6 were passing.
- An npm script named `install` broke `npm i -g` — it is a reserved lifecycle hook and
  fired before the package was unpacked.

### Changed
- Renamed from `jobapplr` to `bamboo`.

## [0.1.0] - 2026-08-11

### Added
- Initial MVP: board token miner, poller across Greenhouse/Lever/Ashby public APIs,
  eligibility gates, trace-or-refuse text validator, MV3 Chrome extension.
- Verified live: 65 boards mined, 8,291 postings recorded on cold start, second cycle
  correctly queued 0 new in 50s.
