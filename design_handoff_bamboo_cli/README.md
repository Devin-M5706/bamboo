# Handoff: bamboo CLI — banner + core screens

## Overview
`bamboo` is a Node.js CLI that watches job boards and drafts applications from a
verified "evidence ledger". This bundle covers its terminal look: the startup
banner (lapdog-style pixel wordmark + red panda mascot), the live watch feed, the
evidence ledger view, the `init` wizard, and the help/command menu.

## About the design files
The files here are **design references authored in HTML** — a prototype of how the
terminal output should look, not code to ship. `Bamboo CLI.dc.html` is a browser
mock; recreate it as **ANSI terminal output in the bamboo codebase** (Node.js).
`banner.js` is the one exception: it is real, dependency-free, runnable Node that
reproduces the banner exactly. Drop it in and call it.

## Fidelity
**High fidelity.** Colors, copy, column layout and spacing below are final. Match them.

---

## Quick start (the banner)

```bash
cp design_handoff_bamboo_cli/banner.js src/ui/banner.js
node src/ui/banner.js        # prints the hero as a smoke test
```

```js
const { hero, wordmark, panda, PALETTE, fg, RESET } = require('./ui/banner');
console.log(hero({ version: 'v0.2.0' }));
```

**How it works.** The sprites are stored as pixel grids and rendered with Unicode
upper-half-blocks (`▀`): foreground color = upper pixel, background color = lower
pixel, so one text row carries two sprite rows and the art keeps a square-pixel
aspect ratio. Requires a truecolor terminal (iTerm2, Windows Terminal, VS Code,
Ghostty, Alacritty — anything with `COLORTERM=truecolor`).

**Fallbacks to implement:** if `!process.stdout.isTTY` or `process.env.NO_COLOR`,
skip the art and print `bamboo v0.2.0` plus the blurb as plain text. Below 112
columns `hero()` already drops the panda and prints the wordmark alone (50 cols).

**API:** `hero({version, columns})` → full startup block · `wordmark()` → BAMBOO only
· `panda()` → sleeping mascot only · `PALETTE`, `fg(hex)`, `bg(hex)`, `RESET` → the
color helpers every other screen should use.

---

## Design tokens

| Role | Hex | Used for |
| --- | --- | --- |
| ground | `#1f212d` | terminal background the mock assumes |
| text | `#d7dae5` | primary output |
| textDim | `#9a9eb0` | secondary output, prompt line |
| muted | `#7f8698` | status bar, labels |
| faint | `#565b6e` | timestamps, table headers, hints |
| orange | `#e8783f` | brand, prompt `❯`, needs-attention, command names |
| orangeLit → orangeDim | `#fbc79f` → `#d55c17` | wordmark gradient, top to bottom |
| extrude | `#5d2309` | wordmark drop-shadow, offset +2px down/right |
| mint | `#4fc3a1` | verified / safe / success — matches, drafted, DRY RUN, cwd |

Rule of thumb: **orange = bamboo speaking or asking**, **mint = something verified
or safe**, **faint = metadata**. Never color body copy in anything else.

Type: the mock uses JetBrains Mono 13px/1.85 — in the terminal that is just the
user's font; what matters is that every screen is monospace-column aligned.

## Sprites
- `assets/banner.png` — BAMBOO wordmark, 6px-wide letters (M is 8), 11px tall,
  2px strokes, 3px letter gap, 2px extrude. Glyph maps are in `banner.js`.
- `assets/mascot-sleeping.png` — sleeping red panda, 56×21 in `banner.js`'s grid.
- `assets/mascot.png` — the awake red panda face (26×23), unused in the hero;
  good for `bamboo status` or the `init` sidebar.

---

## Screens

### 1. Startup banner — `bamboo watch`
Prompt line, then: sleeping panda, 3-column gap, wordmark (bottom aligned), then
the blurb block. On wide terminals the blurb can sit to the right at column 116;
at ≤140 columns print it under the art, left aligned.

Copy, exactly:
```
bamboo v0.2.0
Watching 65 job boards so you never have to hit refresh again.
Applications are filled from your evidence ledger. Anything it can't trace back to a verified fact, it won't claim.
DRY RUN  nothing is submitted until you say so
```
`bamboo` bold orange, version faint, blurb text-colored, `DRY RUN` bold mint with
the trailing clause in textDim.

