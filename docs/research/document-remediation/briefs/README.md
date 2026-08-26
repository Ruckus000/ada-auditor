# Parallel experiment protocol

**Date:** 2026-08-25 · Binding on every chat run from a brief in this directory.

Two experiments run in parallel chats. This file is the contract they run under.
It exists because the failure mode this project has repeated — twice at the level
of a whole experiment, and once inside a single day between two documents written
four hours apart — is **drift**: a narrow question quietly becoming a programme.

Parallelism does not fix drift. It multiplies it. The rules below are what makes
parallelism safe, and they are not advisory.

---

## The thirteen rules

### Scope

**1. One question.** It is stated at the top of the brief. If the work stops
answering that question, the work stops. Not "expands to cover" — **stops**.

**2. A stopping condition.** Named in the brief. Reaching it means stop and
report, **even if it comes early, even if something interesting is one command
away.** Interesting things go on the FINDINGS list in the results file. They do
not go into the build.

**3. An explicit "not doing" list.** Named in the brief. Nothing on it is done,
for any reason, including a good one discovered mid-run.

**4. Timebox.** Named in the brief. At the end, force a decision: the question is
answered, or it is answered negatively, or it is unanswerable with what we have.
All three are results. "Nearly there" is not.

### Method

**5. Register the prediction before running.** Write it to the results file and
**commit it before the first measurement.** Specific enough to be wrong — a
general expectation like "the number should improve" has already been satisfied
by a wholly broken build in this project. R6 and R7 were silently inert for an
entire run; the build compiled, no stage failed, no validator complained, and the
assertion total still fell because other rules worked. Only specificity caught it.

**6. Use the instrument named in the brief.** Do not build a new comparator, a
new scorer, or a new harness. If the named instrument cannot answer the question,
that is a finding — report it and stop. It is not a licence to build one.

**7. Report a miss as a miss.** Line by line against the registered prediction.
Every time this project strengthened an instrument mid-flight the number got
worse and the picture got truer, and the previously reported figure had been
flattering. Expect that.

**8. Evidence discipline.** Mark every claim `[V]` verified here, `[R]` reported
by a vendor or a document, `[H]` hypothesis. **Never convert `[H]` or `[R]` to
`[V]` without running something.** Vendor documentation saying a thing is local
is `[R]`, not `[V]`.

**9. Return measurements, not conclusions.** State what happened and what it
means for the specific question. **Do not recommend a direction for the product,
do not revise the roadmap, do not declare a path dead or alive.** Synthesis
happens in the coordinating chat, which is the only place that can see both
results at once.

### Boundaries

**10. Write exactly one file under `docs/`** — the results file named in the
brief. **Do not edit `README.md`, `working-agreement.md`, `legal-standard.md`,
`decision-2026-08-24.md`, or any other existing document.** The index is
reconciled in one place, on purpose. Two chats editing shared docs is the
contradiction risk this protocol exists to prevent.

**11. Do not modify the pipeline.** Nothing under
`experiments/document-remediation/*.java`, no stage runner, no fixture, no
corpus. Both experiments are measurements of things outside it.

**12. Work in your own git worktree** off `claude/abstention-and-review-cost`,
on your own branch. Commit freely there. **Do not merge, do not push to a shared
branch, do not open a PR.**

### Standing constraints — these predate the briefs and are not negotiable

**13.** In force regardless of what any brief says:

- **PII: bytes never leave our infrastructure.** No cloud API, no hosted model,
  no upload, no external service, for any reason. `HF_HUB_OFFLINE=1` is the
  proven verification method — a run that still completes with it set is `[V]`
  local.
- **Zero human input at any stage** is the product constraint being tested
  against. A technique that needs a human to check it has not solved anything.
- **Findings quote structure, never content.** `real/` is gitignored; `docs/` is
  not. The real corpus is municipal records containing private individuals'
  names and addresses. Quote a tag, a count, a colour, a file name. Never a
  sentence from a document.
- **Holdout 2 is sealed.** Both checkpoints unspent. Do not open it, do not tune
  against it, do not look at it.
- **Check disk before installing anything**, and record what the install
  actually cost. The volume is 96% full. The last model was estimated at ~1 GB
  from its model card and measured **9.2 GB** with cache.
- **Development principles:** YAGNI → KISS → SRP → DRY, in that order. Ask what
  the minimum code is that answers the question. These are throwaway experiments
  and should look like it.

---

## The opening tripwire

**Before the first tool call, restate in the chat:**

1. The one question.
2. The registered prediction, in full.
3. The "not doing" list.
4. The stopping condition.

If you cannot restate all four from the brief, you have not read it. If at any
later point you are about to do something not covered by (1), you are drifting —
stop and put it on the FINDINGS list instead.

## What comes back

A single results file at the path the brief names, containing:

- the registered prediction, unedited, as written before the run
- the measurements, with `[V]`/`[R]`/`[H]` markers
- **prediction checked line by line**, misses named as misses
- a **FINDINGS** list — everything interesting that was deliberately not pursued
- install cost and locality verification, if anything was installed

Then report the file path and a one-paragraph summary. Nothing else.

---

## The briefs

| | question |
|---|---|
| [source-document.md](source-document.md) | Does the semantic structure we cannot reconstruct from a PDF survive an automated export from its source document? |
| [vlm-scale.md](vlm-scale.md) | Is the alt-text wall a model *size* problem, as a 256M model cannot tell us? **Answered: no — scale makes it undetectable.** |
| [source-native.md](source-native.md) | **Running.** Does exporting a native word-processor source ever claim something the source did not state? |
