# How to turn off dry run

You will move bamboo from filling forms and stopping, to actually submitting applications
under your name.

**Read the checklist before the steps.** This is the one setting in bamboo with a
consequence you cannot take back.

## Prerequisites

Every one of these, not most of them:

- [ ] `bamboo check` exits `0` with zero refusals
- [ ] You have watched it dry-run **at least five real forms**, on more than one vendor
- [ ] You have read every answer in the bank end to end, recently
- [ ] Your `workAuthorization` is correct — it is a legal assertion, not a preference
- [ ] You know that resume upload stays manual, so a submitted application may be missing it

If you cannot tick all six, stop here. Dry run is not a training-wheels mode; it is a
reasonable permanent setting.

## Steps

### 1. Confirm you are actually ready

```bash
bamboo check
```

```
LEDGER   18 facts, valid
ANSWERS  12 entries, 0 refused
DROPDOWN 14/14 profile fields set
SUBMIT   DRY RUN (nothing will be submitted)

Ready.
```

Anything other than `Ready.` means not yet.

### 2. Dry-run five real forms and read the console

Open a real Greenhouse, Lever, or Ashby application with the extension loaded. Open
DevTools and filter the console for `[bamboo]`.

```
[bamboo] DRY RUN -- form filled, nothing submitted.
[bamboo]   filled: firstName, email, phone, answer:hardest_problem, select:Are you legally authorized... = I am authorized to work in the United States for any employer
[bamboo]   2 optional question(s) left blank (refused)
```

For each form, check three things:

1. **Every filled field is correct.** Especially the work-authorization dropdown — read the
   exact option it chose, not just that it chose one.
2. **Every refusal is one you agree with.** A refusal you disagree with means a missing
   fact, not a reason to bypass the check.
3. **Nothing was filled that you would not have written.**

Do this on more than one vendor. Form markup differs, and the selectors are the least
tested part of the system.

### 3. Turn it off

Open the extension's options page. Uncheck **Dry run**. Save.

The page refuses to enable live mode with an empty ledger.

### 4. Watch the first live submission

Do not walk away. Open one application, let it run, and confirm in the console:

```
[bamboo] SUBMITTED.
```

Then check the employer's confirmation email and, where possible, the application status in
their portal. Confirm the resume attached, since that step is manual.

## Verification

After your first live application:

- The console logged `SUBMITTED.`
- You received the employer's confirmation
- The submitted content matches what dry run showed you
- The resume is attached, or you attached it manually

## Turning it back off

Re-check **Dry run** on the options page. It takes effect on the next form; nothing is
queued or in flight.

Do this whenever you change the ledger or answer bank meaningfully. New content deserves a
dry run before it goes to an employer.

## Troubleshooting

**`ABORT: live mode but no submit button found`**
The form's submit control did not match any known selector. Nothing was submitted. Finish
this one by hand and report the vendor.

**`ABANDONED: required questions could not be answered from the ledger`**
A required field had no traceable answer, so bamboo abandoned rather than half-filling.
Working as designed. Add the missing fact and re-run.

**It submitted with a field you did not expect**
Re-check Dry run immediately. Then read the console report for that run — it lists every
field it filled and the value it used. Fix the ledger entry behind it before going live
again.

**Dry run keeps re-enabling itself**
The options page refuses live mode when the ledger is empty. Confirm the extension has your
ledger pasted in, not just the file on disk.

## Why this is gated so heavily

Dry run is the default in three places and CI asserts all three, because a submitted
application cannot be recalled. The failure mode is not a crash — it is a real employer
reading something wrong, under your real name, with no edit button.

See [Boundaries](explanation-boundaries.md#nothing-is-submitted-without-an-explicit-opt-in).

## Related

- [How to write your ledger](howto-write-your-ledger.md)
- [Why it refuses](explanation-why-it-refuses.md)
- [Configuration reference](reference-configuration.md#submission)
