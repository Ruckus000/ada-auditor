# Key Dataset Pass Implementation Plan (Stage 0 of the staged-autonomy roadmap)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a heading-type training/validation/test dataset with **no human labels**, by stripping the structure tree from documents whose authors declared it, re-tagging the stripped copy, and scoring every candidate block against the original tree — hygiene-filtered, provenance-carrying, split by host.

**Architecture:** One new Java stage (`Strip.java`, PDFBox) and five small stdlib-Python modules under `experiments/qwen-role-decisions/labels/` — key extraction from a tagged original, veraPDF-based key hygiene, Word→tagged-PDF conversion with the product's own export filter, candidate↔key matching, and a build script — reusing the modules the labelling pass already built (`manifest.py`, `stage_pdfs.py`, `pdf_cards.py`, `render.py`) and `eligibility_eval.py`. The manual labelling tool (`serve.py`) is untouched; it is the audit instrument for a later stage.

**Tech Stack:** Python 3.14 stdlib; JDK 17 + PDFBox 3.0.8 (vendored); veraPDF 1.30.2 CLI (`experiments/document-remediation/vendor/verapdf/verapdf` in the main checkout); LibreOffice `/opt/homebrew/bin/soffice`; `@opendataloader/pdf` 2.5.0 via the spike runner; existing `run.py` helpers (`dump_pdf`, `blocks_to_cards`, `text_norm`, `HEADING`).

**Spec:** `docs/superpowers/plans/2026-09-13-staged-autonomy-roadmap.md` (Stage 0) and `docs/research/document-remediation/heading-definition-2026-09-13.md` (frozen; §2 vocabulary, §4 definition).

## Global Constraints

- **Working directory:** `/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor`, branch `claude/heading-labelling-pass` (head `201eb80` or later). Do not create another clone or worktree. Preserve every uncommitted file.
- **Corpus bytes live only in the main checkout**, gitignored: `/Users/jphilistin/Documents/Coding/ADA Auditor/experiments/document-remediation/blind-corpus/real/` (52 PDF, 26 docx; provenance one directory up). Every script takes `--corpus`/`--manifest`; nothing hard-codes document paths except the two tool locations named below.
- **Tools in the main checkout** (`MAIN = /Users/jphilistin/Documents/Coding/ADA Auditor`): `experiments/document-remediation/run-opendataloader.mjs` (run with `cwd=MAIN`), `experiments/document-remediation/vendor/verapdf/verapdf`, `/opt/homebrew/bin/soffice`. `JAVA_HOME=/opt/homebrew/opt/openjdk@17`.
- **No document text in a tracked file.** Everything under `experiments/qwen-role-decisions/out/keys/` is gitignored (`out/` already is). Tracked deliverables: code, tests, `labels/split-keys-<date>.json` (ids only), the results record.
- **Label rows follow `eligibility_eval.py`'s contract** with `label_source` in `{"stripped-tree", "word-outline", "planted"}` (Task 6 widens the evaluator from `human-answer` only), `actor = "key:<source>"`, `answer_id` a fresh UUID, `client_id = template_id = host`. Model fields (`prediction, model, model_role, heading_flag, raw, confidence`) stay forbidden on a row.
- **Type vocabulary** (definition §2): `H` (with level 1–6), `P`, `Artifact`, `Caption`, `TH`, `TOCI`, `Lbl`, `BlockQuote`, plus `Other` for standard types outside it (`TD`, `LI`, `Figure`, `Formula`, …) — `Other` rows count as non-headings in the binary metric and are excluded from type-confusion reporting.
- **Hygiene is fixed before any document is scored** and recorded: original must have zero failed checks on `7.1-3`, `7.4.2`, `7.4.4`; heading sentence share < 0.30; ≥ 1 text block. Excluded documents are listed by reason.
- **The tagger never sees the tree.** Candidates come from the *stripped* copy only. The key is read from the original only. A candidate's `existing_tag` is the tagger's tag and is stored, never used for matching.
- Run every Python script with `python3 -B` from `experiments/qwen-role-decisions/`; tests with `python3 -B labels/run_tests.py labels.test_x`.
- Commit after each task with `git add <paths>` (never `-A`), trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (or the model that wrote it).

---

### Task 0: Checkpoint and bring the roadmap across

**Files:**
- Copy: `/Users/jphilistin/Documents/Coding/ADA Auditor/.claude/worktrees/sleepy-mclaren-b8ba9e/docs/superpowers/plans/2026-09-13-staged-autonomy-roadmap.md` → `docs/superpowers/plans/`
- Copy: `…/sleepy-mclaren-b8ba9e/docs/superpowers/plans/2026-09-13-key-dataset-pass.md` → `docs/superpowers/plans/`

- [ ] **Step 1: Verify state**

```bash
cd "/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor" && git status --short && git branch --show-current && git log --oneline -1
cd experiments/qwen-role-decisions && python3 -B labels/run_tests.py labels.test_manifest labels.test_stage_pdfs labels.test_pdf_cards labels.test_word_cards labels.test_serve labels.test_agreement | tail -1 && python3 -B eligibility_eval.py --self-check
ls out/labels/manifest.json out/labels/pdfs | head -3
"/Users/jphilistin/Documents/Coding/ADA Auditor/experiments/document-remediation/vendor/verapdf/verapdf" --version | head -1
```
Expected: branch `claude/heading-labelling-pass`; all label tests pass; evaluator ok; `veraPDF 1.30.2`.

- [ ] **Step 2: Copy the two documents and commit**

