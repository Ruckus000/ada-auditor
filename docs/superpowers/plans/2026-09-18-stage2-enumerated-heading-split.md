# Stage 2 wild round 2 — split enumerated heading lines out of auto-tagged list items

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the one card shape that produced 17 of the 22 covered misses on the first wild population, then re-measure the Stage 2 gate on the same ten documents with the same operating point, without touching the model, the labels already written, or the test split.

**Architecture:** On an untagged PDF the product's auto-tagger (OpenDataLoader) reads an enumerated heading and its paragraph as one list item: `L → LI → {Lbl "A.", body "A. Plans All tanks shall…"}`. The card builder inherits that boundary, so the loop sees a numeral-only card the model rightly calls Lbl, and a 130-pt block the model rightly calls P; the consensus labels the block H because it begins with a heading. `pdftotext -bbox-layout` shows "A. Plans" is its own physical line. `Cards.java` already walks glyphs and detects line changes (`wordsOf`, `dy > 0.5em`), so it can report each block's first physical line. A pure Python step then splits an `LI` (or `H*`) block whose first line is short, starts with an enumerator, and is followed by more lines, into a head card (the first line) and a body card (the rest). The split runs only in `labels/suggest.py`'s path; the training-key builder is untouched in this plan. Judges then label only the cards whose text changed, the consensus file is patched by id, and `labels/eval_wild.py` re-runs.

**Tech Stack:** `experiments/qwen-role-decisions/Cards.java` (PDFBox glyphs), `run.py` (`blocks_to_cards`), `labels/pdf_cards.py`, `labels/suggest.py`, the judge protocol in the coordinator's scratchpad, `labels/fold_wild.py`, `labels/eval_wild.py`.

**Spec:** `docs/research/document-remediation/heading-stage2-2026-09-18-results.md` (wild result, miss anatomy, "The next lever is card building on untagged PDFs, not training"), `heading-definition-2026-09-13.md` (H includes a heading merged with its first sentence), memory `heading-loop-stage0-1-night` (convention lesson: numeral-only card = Lbl in every training key).

## Global Constraints

- **Labels never fabricated; existing labels never edited by hand.** `out/labels/s2wild-consensus.jsonl` rows are replaced only for card ids whose text changed, and only by a fresh four-judge consensus on those cards. Every other row stays byte-identical.
- **The model is not retrained.** Adapter `out/stage1/adapter-r10`, threshold `0.9933`.
- **Test split not evaluated.** The ten wild documents stay in validation (`out/keys-all-4-wild/split/split.json`); no id moves.
- **Every number is disclosed as "graded against Claude-consensus labels".**
- **Convention fixed before measuring:** an enumerator-only card ("A.", "II.") is `Lbl`, as in all 185 training-key rows. The judge protocol changes to say so (Task 3). The 20 existing consensus rows that say H are left as labelled and reported in a fourth view, not silently re-scored.
- **Training-key builder untouched.** `labels/build_keys.py` and `candidate_pool` keep their behaviour; the split is opt-in on `labels/suggest.py` via `--split-enumerated-heads`. Applying it to training keys is a later, measured decision.
- Commit per task, `git add <paths>`, trailer `Co-Authored-By: <model> <noreply@anthropic.com>`.

