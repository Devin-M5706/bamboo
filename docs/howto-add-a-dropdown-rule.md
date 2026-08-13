# How to add a dropdown rule

You will teach bamboo to answer a dropdown it currently refuses, by adding a rule that
resolves from a typed profile field.

Do this when a question recurs across employers. For a one-off question specific to a single
company, use [an override](#alternative-a-one-off-override) instead.

## Prerequisites

- A clone of the repo (this changes source, not config)
- The exact question text and its option labels from a real form
- `npm test` passing before you start

## Steps

### 1. Get the real question and options

Never write a rule against an imagined form. Get the actual labels:

```bash
bamboo survey
```

Then read the survey output:

```bash
node -e "const s=require(process.env.USERPROFILE+'/.bamboo/questions-survey.json');
  s.selects.slice(0,15).forEach(p=>console.log(p.jobs+'x', p.label))"
```

Note the exact option labels. `"Bachelor's Degree"` and `"Bachelors Degree"` are different
strings, and the resolver compares normalized text.

### 2. Pick a strategy

| Strategy | Use when | Example |
|---|---|---|
| `exact` | The profile value equals an option label | `"2028"` → `2028` |
| `prefix` | The option label starts with your value | `"3.7"` → `3.7 out of 4.0` |
| `boolean` | Options are Yes / No | `true` → `Yes` |
| `enum` | Several distinct options with different meanings | work authorization |

Reach for `enum` when the options are not interchangeable and picking the wrong one would
be a false statement. That is why work authorization is an enum rather than a boolean.

### 3. Add the rule

Edit `src/selects.js`. Rules are ordered; the first whose `match` hits the label wins, so
put specific patterns above general ones.

```js
export const RULES = [
  // ... existing rules
  {
    id: 'visa_type',
    match: /what (type|kind) of visa|current visa status/i,
    from: 'visaType',
    strategy: 'exact',
  },
];
```

| Field | Meaning |
|---|---|
| `id` | Stable identifier, reported in refusals |
| `match` | Regex against the question label |
| `from` | The `ledger.profile` field this reads |
| `strategy` | One of the four above |

**`src/selects.js` must have no imports.** It is copied verbatim into the extension.

### 4. Add the profile field to the template

Edit `data/ledger.example.json` so new users see the field exists:

```json
"visaType": "",
```

Document it in [`docs/reference-data-files.md`](reference-data-files.md) too.

### 5. Write the tests

Copy the real option labels into the fixture. This is the part that makes the rule
trustworthy.

```js
const VISA = {
  label: 'What type of visa do you currently hold?',
  required: true,
  options: ['F-1', 'H-1B', 'J-1', 'Not applicable'].map((l, i) => ({ label: l, value: i })),
};

test('visa type resolves from the profile', () => {
  const r = resolveSelect(VISA, { visaType: 'F-1' });
  assert.equal(r.ok, true);
  assert.equal(r.option.label, 'F-1');
});

test('REFUSES when the profile does not say', () => {
  const r = resolveSelect(VISA, {});
  assert.equal(r.refused, true);
  assert.match(r.reason, /visaType is not set/);
});

test('REFUSES a value the form does not offer', () => {
  const r = resolveSelect(VISA, { visaType: 'O-1' });
  assert.equal(r.refused, true);
});
```

**The refusal tests are not optional.** A rule that resolves correctly but fails to refuse
is worse than no rule — it will pick something when it should have stopped.

`test/selects.test.js` already has a test asserting that every question type refuses with an
empty profile. Your new fixture should be added to it.

### 6. Rebuild the extension copy and test

```bash
npm run build:ext
npm test
```

Skipping `build:ext` leaves the extension on the old rules. CI catches it, but catching it
locally is faster.

### 7. Verify against a real form

Load the extension, open a real application with that dropdown, and read the console:

```
[bamboo] DRY RUN -- form filled, nothing submitted.
[bamboo]   filled: select:What type of visa... = F-1
```

## Verification

- `npm test` passes, including your three new tests
- `git diff --quiet extension/vendor/` is clean after `build:ext`
- `bamboo check` lists your new field under `DROPDOWN`
- A real form fills the dropdown correctly in dry run

## Alternative: a one-off override

For a question specific to a single company, add an override in `~/.bamboo/answers.json`
instead. No code change:

```json
"selectOverrides": {
  "how did you hear about us": "Campus Career Center"
}
```

Keys are the question text lowercased, punctuation stripped, whitespace collapsed. The
value must match an option label exactly.

Overrides take precedence over rules.

## Troubleshooting

**`no rule for this question`**
Your `match` regex did not hit. Log the exact label from the survey output and test the
regex against that string — form labels often carry invisible whitespace or a trailing `*`.

**`profile.visaType = "F1" matched no single option`**
The value did not match any label. Check for punctuation: `F-1` and `F1` are different.

**Two options matched**
The resolver refuses on ambiguity rather than picking. Tighten the strategy or the value.

**Extension still refuses after the rule was added**
`npm run build:ext` was not run, or the extension was not reloaded at
`chrome://extensions`.

## Related

- [Configuration reference](reference-configuration.md#dropdown-resolution) — all 14 rules
- [Data files reference](reference-data-files.md) — profile schema
- [Why it refuses](explanation-why-it-refuses.md)