```bash
SRC="/Users/jphilistin/Documents/Coding/ADA Auditor/.claude/worktrees/sleepy-mclaren-b8ba9e/docs/superpowers/plans"
cp "$SRC/2026-09-13-staged-autonomy-roadmap.md" "$SRC/2026-09-13-key-dataset-pass.md" docs/superpowers/plans/
git add docs/superpowers/plans/2026-09-13-staged-autonomy-roadmap.md docs/superpowers/plans/2026-09-13-key-dataset-pass.md
git commit -m "Plan Stage 0 of the staged-autonomy roadmap: labels from keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: `Strip.java` — remove the structure tree, keep everything else

**Files:**
- Create: `experiments/qwen-role-decisions/Strip.java`
- Create: `experiments/qwen-role-decisions/labels/strip.py`
- Test: `experiments/qwen-role-decisions/labels/test_strip.py`

**Interfaces:**
- `Strip <in.pdf> <out.pdf>` — removes `/StructTreeRoot` and `/MarkInfo` from the catalog, saves. Prints one JSON line `{"pages": n, "hadTree": bool}`. Marked-content operators in page streams are left alone (they are inert without a tree, and rewriting streams is the surgery this repo refuses).
- `strip.py`: `strip_pdf(src: Path, dest: Path) -> dict` compiles once (`compile_strip()`), runs it, and asserts with `run.dump_pdf` that `dest` has `hasStructTree: false`; raises if the page count changed.

- [ ] **Step 1: Write the failing test** (uses any tagged PDF from the staged pool; skips with a message if none)

```python
# labels/test_strip.py
import json, tempfile
from pathlib import Path
from labels.strip import strip_pdf
from run import dump_pdf

POOL = Path("out/labels/pdfs")


def test_strip_removes_tree_and_keeps_pages():
    src = next((p for p in sorted(POOL.glob("*.pdf")) if dump_pdf(p, compile=False).get("hasStructTree")), None)
    if src is None:
        print("skip: no tagged pdf staged"); return
    with tempfile.TemporaryDirectory() as d:
        dest = Path(d) / "stripped.pdf"
        info = strip_pdf(src, dest)
        assert info["hadTree"] is True and info["pages"] >= 1
        assert dump_pdf(dest, compile=False)["hasStructTree"] is False
        assert dest.stat().st_size > 0
```

- [ ] **Step 2: Run to verify it fails** — `python3 -B labels/run_tests.py labels.test_strip` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement the Java stage and the wrapper**

```java
// Strip.java
import java.io.File;
import java.util.Locale;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentCatalog;

/**
 * Experiment-only: drop the structure tree so a tagged document can stand in
 * for an untagged one. Catalog entries only; page content streams are not
 * rewritten. Usage: Strip <in.pdf> <out.pdf>
 */
public final class Strip {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) { System.err.println("usage: Strip <in.pdf> <out.pdf>"); System.exit(2); }
        try (PDDocument doc = Loader.loadPDF(new File(args[0]))) {
            PDDocumentCatalog cat = doc.getDocumentCatalog();
            boolean had = cat.getStructureTreeRoot() != null;
            cat.getCOSObject().removeItem(COSName.STRUCT_TREE_ROOT);
            cat.getCOSObject().removeItem(COSName.MARK_INFO);
            doc.save(new File(args[1]));
            System.out.println(String.format(Locale.ROOT, "{\"pages\":%d,\"hadTree\":%s}", doc.getNumberOfPages(), had));
        }
    }
}
```

```python
# labels/strip.py
"""Strip a tagged PDF's structure tree so the tagger sees an untagged copy."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from run import CARDS_CLASSES, HERE, JAVA_HOME, PDFBOX, dump_pdf

STRIP_JAVA = HERE / "Strip.java"
_compiled = False


def compile_strip() -> None:
    global _compiled
    if _compiled:
        return
    CARDS_CLASSES.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run([str(JAVA_HOME / "bin" / "javac"), "-cp", str(PDFBOX), "-d", str(CARDS_CLASSES), str(STRIP_JAVA)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:])
    _compiled = True


def strip_pdf(src: Path, dest: Path) -> dict:
    compile_strip()
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run([str(JAVA_HOME / "bin" / "java"), "-Djava.awt.headless=true", "-cp", f"{PDFBOX}:{CARDS_CLASSES}", "Strip", str(src), str(dest)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:])
    info = json.loads(proc.stdout.strip().splitlines()[-1])
    after = dump_pdf(dest, compile=False)
    if after.get("hasStructTree"):
        raise RuntimeError(f"{dest} still has a structure tree")
    return info
```

- [ ] **Step 4: Run the test** → PASS. **Commit:**

```bash
git add experiments/qwen-role-decisions/Strip.java experiments/qwen-role-decisions/labels/strip.py experiments/qwen-role-decisions/labels/test_strip.py
git commit -m "Key dataset: strip a tagged PDF's tree so it can stand in for an untagged one

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `keys.py` — the key from a tagged original

**Files:**
- Create: `experiments/qwen-role-decisions/labels/keys.py`
- Test: `experiments/qwen-role-decisions/labels/test_keys.py`

**Interfaces:**
- `VOCAB = ("H", "P", "Artifact", "Caption", "TH", "TOCI", "Lbl", "BlockQuote")`
- `key_type(existing_tag: str) -> tuple[str, int | None]` — `"H2" → ("H", 2)`; a vocabulary name → itself; anything else → `("Other", None)`; empty → `("Other", None)`.
- `key_blocks(dump: dict) -> list[dict]` — every block of a `run.dump_pdf` result with `page`, box, `text`, `norm = text_norm(text)`, `type`, `level`, `existing_tag`. Blocks without a box are kept (matchable by text only).
- `heading_sentence_share(blocks) -> float | None` — share of `H` blocks ending in `.!?;` (the `prose-headings.mjs` rule); `None` when no headings.

- [ ] **Step 1: Write the failing test**

```python
# labels/test_keys.py
from labels.keys import heading_sentence_share, key_blocks, key_type


def test_key_type_maps_vocabulary_levels_and_other():
    assert key_type("H2") == ("H", 2) and key_type("H6") == ("H", 6)
    assert key_type("Caption") == ("Caption", None) and key_type("TH") == ("TH", None)
    assert key_type("TD") == ("Other", None) and key_type("") == ("Other", None) and key_type("Figure") == ("Other", None)


def test_key_blocks_and_sentence_share():
    dump = {"hasStructTree": True, "blocks": [
        {"locator": "d:0", "existing_tag": "H1", "text": "Title", "page": 0, "x0": 1, "y0": 1, "x1": 2, "y1": 2},
        {"locator": "d:1", "existing_tag": "H2", "text": "This heading is a sentence.", "page": 0, "x0": 1, "y0": 3, "x1": 2, "y1": 4},
        {"locator": "d:2", "existing_tag": "P", "text": "Body.", "page": 0},
    ]}
    ks = key_blocks(dump)
    assert [k["type"] for k in ks] == ["H", "H", "P"] and ks[0]["level"] == 1 and ks[2].get("x0") is None
    assert ks[0]["norm"] == "title"
    assert heading_sentence_share(ks) == 0.5
    assert heading_sentence_share([ks[2]]) is None
```

- [ ] **Step 2: Run to verify it fails** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/keys.py
"""The key: what a tagged original says every block is, in the definition's vocabulary."""
from __future__ import annotations