**Cut from this plan (YAGNI, recorded as gaps):** fixing `prev` context leaking container text (it would change every training card's context and needs its own measurement); the 11 overlapping locators; OCR of the 151 image-only candidates; any change to ODL itself.

---

### Task 1: `Cards.java` reports each block's first physical line

**Files:**
- Modify: `experiments/qwen-role-decisions/Cards.java` (block emission loop, lines ~108–140; `wordsOf`, lines ~221–237)
- Test: `experiments/qwen-role-decisions/labels/test_pdf_cards.py` (new case at the end)

**Interfaces:**
- Produces: two new keys on every block in the Cards dump: `"first_line": <string>` (glyphs up to the first line change, joined as `wordsOf` joins), `"line_count": <int>` (1 + number of line changes). Blocks with no glyphs get `"first_line": ""`, `"line_count": 0`.

- [ ] **Step 1: Write the failing test**

```python
# labels/test_pdf_cards.py — append
import json, subprocess
from pathlib import Path
from run import dump_pdf

WILD = Path("out/suggest/wild/c3-0794/odl-out/c3-0794.pdf")


def test_cards_dump_reports_first_line_and_line_count():
    if not WILD.is_file():
        import pytest; pytest.skip("wild tagged copy not present on this machine")
    raw = dump_pdf(WILD, compile=True)
    by = {b["locator"]: b for b in raw["blocks"]}
    assert by["c3-0794:9"]["first_line"] == "A. Plans"
    assert by["c3-0794:9"]["line_count"] >= 8
    assert by["c3-0794:10"]["first_line"] == "A." and by["c3-0794:10"]["line_count"] == 1


def test_first_line_joins_an_enumerator_and_its_words_across_a_tab_gap():
    # c3-0094 page 3: "VI." at x=90 and "Budget Process – Execution" at x=126 share one baseline.
    tagged = Path("out/suggest/wild/c3-0094/odl-out/c3-0094.pdf")
    if not tagged.is_file():
        import pytest; pytest.skip("wild tagged copy not present on this machine")
    by = {b["locator"]: b for b in dump_pdf(tagged, compile=False)["blocks"]}
    assert by["c3-0094:54"]["first_line"] == "VI. Budget Process – Execution"
    assert by["c3-0094:54"]["line_count"] >= 5
```

Known limit, to be recorded, not fixed here: c3-0794:1 carries "I. OBJECTIVE: To insure that water tanks…" on one physical line, so its first line is long and the rule leaves it merged. Expect at most 14 of the 15 round-1 merged-heading blocks to split.

- [ ] **Step 2: Run it to see it fail**

Run: `cd experiments/qwen-role-decisions && python3 -B -m pytest labels/test_pdf_cards.py -k first_line -q`
Expected: FAIL with `KeyError: 'first_line'`

- [ ] **Step 3: Implement in Cards.java**

Add beside `wordsOf`:

```java
    /** The glyphs up to the first line change, joined like wordsOf; and the line count. */
    record FirstLine(String text, int lines) {}

    static FirstLine firstLineOf(List<Glyph> glyphs) {
        if (glyphs.isEmpty()) return new FirstLine("", 0);
        int lines = 1;
        int firstEnd = glyphs.size();
        Glyph prev = null;
        for (int i = 0; i < glyphs.size(); i++) {
            Glyph g = glyphs.get(i);
            if (prev != null) {
                float em = g.fontPt > 0 ? g.fontPt : prev.fontPt;
                if (Math.abs(g.y - prev.y) > 0.5f * em) {
                    if (lines == 1) firstEnd = i;
                    lines++;
                }
            }
            prev = g;
        }
        return new FirstLine(wordsOf(glyphs.subList(0, firstEnd)), lines);
    }
```

In the emission loop, after `json.append(", \"text\": ").append(q(t));`:

```java
                FirstLine fl = firstLineOf(gs);
                json.append(", \"first_line\": ").append(q(fl.text()));
                json.append(", \"line_count\": ").append(fl.lines());
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd experiments/qwen-role-decisions && python3 -B -m pytest labels/test_pdf_cards.py -q`
Expected: PASS (the new case and the existing ones)

- [ ] **Step 5: Confirm nothing else in the dump changed**

Run: `cd experiments/qwen-role-decisions && python3 -B -c "from pathlib import Path; from run import dump_pdf; import json; r=dump_pdf(Path('out/suggest/wild/c3-0794/odl-out/c3-0794.pdf'), compile=False); b=[{k:v for k,v in x.items() if k not in ('first_line','line_count')} for x in r['blocks']]; print(len(b), b[9]['text'][:40])"`
Expected: `… 'A. Plans All tanks shall be installed in'` and the same block count as `out/suggest/wild/c3-0794/cards.jsonl` plus containers.

- [ ] **Step 6: Commit**

```bash
git add experiments/qwen-role-decisions/Cards.java experiments/qwen-role-decisions/labels/test_pdf_cards.py
git commit -m "Cards.java: report each block's first physical line and line count"
```

### Task 2: `split_enumerated_heads` in `labels/split_heads.py`, wired into `labels/suggest.py`

**Files:**
- Create: `experiments/qwen-role-decisions/labels/split_heads.py`
- Test: `experiments/qwen-role-decisions/labels/test_split_heads.py`
- Modify: `experiments/qwen-role-decisions/labels/suggest.py` (`choose_cards`, `parse_args`, sidecar `coverage`)
- Modify: `experiments/qwen-role-decisions/labels/test_suggest.py` (coverage key)

**Interfaces:**
- Produces: `split_enumerated_heads(blocks: list[dict]) -> tuple[list[dict], int]` — takes raw dump blocks (with `first_line`, `line_count`), returns new block list and the number of splits. A split block `B` with locator `d:9` becomes `d:9h` (head: `text = first_line`, `y1 = y0 + 1.3 * font_pt`, `existing_tag = "LI"`, `split: "head"`) followed by `d:9` (body: `text = text[len(first_line):].lstrip()`, `y0 = y0 + 1.3 * font_pt`, `split: "body"`). All other keys copied.
- Consumes: Task 1's `first_line` / `line_count`.

Split rule, all four required: `existing_tag` in `{"LI", "H", "H1", …, "H6"}`; `line_count >= 2`; `first_line` matches `^(?:[IVX]+|[A-Z]|\d+)\.\s+\S` (an enumerator plus at least one word); `len(first_line.split()) <= 6` and `first_line` does not end in `.`, `;` or `:` followed by more words on the same line. The numeral-only `Lbl` sibling is untouched.

- [ ] **Step 1: Write the failing tests**

```python
# labels/test_split_heads.py
from labels.split_heads import split_enumerated_heads


def blk(loc, text, first, lines, tag="LI", pt=12, y0=360.0, y1=490.0):
    return {"locator": loc, "existing_tag": tag, "text": text, "first_line": first, "line_count": lines,
            "font_pt": pt, "weight": "regular", "ancestors": ["L", "Document"], "in_table_box": False,
            "page": 0, "x0": 144.0, "y0": y0, "x1": 520.0, "y1": y1}


def test_li_with_short_enumerated_first_line_splits_into_head_and_body():
    out, n = split_enumerated_heads([blk("d:9", "A. Plans All tanks shall be installed in accordance", "A. Plans", 8)])
    assert n == 1 and [b["locator"] for b in out] == ["d:9h", "d:9"]
    head, body = out
    assert head["text"] == "A. Plans" and head["split"] == "head" and head["y1"] == 360.0 + 1.3 * 12
    assert body["text"] == "All tanks shall be installed in accordance" and body["split"] == "body" and body["y0"] == head["y1"]


def test_numeral_only_lbl_and_single_line_blocks_are_untouched():
    blocks = [blk("d:10", "A.", "A.", 1, tag="Lbl", y1=367.0), blk("d:38", "D. Risk Coordinator, Office of Human Resources", "D. Risk Coordinator, Office of Human Resources", 1)]
    out, n = split_enumerated_heads(blocks)
    assert n == 0 and out == blocks


def test_a_long_or_sentence_like_first_line_does_not_split():
    long = blk("d:1", "1. Typical fire hydrants or hose connections shall be", "1. Typical fire hydrants or hose connections shall be", 3)
    lead = blk("d:2", "A. Note: the following items apply. More text", "A. Note: the following items apply.", 2)
    out, n = split_enumerated_heads([long, lead])
    assert n == 0 and out == [long, lead]


def test_h_tagged_merged_block_splits_too():
    out, n = split_enumerated_heads([blk("d:153", "IX. Tagout A. Authorized employees must tag", "IX. Tagout", 3, tag="H3")])
    assert n == 1 and out[0]["text"] == "IX. Tagout" and out[0]["existing_tag"] == "H3"
```

- [ ] **Step 2: Run to see them fail**

Run: `cd experiments/qwen-role-decisions && python3 -B -m pytest labels/test_split_heads.py -q`
Expected: FAIL with `ModuleNotFoundError: labels.split_heads`

- [ ] **Step 3: Implement**

```python
# labels/split_heads.py
"""Split an auto-tagged list item whose first physical line is an enumerated heading.

OpenDataLoader reads "A. Plans" + its paragraph as one LI (Lbl "A.", body the rest).
Stage 2 wild round 1: 17 of 22 covered misses were this shape. The head becomes its
own card; the numeral-only Lbl sibling is left alone (training convention: Lbl).
"""
import re

ENUM_HEAD = re.compile(r"^(?:[IVX]+|[A-Z]|\d+)\.\s+\S")
SPLIT_TAGS = {"LI", "H", "H1", "H2", "H3", "H4", "H5", "H6"}
MAX_HEAD_WORDS = 6
LINE_EM = 1.3


def is_enumerated_head(block: dict) -> bool:
    first = (block.get("first_line") or "").strip()
    if block.get("existing_tag") not in SPLIT_TAGS or (block.get("line_count") or 0) < 2:
        return False
    if not ENUM_HEAD.match(first) or len(first.split()) > MAX_HEAD_WORDS:
        return False
    return not re.search(r"[.;:]$", first) and block.get("font_pt") is not None


def split_enumerated_heads(blocks: list[dict]) -> tuple[list[dict], int]:
    out, n = [], 0
    for b in blocks:
        if not is_enumerated_head(b):
            out.append(b)
            continue
        first = b["first_line"].strip()
        text = b.get("text") or ""
        if not text.startswith(first):
            out.append(b)
            continue
        cut = float(b["y0"]) + LINE_EM * float(b["font_pt"])
        head = {**b, "locator": f'{b["locator"]}h', "text": first, "y1": cut, "split": "head"}
        body = {**b, "text": text[len(first):].lstrip(), "y0": cut, "split": "body"}
        out.extend([head, body])
        n += 1
    return out, n
```

Then in `labels/suggest.py`:
- `parse_args`: add `p.add_argument("--split-enumerated-heads", action="store_true", help="split an LI/H block whose first physical line is a short enumerated heading into head + body cards")`.
- `choose_cards(raw, stem, all_blocks, split_heads: bool = False)`: before `candidate_pool`, `blocks, n_split = split_enumerated_heads(raw.get("blocks") or []) if split_heads else (raw.get("blocks") or [], 0)`, use `{**raw, "blocks": blocks}` everywhere `raw` was used, and return `n_split` as a fourth value.
- `coverage_of` gains `"split_heads": n_split`; add `"split_heads"` to `COVERAGE_KEYS`.
- Thread the flag from `main` through `build_cards`.

- [ ] **Step 4: Update `test_suggest.py::test_coverage_counts` for the new key and run all label tests**

Run: `cd experiments/qwen-role-decisions && python3 -B -m pytest labels -q`
Expected: all pass, including the four new cases.

- [ ] **Step 5: Commit**

```bash
git add experiments/qwen-role-decisions/labels/split_heads.py experiments/qwen-role-decisions/labels/test_split_heads.py experiments/qwen-role-decisions/labels/suggest.py experiments/qwen-role-decisions/labels/test_suggest.py
git commit -m "suggest: opt-in split of enumerated heading lines out of auto-tagged list items"
```

### Task 3: Judge protocol convention change (coordinator)

**Files:**
- Modify: the coordinator scratchpad `judge/PROTOCOL.md`; copy the new version to `out/labels/s2wild-judges/PROTOCOL-v2.md`.

- [ ] **Step 1:** Replace the rule "a numbered/lettered section heading is `H` even if the box covers only the numeral" with: "a box that covers only an enumerator (`A.`, `II.`, `3.`) is `Lbl`, whatever it enumerates; the heading is the card that carries the words. A card that carries an enumerator and heading words on one short line is `H`."
- [ ] **Step 2:** Add one line under Rules: "A head card split from a list item (id ending in `h`) is judged on its own line only; its body card is judged as body text unless it is itself a heading."
- [ ] **Step 3:** Copy to `out/labels/s2wild-judges/PROTOCOL-v2.md` (the v1 file stays as the record of round 1).

### Task 4: Re-run the ten wild sidecars with the split, judge only the changed cards, patch the consensus

**Files:**
- Create: `experiments/qwen-role-decisions/out/suggest/wild-v2/<doc>/sidecar.json` (ten runs)
- Create: `out/labels/s2wild-v2-source.jsonl`, `out/labels/s2wild-v2-consensus.jsonl` (coordinator)
- Modify: `labels/fold_wild.py` only if it cannot take a consensus file whose ids include `…h` (it keys by sidecar card id, so it should not need to).

- [ ] **Step 1 (implementing chat): sidecars.** For each of the ten stems in `labels/cohort3-names.txt` that have a `out/suggest/wild/<stem>` run:

```bash
cd experiments/qwen-role-decisions && python3 -B -m labels.suggest --pdf out/cohort3/real/<stem>.pdf --adapter out/stage1/adapter-r10 --threshold 0.9933 --all-blocks --split-enumerated-heads --python ~/.venvs/qwen-role-decisions/bin/python --out out/suggest/wild-v2/<stem>/sidecar.json
```

Expected: `coverage.split_heads` > 0 for c3-0128, c3-0794, c3-0094 (about 18, 11 and 6), 0 or near 0 elsewhere; `blocks_total` grows by the same count. Record wall time per document (round 1: ~2.8 s per model card).

- [ ] **Step 2 (implementing chat): diff the card sets.** Write `out/labels/s2wild-v2-changed.json`: for each stem, the ids present in v2 but not v1 (the `…h` heads), and the ids whose `text` differs between v1 and v2 (the shortened bodies). Every other id must have identical text; assert it and refuse if not. Hand the list to the coordinator.

- [ ] **Step 3 (coordinator): judge the changed cards.** Build `s2wild-v2-source.jsonl` for the changed ids only (same fields as round 1, images re-marked with the new boxes via `build_cards.py`/`emit_audit.py`), one chunk per ~60 cards, four judges each under `PROTOCOL-v2.md`, `consensus.py --write` into `s2wild-v2-consensus.jsonl`. Report calibration is not available on these cards (no audit overlap); report pairwise agreement and consensus counts instead.

- [ ] **Step 4 (coordinator): patch by id.** `s2wild-consensus-v2.jsonl` = round-1 rows for every unchanged id, plus the v2 rows for the changed ids. Print: rows replaced, rows added, rows kept, and confirm the kept rows are byte-identical to round 1.

- [ ] **Step 5 (implementing chat): fold and evaluate.** Same commands as round 1 with `--sidecars out/suggest/wild-v2` and the v2 consensus file, outputs under `out/labels/wild-v2-*` and `out/stage1/pred-wild-v2-r10.jsonl`, `out/stage1/eval-wild-v2-r10.txt`. The split assignment is `--keep out/keys-all-4-wild/split/split.json`; new `…h` ids go to validation with their documents; refuse if any kept id moves.

### Task 5: Record and roadmap

**Files:**
- Modify: `docs/research/document-remediation/heading-stage2-2026-09-18-results.md` (new section "Wild round 2: enumerated heading split")
- Modify: the roadmap's Stage 2 line

- [ ] **Step 1:** Report the four views at 0.9933, all "graded against Claude-consensus labels": raw v2; v2 excluding the 20 round-1 enumerator-only H rows (convention conflict, unchanged ids); v2 shape-blind (the same 227-card selector re-applied to v2 ids); and, for continuity, raw round 1. Same columns as round 1 (rows, covered, abstention, accuracy with exact bounds, FP with upper bound, FN), plus the per-document clean rate and the coverage curve.
- [ ] **Step 2:** State the anatomy of the remaining covered misses the same way round 1 did. If the head cards are now answered H at ≥ 0.9933, say how many of the 15 merged blocks became covered headings; if they abstain, say so and record that as the next lever (the abstained-miss population).
- [ ] **Step 3:** Gate verdict in one sentence per view. Do not adopt a view the gate passes in unless it is the raw or the convention-net view.
- [ ] **Step 4:** Commit record and roadmap.

**Not in this plan:** retraining on wild labels (round 13), applying the split to training keys, `prev` context repair, OCR, ODL changes, any product-branch change, the merge of `claude/heading-suggestion-asks`.
