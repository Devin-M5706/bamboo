# Security

## What this project handles

bamboo holds data that is sensitive in a specific way. Not passwords, but:

- **Work authorization and visa status** (`~/.bamboo/ledger.json`) — the answers it
  gives here are legal assertions on real applications
- **Application answers and employment history** (`~/.bamboo/answers.json`)
- **A Jina API key**, if configured (`~/.bamboo/.env`)

None of it leaves your machine. There is no server, no telemetry, and no network call
that carries your ledger.

## Boundaries the code holds on purpose

**It does not scrape LinkedIn.** `bamboo contacts` builds search URLs for you to click
while logged in. Automated LinkedIn access violates their User Agreement and gets
accounts restricted. A PR that adds LinkedIn fetching will be rejected.

**It does not store credentials for employer sites.** The extension rides your existing
browser session. There is no credential store to leak.

**It cannot upload your resume.** Browsers do not let scripts populate file inputs. That
is a security boundary worth having, and we do not work around it.

**Dry run is the default.** Nothing is submitted to an employer until you explicitly turn
it off, and the options page refuses to enable live mode with an empty ledger.

## Reporting a vulnerability

Open a private security advisory:
https://github.com/Devin-M5706/bamboo/security/advisories/new

Please do not open a public issue for anything that could expose a user's ledger,
credentials, or browser session.

What is in scope and worth reporting:

- A path where generated text reaches an employer without passing the validator
- A path where a dropdown resolves to an option not derived from a declared profile field
- Anything that writes `ledger.json` non-atomically or without distinguishing a corrupt
  file from a missing one
- Anything that transmits `~/.bamboo` contents anywhere
- Extension permissions broader than the four ATS hosts in `manifest.json`

The first three are correctness bugs that happen to be security bugs: the harm is an
untrue statement submitted under a real person's name.