import re

from run import HEADING, text_norm

VOCAB = ("H", "P", "Artifact", "Caption", "TH", "TOCI", "Lbl", "BlockQuote")
SENTENCE_END = re.compile(r"[.!?;]\s*$")


def key_type(existing_tag: str) -> tuple[str, int | None]:
    tag = existing_tag or ""
    if tag in HEADING:
        return "H", int(tag[1])
    if tag in VOCAB:
        return tag, None
    return "Other", None


def key_blocks(dump: dict) -> list[dict]:
    out = []
    for b in dump.get("blocks") or []:
        t, level = key_type(b.get("existing_tag") or "")
        row = {k: b.get(k) for k in ("locator", "page", "x0", "y0", "x1", "y1", "existing_tag")}
        row.update({"text": b.get("text") or "", "norm": text_norm(b.get("text") or ""), "type": t, "level": level})
        out.append(row)
    return out


def heading_sentence_share(blocks: list[dict]) -> float | None:
    heads = [b for b in blocks if b["type"] == "H" and b["text"].strip()]
    if not heads:
        return None
    return sum(1 for b in heads if SENTENCE_END.search(b["text"])) / len(heads)
```

- [ ] **Step 4: Run tests** → PASS (2). **Commit:**

```bash
git add experiments/qwen-role-decisions/labels/keys.py experiments/qwen-role-decisions/labels/test_keys.py
git commit -m "Key dataset: read the key from a tagged original in the definition's vocabulary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `hygiene.py` — which keys may be trusted

**Files:**
- Create: `experiments/qwen-role-decisions/labels/hygiene.py`
- Test: `experiments/qwen-role-decisions/labels/test_hygiene.py`

**Interfaces:**
- `verapdf_failures(pdf: Path) -> set[str]` — runs `<MAIN>/experiments/document-remediation/vendor/verapdf/verapdf -f ua1 --format json <pdf>` and returns clause ids like `"7.1-3"` for every rule summary with `status == "failed"`. The JSON shape (checked 2026-09-13): `report.jobs[0].validationResult` is a **list**; each entry has `details.ruleSummaries[]` with `clause`, `testNumber`, `status`, `failedChecks`.
- `verdict(failures: set[str], sentence_share: float | None, n_blocks: int) -> tuple[bool, list[str]]` — `(usable, reasons)`; reasons among `untagged-content (7.1-3)`, `level-skip (7.4.2)`, `mixed-structure (7.4.4)`, `prose-headings (>=0.30)`, `no-blocks`.
- `BLOCKING = {"7.1-3", "7.4.2-1", "7.4.4-1", "7.4.4-2", "7.4.4-3"}` — matched on prefix `clause-test`.

- [ ] **Step 1: Write the failing test**

```python
# labels/test_hygiene.py
from labels.hygiene import parse_failures, verdict


def test_parse_failures_reads_the_list_shaped_validation_result():
    report = {"report": {"jobs": [{"validationResult": [{"details": {"ruleSummaries": [
        {"clause": "7.1", "testNumber": 3, "status": "failed", "failedChecks": 12},
        {"clause": "7.18.1", "testNumber": 2, "status": "failed", "failedChecks": 37},
        {"clause": "7.4.2", "testNumber": 1, "status": "passed", "failedChecks": 0},
    ]}}]}]}}
    assert parse_failures(report) == {"7.1-3", "7.18.1-2"}


def test_verdict_reasons():
    assert verdict(set(), 0.1, 40) == (True, [])
    assert verdict({"7.1-3"}, 0.0, 40) == (False, ["untagged-content (7.1-3)"])
    assert verdict({"7.4.2-1", "7.4.4-2"}, None, 40)[1] == ["level-skip (7.4.2)", "mixed-structure (7.4.4)"]
    assert verdict({"7.18.1-2"}, 0.31, 40) == (False, ["prose-headings (>=0.30)"])
    assert verdict(set(), None, 0) == (False, ["no-blocks"])
```

