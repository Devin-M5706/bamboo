# Getting started

By the end of this you will have bamboo installed, watching 65 job boards, and showing you
real internship postings it found. It takes about 15 minutes.

You will also see it refuse to answer a question, which is the part worth understanding.

## What you'll need

- **Node 22 or newer** — check with `node --version`
- **Git**
- Access to the bamboo repository
- A terminal. Windows Terminal, iTerm2, or anything with truecolor support

No API keys, no accounts, no configuration files to write yet.

---

## Step 1: Install it

```bash
npm install -g github:Devin-M5706/bamboo
```

Then create your data directory:

```bash
bamboo setup
```

```
  ✓ home  C:\Users\you\.bamboo
  + seeded  ledger.json
  + seeded  answers.json

  next  bamboo init to answer the questions real forms ask
```

Your data lives in `~/.bamboo`, deliberately outside the package. When you update bamboo,
npm replaces the code and leaves your ledger alone.

## Step 2: See it

```bash
bamboo
```

You should see a sleeping red panda next to the wordmark:

![bamboo banner](ui/banner.png)

If the panda is missing, your terminal is under 112 columns — widen it and run again. If
it is grey, your terminal lacks truecolor; try Windows Terminal or iTerm2.

That is bamboo working. Nothing is configured yet, and nothing has been submitted —
`DRY RUN` says so on the banner and will keep saying so until you explicitly turn it off.

## Step 3: Find real job postings

Two commands. First, get the list of companies to watch:

```bash
bamboo mine
```

```
Mining board tokens from the aggregator...
  read 401 listings
  found 65 boards: { greenhouse: 37, ashby: 23, lever: 5 }
```

Now poll them:

```bash
bamboo poll
```

This takes about 50 seconds. It fetches all 65 boards from Greenhouse, Lever and Ashby.

```
Cold start: recorded 8,291 existing postings as already-seen.
Nothing queued. The next poll will only surface genuinely new postings.
```

**That is correct, not a failure.** The first run records everything that already exists so
you are not handed thousands of stale listings. Run it again in a few hours and you will
see only new postings:

```
Polled 65 boards in 50s: 2 new, 2 queued.
  dropped: Senior Compensation Partner (title matched a deny pattern)
```

See what is queued:

```bash
bamboo feed
```

```
18:32:23  greenhouse   virtu · 2027 Internship (Dublin, Ireland)      —  needs you
18:32:23  greenhouse   dvtrading · Trading Intern (London)            —  needs you

────────────────────────────────────────────────────────────────────────────
● 65 boards · 2 drafts waiting · 8430 seen today
```

Real internships, found without you refreshing anything.

## Step 4: Meet the refusal

Now the part that makes bamboo different. Run the preflight:

```bash
bamboo check
```

![bamboo check](ui/check.png)

It says **NOT READY**, and that is bamboo working correctly.

Look at what it is telling you:

- `LEDGER 4 facts, INVALID` — the seeded file has placeholder facts marked unverified
- `ANSWERS 4 entries, 1 refused` — one answer names no supporting fact
- `DROPDOWN 0/14 profile fields set` — it does not know your work authorization, so it
  will refuse every form asking

bamboo will not fill a field it cannot back. Not with a guess, not with a hedge, not with
something plausible. It stops and names the reason.

That is the entire product in one screen.

## Step 5: Answer the questions real forms ask

```bash
bamboo init
```

Five questions, arrow keys to move, `space` to toggle, `enter` to accept:

```
✓ Which boards should bamboo watch?  Greenhouse, Ashby, Lever
✓ How often should it check?  Every 5 minutes
? Your work authorization in the US?  asked on 4 of every 32 forms, always required
   ◯ Authorized for any employer
 ▌ ◉ I need visa sponsorship
   ◯ Not authorized

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  step 3 of 5
```

Two of these are not preferences. **Work authorization** and **graduation year** feed the
dropdown resolver directly, and they are the most-required questions on real forms.

Ctrl-C cancels without writing anything.

Now run check again:

```bash
bamboo check
```

```
DROPDOWN 2/14 profile fields set
```

Two down. The refusals for those two questions are gone.

## What you built

You have bamboo watching 65 job boards, a queue of real postings it found, and a preflight
that tells you exactly what is still blocking you.

What you have **not** done is let it claim anything about you. That is deliberate: the
ledger is the one thing nothing can automate, because its whole value is that a person
verified each entry.

### Next steps

1. **[Write your ledger](howto-write-your-ledger.md)** — the 45–90 minutes that unlock
   everything else. Run `bamboo survey` first; it will tell you which questions actually
   recur, and it is not the ones you would guess.
2. **[Understand why it refuses](explanation-why-it-refuses.md)** — worth reading before
   you start writing, so the constraints make sense rather than feeling arbitrary.
3. **[Turn off dry run](howto-go-live.md)** — only after `bamboo check` says `Ready.` and
   you have watched it dry-run five real forms.

### If something went wrong

**`bamboo: command not found`**
Open a new terminal — the PATH entry needs a fresh shell. Still missing? Check that
`npm prefix -g` is on your PATH.

**`no boards found`**
Run `bamboo mine` before `bamboo poll`.

**Poll reports errors on some boards**
Normal. Companies rename and delete boards; a dead board is reported and skipped without
aborting the cycle.

**The banner has no colour**
You are piping, or your terminal lacks truecolor. `FORCE_COLOR=1 bamboo banner` forces it.

## Related

- [CLI reference](reference-cli.md) — every command
- [Architecture](explanation-architecture.md) — how postings get found
- [Boundaries](explanation-boundaries.md) — what bamboo will not do