### 2. Live feed — `bamboo watch --boards all --min-match 60`
Five aligned columns, two spaces minimum between them:

| col | width | color |
| --- | --- | --- |
| timestamp `HH:MM:SS` | 8 | faint |
| board slug (`greenhouse`, `lever`, `ashby`, `workday`) | 11 | muted |
| `Company · Role (location)` | flex | text; location in faint; whole row muted when skipped/expired |
| match score | 3, right | mint ≥70, orange 60–69, muted below/`—` |
| verdict (`drafted`, `skipped`, `needs you`, `expired`) | 9 | same color as the score |

A reason line may follow any row, indented to the description column and prefixed
`└ ` in faint — e.g. `└ no ledger evidence for "Kubernetes" — bamboo ledger add to fix`
(the command inside it in orange).

Status bar, separated by a faint rule (`─` full width):
`● 65 boards` (dot mint) · `4 drafts waiting` (number orange) · `112 seen today` ·
right-aligned key hints `d review drafts  f filter  q let the panda nap` (keys
textDim, labels faint).

New rows append; the status bar redraws in place (ANSI cursor save/restore, or
`log-update`). One row per posting, no spinner between them.

### 3. Evidence ledger — `bamboo ledger`
Table: `ID` (3) · `CLAIM` (flex) · `SOURCE` (right-ish) · `USED` (right, 4).
Header row in faint uppercase with a faint underline rule. IDs faint, claims text,
verified sources mint prefixed `✓ `, unverified sources orange, use-count textDim.
An unverified row gets a faint `└ ` note: `blocked 6 applications this week. Add a
source or drop it.` Footer: `5 entries · 4 verified · 1 needs a source` with the
counts colored mint and orange.

### 4. Setup — `bamboo init`
Sequential prompts. Answered ones collapse to `✓ ` (mint) + question (muted) +
answer (text). The active question is `? ` (orange) + white question + faint hint
(`space to toggle, enter to accept`). Choices: `◉`/`◯` in mint/faint, label in text,
counts in faint. The highlighted row gets a 2-col orange left bar and an
`rgba(232,120,63,.13)` background — in the terminal, use a dim orange background on
that line only. Unanswered future questions render entirely faint.
Progress: `━` bar, filled orange / unfilled `#3a3e50`, plus `step 3 of 5` in muted.
Right sidebar (≥120 cols, separated by a faint vertical rule at 2 spaces): `PREVIEW`
label in faint, then the estimate copy with numbers in orange/mint.

### 5. Help — `bamboo --help`
Two columns: command in orange (left, width 7), description in muted.
`init`, `watch`, `review`, `apply`, `ledger`, `boards`, `status`, `nap`.
Footer in faint: `--dry-run is the default.` + `--for-real` in mint + ` is not.`

---

## Interactions & behavior
- `watch` is a long-running TTY view: raw mode, `d`/`f`/`q` keys, Ctrl-C exits clean
  (show cursor again, reset colors).
- Every write goes through the palette helpers — no raw ANSI codes scattered around.
- Respect `NO_COLOR`, `--no-color`, and non-TTY stdout (pipes get plain text, no art,
  no cursor movement).
- Nothing is ever submitted without an explicit `--for-real`; the DRY RUN line is not
  decoration, it is the product's promise.

## State the CLI needs
Board registry + poll cursor per board; seen-posting ids (dedupe); draft queue with
status (`drafted`/`needs you`/`skipped`+reason); the ledger (id, claim, source,
verified flag, use count); config from `init` (boards, interval, auto-submit
threshold, ledger path).

## Files in this bundle
- `banner.js` — runnable banner renderer (copy into the codebase)
- `Bamboo CLI.dc.html` + `support.js` — the HTML mock of all five screens; open in a browser
- `assets/` — the sprite PNGs

Note: the HTML mock references a design-system stylesheet that is not bundled, so
the page chrome around the terminal panels will look unstyled. The terminal panels
themselves — the part that matters — render exactly as designed.