- [ ] **Step 2: Run to verify it fails** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/hygiene.py
"""Key hygiene: a key is trusted only when the checker says its structure is whole."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

MAIN = Path("/Users/jphilistin/Documents/Coding/ADA Auditor")
VERAPDF = MAIN / "experiments" / "document-remediation" / "vendor" / "verapdf" / "verapdf"
PROSE_SHARE = 0.30


def parse_failures(report: dict) -> set[str]:
    out: set[str] = set()
    for job in report.get("report", {}).get("jobs", []):
        results = job.get("validationResult") or []
        if isinstance(results, dict):
            results = [results]
        for r in results:
            for rule in (r.get("details") or {}).get("ruleSummaries") or []:
                if rule.get("status") == "failed":
                    out.add(f"{rule.get('clause')}-{rule.get('testNumber')}")
    return out


def verapdf_failures(pdf: Path) -> set[str]:
    proc = subprocess.run([str(VERAPDF), "-f", "ua1", "--format", "json", str(pdf)], capture_output=True, text=True)
    if not proc.stdout.strip():
        raise RuntimeError(f"verapdf produced no output for {pdf}: {proc.stderr[-500:]}")
    return parse_failures(json.loads(proc.stdout))


def verdict(failures: set[str], sentence_share: float | None, n_blocks: int) -> tuple[bool, list[str]]:
    reasons = []
    if n_blocks == 0:
        reasons.append("no-blocks")
    if "7.1-3" in failures:
        reasons.append("untagged-content (7.1-3)")
    if any(f.startswith("7.4.2-") for f in failures):
        reasons.append("level-skip (7.4.2)")
    if any(f.startswith("7.4.4-") for f in failures):
        reasons.append("mixed-structure (7.4.4)")
    if sentence_share is not None and sentence_share >= PROSE_SHARE:
        reasons.append("prose-headings (>=0.30)")
    return (not reasons, reasons)
```

- [ ] **Step 4: Run tests** → PASS (2). Then one real call: `python3 -B -c "from pathlib import Path; from labels.hygiene import verapdf_failures; print(sorted(verapdf_failures(Path('out/labels/pdfs/n01.pdf'))))"` → a list including `7.18.1-2` (n01's known clauses). **Commit:**

```bash
git add experiments/qwen-role-decisions/labels/hygiene.py experiments/qwen-role-decisions/labels/test_hygiene.py
git commit -m "Key dataset: veraPDF-backed key hygiene

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `word_convert.py` — Word sources become tagged originals

**Files:**
- Create: `experiments/qwen-role-decisions/labels/word_convert.py`
- Test: `experiments/qwen-role-decisions/labels/test_word_convert.py`

**Interfaces:**
- `EXPORT_FILTER` — exactly the product's string from `src/integrations/documents/convert.ts`: `'pdf:writer_pdf_Export:' + json.dumps({"UseTaggedPDF": {"type": "boolean", "value": "true"}, "PDFUACompliance": {"type": "boolean", "value": "true"}})`.
- `convert_docx(src: Path, out_dir: Path) -> Path | None` — `soffice --headless --convert-to <EXPORT_FILTER> --outdir <out_dir> <src>` with a private `-env:UserInstallation=file://<tmp>` profile (parallel-safe); returns the PDF path if produced and `run.dump_pdf` reports a tree, else `None`.
- CLI: `--manifest --out out/keys/word-pdfs` → converts every `docx` row; prints `{"converted": n, "untagged": [ids], "failed": [ids]}`.

- [ ] **Step 1: Write the failing test** (pure part only — the filter string must equal the product's)

```python
# labels/test_word_convert.py
import re
from pathlib import Path
from labels.word_convert import EXPORT_FILTER

REPO = Path(__file__).resolve().parents[3]


def test_export_filter_matches_the_products():
    src = (REPO / "src" / "integrations" / "documents" / "convert.ts").read_text()
    assert "UseTaggedPDF" in src and "PDFUACompliance" in src
    assert EXPORT_FILTER.startswith("pdf:writer_pdf_Export:")
    assert '"UseTaggedPDF":{"type":"boolean","value":"true"}' in EXPORT_FILTER.replace(" ", "")
    assert '"PDFUACompliance":{"type":"boolean","value":"true"}' in EXPORT_FILTER.replace(" ", "")
```

- [ ] **Step 2: Run to verify it fails** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/word_convert.py
"""Convert Word sources with the product's own tagged-export filter; the result is a tagged original."""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from run import compile_cards, dump_pdf

SOFFICE = "/opt/homebrew/bin/soffice"
EXPORT_FILTER = "pdf:writer_pdf_Export:" + json.dumps({
    "UseTaggedPDF": {"type": "boolean", "value": "true"},
    "PDFUACompliance": {"type": "boolean", "value": "true"},
})


