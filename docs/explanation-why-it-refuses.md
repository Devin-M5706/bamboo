# Why bamboo refuses

Most tools in this category will always produce an answer. bamboo will sometimes produce
nothing and tell you why. That is the design, and this is the reasoning behind it.

## The problem

Every job-application tool faces the same moment: a form has a text box, the box needs
words, and the person is not there.

The industry answer is to generate the words at submit time. A model reads the job
description and your resume, writes something plausible, and submits it.

That moment is the worst possible place to put a language model. Consider what is actually
true about it:

- **The output is permanent.** It goes into an applicant tracking system under your legal
  name. There is no edit button.
- **You are accountable for it.** A recruiter can ask you about it in a screen six weeks
  later. "The tool wrote that" is not an answer that survives.
- **You will never see it.** By construction, autonomous means unreviewed. If it invents a
  project, you find out when someone asks you to walk through it.
- **The failure is silent.** A fabricated detail looks exactly like a real one. Nothing
  fails, nothing errors, and the application looks fine.

The last point is what makes this different from ordinary software bugs. A crash tells you
something is wrong. A confidently wrong sentence on an application tells you nothing until
it costs you.

## The approach

Move the writing earlier, and make the tool structurally incapable of inventing at submit
time.

```
  OFFLINE, days before                    APPLY TIME
  ────────────────────                    ──────────
  you write a fact  ──────┐
  you write an answer ────┤
                          v
                    validator                  retrieve ─── fill
                  every claim                     │
                  traceable?                      │
                    │      │                      │
                  yes     no                  no match?
                    │      │                      │
                  bank   fix it                REFUSE
```

At apply time there is no model. There is a lookup, a string check, and a decision to fill
or refuse. The interesting work happened days earlier, when you were awake and could edit.

Three rules make it hold:

**1. Missing beats wrong.** A blank optional field costs you a little. A false claim costs
you the interview and possibly the relationship with that employer. So an unanswerable
question produces nothing, and a required unanswerable question abandons the whole
application rather than half-filling it.

**2. Every claim traces to something a person verified.** The validator extracts the
numbers and proper nouns from an answer and checks each against the ledger facts that
answer names. `Kubernetes` in the text and not in the facts is a refusal. So is `90%` when
the fact says `40%`.

**3. Refusals are loud.** Every refusal names the question, the reason, and the specific
untraceable claim. A silent skip would be a worse version of the problem this design
exists to solve.

## Dropdowns turned out to matter more

The original design assumed the hard part was essays. Measurement said otherwise.

Surveying 32 real Greenhouse internship forms: almost every free-text question appeared
**exactly once**, and they were logistics rather than essays — visa status, current
location, competing offer deadlines, street address. One posting in 32 asked anything
essay-shaped.

What recurs instead is dropdowns, and they are factual:

| Question | Frequency |
|---|---|
| Are you legally authorized to work in the United States? | 4 of 32, always required |
| Expected graduation year | 3 of 32 |
| Highest degree currently pursuing | 2 of 32 |
| FINRA registration, security clearance, GPA | scattered but always required where present |

"I am authorized to work in the United States for any employer" is a **legal assertion**,
not a preference. So the same rule applies: it resolves from a declared profile field or it
refuses. It is an enum with four values rather than a boolean, because collapsing
"requires sponsorship" into "authorized for any employer" would put a false legal statement
on a real application.

This finding made the refusal machinery matter *more*, not less. A wrong visa status
auto-submitted is worse than a mediocre essay.

## Trade-offs

Naming what this costs, because every design gives something up.

**You do real work before the tool does anything.** Writing 15–25 verified facts takes an
hour or two, and nothing can shortcut it — the entire value is that a person checked each
one. Competing tools work in five minutes. They work by doing the thing this tool refuses
to do.

**It will refuse things you could have answered.** The validator is a string-level check
with no understanding. Write "Greenhouse" when your fact says "three ATS APIs" and it
refuses, even though you know they mean the same thing. The fix is a `tags` entry, but the
friction is real and it is the price of a check that cannot be talked into agreeing.

**Coverage is lower than a scraper's.** Custom dropdown widgets are reported rather than
faked, because clicking through a React select can leave a form looking answered while the
underlying value is unset. That is a visibly blank field instead of a silently wrong one,
and it means some forms need manual finishing.

**The honest version is slower.** That is the trade. It is the whole trade.

## Alternatives considered

**Generate then validate.** Let a model write freely, then check the output and regenerate
on failure. Rejected: a model that fails a check and tries again learns to produce text
that passes the check, which is not the same as text that is true. The retry loop optimizes
for the wrong target.

**Human review per application.** Queue everything for approval before submitting. This was
the original recommendation and the builder chose full autonomy instead. The corpus-level
review design was the reconciliation: review happens once, over the answer bank, rather
than per application. You get autonomy at submit time and still never ship a sentence you
have not read.

**Confidence thresholds.** Submit when the model is confident, queue when it is not.
Rejected: model confidence is not calibrated to factual accuracy, and a confidently
fabricated internship reads exactly like a confidently accurate one.

## Related

- [Data files reference](reference-data-files.md) — the ledger and answer schema
- [How to write your ledger](howto-write-your-ledger.md) — doing it
- [Boundaries](explanation-boundaries.md) — the other things it refuses
