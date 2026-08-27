# The advisory's first run: 19 to 24 of 37, and a zero that took instrumentation to explain

**Date:** 2026-08-27, the day after the baseline.
**Run:** `npm run blind:test`, same three sites, same answer keys, same scorer —
the only variable changed from
[`2026-08-26-three-fixture-sites.md`](2026-08-26-three-fixture-sites.md) is
that the advisory pass had a way to reach a model.
**Advisory:** `minimax/minimax-m3-free` through the AI Gateway, authenticated
by a `VERCEL_OIDC_TOKEN` pulled locally. First execution of this pass in the
product's history: `phaseMs.advisory` reads `0` on every prior run in the
database.

## Result, against the dark baseline

| Planted as | Count | Seen (dark, 08-26) | Seen (advisory live) |
|---|---:|---:|---:|
| `deterministic` | 19 | 16 | 16 |
| `needs-review` | 4 | 2 | 2 |
| `judgement` | 14 | **1** | **6** |
| `clean` | 7 | 7 quiet, 0 FP | 7 quiet, **0 FP** |
| **barriers seen** | **37** | **19** | **24** |

`[V]` Misses fell from 17 to 12. The judgement class — the half no rule can
decide, and the half of the product that had never been measured — went from
1 of 14 to 6 of 14. Five barriers were caught by the advisory **alone**, no
rule involved: A4 (`alt="image1"`), A5 ("Click here"), A11 and C12 (an error
message that names neither the field nor the fix, on two different sites), C9
(a German quote inside an English page).

`[V]` **Zero false positives held.** All seven correctly-built implementations
stayed quiet under a live model — the number the `clean` rows exist to produce,
and the real risk in turning a model on. And every verdict and score is
unchanged from the dark run, because advisory findings are `gateable: false`:
the two-finding-path rule survived first contact with an actual model rather
than a test double.

`[V]` Cost: 6.6–8.8s of advisory time per four-page site, against the walk
budget's 60s advisory reserve — that reserve's first measurement, and it is
generous by roughly 7×. Findings: 4 on Ridgeline, 0 on Fairview, 2 on Kestrel.

## What it catches is text; what it misses is structure

The five advisory-only catches share a shape: **text that exists and says
nothing** — a useless alt, a purposeless link, an unhelpful error, an
undeclared language switch. The twelve remaining misses share the opposite
shape:

- `<div onclick>` keyboard traps — B3, C1. Missed twice.
- Table header structure — A8, B4, C7. Missed three times.
- Placeholder-only labels — A10, C13. Missed twice.
- role="tab" without states (C5), fieldset-less radio group (B8), colour-only
  status (A9), identical "Download" links (B5), label-in-name (B9).

That split is consistent with what the pass is given: a flattened
accessibility tree, and structure is what flattening removes. The practical
consequence: **the remaining misses are rule-shaped, not model-shaped.** A
better model reading the same evidence should not be expected to close them;
`focus-order-semantics`, a table-header check and a placeholder-label decision
would. "Try a stronger model" is explicitly not the next step this measurement
supports.

Worth separating from the earlier document-remediation record:
[`picture-description-results.md`](../document-remediation/picture-description-results.md)
killed VLM-*written* alt text as confident, fluent and wrong. *Detecting* that
an alt says nothing is a different and much easier job, and it works.

## The Fairview zero, and what it took to explain it

Fairview answered `advisory 0` — with `phaseMs.advisory: 7790ms`. A call
happened; nothing came back; and the code could not say why, because
`requestAiAdvisory` collapsed six outcomes into the same silent `[]`: model
never called the findings tool, schema-invalid answer, thrown error, genuinely
empty answer, everything eaten by the 0.7 confidence threshold, or
unconfigured. On a real client run, "nothing to report" and "the advisory
silently failed" were identical in the database.

So the advisory now logs its outcome — `ai_advisory_completed` with
`reported` (before the confidence filter) and `kept` (after), plus
`ai_advisory_no_tool_call`, `ai_advisory_invalid_shape` and
`ai_advisory_error` where those are decided. Counts, model id and zod issue
codes only, never finding text: findings describe a client's page content, and
the invalid-shape path in particular must not log zod's `message`, which
embeds the received model output. The test plants a name-and-address string
inside a malformed model answer and asserts it reaches no logged line.

`[V]` Three instrumented runs of Fairview alone, identical evidence each time:

| run | event | reported | kept | advisory wall time |
|---|---|---:|---:|---:|
| 1 | `ai_advisory_completed` | **9** | 5 | 15.2s |
| 2 | `ai_advisory_completed` | **0** | 0 | 7.4s |
| 3 | `ai_advisory_completed` | **5** | 2 | 7.2s |

The answer to the anomaly: **the zero was a genuine model answer, and the
model is high-variance.** Run 2 reproduces the original zero exactly — the
model called the tool with an empty list, which the system prompt invites
("an empty list is a good answer"). No failure path fired on any run. The same
model, on the same bytes, reported 9, 0 and 5 findings on consecutive runs.

Two further things the three runs surfaced:

1. **The confidence threshold is doing real work.** 4 of 9 and 3 of 5 reported
   findings fell below `minReport: 0.7`. Before the `reported`/`kept` split,
   a threshold-eaten answer was indistinguishable from an empty one.
2. **The scorer under-credits the advisory, conservatively and by design.**
   `[V]` Run 1's prose described B9's exact defect — visible label "Email
   address", accessible name "Contact" — and scored as a miss, because
   `advisoryMentions` requires the sentence to contain the expectation's cue
   or selector (`applicant-email`), and a model naturally describes an element
   by its labels rather than its id. Conservative matching is the right
   default (crediting vague prose would flatter the tool), but it means
   single-run advisory scores carry wide error bars in *both* directions. The
   matcher was deliberately not changed for these runs — comparing against
   yesterday's baseline requires yesterday's instrument, the same
   walked-the-same-path rule the document comparator enforces with
   `INSTRUMENT_VERSION`.

## What this changes about reading advisory numbers

The deterministic side is reproducible: `[V]` identical counts on every
Fairview run, yesterday and today. The advisory side is a sample, not a
measurement — 0 to 9 findings on identical input. Any future claim shaped
"the advisory catches X of Y" needs either multiple runs or a declared
tolerance, and a client-facing surface should expect advisory findings to
appear and disappear between otherwise-identical runs. The two-path rule
already contains this: verdicts cannot flap, because advisory findings cannot
gate.

## What stays open

- **Local runs against `file://` fixtures, not a deployed function.** The
  gateway call is real; the environment is not production's. No advisory run
  exists in the production database yet, and the first one should be over the
  dsrfund twelve-page baseline, where 88 undecided checks are waiting to be
  compared against.
- **The free-model data boundary is unchanged** (`docs/env.md`): no
  data-retention guarantee, so `AUDITOR_ADVISORY_MODEL` must point at a model
  with one — or at `off` — before any authenticated journey runs the pass.
- **Variance itself.** Whether a paid model at temperature 0 through the same
  gateway is materially steadier is now a measurable question; three runs of
  this one put the baseline at 0–9 on identical input.

## Reproducing

```bash
vercel env pull /tmp/env.pull            # mints a ~12h VERCEL_OIDC_TOKEN
export VERCEL_OIDC_TOKEN=<from that file — the blind test needs nothing else>
npm run blind:test                       # all three sites
npm run blind:test -- --site fairview-township --out /tmp/fv   # the variance check
```