def convert_docx(src: Path, out_dir: Path) -> Path | None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run([SOFFICE, f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", EXPORT_FILTER, "--outdir", str(out_dir), str(src)], capture_output=True, text=True, timeout=300)
    pdf = out_dir / (src.stem + ".pdf")
    if not pdf.is_file():
        return None
    return pdf if dump_pdf(pdf, compile=False).get("hasStructTree") else None


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path("out/keys/word-pdfs"))
    a = p.parse_args()
    compile_cards()
    rows = [r for r in json.loads(a.manifest.read_text()) if r["kind"] == "docx"]
    converted, untagged, failed = [], [], []
    for r in rows:
        try:
            pdf = convert_docx(Path(r["path"]), a.out)
        except Exception:
            failed.append(r["id"]); continue
        if pdf is None:
            (untagged if (a.out / (Path(r["path"]).stem + ".pdf")).is_file() else failed).append(r["id"])
        else:
            converted.append(r["id"])
    print(json.dumps({"converted": len(converted), "untagged": untagged, "failed": failed}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test → PASS. Convert the real Word files:**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@17 python3 -B -m labels.word_convert --manifest out/labels/manifest.json`
Expected: `converted` ≈ 26, `untagged` and `failed` ideally empty; record the exact numbers. A Word file that converts untagged is excluded (never retried with different options).

- [ ] **Step 5: Commit**

```bash
git add experiments/qwen-role-decisions/labels/word_convert.py experiments/qwen-role-decisions/labels/test_word_convert.py
git commit -m "Key dataset: Word sources become tagged originals through the product's export filter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `match.py` — candidate blocks scored against the key

**Files:**
- Create: `experiments/qwen-role-decisions/labels/match.py`
- Test: `experiments/qwen-role-decisions/labels/test_match.py`

**Interfaces:**
- `iou(a: dict, b: dict) -> float` on `x0,y0,x1,y1`.
- `match_candidate(card: dict, keys_on_page: list[dict]) -> tuple[dict | None, str]` — returns `(key_block, how)` with `how ∈ {"exact", "contains", "box", "none"}`: same `norm` first; else the key whose `norm` contains the card's norm (or vice-versa) with IoU ≥ 0.3; else best IoU ≥ 0.5; else none.
- `label_for(card, key, how) -> tuple[str, int | None]` — the key's `(type, level)`; `("Artifact", None)` when `how == "none"` (no element at that place in a whole-tagged document means the author left it out of the tree, which is what Artifact means — this is why hygiene requires `7.1-3` to pass).
- `make_key_row(card, doc, key, how, source) -> dict` — the label row (evaluator contract) plus `type`, `match`, `key_locator`, `text_sha256`, the card facts, `existing_tag` (the tagger's tag, stored only).

- [ ] **Step 1: Write the failing test**

```python
# labels/test_match.py
from labels.match import iou, label_for, make_key_row, match_candidate
from eligibility_eval import refusals


def box(x0, y0, x1, y1, **k):
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1, **k}


def test_iou():
    assert iou(box(0, 0, 10, 10), box(0, 0, 10, 10)) == 1.0
    assert iou(box(0, 0, 10, 10), box(5, 0, 15, 10)) == 1 / 3
    assert iou(box(0, 0, 10, 10), box(20, 20, 30, 30)) == 0.0


def test_match_prefers_text_then_containment_then_box():
    keys = [box(0, 0, 100, 10, norm="publiccomment", type="H", level=2, locator="k:1"),
            box(0, 20, 100, 30, norm="thefeeschedulefor2026", type="P", level=None, locator="k:2"),
            box(0, 40, 100, 50, norm="fee", type="TH", level=None, locator="k:3")]
    assert match_candidate(box(0, 0, 100, 10, norm="publiccomment"), keys)[1] == "exact"
    k, how = match_candidate(box(0, 20, 60, 30, norm="thefeeschedule"), keys)
    assert how == "contains" and k["locator"] == "k:2"
    k, how = match_candidate(box(2, 41, 98, 49, norm="glyphsoup"), keys)  # OCR-ish text, box still says TH
    assert how == "box" and k["locator"] == "k:3"
    assert match_candidate(box(0, 200, 100, 210, norm="runningfooter"), keys) == (None, "none")


def test_label_and_row_contract():
    assert label_for({}, {"type": "H", "level": 2}, "exact") == ("H", 2)
    assert label_for({}, None, "none") == ("Artifact", None)
    card = {"card_id": "n01:5", "document_id": "n01", "kind": "pdf", "text": "Public Comment", "existing_tag": "H1", "why": ["source_h"], "repeats_on_pages": 1, "in_table_box": False, "font_pt": 14, "weight": "bold", "page": 0}
    doc = {"id": "n01", "sha256": "b" * 64, "host": "example.gov"}
    row = make_key_row(card, doc, {"type": "H", "level": 2, "locator": "k:9"}, "exact", "stripped-tree")
    assert row["label"] == {"heading": True, "level": 2} and row["type"] == "H" and row["match"] == "exact"
    assert row["label_source"] == "stripped-tree" and row["actor"] == "key:stripped-tree"
    assert "text" not in row and row["existing_tag"] == "H1"
    assert refusals([row]) == []  # after Task 6 widens the evaluator; before it, this line fails
```

- [ ] **Step 2: Run to verify it fails** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/match.py
"""Score a candidate block from the stripped copy against the original tree."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

CONTAIN_IOU = 0.3
BOX_IOU = 0.5


def iou(a: dict, b: dict) -> float:
    if any(a.get(k) is None or b.get(k) is None for k in ("x0", "y0", "x1", "y1")):
        return 0.0
    w = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
    h = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"])
    inter = max(w, 0) * max(h, 0)
    union = (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]) + (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]) - inter
    return inter / union if union > 0 else 0.0


def match_candidate(card: dict, keys_on_page: list[dict]) -> tuple[dict | None, str]:
    n = card.get("norm") or ""
    if n:
        exact = [k for k in keys_on_page if k.get("norm") == n]
        if exact:
            return max(exact, key=lambda k: iou(card, k)), "exact"
        contains = [k for k in keys_on_page if k.get("norm") and (n in k["norm"] or k["norm"] in n) and iou(card, k) >= CONTAIN_IOU]
        if contains:
            return max(contains, key=lambda k: iou(card, k)), "contains"
    best = max(keys_on_page, key=lambda k: iou(card, k), default=None)
    if best is not None and iou(card, best) >= BOX_IOU:
        return best, "box"
    return None, "none"


def label_for(card: dict, key: dict | None, how: str) -> tuple[str, int | None]:
    if how == "none" or key is None:
        return "Artifact", None
    return key["type"], key.get("level")


def make_key_row(card: dict, doc: dict, key: dict | None, how: str, source: str) -> dict:
    type_, level = label_for(card, key, how)
    return {
        "id": card["card_id"],
        "label_source": source,
        "answer_id": str(uuid.uuid4()),
        "actor": f"key:{source}",
        "client_id": doc["host"],
        "template_id": doc["host"],
        "document_sha256": doc["sha256"],
        "document_stem": doc["id"],
        "document_id": doc["id"],
        "card_id": card["card_id"],
        "kind": card.get("kind"),
        "type": type_,
        "match": how,
        "key_locator": None if key is None else key.get("locator"),
        "label": {"heading": type_ == "H", "level": level if type_ == "H" else None},
        "text_sha256": hashlib.sha256((card.get("text") or "").encode()).hexdigest(),
        "why": card.get("why"),
        "repeats_on_pages": card.get("repeats_on_pages"),
        "in_table_box": card.get("in_table_box"),
        "font_pt": card.get("font_pt"),
        "weight": card.get("weight"),
        "page": card.get("page"),
        "existing_tag": card.get("existing_tag"),
        "labelled_at": datetime.now(timezone.utc).isoformat(),
    }
```

- [ ] **Step 4: Run tests** — the first two pass; the contract assertion fails until Task 6. **Commit** anyway (the failing line is the reason Task 6 exists):

```bash
git add experiments/qwen-role-decisions/labels/match.py experiments/qwen-role-decisions/labels/test_match.py
git commit -m "Key dataset: match stripped-copy candidates to the original tree

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Widen the evaluator — key sources, type outputs, level from the model

**Files:**
- Modify: `experiments/qwen-role-decisions/eligibility_eval.py` (`refusals`, `read_prediction`, `self_check`)

**Interfaces:**
- `LABEL_SOURCES = ("human-answer", "stripped-tree", "word-outline", "planted")`; `refusals` accepts any of them.
- `read_prediction(raw)` also accepts the type output: `{"type": "Caption", "rule": 3}` → `("not-heading", None)`; `{"type": "H", "level": 2, "rule": 1}` → `("heading", 2)`; `{"type": "Unsure"}` → `("abstain", None)`. The old `{"heading": bool}` form still works.
- `evaluate` additionally reports `type_confusion`: counts of `(truth_type, predicted_type)` over rows whose label carries `type` and whose prediction carries `type`, excluding `Other`.

- [ ] **Step 1: Extend the self-check first** (it is the test)

Add to `self_check()` before the final print:

```python
    # key sources are labels; a model source is not
    k = {**label(5, True, "c", "t"), "label_source": "stripped-tree", "actor": "key:stripped-tree"}
    assert refusals([k]) == []
    assert refusals([{**k, "label_source": "model-draft"}])
    # type-shaped predictions
    assert read_prediction('{"type":"Caption","rule":3}') == ("not-heading", None)
    assert read_prediction('{"type":"H","level":2,"rule":1}') == ("heading", 2)
    assert read_prediction('{"type":"Unsure"}') == ("abstain", None)
    typed = [{**label(0, False, "c", "t"), "id": "t1", "type": "Caption"}, {**label(1, True, "c", "t", 2), "id": "t2", "type": "H"}]
    got = evaluate(typed, {"t1": '{"type":"H","level":1,"rule":1}', "t2": '{"type":"H","level":2,"rule":1}'})
    assert got["confusion"]["fp"] == 1 and got["type_confusion"] == {"Caption->H": 1, "H->H": 1}
```

- [ ] **Step 2: Run** `python3 -B eligibility_eval.py --self-check` → AssertionError at the first new line.

- [ ] **Step 3: Implement** (verified 2026-09-13 against the current file)

Beside `MODEL_FIELDS` add:

```python
LABEL_SOURCES = ("human-answer", "stripped-tree", "word-outline", "planted")
```

In `refusals`, replace the two `label_source` lines with:

```python
        if row.get("label_source") not in LABEL_SOURCES:
            out.append(f"{where}: label_source must be one of {LABEL_SOURCES}")
```

Replace the whole `read_prediction` function with:

```python
def prediction_dict(raw: str) -> dict | None:
    try:
        data = json.loads(raw[raw.index("{") : raw.rindex("}") + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def read_prediction(raw: str) -> tuple[str, int | None]:
    """``heading`` | ``not-heading`` | ``abstain`` | ``parse-failure``, and a level.

    Two output shapes: the binary ``{"heading": bool}`` and the typed
    ``{"type": <vocab>, "level": n, "rule": r}`` the staged-autonomy roadmap
    trains toward. ``Unsure`` and ``{"abstain": true}`` are abstentions.
    """
    data = prediction_dict(raw)
    if data is None:
        return "parse-failure", None
    level = data.get("level") if data.get("level") in range(1, 7) else None
    if data.get("type") == "Unsure" or (data.get("abstain") is True and "heading" not in data and "type" not in data):
        return "abstain", None
    if isinstance(data.get("type"), str):
        return ("heading" if data["type"] == "H" else "not-heading"), level
    flag = parse_heading_flag(raw)
    if flag is None:
        return "parse-failure", None
    return ("heading" if flag else "not-heading"), level
```

In `evaluate`: after `confusion = Counter()` add `type_confusion = Counter()`; in the loop, directly after `outcome, level = read_prediction(raw)` add:

```python
            pd = prediction_dict(raw)
            if row.get("type") and pd and isinstance(pd.get("type"), str) and "Other" not in (row["type"], pd["type"]):
                type_confusion[f"{row['type']}->{pd['type']}"] += 1
```

and in the returned dict add `"type_confusion": dict(type_confusion),` before `"uncertainty"`.

- [ ] **Step 4: Run the self-check → `eligibility_eval_self_check_ok`; run `labels.test_match` → PASS (3). Commit:**

```bash
git add experiments/qwen-role-decisions/eligibility_eval.py
git commit -m "Evaluator: key label sources, typed predictions, type confusion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `build_keys.py` — the whole pass, one command

**Files:**
- Create: `experiments/qwen-role-decisions/labels/build_keys.py`
- Test: `experiments/qwen-role-decisions/labels/test_build_keys.py`

**Interfaces:**
- `originals(manifest_rows, word_pdfs: Path, staged: Path) -> list[dict]` — every tagged original with `source`: manifest PDFs whose staged copy came from `original` (read `out/labels/staging.json`) → `stripped-tree`; converted Word PDFs → `word-outline`. ODL-tagged PDFs are **excluded** (their tree is the tagger's, not an author's).
- Per document: hygiene → strip to `out/keys/stripped/<id>.pdf` → tag the stripped copy with the ODL runner (batch, one call, `cwd=MAIN`) → `run.dump_pdf` on the tagged-stripped copy → `blocks_to_cards` → `pdf_cards.select_candidates` + `cap_per_document` → `match_candidate` against `key_blocks(dump_pdf(original))` on the same page → `make_key_row`.
- Outputs: `out/keys/labels.jsonl`, `out/keys/report.json` (`documents`, `usable`, `excluded: {id: reasons}`, `cards`, `match: {exact, contains, box, none}`, `types: Counter`, `hosts`), then `eligibility_eval.py split` and a copy of `split.json` to `labels/split-keys-<date>.json`.

- [ ] **Step 1: Write the failing test** (pure `originals` only)

```python
# labels/test_build_keys.py
import json, tempfile
from pathlib import Path
from labels.build_keys import originals


def test_originals_excludes_tagger_output_and_adds_word_conversions():
    rows = [{"id": "n01", "kind": "pdf", "path": "/x/n01.pdf", "host": "a", "sha256": "1" * 64},
            {"id": "n09", "kind": "pdf", "path": "/x/n09.pdf", "host": "b", "sha256": "2" * 64},
            {"id": "n34", "kind": "docx", "path": "/x/n34.docx", "host": "c", "sha256": "3" * 64}]
    with tempfile.TemporaryDirectory() as d:
        staged = Path(d) / "labels"; staged.mkdir()
        (staged / "staging.json").write_text(json.dumps([{"id": "n01", "source": "original", "tagged": True}, {"id": "n09", "source": "opendataloader", "tagged": True}]))
        word = Path(d) / "word-pdfs"; word.mkdir(); (word / "n34.pdf").write_bytes(b"x")
        out = originals(rows, word, staged)
    assert [(o["id"], o["source"]) for o in out] == [("n01", "stripped-tree"), ("n34", "word-outline")]
    assert out[1]["original"].endswith("n34.pdf") and out[0]["original"] == "/x/n01.pdf"
```

- [ ] **Step 2: Run to verify it fails** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/build_keys.py
"""Stage 0: labels from keys. Strip, re-tag, match, score, split — no person."""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import tempfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from run import blocks_to_cards, compile_cards, dump_pdf, text_norm
from labels.hygiene import verapdf_failures, verdict
from labels.keys import heading_sentence_share, key_blocks
from labels.match import make_key_row, match_candidate
from labels.pdf_cards import SEED, cap_per_document, select_candidates
from labels.stage_pdfs import MAIN, ODL_RUNNER
from labels.strip import strip_pdf

OUT = Path("out/keys")


def originals(rows: list[dict], word_pdfs: Path, staged: Path) -> list[dict]:
    staging = {s["id"]: s for s in json.loads((staged / "staging.json").read_text())}
    out = []
    for r in rows:
        if r["kind"] == "pdf" and staging.get(r["id"], {}).get("source") == "original":
            out.append({**r, "source": "stripped-tree", "original": r["path"]})
        elif r["kind"] == "docx" and (word_pdfs / f"{r['id']}.pdf").is_file():
            out.append({**r, "source": "word-outline", "original": str(word_pdfs / f"{r['id']}.pdf")})
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, default=Path("out/labels/manifest.json"))
    p.add_argument("--word-pdfs", type=Path, default=Path("out/keys/word-pdfs"))
    p.add_argument("--staged", type=Path, default=Path("out/labels"))
    p.add_argument("--salt", required=True)
    a = p.parse_args()
    compile_cards()
    rows = json.loads(a.manifest.read_text())
    docs = originals(rows, a.word_pdfs, a.staged)
    excluded: dict[str, list[str]] = {}
    usable: list[dict] = []
    keys: dict[str, list[dict]] = {}
    for d in docs:
        dump = dump_pdf(Path(d["original"]), compile=False)
        kb = key_blocks(dump)
        ok, reasons = verdict(verapdf_failures(Path(d["original"])), heading_sentence_share(kb), len(kb))
        if not ok:
            excluded[d["id"]] = reasons
            continue
        keys[d["id"]] = kb
        usable.append(d)
    stripped_dir = OUT / "stripped"
    for d in usable:
        strip_pdf(Path(d["original"]), stripped_dir / f"{d['id']}.pdf")
    tagged_dir = OUT / "tagged"
    tagged_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["node", str(ODL_RUNNER), str(stripped_dir.resolve()), str(tagged_dir.resolve())], cwd=MAIN, check=True)
    rng = random.Random(SEED)
    match_counts, types = Counter(), Counter()
    n_rows = 0
    with (OUT / "labels.jsonl").open("w") as f:
        for d in usable:
            tagged = tagged_dir / f"{d['id']}.pdf"
            if not tagged.is_file():
                excluded[d["id"]] = ["tagger-produced-nothing"]; continue
            cards, _ = blocks_to_cards(dump_pdf(tagged, compile=False).get("blocks") or [])
            chosen = select_candidates(cards, rng)
            for c in chosen:
                c["document_id"] = d["id"]; c["kind"] = "pdf"; c["card_id"] = c["locator"]
                c["norm"] = text_norm(c["text"])
            by_page = defaultdict(list)
            for k in keys[d["id"]]:
                by_page[k.get("page")].append(k)
            for c in cap_per_document(chosen, rng):
                key, how = match_candidate(c, by_page.get(c.get("page"), []))
                row = make_key_row(c, d, key, how, d["source"])
                match_counts[how] += 1; types[row["type"]] += 1; n_rows += 1
                f.write(json.dumps(row) + "\n")
    report = {"documents": len(docs), "usable": len(usable) - sum(1 for d in usable if d["id"] in excluded), "excluded": excluded,
              "cards": n_rows, "match": dict(match_counts), "types": dict(types), "hosts": len({d["host"] for d in usable if d["id"] not in excluded})}
    (OUT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    subprocess.run(["python3", "-B", "eligibility_eval.py", "split", "--labels", str(OUT / "labels.jsonl"), "--salt", a.salt, "--out", str(OUT / "split")], check=True)
    (Path("labels") / f"split-keys-{date.today().isoformat()}.json").write_bytes((OUT / "split" / "split.json").read_bytes())


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test → PASS. Then the real build:**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@17 python3 -B -m labels.build_keys --salt "$(date +%s)-$(head -c 4 /dev/urandom | xxd -p)"`
Expected: `documents` ≈ 44 + 26 (Strip, keys and hygiene were run on n01 on 2026-09-13: 21 pages, 464 key blocks, tree gone after strip, veraPDF failures `5-1, 7.18.1-2, 7.18.5-2, 7.21.4.1-1`, verdict usable); `usable` after hygiene — record it (the roadmap's kill fires if more than half are excluded); `match.none` should be a small share (these become `Artifact`; sanity-check five by eye against their page images — if they are body text the tagger missed, hygiene is not doing its job and the record says so); `hosts` ≥ 40. The split is drawn and `labels/split-keys-<date>.json` written.

- [ ] **Step 5: Commit**

```bash
git add experiments/qwen-role-decisions/labels/build_keys.py experiments/qwen-role-decisions/labels/test_build_keys.py experiments/qwen-role-decisions/labels/split-keys-*.json
git commit -m "Key dataset: build, match, score and split in one pass

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The results record

**Files:**
- Create: `docs/research/document-remediation/heading-keys-<date>-results.md`

- [ ] **Step 1: Write it from `out/keys/report.json` and the run outputs**

```markdown
# Heading-type labels from keys — Stage 0 results

**Roadmap:** `docs/superpowers/plans/2026-09-13-staged-autonomy-roadmap.md` (Stage 0). **Plan:** `2026-09-13-key-dataset-pass.md`. **Definition:** `heading-definition-2026-09-13.md` (frozen). **Branch/head:** `claude/heading-labelling-pass` @ <sha>.

## Population
- Tagged originals: <n> real PDFs (staging `original`), <n> Word conversions (LibreOffice, product filter). ODL-tagged PDFs excluded by design: <n>.
- Hygiene (fixed before scoring): 7.1-3, 7.4.2, 7.4.4 clean; heading sentence share < 0.30. Excluded <n>: <id: reasons …>. Kill threshold (> 50 % excluded): <fired | not fired>.
- Candidates on stripped copies: <n> cards over <n> documents, <n> hosts; per-document cap 150 hit on <n>.
- Matching: exact <n>, contains <n>, box <n>, none → Artifact <n>. Five `none` rows checked by eye: <what they were>.
- Types: H <n> (levels: …), P <n>, Artifact <n>, Caption <n>, TH <n>, TOCI <n>, Lbl <n>, BlockQuote <n>, Other <n>.
- Usable documents whose key carries **zero** headings: <n> (n01 is one — 464 blocks, all P/Other; they are negatives, and the heading share of the dataset is reported because of them).

## Split
- Salt `<salt>`; train/validation/test = <n>/<n>/<n> rows; hosts <n>/<n>/<n>; leakage check none; `test.spent` absent.
- Test split against the evaluator's floors: documents ≥ 30 <yes/no>, clients ≥ 5, templates ≥ 10, non-headings ≥ 299 <count>.

## Stage 0 gate (roadmap)
- ≥ 20,000 cards from ≥ 60 hosts: <met | not met — this corpus yields <n>; the harvest round to reach it is registered separately>.

## What a key cannot say
Stripped tagged PDFs skew toward better producers; transfer to untagged documents in the wild is measured at the Stage 2→3 audit (~400 blind cards, `labels.serve`), never here.

## Stop decision
Stage 1 round 1 (fine-tune on train, evaluate on validation) is the next registered experiment; nothing here evaluates a model.
```

- [ ] **Step 2: Commit and stop**

```bash
git add docs/research/document-remediation/heading-keys-*-results.md
git commit -m "Record Stage 0: labels from keys, hygiene, split

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Not in this plan:** harvesting more documents (the ≥ 20k gate will not be met by 70 documents; that round — harvester → convert/strip → this pipeline — is registered when Stage 1 round 1 shows where the data gaps are), any model call, training, product wiring.
