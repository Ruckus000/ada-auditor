# Milestone 1 exit: 19 → 26 of 37, and what the instrument itself taught

**Date:** 2026-08-27, evening. Third document in this folder's sequence:
the [dark baseline](2026-08-26-three-fixture-sites.md) (19/37), the
[advisory's first run](2026-08-27-advisory-first-run.md) (24/37), and now the
rule-shaped fixes. Same sites, same frozen answer keys, same scorer.

## Result

`[V]` Advisory live, one roll:

| | dark baseline | advisory live | after the fixes |
|---|---:|---:|---:|
| barriers seen (of 37) | 19 | 24 | **26** |
| deterministic (of 19) | 16 | 16 | **17** |
| judgement (of 14) | 1 | 6 | 6 |
| needs-review (of 4) | 2 | 2 | **3** |
| clean rows quiet | 7/7 | 7/7 | **7/7** |
| false positives | 0 | 0 | **0** |
| core barriers, deterministic only | 14/30 | 14/30 | **18/30** |

The roadmap's exit target was ≥28/37; this run reads 26. The shortfall is the
advisory's measured variance, not the fixes: Kestrel rolled `advisory 0` on
this run (`reported: 0` — the same genuine-empty-answer signature the
instrumentation run documented), which alone accounts for the gap. The
deterministic core — the reproducible, defensible half — moved 14/30 →
**18/30** and reads identically on every run.

## What closed, and what the closing taught

Three custom checks (`services/page-checks.ts`), each measured before and
after, with all seven `clean` rows quiet throughout:

- **A10** placeholder-only label → SEEN (`placeholder-as-only-label`)
- **B3, C1** `<div onclick>` navigation → caught (`click-handler-not-focusable`)
- **B9** label-in-name for inputs → caught (`visible-label-not-in-name`)
- plus Fairview's three unplanted twin tiles, correctly reported.

Two findings from the road there matter more than the checks:

1. `[V]` **The planned fix was measured and rejected first.** axe's nearest
   rules (`focus-order-semantics`, `label-content-name-mismatch`), enabled,
   produced zero output on fixtures containing their exact target defects —
   the ruleset stamp proves they ran. Applicability, not configuration: one
   examines only elements *in* the focus order, and a `<div onclick>` with no
   tabindex is not in it; the other only content-labelled elements, which an
   externally-labelled input never is. Enabling rules is not a coverage
   strategy; measuring them is.
2. `[V]` **A serialization boundary only a real browser could test.** The
   fact collector's page code, passed as a function, arrived in the page
   wrapped in esbuild's `__name` helper — present in the Node bundle, absent
   in the page — and died while every type checked and every pure test
   passed. Shipped as a string now, the same fix as `axe.source`, with a
   browser test whose subject is the boundary itself.

## The score no longer reads as a grade

`[V]` Every surface now renders the score through one seam
(`services/presentation/verdict.ts`): labelled **Checks passed**, formatted
`94%`, subordinated to the verdict by the explainer sentence, with the word
"Score" gone from every screen — asserted in the rendered form by the
hydration suite against the built app, and held by a grep-the-tree test so
the old rendering cannot be pasted back. The 97–98-beside-`fail` shape this
folder's first document flagged is no longer printable.

## Already satisfied, not re-built

The baseline doc's item 4 — surface "reported, but not for this reason" —
was already per-finding in the scorer (`predictedRuleFired`, printed as
"(not *rule* — noticed for another reason)") before this milestone started.
Recorded here so it is not rediscovered as open work.

## What stays open, named

- **C5** (`role="tab"` divs with no states) — the one deterministic miss
  left. No axe rule reaches it and no custom check covers ARIA widget-state
  completeness yet; a check that did would need the clean rows extended
  first, because widget-state rules are exactly where false positives live.
- **The judgement half floats with the model** (0–9 findings on identical
  input, documented). Deterministic coverage is the number to quote.
- **Fixture sites are our own.** 26/37 is coverage of what we planted, not
  of the web; a fourth site authored by someone else would test for
  overfitting.
