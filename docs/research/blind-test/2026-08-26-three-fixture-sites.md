# Blind test: three fixture sites, 44 planted barriers

**Date:** 2026-08-26
**Run:** `npm run blind:test` (local, `tsx`, Chromium via `playwright-core`)
**Sites:** `fixtures/blind-test/{ridgeline-dental,fairview-township,kestrel-cloud}`
**Advisory:** `minimax/minimax-m3-free` — **did not run.** No gateway credential
and no egress to the gateway from this machine, so `phaseMs.advisory` is 0 on
all three runs and every judgement-class expectation is unanswered rather than
answered wrongly.

## What this is

Three four-page static sites, each written as a plausible non-auth client — a
dentist's brochure, a township, a SaaS signup flow — with 44 known barriers and
correct implementations planted in them. Each is recorded in that site's
`answer-key.json` **before** any run, with the mechanism that should catch it:

| `expect` | Meaning |
|---|---|
| `deterministic` | an axe violation |
| `needs-review` | axe reaches no verdict — the human-review queue |
| `judgement` | no rule can decide it; the advisory pass or nobody |
| `clean` | correctly built, and must not be reported at all |

The point of the `clean` rows is that a detector you cannot trust to stay quiet
is not a detector. The point of `judgement` is that it is the half of the
product with no measurement behind it.

## Result

| Site | Verdict | Score | Findings | Gating | Undecided | Journey |
|---|---|---|---|---|---|---|
| Ridgeline Dental | `fail` | 98 | 8 | 5 | 2 | 5.6s |
| Township of Fairview | `fail` | 97 | 13 | 3 | 2 | 4.9s |
| Kestrel Cloud | `fail` | 97 | 11 | 5 | 0 | 4.8s |

All three failed, on Level A/AA criteria, with complete evidence and no
truncation. Twelve pages walked in 15.3s of browser time.

By what was planted:

| Planted as | Count | Seen | Notes |
|---|---|---|---|
| `deterministic` | 19 | 16 | 14 by the predicted rule, 2 by another (§4); 1 downgraded to needs-review, 2 missed |
| `needs-review` | 4 | 2 | 2 missed |
| `judgement` | 14 | 1 | advisory dark; the one hit was caught by a rule |
| `clean` | 7 | 7 quiet | **zero false positives** |

**Note the score.** Every site scored 97–98 while failing. That is the
documented shape — the score is a rate over the checks axe evaluated and the
verdict is not — but 17 of the 37 planted barriers were never reported at
all, between 42% and 50% of them on each site, and a 98 next to `fail` is
still the number a client will quote back. Thirteen of those seventeen are the
advisory's half, dark on this run; the other four are barriers a rule could
have reached.
It is right by its own definition and misleading in a sentence.

## Where this stands: re-run 2026-08-29 on master

Everything below this section is the record of the 26 August run and is left
as it was — a dated measurement is evidence, not a page to keep current. This
is where the same three sites stand on master (`cb79cb1`) three days later.

| | 08-26 baseline | 08-27 advisory live | **08-29 master** |
|---|---:|---:|---:|
| `deterministic` (19) | 16 | 16 | **18** |
| `needs-review` (4) | 2 | 2 | **3** |
| `judgement` (14) | 1 | 6 | **5** |
| **barriers seen (37)** | **19** | **24** | **26** |
| `clean` (7) — false positives | 0 | 0 | **0** |

**The advisory was dark for this run**, so it is comparable to the 08-26
baseline rather than to 08-27: no `AI_GATEWAY_API_KEY`, no `VERCEL_OIDC_TOKEN`,
and no egress to the gateway from the machine that ran it. Which makes the
headline the interesting part — **the rules alone (26) now find more than rules
plus a live model did on the 27th (24)**. Five of the fourteen judgement-class
barriers are caught deterministically now, by the three checks named after
them (`click-handler-not-focusable`, `placeholder-as-only-label`,
`visible-label-not-in-name`) and by HTML_CodeSniffer's technique coverage. What
was the advisory's exclusive territory is being taken from it by rules, which
is the cheaper and more defensible half.

**Zero false positives held** across all seven correct implementations — now
under 135–142 findings per site rather than 8–13. That number is the guard on
everything above it, and adding a whole second engine did not move it.

