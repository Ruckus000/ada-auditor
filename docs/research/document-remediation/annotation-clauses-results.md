# Four clauses that reached nobody, and where a figure is

Two items left named-but-not-done by the header-bound work. Both changed shape
once measured; one got much cheaper and one got much smaller.

## 1 · A family route silenced four clauses

`VOICED_BY_OUR_INSTRUMENT` routed all of `/^7\.18\./` to criterion `1.3.1`.
Suppression is **earned** — a clause leaves the catch-all only when one of our
own items is present — and that rule is sound. The route was not.

`7.18` holds unrelated questions: a form field's name (`7.18.1-3`), a page's
`/Tabs` (`7.18.3-1`), a widget's `Form` nesting (`7.18.4-1`), a link's `Link`
nesting (`7.18.5-1`). Because suppression is earned per **criterion**, any
document carrying the annotation item suppressed the whole family with it.

Measured before the change:

| document | veraPDF 7.18 clauses | **named nowhere** |
|---|---|---|
| r13 (real) | 7.18.1-3, 7.18.3-1, 7.18.4-1 | **7.18.3-1, 7.18.4-1** |
| p15 | 7.18.1-3, 7.18.4-1 | **7.18.4-1** |
| p30 | 7.18.5-1 | **7.18.5-1** |

Four instances, in no gap, no need and no catch-all — including `7.18.3-1` on a
**real client document**. Documents where the 1.3.1 item happened to be absent
(r04, r15, r17, r23, r30) voiced their clauses correctly, which is what showed
the mechanism was sound and the route was not.

**This is the second time the same route bit.** The form-names work split
`7.18.1-3` out after r13 shipped with 135 unnamed form fields named nowhere.
That fixed one clause and left the rule standing. Removing the family route
closes the class.

### The fix is negative code

One entry deleted from the route table, and the deliberate mirror
(`SUPPRESSED` in `score.ts`) moved with it. Only `7.18.1-3` stays suppressed,
because the 4.1.2 item genuinely says what that clause says.

Accepted cost: mild duplication. r13 now says "289 form fields or links sit
outside the document's structure" **and** lists `7.18.4-1` in the catch-all.
Saying a thing twice is a far smaller fault than a clause reaching no one.

### The corpus is blind to this class

`SUPPRESSED` mirrors the domain route, so a suppressed-but-unvoiced clause is
neither `silent` nor `suppressedButQuiet`. **The scorecard read `Silent gaps 0`
for the entire time these four were invisible**, and reads `0` now — so a green
run proves nothing here. The verification is a direct diff of veraPDF's failing
clauses against our voiced criteria plus catch-all text.

`[V]` After: every 7.18 clause on every document is named. r13's catch-all went
from 3 clauses to 5, naming exactly the two that had been silent.

## 2 · A figure now says where it is

`Figure 47` was a position in `structure.figures`. Nobody can find figure 47 in
a 37-page document without counting `/Figure` tags.

- `Figure 1 (p6): no alt text, no caption to transcribe — write a description`
- `Figure 101 (p37): alt text is a placeholder, not a description (WCAG F30) — write one`

The page comes from `el.getPage()` — the element's own `/Pg`, which **279 of 279
figure elements in the corpus carry**. Emitted as `null` when absent, because
absent beats invented.

**Not `StructText.boxOf`.** It registers a box only when text was harvested, so
an image-only figure — the ordinary undescribed one — resolves to nothing; and
its fallback scans every page's MCID map and takes the first hit. MCIDs restart
at 0 per page, so that path can return the **wrong** page. A wrong page on a
client's public report is a fabricated location, which is worse than no page.

Labelled with `figure.type`, because `Inspect` collects `Formula` into the same
array and a client who goes to the page should not find no figure there.

### The bug worth remembering

The first implementation reported **no page for all 101 of r05's figures**, while
qpdf showed every one carrying `/Pg`. `PDStructureElement.getPage()` builds a
fresh `PDPage` wrapper around the page's dictionary and `PDPage` does not
override `equals`, so a map keyed on the wrapper misses every time. Key on
`page.getCOSObject()`. Only running it caught this — it compiles and it is
silent.

### It had to be paid for

` (page 37)` × 101 items takes r05 from 13,212 to **14,222 against a 14,000
budget** — over, and `boundSummary` would have trimmed items off a client's list.
`(p37)` plus dropping the words the wording could spare lands it at **13,382 with
618 bytes of margin, 0 documents trimmed**. `SUMMARY_HEADER_BUDGET` was not
touched; AGENTS.md forbids that move by name.

## What was cut, and why

- **Collapsing the figure items into one range.** Its motivating problem was
  already fixed — #187 bounded the header — and collapsing would have deleted the
  corpus's only check on undescribed-figure counts: `score.ts` compares `needs`
  as a multiset, `p36`/`p37` exist to fail if the F30 predicate narrows back to a
  presence check, and nothing verifies the count inside a gap string. It would
  also have erased the r04/r05 scope-change rows, since `legibilityAdded` is a
  difference of `1.1.1` counts.
- **Re-measuring `7.18.4-1` against the ParentTree.** Once the routing is fixed
  the clause is voiced by id, so this becomes cosmetic — "289 form fields or
  links" → "289 form fields", and p15's 1 → 2. It would cost a
  `structParentStandardType` lookup, two veraPDF exemptions our counter lacks
  (`isOutsideCropBox`, hidden `F & 2`), role-map handling, a hand-built
  `/ParentTree` fixture and ~13 test files. Worth doing later on its own
  evidence; not worth bundling with a promise fix.
- **A `contentChanges` projection for the figure page.** Planned as defensive
  code, then measured instead: **0 content-changed refusals** and 19 documents
  still certified. The page is stable across repair's two passes because
  `getPage()` reads `/Pg` directly and `Finish` does not repaginate. Not written.

## Verification

`[V]` **97 documents, exit 0, every promise held, 0 regressed.** Disposition
42/42, doors 11/11, **punch items 0 missing**, invented claims 0, silent gaps 0,
drift 0.

- Every 7.18 clause named, on every document (direct clause diff, not the
  scorecard).
- r05: 13,382 bytes, 104 items, **0 documents trimmed**.
- 0 content-changed refusals; 19 documents certified, unchanged.
- lint, typecheck, 1,912 unit tests, 42 JVM document tests — including a
  two-page fixture asserting `[1, 2, null]`, which is the only thing that would
  catch a wrong page, since no answer key checks one.

## Still open

- The 1.3.1 item still says "form fields **or links**" and still counts
  `/StructParent` presence rather than `Form` nesting. Honest, imprecise, and
  now voiced beside the clause it approximates.
- A figure's ordinal is structure order while its page is page order, so on
  r09/r15/r33/r34 the list reads "Figure 6 (p9), Figure 7 (p2)". Reading order
  follows the story, not the page — correct, and surprising.
