# 4.1.2 form-field names — registered before the run

Written before the blind test executes, and before `corrections.json` gains a
row. A prediction edited afterwards is the failure this apparatus exists to
prevent, so what is wrong here stays wrong on the record.

## The defect being closed

r13 is delivered with **135 form fields carrying no accessible name**, and the
punch list names none of them.

veraPDF fails `7.18.1-3` — *a form field shall have a TU key present, or all its
widget annotations shall have alternative descriptions*. `alreadyVoiced` routed
the whole `7.18` family to the 1.3.1 annotation-nesting item, that item is
present on r13 for an unrelated reason, and so the clause was suppressed from
the catch-all and appeared in no gap, no need and no clause list. The same
summary told the client 4.1.2 was **not checked**.

Reproduced offline against the real delivered bytes and veraPDF's own report,
and the reproduction matches `latest.json` for r13 line for line.

## Why this criterion and not another

`legal-standard.md`'s seven-criterion pass mark includes 4.1.2 — *form fields
are labelled, where forms exist* — and it is one of only two on that mark the
pipeline did not reach. Unlike 1.4.1, refused two commits ago, the condition is
deterministic and non-semantic: a key is present or it is not.

## Predicted outcome

**Exactly two documents gain a `4.1.2` gap and a `4.1.2` need. No third.**

| document | fields | unnamed | gap string |
|---|---:|---:|---|
| r13 | 289 | **135** | `4.1.2: 135 form fields with no accessible name` |
| p15-form-fields-outside-structure | 2 | **2** | `4.1.2: 2 form fields with no accessible name` |

The "no third" half is the real prediction. All **72** delivered documents were
scanned with the compiled stage; only these two carry widget annotations at all.

**135 is agreed by three independent readings**: veraPDF's `7.18.1-3` failed
checks, a raw qpdf-object scan, and this pass. p15's 2 is agreed by the raw scan
and this pass — veraPDF is not consulted for it here.

## Also predicted

- Blind test **exit 0**, every promise held, **0 regressed**, **0 silent gaps**,
  disposition unchanged at 42/42.
- **`vs previous` shows movement**, because `INSTRUMENT_VERSION` goes 10 → 11 and
  every stored baseline reads `incomparable` for one cycle. Pre-announced so it
  is not read as documents getting worse.
- **Two `scope-change` corrections**, r13 and p15 — the product correctly claims
  more. Not instrument defects: both keys were right about what they recorded.
- **Header**: r05 is the cap-critical document and carries no form fields, so it
  does not move from 13,677 bytes. r13 gains one gap and one item, roughly 230
  bytes.
- veraPDF's catch-all on r13 stays at **3 clauses** (`7.21.3.2-1`, `7.2-42`,
  `7.2-43`). `7.18.1-3` leaves it by being *voiced*, not by being suppressed.

## What this does not close

- **`7.18.4-1` — 289 widgets not nested in a `Form` tag — is still voiced only
  as 1.3.1.** That is the reachability half and the existing item is honest about
  it; naming it 4.1.2 as well would report one defect twice.
- **No field is ever labelled by us.** A field's label is what the field is FOR,
  and inferring it from a nearby word is the invention refused for alt text —
  worse here, because a wrong label on a form is a barrier that looks like a fix.
- **One real document is thin evidence.** The corpus has one genuine form. The
  count is corroborated three ways, but prevalence is not established, and a
  second real form could show a shape this pass reads wrongly.
