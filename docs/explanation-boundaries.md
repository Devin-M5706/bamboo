# Boundaries bamboo will not cross

Four things this tool deliberately does not do. Each one is a capability that would be
straightforward to build, and each is left unbuilt on purpose.

These are not TODOs. A pull request implementing any of them will be rejected.

---

## LinkedIn is never fetched

`bamboo contacts <company>` finds people worth talking to. It fetches engineers from
GitHub's public organization API, and for recruiters and hiring managers it builds LinkedIn
search URLs that **you** open, logged in, as a person.

### The problem with automating it

LinkedIn's User Agreement prohibits automated access. Enforcement is account restriction.

The asymmetry is what settles it: the upside is saving a few clicks; the downside is losing
the account you need most, during the season you need it. A restricted LinkedIn account
during a recruiting cycle is a serious, hard-to-reverse loss, and no amount of contact
automation is worth that trade.

There is also a second party. Bulk profile collection gathers personal data about people
who did not consent to being in your database. Looking someone up to send them a message is
ordinary networking. Harvesting a company's org chart into a local file is a different
activity wearing the same clothes.

### What it does instead

```
✓ engineers · github.com/stripe          ← fetched, public API, documented
@barreeeiroo  Diego Barreiro Perez       Software Engineer @ Stripe

→ open these yourself, logged in         ← built, not fetched
  technical recruiter    https://linkedin.com/search/results/people/?keywords=...
```

The search keywords are the titles people actually put in their headline. "Hiring manager"
is not a LinkedIn title and finds nobody; "engineering manager" and "technical recruiter"
do.

The screen prints the reasoning in its own output, so it travels with the tool rather than
living only in this document.

---

## No credentials for employer sites

The extension rides your existing browser session. There is no login flow, no credential
store, no cookie jar.

### Why

The alternative is a headless browser with a persistent profile you log into once. It works,
and it enables true unattended operation. It also means one directory on your machine holds
active sessions for several dozen employer accounts.

That is a meaningful thing to own. It has to be secured, backed up carefully, and reasoned
about if the machine is lost or shared. For a personal tool whose job is filling forms, the
security burden badly outweighs the convenience.

Riding the real session means bamboo never holds a secret it could leak.

**The cost:** nothing happens while Chrome is closed. That is the trade, taken knowingly.

---

## Resumes are always uploaded by hand

Browsers do not let scripts populate `<input type="file">`. bamboo does not work around it.

This one is not really a choice — it is a browser security boundary, and it is a good one.
A page that could silently attach files from your disk would be a serious vulnerability.

What bamboo does is tell you clearly:

```
Resume upload is always manual -- browsers do not let scripts set file inputs.
```

`resumePath` exists in the profile schema for your own reference. Nothing reads it to
perform an upload.

---

## Nothing is submitted without an explicit opt-in

Dry run is the default in three separate places, and CI asserts all three:

1. `src/config.js` — `DRY_RUN_DEFAULT = true`
2. `extension/content/apply.js` — the settings fallback
3. `src/ui/init.js` — the preselected answer on the submit question

In dry run the extension fills the form and stops. You see exactly what it would have
submitted, in the real form, before anything is sent.

### Why three places and a CI check

Defaults drift. Someone flips one to make a demo easier, the other two stay, and the code
now disagrees with itself about the single most consequential setting it has.

The `invariant guards` CI job greps for all three on every pull request. It is a crude
check and that is fine — the property it defends is worth defending crudely.

The extension's options page separately refuses to enable live mode with an empty ledger,
because an empty ledger plus live mode means submitting blank or unvalidated applications
under your name.

See [How to go live](howto-go-live.md) for the checklist before turning it off.

---

## The pattern

Each boundary follows the same shape:

| | The capability | Why not |
|---|---|---|
| LinkedIn | Scrape profiles | Breaks their terms; costs you the account you need |
| Credentials | Store employer logins | Creates a secret worth stealing, for convenience |
| Resume | Auto-upload | Browser security boundary, correctly placed |
| Submission | Default to live | Removes the last human checkpoint |

In every case the capability is easy and the reason not to build it is about **what happens
when it goes wrong, to whom, and how reversibly**.

That is the same reasoning as the [validator](explanation-why-it-refuses.md): a tool acting
on your behalf, under your name, in a context that is hard to undo, should be conservative
where the downside is asymmetric.

## Related

- [Why it refuses](explanation-why-it-refuses.md)
- [How to go live](howto-go-live.md)
- [`SECURITY.md`](../SECURITY.md) — reporting a vulnerability