**The review queue is reported honestly for the first time** (#162). The
summary line reads `132 to review (2 axe-undecided)` where it used to read
`2 undecided`, on a run whose findings carry 132 items at `needs-review`.
Verdicts, scores and gating counts are unchanged by that fix, which is what it
was supposed to leave alone.

Eleven barriers remain unseen, nine of them judgement-class. The two a rule
could reach are C5 (`role="tab"` with no `aria-selected`) and B5 (five links
reading "Download", each to a different PDF).


## What it missed, and why each one matters

### 1. A form field labelled only by its placeholder is called clean (A10)

`<input id="appt-date" placeholder="Preferred date">` produced no finding.
axe's `label` rule accepts a placeholder as an accessible name, so the pass
counts it and the human-review queue never sees it. The barrier is real —
the label disappears the moment the user types — and this is the single most
common form defect on small-business sites.

Adjacent and better: `label-title-only` **did** fire on the township's
title-only search box (B7). So the engine has a rule for the tooltip case and
none for the placeholder case, and the product inherits that asymmetry
silently.

### 2. A video with no captions cannot fail a run (B6)

`video-caption` came back `incomplete`, so a Level A 1.2.2 barrier lands in the
human-review queue rather than gating. That follows the steady-state rule —
an undecided check never fails a run — and it is correct as written. Worth
saying out loud anyway: for a municipality publishing council recordings, the
most consequential barrier on the site is one the gate structurally cannot
reach.

### 3. Keyboard operability is invisible (B3, C1)

Both sites' primary navigation is `<div onclick>` — no role, no `tabindex`, no
href. Nothing was reported on either. axe-core ships `focus-order-semantics`
disabled, and the product does not turn it on. A site whose entire menu cannot
be reached by keyboard scores 97 and fails only for unrelated reasons.

This is the largest single gap the test found, because it is both severe (2.1.1
Level A) and common in exactly the hand-rolled-widget sites this product is
sold against.

### 4. Noticed, but for a different reason (B1, C6)

The skip link targets `#main-content`, which does not exist. `skip-link` did
not fire; `region` did, because the link sits outside a landmark. An operator
reading that report is told the page has content outside landmarks, not that
the bypass mechanism is broken. The scorer records this as
`predictedRuleFired: false` for exactly this reason.

C6 is the same shape and almost none of the cost. The annual-billing switch
has no accessible name; `aria-toggle-field-name` did not fire and
`button-name` did — a more general rule naming the *same* defect, and at
critical rather than `region`'s minor. Reported for a different reason is not
the same as reported uselessly, and the difference between these two is why
the scorer records the substitution rather than scoring it: 16 of the 19 were
reported, 14 by the rule predicted for them.

### 5. Label-in-name is unchecked for inputs (B9)

Visible label "Email address", `aria-label="Contact"`.
`label-content-name-mismatch` never fired — it applies to elements with visible
text inside them, and an input's label is external. 2.5.3 is therefore not
covered for form fields at all, which is the place it matters most.

### 6. Identical link text is not evaluated (B5)

Five links reading "Download", each to a different PDF. Nothing.
`identical-links-same-purpose` is not in the enabled set.

### 7. ARIA widget state is unchecked (C5, C7)

`role="tab"` with no `aria-selected`, no `tabindex`, no `aria-controls`:
nothing. A real data table carrying `role="presentation"`: nothing. The engine
checks that required ARIA attributes exist where the spec says *required*, and
neither of these trips that test — but both destroy the semantics they claim.

### 8. Everything requiring reading comprehension (13 of 14)

`alt="image1"`, "Click here", a fee table whose header row is styled `td`s,
open/closed indicated only by a green or red dot, "Error: invalid input.",
password rules only in a placeholder, a German quotation in an English page.
Every one of them was planted for the advisory pass; the advisory pass has
still never run.

This is not a new gap — `AGENTS.md` records it — but the test now puts a number
on it: **14 of 44 barriers on three ordinary sites are in the class only the
advisory can reach**, and one of them was caught by accident.

## What it got right

- **Zero false positives across seven correct implementations**, including a
  decorative image with `alt=""`, a properly labelled field, a valid
  `autocomplete` token, and a `lang`-tagged foreign-language quote. Nothing was
  invented.
- 16 of 19 predicted violations reported, **14 of them by the predicted rule**,
  with the right criterion and level on each. The other two fired a different
  rule (§4) — which cost nothing in one case and everything in the other.
- Both planted needs-review cases — white text over a photograph and over a
  gradient — landed in the human-review queue rather than being guessed at.
- Two barriers nobody planted: `empty-table-header` on the township's meetings
  table and a contrast failure on the Kestrel hero. Both real.
- Multi-page evidence held: 4/4 pages per site, complete, no truncation, and
  every finding carried its `pageUrl`.

## Suggested work, in the order the evidence supports it

1. ~~**Run the advisory once.**~~ **Done, 2026-08-27** — barriers seen went
   19→24 of 37, judgement 1→6 of 14, zero false positives held, and the one
   `advisory 0` took new instrumentation to explain: a genuine empty answer
   from a model that reports 0–9 findings on identical input. See
   [`2026-08-27-advisory-first-run.md`](2026-08-27-advisory-first-run.md).
2. **Decide on the placeholder-as-label case.** Either enable a check for it or
   record it as a known blind spot; today it silently counts as a pass.
3. **Decide on keyboard operability.** `focus-order-semantics` exists and is
   disabled upstream for false-positive reasons. Turning it on has a cost this
   test can now measure — the seven `clean` rows are the guard against it.
4. **Consider surfacing "reported, but not for this reason".** The skip-link
   case is the shape of a report that reads as coverage and is not — and C6 is
   the shape that reads the same way and *is*, so the distinction has to be
   made per finding rather than by counting.

## Reproducing

```bash
npm run blind:test                          # all three, scorecard to stdout
npm run blind:test -- --site kestrel-cloud  # one site
```

Full reports land in `.blind-test/<site>.json` (gitignored): the whole run
record plus the scored answer key. Nothing is written to a run store — a
fixture audit must not appear on a portfolio screen.
