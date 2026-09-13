# Heading Labelling Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a human-labelled, provenance-carrying, leakage-safe heading-type dataset over the 78 real corpus documents (PDF and Word), sealed into train/validation/test by host, so the eligibility model can be trained and judged against the frozen definition.

**Architecture:** Five small stdlib-Python research scripts under `experiments/qwen-role-decisions/labels/` — a document manifest, a PDF candidate builder over the existing `Cards.java` dump, a Word paragraph candidate builder, a local keyboard labelling server, and an agreement report — feeding the existing `eligibility_eval.py` split. Untagged PDFs go through the spike's existing OpenDataLoader runner first so `Cards.java` has a tree to walk. No product code, no database, no model call.

**Tech Stack:** Python 3.14 stdlib (`json`, `zipfile`, `xml.etree`, `http.server`, `hashlib`, `random`, `uuid`); existing `run.py` helpers (`dump_pdf`, `blocks_to_cards`, `render_page_png`, `mark_page_png`, `text_norm`); JDK 17 + PDFBox 3.0.8 (already vendored); `@opendataloader/pdf` 2.5.0 (already in `node_modules` of the main checkout).

**Spec:** `docs/research/document-remediation/heading-definition-2026-09-13.md` (frozen) — §4 definition, §5 rulings, §7 reviewer procedure. Background: `docs/research/document-remediation/heading-eligibility-learning-loop-2026-09-12.md`.

## Global Constraints

- **Working directory:** `/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor`, branch `cursor/qwen35-role-decisions-914b` (PR #239, open). It holds `experiments/qwen-role-decisions/` — `run.py`, `Cards.java`, `Mark.java`, `eligibility_eval.py`. Do not create another clone or worktree. Preserve every uncommitted file there.
- **Corpus bytes live only in the main checkout**, gitignored: `/Users/jphilistin/Documents/Coding/ADA Auditor/experiments/document-remediation/blind-corpus/real/` (78 files: 52 `.pdf`, 26 `.docx`; ids `n01`–`n50`, `r01`–`r34`). Provenance: `blind-corpus/real-names.txt` and `new-names.txt` in that same directory (`<id>.<ext>` whitespace `<url>` per line, `#` comments). Every script takes `--corpus <dir>` and never hard-codes the path.
- **No document text in a tracked file.** Cards, page images and label rows carrying text live under `experiments/qwen-role-decisions/out/labels/` (`out/` is gitignored). The tracked deliverables are the definition, this plan, the results record, and `split.json` (ids only).
- **No model output anywhere in this pass.** The source/tagger tag is stored on a card as `existing_tag` and never rendered by the labelling tool.
- **Label rows use `eligibility_eval.py`'s contract** (`refusals()`): `id`, `label_source: "human-answer"`, `answer_id`, `actor`, `client_id`, `template_id`, 64-hex `document_sha256`, `label: {heading: bool, level: 1–6|null}`. `client_id` and `template_id` are both the document's **host** (recorded as a proxy in the results doc). Any key in `MODEL_FIELDS` (`prediction, model, model_role, heading_flag, raw, confidence`) is forbidden on a row.
- **Types** a reviewer may assign: `H`, `P`, `Artifact`, `Caption`, `TH`, `TOCI`, `Lbl`, `BlockQuote`, `Unsure`. `heading = (type == "H")`. `Unsure` rows are written with `"unsure": true` and are excluded from split/evaluation but counted.
- **Level rule** (definition §3, 7.4.2): a heading's level is `≤ max(open_stack) + 1` and `≥ 1`; the first heading in a document is 1. The tool refuses a skip.
- Deterministic candidate filter is fixed from the definition **before** any document is opened; changing it after labelling starts is recorded in the results doc with the case that forced it.
- Java: `JAVA_HOME=/opt/homebrew/opt/openjdk@17`. Run every Python script with `python3 -B` from `experiments/qwen-role-decisions/` so `from run import …` resolves.
- Commit after each task with `git add <paths>` (never `-A`), message ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 0: Checkpoint the checkout and bring the spec across

**Files:**
- Copy: `/Users/jphilistin/Documents/Coding/ADA Auditor/.claude/worktrees/sleepy-mclaren-b8ba9e/docs/research/document-remediation/heading-definition-2026-09-13.md` → `docs/research/document-remediation/heading-definition-2026-09-13.md`
- Copy: `…/sleepy-mclaren-b8ba9e/docs/superpowers/plans/2026-09-13-heading-labelling-pass.md` → `docs/superpowers/plans/2026-09-13-heading-labelling-pass.md`
- Create: `experiments/qwen-role-decisions/labels/__init__.py` (empty)
- Create: `experiments/qwen-role-decisions/labels/run_tests.py` (pytest is not installed on this machine; this runner is the whole harness)

- [ ] **Step 1: Verify state and the tools the plan assumes**

```bash
cd "/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor" && git status --short && git branch --show-current
ls experiments/qwen-role-decisions/eligibility_eval.py experiments/qwen-role-decisions/Cards.java experiments/qwen-role-decisions/Mark.java
ls "/Users/jphilistin/Documents/Coding/ADA Auditor/experiments/document-remediation/blind-corpus/real" | wc -l   # expect 78
ls "/Users/jphilistin/Documents/Coding/ADA Auditor/node_modules/@opendataloader/pdf/package.json"
/opt/homebrew/opt/openjdk@17/bin/java -version
cd experiments/qwen-role-decisions && python3 -B eligibility_eval.py --self-check && python3 -B run.py --self-check | tail -1
```
Expected: branch `cursor/qwen35-role-decisions-914b`; 78; both self-checks print `…ok`.

- [ ] **Step 2: Commit the uncommitted research files already in the tree as a checkpoint** (they are the previous session's work; committing preserves them)

```bash
cd "/Users/jphilistin/.codex/worktrees/12c6/ADA Auditor"
git add docs/research/document-remediation/qwen35-role-decisions-results.md docs/research/document-remediation/qwen35-production-readiness-2026-09-12.md docs/research/document-remediation/heading-eligibility-learning-loop-2026-09-12.md experiments/qwen-role-decisions/run.py experiments/qwen-role-decisions/part26_semantic.py experiments/qwen-role-decisions/part28_hierarchy_context.py experiments/qwen-role-decisions/part28_processor_probe.py experiments/qwen-role-decisions/part28_resize_sft.py experiments/qwen-role-decisions/eligibility_eval.py
git commit -m "Record Part 28 and the offline eligibility evaluator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: Copy the frozen definition and this plan in, create the package dir, commit**

```bash
SRC="/Users/jphilistin/Documents/Coding/ADA Auditor/.claude/worktrees/sleepy-mclaren-b8ba9e"
cp "$SRC/docs/research/document-remediation/heading-definition-2026-09-13.md" docs/research/document-remediation/
mkdir -p docs/superpowers/plans && cp "$SRC/docs/superpowers/plans/2026-09-13-heading-labelling-pass.md" docs/superpowers/plans/
mkdir -p experiments/qwen-role-decisions/labels && : > experiments/qwen-role-decisions/labels/__init__.py
cat > experiments/qwen-role-decisions/labels/run_tests.py <<'RUNNER'
"""Run test_* functions in the named modules. Usage: python3 -B labels/run_tests.py labels.test_x [...]"""
import importlib, sys, traceback
sys.path.insert(0, ".")
ok = fail = 0
for mod in sys.argv[1:]:
    m = importlib.import_module(mod)
    for name in sorted(n for n in dir(m) if n.startswith("test_")):
        try:
            getattr(m, name)(); ok += 1; print("ok  ", mod, name)
        except Exception:
            fail += 1; print("FAIL", mod, name); traceback.print_exc(limit=4)
print(f"passed={ok} failed={fail}")
sys.exit(1 if fail else 0)
RUNNER
git add docs/research/document-remediation/heading-definition-2026-09-13.md docs/superpowers/plans/2026-09-13-heading-labelling-pass.md experiments/qwen-role-decisions/labels/__init__.py experiments/qwen-role-decisions/labels/run_tests.py
git commit -m "Freeze the heading definition and plan the labelling pass

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Document manifest with host provenance

**Files:**
- Create: `experiments/qwen-role-decisions/labels/manifest.py`
- Test: `experiments/qwen-role-decisions/labels/test_manifest.py`

**Interfaces:**
- Produces: `build_manifest(corpus: Path) -> list[dict]` — one row per file in `<corpus>`: `{"id": "n34", "path": "<abs>", "kind": "pdf"|"docx", "sha256": <64hex>, "host": "fnsb.gov", "url": <str>}`; raises `ValueError` if any file has no provenance line. `host_of(url: str) -> str` strips scheme and a leading `www.`. CLI: `python3 -B -m labels.manifest --corpus DIR --out out/labels/manifest.json`.

- [ ] **Step 1: Write the failing test**

```python
# labels/test_manifest.py
import hashlib, json, tempfile
from pathlib import Path
from labels.manifest import build_manifest, host_of


def test_host_of_strips_scheme_and_www():
    assert host_of("https://www.fnsb.gov/DocumentCenter/View/1308") == "fnsb.gov"
    assert host_of("http://policies.osu.edu/x.pdf") == "policies.osu.edu"


def test_build_manifest_reads_both_provenance_files_and_hashes_bytes():
    with tempfile.TemporaryDirectory() as d:
        corpus = Path(d)
        (corpus / "n01.pdf").write_bytes(b"%PDF-1.7 fake")
        (corpus / "r27.docx").write_bytes(b"PK fake")
        (corpus / "real-names.txt").write_text("# comment\nr27.docx\thttps://policies.northwestern.edu/docs/t.docx\n")
        (corpus / "new-names.txt").write_text("n01.pdf https://www.fnsb.gov/DocumentCenter/View/1\n")
        rows = build_manifest(corpus)
    assert [r["id"] for r in rows] == ["n01", "r27"]
    assert rows[0]["kind"] == "pdf" and rows[0]["host"] == "fnsb.gov"
    assert rows[1]["kind"] == "docx" and rows[1]["host"] == "policies.northwestern.edu"
    assert rows[0]["sha256"] == hashlib.sha256(b"%PDF-1.7 fake").hexdigest()


def test_build_manifest_refuses_a_file_without_provenance():
    with tempfile.TemporaryDirectory() as d:
        corpus = Path(d)
        (corpus / "n02.pdf").write_bytes(b"x")
        (corpus / "real-names.txt").write_text("")
        (corpus / "new-names.txt").write_text("")
        try:
            build_manifest(corpus)
        except ValueError as e:
            assert "n02.pdf" in str(e)
        else:
            raise AssertionError("expected ValueError")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd experiments/qwen-role-decisions && python3 -B labels/run_tests.py labels.test_manifest`
Expected: FAIL — `ModuleNotFoundError: labels.manifest`.

- [ ] **Step 3: Implement**

```python
# labels/manifest.py
"""Document manifest for the labelling pass: id, kind, bytes hash, host.

Host is the split unit and the stand-in for both client and template
(recorded as a proxy in the results doc). Provenance comes from the two
tracked manifests in the corpus directory; a file without a line is an
error, never an "unknown" host, because unknown cannot be split safely.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

PROVENANCE_FILES = ("real-names.txt", "new-names.txt")


def host_of(url: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", url.strip()).split("/")[0].lower()


def read_provenance(corpus: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    # The manifests are tracked beside the gitignored `real/` directory, so
    # look in the corpus directory and then its parent.
    for name in PROVENANCE_FILES:
        path = next((d / name for d in (corpus, corpus.parent) if (d / name).is_file()), None)
        if path is None:
            continue
        for line in path.read_text().splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.split(None, 1)
            if len(parts) == 2:
                out[parts[0].strip()] = parts[1].strip()
    return out


def build_manifest(corpus: Path) -> list[dict]:
    provenance = read_provenance(corpus)
    rows: list[dict] = []
    missing: list[str] = []
    for path in sorted(corpus.iterdir()):
        if path.suffix.lower() not in (".pdf", ".docx"):
            continue
        url = provenance.get(path.name)
        if url is None:
            missing.append(path.name)
            continue
        rows.append(
            {
                "id": path.stem,
                "path": str(path.resolve()),
                "kind": path.suffix.lower()[1:],
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "host": host_of(url),
                "url": url,
            }
        )
    if missing:
        raise ValueError(f"no provenance for {missing}")
    return rows


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--corpus", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    rows = build_manifest(a.corpus)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(rows, indent=2) + "\n")
    hosts = {r["host"] for r in rows}
    print(json.dumps({"documents": len(rows), "hosts": len(hosts), "pdf": sum(r["kind"] == "pdf" for r in rows), "docx": sum(r["kind"] == "docx" for r in rows)}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests, then the real manifest**

Run: `python3 -B labels/run_tests.py labels.test_manifest` → PASS (3).
Run: `python3 -B -m labels.manifest --corpus "/Users/jphilistin/Documents/Coding/ADA Auditor/experiments/document-remediation/blind-corpus/real" --out out/labels/manifest.json`
Expected (measured 2026-09-13): `{"documents": 78, "hosts": 69, "pdf": 52, "docx": 26}`.

- [ ] **Step 5: Commit**

```bash
git add experiments/qwen-role-decisions/labels/manifest.py experiments/qwen-role-decisions/labels/test_manifest.py
git commit -m "Labelling pass: document manifest keyed by host

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Give untagged PDFs a tree to walk (OpenDataLoader, existing runner)

**Files:**
- Create: `experiments/qwen-role-decisions/labels/stage_pdfs.py`
- Test: `experiments/qwen-role-decisions/labels/test_stage_pdfs.py`

**Interfaces:**
- Consumes: `run.dump_pdf(pdf: Path, compile: bool) -> dict` (`{"hasStructTree": bool, "blocks": [...]}`); the spike runner `experiments/document-remediation/run-opendataloader.mjs <IN> <OUT>` in the **main checkout** (it imports `@opendataloader/pdf` from that checkout's `node_modules`).
- Produces: `out/labels/pdfs/<id>.pdf` for every manifest PDF — the original where it has a tree, the tagger's output where it did not; `out/labels/staging.json`: `[{"id", "source": "original"|"opendataloader", "tagged": bool}]`. `plan_staging(manifest_rows, has_tree: Callable[[Path], bool]) -> tuple[list[dict], list[dict]]` returns `(keep_as_is, needs_tagging)`.

- [ ] **Step 1: Write the failing test**

```python
# labels/test_stage_pdfs.py
from pathlib import Path
from labels.stage_pdfs import plan_staging


def test_plan_staging_splits_on_tree_presence_and_skips_word():
    rows = [
        {"id": "n01", "kind": "pdf", "path": "/x/n01.pdf"},
        {"id": "n09", "kind": "pdf", "path": "/x/n09.pdf"},
        {"id": "n34", "kind": "docx", "path": "/x/n34.docx"},
    ]
    keep, tag = plan_staging(rows, has_tree=lambda p: p.name == "n01.pdf")
    assert [r["id"] for r in keep] == ["n01"]
    assert [r["id"] for r in tag] == ["n09"]
```

- [ ] **Step 2: Run to verify it fails** — `python3 -B labels/run_tests.py labels.test_stage_pdfs` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/stage_pdfs.py
"""Stage every manifest PDF under out/labels/pdfs/ with a structure tree.

Tagged originals are copied. Untagged ones go through the spike's existing
OpenDataLoader runner — its tags are CANDIDATES for a reviewer, never labels
and never shown. Defaults only, as the runner insists.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

from run import dump_pdf

MAIN = Path("/Users/jphilistin/Documents/Coding/ADA Auditor")
ODL_RUNNER = MAIN / "experiments" / "document-remediation" / "run-opendataloader.mjs"


def plan_staging(rows: list[dict], has_tree: Callable[[Path], bool]) -> tuple[list[dict], list[dict]]:
    keep, tag = [], []
    for r in rows:
        if r["kind"] != "pdf":
            continue
        (keep if has_tree(Path(r["path"])) else tag).append(r)
    return keep, tag


def has_struct_tree(pdf: Path) -> bool:
    return bool(dump_pdf(pdf, compile=False).get("hasStructTree"))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path("out/labels/pdfs"))
    a = p.parse_args()
    rows = json.loads(a.manifest.read_text())
    dump_pdf(Path(rows[0]["path"]), compile=True)  # compile Cards once
    keep, tag = plan_staging(rows, has_struct_tree)
    a.out.mkdir(parents=True, exist_ok=True)
    staging = []
    for r in keep:
        shutil.copyfile(r["path"], a.out / f"{r['id']}.pdf")
        staging.append({"id": r["id"], "source": "original", "tagged": True})
    with tempfile.TemporaryDirectory() as tmp:
        inp, outp = Path(tmp) / "in", Path(tmp) / "out"
        inp.mkdir()
        for r in tag:
            shutil.copyfile(r["path"], inp / f"{r['id']}.pdf")
        if tag:
            subprocess.run(["node", str(ODL_RUNNER), str(inp), str(outp)], cwd=MAIN, check=True)
        for r in tag:
            produced = outp / f"{r['id']}.pdf"
            tagged = produced.is_file() and has_struct_tree(produced)
            if tagged:
                shutil.copyfile(produced, a.out / f"{r['id']}.pdf")
            staging.append({"id": r["id"], "source": "opendataloader", "tagged": tagged})
    (a.out.parent / "staging.json").write_text(json.dumps(staging, indent=2) + "\n")
    print(json.dumps({"original": len(keep), "tagged_by_odl": sum(s["tagged"] for s in staging if s["source"] == "opendataloader"), "failed": [s["id"] for s in staging if not s["tagged"]]}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test, then stage the real PDFs**

Run: `python3 -B labels/run_tests.py labels.test_stage_pdfs` → PASS.
Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@17 python3 -B -m labels.stage_pdfs --manifest out/labels/manifest.json`
Expected: `original` ≈ 33, `tagged_by_odl` ≈ 19, `failed` ideally `[]`. Record the exact numbers and any failures in the results doc (Task 8). A failure is a document the pass cannot label; it is not retried with options.

- [ ] **Step 5: Commit**

```bash
git add experiments/qwen-role-decisions/labels/stage_pdfs.py experiments/qwen-role-decisions/labels/test_stage_pdfs.py
git commit -m "Labelling pass: stage untagged PDFs through the existing tagger

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: PDF candidate cards — the recall net

**Files:**
- Create: `experiments/qwen-role-decisions/labels/pdf_cards.py`
- Test: `experiments/qwen-role-decisions/labels/test_pdf_cards.py`

**Interfaces:**
- Consumes: `run.dump_pdf`, `run.blocks_to_cards(blocks) -> (cards, failed)` (cards carry `locator, text, font_pt, weight, prev, next, existing_tag, ancestors, in_table_box, page, x0, y0, x1, y1`), `run.text_norm`.
- Produces: `select_candidates(cards: list[dict], rng: random.Random) -> list[dict]` and `repeats_on_pages(cards) -> dict[str, int]`; each candidate card gains `"card_id": "<id>:<index>"`, `"why": ["source_h"|"short"|"outlier"|"random"]`, `"repeats_on_pages": int`, `"page_median_pt": float|None`. CLI writes `out/labels/cards-pdf.jsonl` (one card per line, fields above plus `"document_id"`, `"kind": "pdf"`).

Filter, fixed from the definition before any document is opened: keep if `existing_tag` is `H1–H6`; or ≤15 words and last char not in `.!?;:`; or `font_pt ≥ 1.15 × page median` or `weight == "bold"` while the page median weight is regular; plus a 5% uniform random sample of the rest (seed 20260913).

- [ ] **Step 1: Write the failing test**

```python
# labels/test_pdf_cards.py
import random
from labels.pdf_cards import repeats_on_pages, select_candidates


def card(i, text, tag="P", pt=11, weight="regular", page=0, y0=700):
    return {"locator": f"d:{i}", "text": text, "existing_tag": tag, "font_pt": pt, "weight": weight,
            "page": page, "x0": 50, "y0": y0, "x1": 300, "y1": y0 + 12, "prev": "none", "next": "none",
            "ancestors": [], "in_table_box": False}


def test_repeats_counts_same_text_same_band_across_pages():
    cards = [card(0, "Town of X · Page", page=0, y0=760), card(1, "Town of X · Page", page=1, y0=762),
             card(2, "Town of X · Page", page=2, y0=40), card(3, "Body text here.", page=0)]
    r = repeats_on_pages(cards)
    assert r["d:0"] == 2 and r["d:1"] == 2 and r["d:2"] == 1 and r["d:3"] == 1


def test_select_keeps_source_headings_short_lines_outliers_and_a_random_slice():
    body = [card(i, "A long sentence of ordinary running body text that goes on for a while.", pt=11) for i in range(100)]
    cards = body + [card(200, "Source heading", tag="H2"), card(201, "Public Comment"),
                    card(202, "Big text sentence that is long enough to fail the short rule okay.", pt=18),
                    card(203, "Bold sentence that is long enough to fail the short rule okay yes.", weight="bold")]
    out = select_candidates(cards, random.Random(1))
    why = {c["locator"]: c["why"] for c in out}
    assert "source_h" in why["d:200"] and "short" in why["d:201"]
    assert "outlier" in why["d:202"] and "outlier" in why["d:203"]
    randoms = [c for c in out if c["why"] == ["random"]]
    assert 1 <= len(randoms) <= 15
    assert all(c["card_id"].endswith(c["locator"].split(":")[1]) for c in out)


def test_table_contained_blocks_enter_only_as_source_headings():
    inside = card(0, "Fee"); inside["in_table_box"] = True
    toc = card(1, "Contents entry"); toc["ancestors"] = ["Document", "TOC", "TOCI"]
    h_in = card(2, "Heading in table", tag="H2"); h_in["in_table_box"] = True
    out = select_candidates([inside, toc, h_in] + [card(i, "x" * 5 + " long sentence text that is body copy and terminates properly.") for i in range(10, 30)], random.Random(0))
    ids = {c["locator"]: c["why"] for c in out}
    assert "d:0" not in ids and "d:1" not in ids
    assert ids["d:2"] == ["source_h"]


def test_cap_per_document_keeps_best_reasons_and_all_random_rows():
    from labels.pdf_cards import cap_per_document
    rows = [{"document_id": "a", "why": ["short"], "n": i} for i in range(300)]
    rows += [{"document_id": "a", "why": ["source_h"], "n": 900 + i} for i in range(5)]
    rows += [{"document_id": "a", "why": ["random"], "n": 990 + i} for i in range(7)]
    rows += [{"document_id": "b", "why": ["outlier"], "n": 2000}]
    out = cap_per_document(rows, random.Random(0), cap=10)
    a = [r for r in out if r["document_id"] == "a"]
    assert len(a) == 10 + 7 and sum(r["why"] == ["source_h"] for r in a) == 5
    assert sum(r["why"] == ["random"] for r in a) == 7
    assert [r["n"] for r in out if r["document_id"] == "b"] == [2000]
```

- [ ] **Step 2: Run to verify it fails** — `python3 -B labels/run_tests.py labels.test_pdf_cards` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/pdf_cards.py
"""Candidate cards from a Cards.java dump: a RECALL net, not a decider.

Keeps every source H*, every short unterminated line, every size/weight
outlier on its page, plus a 5 % random slice of everything else so the net's
own misses are measurable. The source tag rides along as `existing_tag` and
is never shown to a reviewer.

Two bounds, both measured on the real corpus BEFORE any label was written
(2026-09-13, 43 tagged PDFs: 27,793 blocks, 18,035 kept by the rules alone):
blocks inside a Table, TOC or List are a different question (TH/TOCI/Lbl)
and made up 8,758 of those, so they enter only as source H* or in the random
slice; and three long documents (n05 at 578 pages, r09, r15) supplied more
than half the rest, so each document contributes at most CAP cards, chosen
source_h > outlier > short and at random within a class. Random-slice rows
are exempt from the cap: they are the recall measurement.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
from collections import defaultdict
from pathlib import Path

from run import HEADING, blocks_to_cards, dump_pdf, text_norm

SEED = 20260913
RANDOM_SHARE = 0.05
MAX_WORDS = 15
TERMINAL = ".!?;:"
OUTLIER_RATIO = 1.15
BAND_PT = 24.0
CAP = 150
CONTAINERS = ("Table", "TOC", "L")
PRIORITY = {"source_h": 0, "outlier": 1, "short": 2, "random": 3}


def repeats_on_pages(cards: list[dict]) -> dict[str, int]:
    """Pages on which the same normalised text sits in the same vertical band."""
    seen: dict[tuple[str, int], set[int]] = defaultdict(set)
    for c in cards:
        if c.get("page") is None or c.get("y0") is None:
            continue
        seen[(text_norm(c["text"]), int(float(c["y0"]) // BAND_PT))].add(int(c["page"]))
    return {c["locator"]: len(seen.get((text_norm(c["text"]), int(float(c["y0"]) // BAND_PT)), {0})) if c.get("page") is not None and c.get("y0") is not None else 1 for c in cards}


def page_medians(cards: list[dict]) -> dict[int, tuple[float | None, str]]:
    by_page: dict[int, list[dict]] = defaultdict(list)
    for c in cards:
        if c.get("page") is not None and c.get("font_pt") is not None:
            by_page[int(c["page"])].append(c)
    out = {}
    for page, cs in by_page.items():
        pts = [float(c["font_pt"]) for c in cs]
        bold = sum(1 for c in cs if c.get("weight") == "bold")
        out[page] = (statistics.median(pts), "bold" if bold * 2 > len(cs) else "regular")
    return out


def contained(c: dict) -> bool:
    return bool(c.get("in_table_box")) or any(a in CONTAINERS for a in (c.get("ancestors") or []))


def cap_per_document(cards: list[dict], rng: random.Random, cap: int = CAP) -> list[dict]:
    """At most `cap` non-random cards per document, best reasons first."""
    out: list[dict] = []
    for doc in sorted({c["document_id"] for c in cards}):
        mine = [c for c in cards if c["document_id"] == doc]
        exempt = [c for c in mine if c["why"] == ["random"]]
        ranked = [c for c in mine if c["why"] != ["random"]]
        rng.shuffle(ranked)
        ranked.sort(key=lambda c: min(PRIORITY[w] for w in c["why"]))
        out += ranked[:cap] + exempt
    return out


def reasons(c: dict, medians: dict) -> list[str]:
    why = []
    if c.get("existing_tag") in HEADING:
        why.append("source_h")
    if contained(c):
        return why
    words = c["text"].split()
    if 0 < len(words) <= MAX_WORDS and c["text"].strip()[-1:] not in TERMINAL:
        why.append("short")
    med = medians.get(int(c["page"])) if c.get("page") is not None else None
    if med and c.get("font_pt") is not None:
        pt, wt = med
        if pt and float(c["font_pt"]) >= OUTLIER_RATIO * pt:
            why.append("outlier")
        elif c.get("weight") == "bold" and wt == "regular":
            why.append("outlier")
    return why


def select_candidates(cards: list[dict], rng: random.Random) -> list[dict]:
    medians = page_medians(cards)
    repeats = repeats_on_pages(cards)
    out = []
    for c in cards:
        why = reasons(c, medians)
        if not why and rng.random() < RANDOM_SHARE:
            why = ["random"]
        if not why:
            continue
        row = dict(c)
        row["card_id"] = c["locator"]
        row["why"] = why
        row["repeats_on_pages"] = repeats.get(c["locator"], 1)
        row["page_median_pt"] = medians.get(int(c["page"]), (None, None))[0] if c.get("page") is not None else None
        out.append(row)
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--pdfs", type=Path, default=Path("out/labels/pdfs"))
    p.add_argument("--out", type=Path, default=Path("out/labels/cards-pdf.jsonl"))
    a = p.parse_args()
    rng = random.Random(SEED)
    rows = [r for r in json.loads(a.manifest.read_text()) if r["kind"] == "pdf"]
    total = kept = 0
    first = True
    with a.out.open("w") as f:
        for r in rows:
            pdf = a.pdfs / f"{r['id']}.pdf"
            if not pdf.is_file():
                continue
            cards, _failed = blocks_to_cards(dump_pdf(pdf, compile=first).get("blocks") or [])
            first = False
            total += len(cards)
            chosen = select_candidates(cards, rng)
            for c in chosen:
                c["document_id"] = r["id"]
                c["kind"] = "pdf"
            for c in cap_per_document(chosen, rng):
                f.write(json.dumps(c) + "\n")
                kept += 1
    print(json.dumps({"blocks": total, "candidates": kept}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests, then build the real cards**

Run: `python3 -B labels/run_tests.py labels.test_pdf_cards` → PASS (4).
Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@17 python3 -B -m labels.pdf_cards --manifest out/labels/manifest.json`
Expected: about 3,800 (measured 2026-09-13 on the 43 tagged originals: 3,839 with the cap, of which the uncapped random slice is a few hundred; the untagged ones staged in Task 2 add to that). Do **not** tighten the filter further — the reviewer labels documents in shuffled order and the record states how far the pass got.

- [ ] **Step 5: Commit**

```bash
git add experiments/qwen-role-decisions/labels/pdf_cards.py experiments/qwen-role-decisions/labels/test_pdf_cards.py
git commit -m "Labelling pass: PDF candidate cards as a recall net

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Word candidate cards (stdlib docx reader)

**Files:**
- Create: `experiments/qwen-role-decisions/labels/word_cards.py`
- Test: `experiments/qwen-role-decisions/labels/test_word_cards.py`

**Interfaces:**
- Produces: `paragraphs(docx: Path) -> list[dict]` — every non-empty paragraph in body order: `{"index", "text", "style", "outline_level": int|None (0–8; 9 and absent → None), "bold": bool, "size_pt": float|None, "prev", "next"}`. Outline level resolves direct `w:pPr/w:outlineLvl`, then the style's, then `w:basedOn` chain; a style's own level 9 ends the walk as "not a heading" (AGENTS.md level-9 rule). `select_word_candidates(paras, rng) -> list[dict]` applies the same filter as Task 3 with `outline_level is not None` playing `source_h`, and the document's median size/weight as the page median. CLI writes `out/labels/cards-word.jsonl` with `card_id = "<id>:p<index>"`, `document_id`, `kind: "docx"`, `existing_tag` = `"H<level+1>"` or `"P"`.

- [ ] **Step 1: Write the failing test** (builds a minimal docx with `zipfile` — no fixture file)

```python
# labels/test_word_cards.py
import random, tempfile, zipfile
from pathlib import Path
from labels.word_cards import paragraphs, select_word_candidates

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
STYLES = f'''<w:styles {W}>
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="contactheading"><w:basedOn w:val="Heading1"/></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>
</w:styles>'''
DOC = f'''<w:document {W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="contactheading"/></w:pPr><w:r><w:t>Inherited</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>
<w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>Direct level</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>Bold Big</w:t></w:r></w:p>
<w:p><w:r><w:t>Plain body text that runs on as ordinary paragraphs tend to do in a document.</w:t></w:r></w:p>
<w:p><w:r><w:t></w:t></w:r></w:p>
</w:body></w:document>'''


def make_docx(d):
    p = Path(d) / "t.docx"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("word/document.xml", DOC)
        z.writestr("word/styles.xml", STYLES)
    return p


def test_paragraphs_resolve_outline_levels_and_formatting():
    with tempfile.TemporaryDirectory() as d:
        ps = paragraphs(make_docx(d))
    by = {p["text"]: p for p in ps}
    assert len(ps) == 6  # empty paragraph dropped
    assert by["Title"]["outline_level"] == 0
    assert by["Inherited"]["outline_level"] == 0
    assert by["Contents"]["outline_level"] is None  # level 9 = body text
    assert by["Direct level"]["outline_level"] == 2
    assert by["Bold Big"]["bold"] is True and by["Bold Big"]["size_pt"] == 14.0
    assert by["Inherited"]["prev"] == "Title" and by["Inherited"]["next"] == "Contents"


def test_select_word_candidates_flags_levels_and_formatting():
    with tempfile.TemporaryDirectory() as d:
        ps = paragraphs(make_docx(d))
    out = {c["text"]: c["why"] for c in select_word_candidates(ps, random.Random(1))}
    assert "source_h" in out["Title"] and "source_h" in out["Direct level"]
    assert "short" in out["Contents"] and "source_h" not in out["Contents"]
    assert "outlier" in out["Bold Big"]
```

- [ ] **Step 2: Run to verify it fails** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/word_cards.py
"""Word paragraph candidates, read with the standard library.

A heading in Word is an OUTLINE LEVEL (direct, from the style, or inherited
through basedOn), and a style's own level 9 is Word's "Body Text" override
that ends the walk — the rule AGENTS.md records for TOC Heading. Text-only
cards: the apply target on this lane is the paragraph itself.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

from labels.pdf_cards import MAX_WORDS, OUTLIER_RATIO, RANDOM_SHARE, SEED, TERMINAL, cap_per_document

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
BODY_LEVEL = 9


def style_levels(styles_xml: bytes | None) -> dict[str, int | None]:
    """styleId -> resolved outline level (None = not a heading)."""
    if not styles_xml:
        return {}
    root = ET.fromstring(styles_xml)
    own: dict[str, int | None] = {}
    based: dict[str, str | None] = {}
    for st in root.findall("w:style", NS):
        sid = st.get(f"{{{NS['w']}}}styleId")
        lvl = st.find("w:pPr/w:outlineLvl", NS)
        own[sid] = int(lvl.get(f"{{{NS['w']}}}val")) if lvl is not None else None
        b = st.find("w:basedOn", NS)
        based[sid] = b.get(f"{{{NS['w']}}}val") if b is not None else None
    resolved: dict[str, int | None] = {}

    def resolve(sid: str, seen: set[str]) -> int | None:
        if sid in resolved:
            return resolved[sid]
        if sid in seen or sid not in own:
            return None
        seen.add(sid)
        lvl = own[sid]
        if lvl is not None:
            out = None if lvl == BODY_LEVEL else lvl
        else:
            parent = based.get(sid)
            out = resolve(parent, seen) if parent else None
        resolved[sid] = out
        return out

    for sid in own:
        resolve(sid, set())
    return resolved


def paragraphs(docx: Path) -> list[dict]:
    with zipfile.ZipFile(docx) as z:
        doc = z.read("word/document.xml")
        styles = z.read("word/styles.xml") if "word/styles.xml" in z.namelist() else None
    levels = style_levels(styles)
    out: list[dict] = []
    for i, p in enumerate(ET.fromstring(doc).iter(f"{{{NS['w']}}}p")):
        text = "".join(t.text or "" for t in p.iter(f"{{{NS['w']}}}t")).strip()
        if not text:
            continue
        style_el = p.find("w:pPr/w:pStyle", NS)
        style = style_el.get(f"{{{NS['w']}}}val") if style_el is not None else None
        direct = p.find("w:pPr/w:outlineLvl", NS)
        if direct is not None:
            lvl = int(direct.get(f"{{{NS['w']}}}val"))
            level = None if lvl == BODY_LEVEL else lvl
        else:
            level = levels.get(style) if style else None
        runs = p.findall("w:r", NS)
        bold = any(r.find("w:rPr/w:b", NS) is not None for r in runs) and runs != []
        sizes = [int(s.get(f"{{{NS['w']}}}val")) / 2 for r in runs for s in r.findall("w:rPr/w:sz", NS)]
        out.append({"index": i, "text": text, "style": style, "outline_level": level, "bold": bold,
                    "size_pt": max(sizes) if sizes else None})
    for j, row in enumerate(out):
        row["prev"] = out[j - 1]["text"] if j else "none"
        row["next"] = out[j + 1]["text"] if j + 1 < len(out) else "none"
    return out


def select_word_candidates(paras: list[dict], rng: random.Random) -> list[dict]:
    sizes = [p["size_pt"] for p in paras if p["size_pt"] is not None]
    median = statistics.median(sizes) if sizes else None
    mostly_bold = sum(p["bold"] for p in paras) * 2 > len(paras)
    out = []
    for p in paras:
        why = []
        if p["outline_level"] is not None:
            why.append("source_h")
        words = p["text"].split()
        if 0 < len(words) <= MAX_WORDS and p["text"][-1:] not in TERMINAL:
            why.append("short")
        if (median and p["size_pt"] is not None and p["size_pt"] >= OUTLIER_RATIO * median) or (p["bold"] and not mostly_bold):
            why.append("outlier")
        if not why and rng.random() < RANDOM_SHARE:
            why = ["random"]
        if not why:
            continue
        row = dict(p)
        row["why"] = why
        row["existing_tag"] = f"H{p['outline_level'] + 1}" if p["outline_level"] is not None else "P"
        row["repeats_on_pages"] = 1
        out.append(row)
    return out


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("--manifest", type=Path, required=True)
    a.add_argument("--out", type=Path, default=Path("out/labels/cards-word.jsonl"))
    args = a.parse_args()
    rng = random.Random(SEED)
    total = kept = 0
    with args.out.open("w") as f:
        for r in json.loads(args.manifest.read_text()):
            if r["kind"] != "docx":
                continue
            paras = paragraphs(Path(r["path"]))
            total += len(paras)
            chosen = select_word_candidates(paras, rng)
            for c in chosen:
                c["card_id"] = f"{r['id']}:p{c['index']}"
                c["document_id"] = r["id"]
                c["kind"] = "docx"
            for c in cap_per_document(chosen, rng):
                f.write(json.dumps(c) + "\n")
                kept += 1
    print(json.dumps({"paragraphs": total, "candidates": kept}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests, then build the real Word cards**

Run: `python3 -B labels/run_tests.py labels.test_word_cards` → PASS (2).
Run: `python3 -B -m labels.word_cards --manifest out/labels/manifest.json`
Expected (measured 2026-09-13): `{"paragraphs": 2514, "candidates": ~1450}` over 26 documents.

- [ ] **Step 5: Commit**

```bash
git add experiments/qwen-role-decisions/labels/word_cards.py experiments/qwen-role-decisions/labels/test_word_cards.py
git commit -m "Labelling pass: Word paragraph candidates by outline level

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Marked page images for PDF cards

**Files:**
- Create: `experiments/qwen-role-decisions/labels/render.py`

**Interfaces:**
- Consumes: `run.render_page_png(pdf, page_1based, dest) -> Path`, `run.mark_page_png(pdf, page_1based, box, src, dest) -> dict`.
- Produces: `out/labels/pages/<id>-p<N>.png` and `out/labels/pages/marked/<card_id with ':' → '_'>.png`; `image_path(card) -> Path` used by Task 6. Cards with no box (`page`/`x0` missing) get no image; the tool shows facts only and the card carries `"no_image": true`.

- [ ] **Step 1: Implement** (no unit test — it is a thin loop over two pinned helpers; the check is the count)

```python
# labels/render.py
"""Marked page images for PDF cards, via the spike's Preview + Mark bridge."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from run import mark_page_png, render_page_png

PAGES = Path("out/labels/pages")


def image_path(card: dict) -> Path:
    return PAGES / "marked" / (card["card_id"].replace(":", "_") + ".png")


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("--cards", type=Path, default=Path("out/labels/cards-pdf.jsonl"))
    a.add_argument("--pdfs", type=Path, default=Path("out/labels/pdfs"))
    args = a.parse_args()
    cards = [json.loads(l) for l in args.cards.read_text().splitlines() if l.strip()]
    rendered = skipped = 0
    for c in cards:
        if any(c.get(k) is None for k in ("page", "x0", "y0", "x1", "y1")):
            skipped += 1
            continue
        page1 = int(c["page"]) + 1
        pdf = args.pdfs / f"{c['document_id']}.pdf"
        base = PAGES / f"{c['document_id']}-p{page1}.png"
        if not base.is_file():
            render_page_png(pdf, page1, base)
        dest = image_path(c)
        if not dest.is_file():
            mark_page_png(pdf, page1, (float(c["x0"]), float(c["y0"]), float(c["x1"]), float(c["y1"])), base, dest)
        rendered += 1
    print(json.dumps({"rendered": rendered, "no_box": skipped}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@17 python3 -B -m labels.render`
Expected: `rendered` equals the number of PDF cards with a box; open two marked PNGs and confirm the rectangle sits on the card's text (the box map was pinned by `run.py --check-box-map`; if a rectangle is off, run that check first).

- [ ] **Step 3: Commit**

```bash
git add experiments/qwen-role-decisions/labels/render.py
git commit -m "Labelling pass: marked page images through the existing bridge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The labelling tool

**Files:**
- Create: `experiments/qwen-role-decisions/labels/serve.py`
- Test: `experiments/qwen-role-decisions/labels/test_serve.py`

**Interfaces:**
- Consumes: `cards-pdf.jsonl`, `cards-word.jsonl`, `manifest.json`, `labels.render.image_path`.
- Produces: `out/labels/labels-<actor>.jsonl`, one row per decision in the evaluator's contract plus `type`, `text_sha256`, `card_id`, `document_id`, `kind`, `why`, `repeats_on_pages`, `font_pt`/`size_pt`, `weight`/`bold`, `in_table_box`, `existing_tag` (stored, never shown), `labelled_at`, `unsure`. Pure functions: `order_cards(cards, manifest, rng) -> list[dict]` (documents shuffled, cards within a document in reading order); `allowed_levels(stack: list[int]) -> list[int]`; `apply_heading(stack, level) -> list[int]`; `make_row(card, doc, actor, type_, level) -> dict`; `next_card(cards, done_ids) -> dict|None`.

Keys in the browser: `H P A C T O L B U`, then for `H` digits `1–6` (only allowed levels are enabled), `Backspace` = undo last row (rewrites the file without it), `S` = skip to next document. The page shows: marked image (or "no image"), text, prev/next, `repeats on N pages`, `in table`, font/size/weight, the approved heading stack for this document, and progress. **Never** `existing_tag`, `why`, or any model field.

- [ ] **Step 1: Write the failing test**

```python
# labels/test_serve.py
import random
from labels.serve import allowed_levels, apply_heading, make_row, next_card, order_cards
from eligibility_eval import refusals


def test_allowed_levels_forbid_skips():
    assert allowed_levels([]) == [1]
    assert allowed_levels([1]) == [1, 2]
    assert allowed_levels([1, 2, 3]) == [1, 2, 3, 4]
    assert apply_heading([1, 2, 3], 2) == [1, 2]
    assert apply_heading([1], 2) == [1, 2]


def test_order_cards_shuffles_documents_but_keeps_reading_order():
    cards = [{"card_id": "a:2", "document_id": "a", "page": 0, "y0": 500}, {"card_id": "a:1", "document_id": "a", "page": 0, "y0": 700},
             {"card_id": "b:p3", "document_id": "b", "index": 3}, {"card_id": "b:p1", "document_id": "b", "index": 1}]
    manifest = [{"id": "a", "kind": "pdf"}, {"id": "b", "kind": "docx"}]
    out = [c["card_id"] for c in order_cards(cards, manifest, random.Random(3))]
    assert out.index("a:1") < out.index("a:2") and out.index("b:p1") < out.index("b:p3")
    assert next_card(order_cards(cards, manifest, random.Random(3)), {"a:1", "a:2", "b:p1", "b:p3"}) is None


def test_make_row_passes_the_evaluator_contract_and_hides_text():
    card = {"card_id": "n34:p7", "document_id": "n34", "kind": "docx", "text": "Public Comment", "prev": "x", "next": "y",
            "existing_tag": "P", "why": ["short"], "repeats_on_pages": 1, "bold": True, "size_pt": 14.0}
    doc = {"id": "n34", "sha256": "a" * 64, "host": "fnsb.gov"}
    row = make_row(card, doc, "reviewer-a", "H", 2)
    assert refusals([row]) == []
    assert row["label"] == {"heading": True, "level": 2} and row["type"] == "H"
    assert "text" not in row and len(row["text_sha256"]) == 64
    assert row["client_id"] == row["template_id"] == "fnsb.gov" and row["document_stem"] == "n34"
    p = make_row(card, doc, "reviewer-a", "Caption", None)
    assert p["label"] == {"heading": False, "level": None} and refusals([p]) == []
    u = make_row(card, doc, "reviewer-a", "Unsure", None)
    assert u["unsure"] is True
```

- [ ] **Step 2: Run to verify it fails** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/serve.py
"""Local keyboard labelling tool. Stdlib http.server; one reviewer at a time.

Writes one row per decision in eligibility_eval's label contract. Shows the
marked page, the text and its neighbours, the deterministic facts and the
APPROVED heading stack for the document. Never shows the source/tagger tag
or any model output. Document text stays under out/ (gitignored); the row
carries the text's SHA-256 only.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import random
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from labels.render import image_path

TYPES = {"H": "H", "P": "P", "A": "Artifact", "C": "Caption", "T": "TH", "O": "TOCI", "L": "Lbl", "B": "BlockQuote", "U": "Unsure"}
OUT = Path("out/labels")


def allowed_levels(stack: list[int]) -> list[int]:
    return list(range(1, (max(stack) if stack else 0) + 2))


def apply_heading(stack: list[int], level: int) -> list[int]:
    return [l for l in stack if l < level] + [level]


def order_cards(cards: list[dict], manifest: list[dict], rng: random.Random) -> list[dict]:
    docs = [m["id"] for m in manifest]
    rng.shuffle(docs)
    rank = {d: i for i, d in enumerate(docs)}

    def key(c: dict):
        pos = (int(c.get("page") or 0), -float(c.get("y0") or 0)) if "index" not in c else (int(c["index"]), 0)
        return (rank.get(c["document_id"], len(rank)), pos)

    return sorted(cards, key=key)


def next_card(cards: list[dict], done: set[str]) -> dict | None:
    return next((c for c in cards if c["card_id"] not in done), None)


def make_row(card: dict, doc: dict, actor: str, type_: str, level: int | None) -> dict:
    heading = type_ == "H"
    return {
        "id": card["card_id"],
        "label_source": "human-answer",
        "answer_id": str(uuid.uuid4()),
        "actor": actor,
        "client_id": doc["host"],
        "template_id": doc["host"],
        "document_sha256": doc["sha256"],
        "document_stem": doc["id"],
        "document_id": doc["id"],
        "card_id": card["card_id"],
        "kind": card.get("kind"),
        "type": type_,
        "unsure": type_ == "Unsure",
        "label": {"heading": heading, "level": level if heading else None},
        "text_sha256": hashlib.sha256(card["text"].encode()).hexdigest(),
        "why": card.get("why"),
        "repeats_on_pages": card.get("repeats_on_pages"),
        "in_table_box": card.get("in_table_box"),
        "font_pt": card.get("font_pt", card.get("size_pt")),
        "weight": card.get("weight", "bold" if card.get("bold") else "regular"),
        "existing_tag": card.get("existing_tag"),
        "labelled_at": datetime.now(timezone.utc).isoformat(),
    }


class State:
    def __init__(self, cards: list[dict], manifest: list[dict], actor: str, sample: int | None):
        self.docs = {m["id"]: m for m in manifest}
        self.actor = actor
        self.path = OUT / f"labels-{actor}.jsonl"
        rng = random.Random(20260913)
        ordered = order_cards(cards, manifest, rng)
        if sample:
            ordered = random.Random(7).sample(ordered, min(sample, len(ordered)))
        self.cards = ordered
        self.rows: list[dict] = [json.loads(l) for l in self.path.read_text().splitlines() if l.strip()] if self.path.is_file() else []

    def done(self) -> set[str]:
        return {r["id"] for r in self.rows}

    def stack_for(self, doc_id: str) -> list[int]:
        stack: list[int] = []
        for r in self.rows:
            if r["document_id"] == doc_id and r["label"]["heading"]:
                stack = apply_heading(stack, r["label"]["level"])
        return stack

    def record(self, card: dict, type_: str, level: int | None) -> None:
        row = make_row(card, self.docs[card["document_id"]], self.actor, type_, level)
        self.rows.append(row)
        with self.path.open("a") as f:
            f.write(json.dumps(row) + "\n")

    def undo(self) -> None:
        if self.rows:
            self.rows.pop()
            self.path.write_text("".join(json.dumps(r) + "\n" for r in self.rows))

    def skip_document(self, doc_id: str) -> None:
        for c in self.cards:
            if c["document_id"] == doc_id and c["card_id"] not in self.done():
                self.record(c, "Unsure", None)


PAGE = """<!doctype html><meta charset=utf-8><title>label</title>
<style>body{{font:15px system-ui;margin:16px;display:grid;grid-template-columns:1fr 420px;gap:16px}}
img{{max-width:100%;border:1px solid #ccc}} .t{{font-size:20px;font-weight:600}} kbd{{border:1px solid #999;padding:1px 5px;border-radius:3px}}
.dim{{color:#666}} .stack{{font-family:monospace}}</style>
<div>{image}</div>
<div>
<p class=dim>{progress} · {doc} · {kind}</p>
<p class=dim>prev: {prev}</p><p class=t>{text}</p><p class=dim>next: {next}</p>
<p>repeats on <b>{repeats}</b> page(s) · in table: <b>{in_table}</b> · {font}</p>
<p class=stack>approved stack: {stack}</p>
<p><kbd>H</kbd> heading → then level {levels} &nbsp; <kbd>P</kbd> paragraph &nbsp; <kbd>A</kbd> artifact &nbsp; <kbd>C</kbd> caption<br>
<kbd>T</kbd> TH &nbsp; <kbd>O</kbd> TOCI &nbsp; <kbd>L</kbd> Lbl &nbsp; <kbd>B</kbd> blockquote &nbsp; <kbd>U</kbd> unsure &nbsp; <kbd>⌫</kbd> undo &nbsp; <kbd>S</kbd> skip document</p>
</div>
<script>
let pendingH=false;const allowed={levels_json};
document.addEventListener('keydown',e=>{{const k=e.key.toUpperCase();
 if(e.key==='Backspace'){{location.href='/undo';return;}}
 if(pendingH){{const n=parseInt(k);if(allowed.includes(n))location.href='/answer?type=H&level='+n;return;}}
 if(k==='H'){{pendingH=true;document.querySelector('.t').style.color='#06c';return;}}
 if(k==='S'){{location.href='/skip';return;}}
 const m={{P:'P',A:'Artifact',C:'Caption',T:'TH',O:'TOCI',L:'Lbl',B:'BlockQuote',U:'Unsure'}};
 if(m[k])location.href='/answer?type='+m[k];}});
</script>"""


def make_handler(state: State):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def send_html(self, body: str) -> None:
            data = body.encode()
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

        def redirect(self) -> None:
            self.send_response(303); self.send_header("Location", "/"); self.end_headers()

        def do_GET(self):
            url = urlparse(self.path)
            card = next_card(state.cards, state.done())
            if url.path == "/img" and card is not None:
                p = image_path(card)
                data = p.read_bytes() if p.is_file() else b""
                self.send_response(200); self.send_header("Content-Type", "image/png"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
            if url.path == "/undo":
                state.undo(); self.redirect(); return
            if card is None:
                self.send_html(f"<p>Done: {len(state.rows)} rows in {state.path}</p>"); return
            if url.path == "/skip":
                state.skip_document(card["document_id"]); self.redirect(); return
            if url.path == "/answer":
                q = parse_qs(url.query)
                type_ = q.get("type", [""])[0]
                level = int(q["level"][0]) if "level" in q else None
                if type_ not in TYPES.values() or (type_ == "H" and level not in allowed_levels(state.stack_for(card["document_id"]))):
                    self.redirect(); return
                state.record(card, type_, level); self.redirect(); return
            stack = state.stack_for(card["document_id"])
            levels = allowed_levels(stack)
            has_img = card.get("kind") == "pdf" and image_path(card).is_file()
            font = f"{card.get('font_pt', card.get('size_pt'))} pt · {card.get('weight', 'bold' if card.get('bold') else 'regular')}"
            self.send_html(PAGE.format(
                image='<img src="/img?c=%s">' % html.escape(card["card_id"]) if has_img else "<p class=dim>(no page image for this card)</p>",
                progress=f"{len(state.done())}/{len(state.cards)}", doc=html.escape(card["document_id"]), kind=card.get("kind"),
                prev=html.escape(str(card.get("prev"))), text=html.escape(card["text"]), next=html.escape(str(card.get("next"))),
                repeats=card.get("repeats_on_pages", 1), in_table=bool(card.get("in_table_box")), font=html.escape(font),
                stack=" > ".join(f"H{l}" for l in stack) or "(none yet)", levels="/".join(map(str, levels)), levels_json=json.dumps(levels)))

    return H


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("--actor", required=True)
    a.add_argument("--sample", type=int, default=None, help="label a fixed random sample (second reviewer)")
    a.add_argument("--port", type=int, default=8765)
    args = a.parse_args()
    manifest = json.loads((OUT / "manifest.json").read_text())
    cards = []
    for name in ("cards-pdf.jsonl", "cards-word.jsonl"):
        p = OUT / name
        if p.is_file():
            cards += [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    state = State(cards, manifest, args.actor, args.sample)
    print(f"http://127.0.0.1:{args.port}/  ({len(state.cards)} cards, {len(state.rows)} already labelled)")
    HTTPServer(("127.0.0.1", args.port), make_handler(state)).serve_forever()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests, then a five-card smoke run**

Run: `python3 -B labels/run_tests.py labels.test_serve` → PASS (3).
Run: `python3 -B -m labels.serve --actor smoke --sample 5`, open the URL, press keys for five cards, press `⌫` once, confirm `out/labels/labels-smoke.jsonl` has four rows and that `python3 -B -c "import json,eligibility_eval as e;print(e.refusals([json.loads(l) for l in open('out/labels/labels-smoke.jsonl')]))"` prints `[]`. Delete `labels-smoke.jsonl` afterwards.

- [ ] **Step 5: Commit**

```bash
git add experiments/qwen-role-decisions/labels/serve.py experiments/qwen-role-decisions/labels/test_serve.py
git commit -m "Labelling pass: local keyboard labelling tool writing evaluator rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Agreement report for the second reviewer

**Files:**
- Create: `experiments/qwen-role-decisions/labels/agreement.py`
- Test: `experiments/qwen-role-decisions/labels/test_agreement.py`

**Interfaces:**
- Produces: `agreement(a: list[dict], b: list[dict]) -> dict` over rows sharing `id`: `{"n", "type_agreement", "heading_agreement", "level_agreement" (among rows both call H), "disagreements": [{"id", "a", "b"}], "unsure": {"a": n, "b": n}}`. Unsure rows on either side are excluded from the rates and counted.

- [ ] **Step 1: Write the failing test**

```python
# labels/test_agreement.py
from labels.agreement import agreement


def row(i, t, level=None, unsure=False):
    return {"id": i, "type": t, "unsure": unsure, "label": {"heading": t == "H", "level": level}}


def test_agreement_rates_and_disagreement_list():
    a = [row("1", "H", 1), row("2", "P"), row("3", "Caption"), row("4", "H", 2), row("5", "Unsure", unsure=True)]
    b = [row("1", "H", 1), row("2", "P"), row("3", "H", 2), row("4", "H", 3), row("5", "P")]
    r = agreement(a, b)
    assert r["n"] == 4 and r["type_agreement"] == 0.75 and r["heading_agreement"] == 0.75
    assert r["level_agreement"] == 0.5 and r["unsure"] == {"a": 1, "b": 0}
    assert [d["id"] for d in r["disagreements"]] == ["3", "4"]
```

- [ ] **Step 2: Run to verify it fails** → `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# labels/agreement.py
"""Inter-rater agreement on the shared sample. The ceiling on any 99 % claim."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def agreement(a: list[dict], b: list[dict]) -> dict:
    by_a = {r["id"]: r for r in a}
    by_b = {r["id"]: r for r in b}
    shared = [i for i in by_a if i in by_b]
    unsure = {"a": sum(by_a[i].get("unsure", False) for i in shared), "b": sum(by_b[i].get("unsure", False) for i in shared)}
    pairs = [(by_a[i], by_b[i]) for i in shared if not by_a[i].get("unsure") and not by_b[i].get("unsure")]
    n = len(pairs)
    type_ok = sum(x["type"] == y["type"] for x, y in pairs)
    head_ok = sum(x["label"]["heading"] == y["label"]["heading"] for x, y in pairs)
    both_h = [(x, y) for x, y in pairs if x["label"]["heading"] and y["label"]["heading"]]
    level_ok = sum(x["label"]["level"] == y["label"]["level"] for x, y in both_h)
    return {
        "n": n,
        "type_agreement": None if not n else type_ok / n,
        "heading_agreement": None if not n else head_ok / n,
        "level_agreement": None if not both_h else level_ok / len(both_h),
        "disagreements": [{"id": x["id"], "a": f"{x['type']}{x['label']['level'] or ''}", "b": f"{y['type']}{y['label']['level'] or ''}"} for x, y in pairs if x["type"] != y["type"] or x["label"]["level"] != y["label"]["level"]],
        "unsure": unsure,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("a", type=Path)
    p.add_argument("b", type=Path)
    args = p.parse_args()
    load = lambda f: [json.loads(l) for l in f.read_text().splitlines() if l.strip()]
    print(json.dumps(agreement(load(args.a), load(args.b)), indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests** → PASS (1). **Commit:**

```bash
git add experiments/qwen-role-decisions/labels/agreement.py experiments/qwen-role-decisions/labels/test_agreement.py
git commit -m "Labelling pass: inter-rater agreement report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The results record, written before labelling starts

**Files:**
- Create: `docs/research/document-remediation/heading-labels-2026-09-XX-results.md` (use the real date)

- [ ] **Step 1: Write the record with the pre-registered fields empty and the population filled from Tasks 1–5**

```markdown
# Heading-type labels over the real corpus — results

**Definition:** `heading-definition-2026-09-13.md` (frozen). **Plan:** `docs/superpowers/plans/2026-09-13-heading-labelling-pass.md`.

## Population (filled from the scripts' own output)
- Manifest: <N> documents, <H> hosts (`labels.manifest`); PDF <n>, Word <n>.
- Staging: <n> tagged originals, <n> tagged by OpenDataLoader 2.5.0 defaults, failed: <ids>.
- Candidates: PDF <n> of <blocks> blocks; Word <n> of <paragraphs>; images rendered <n>, no box <n>.
- Filter as fixed 2026-09-13 (`pdf_cards.py`: source H*, ≤15 words unterminated, ≥1.15× page median or bold on a regular page, 5 % random, seed 20260913; Table/TOC/List-contained blocks only as source H* or random; ≤150 non-random cards per document, source_h > outlier > short). Both bounds were set from counts measured before the first label (18,035 → 3,839 PDF cards), not from any card's content. Changes after labelling began: none | <case that forced it>.

## Registered before labelling
- Host is the split unit and the proxy for client AND template.
- Second reviewer labels a 200-card sample; if type agreement < 99 %, disagreeing cases are adjudicated by adding §5 rows, then the sample is re-labelled. The disagreeing classes are reported, never dropped.
- Unsure rows are excluded from the split and counted here.
- Test split is sealed by `eligibility_eval.py split --salt <salt>`; the salt is recorded below only after the split is drawn.

## Labelling
- Reviewer A: <actor>, <n> rows, <hours>; documents completed <n>/<N>. Unsure <n>.
- Reviewer B (sample): <actor>, <n> rows. Agreement: type <x>, heading <x>, level <x>. Disagreements: <list with §5 ruling applied>.

## Split
- Salt `<salt>`; train/validation/test = <n>/<n>/<n> rows; hosts <n>/<n>/<n>; leakage check: none.
- Type counts per split (H / P / Artifact / Caption / TH / TOCI / Lbl / BlockQuote).

## Stop decision
<what happens next: baseline evaluation on validation only, registered separately>
```

- [ ] **Step 2: Commit**

```bash
git add docs/research/document-remediation/heading-labels-2026-09-XX-results.md
git commit -m "Register the heading labelling pass before the first label

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Label (a person's work), then split and seal

This task is done by the reviewer, not an agent. The agent runs the commands after.

- [ ] **Step 1: Reviewer A labels** — `python3 -B -m labels.serve --actor <name>`; resume any time (the tool re-reads its own file). Stop when every document is done or after the agreed time; record the count.
- [ ] **Step 2: Reviewer B labels the sample** — `python3 -B -m labels.serve --actor <name-b> --sample 200 --port 8766`.
- [ ] **Step 3: Agreement** — `python3 -B -m labels.agreement out/labels/labels-<a>.jsonl out/labels/labels-<b>.jsonl`; paste into the results doc. If type agreement < 0.99: for each disagreement, add a §5 row to the definition naming the case and the ruling, re-label those cards (both reviewers), re-run.
- [ ] **Step 4: Build the label file and split**

```bash
cd experiments/qwen-role-decisions
python3 -B -c "
import json; rows=[json.loads(l) for l in open('out/labels/labels-<a>.jsonl')]
keep=[r for r in rows if not r.get('unsure')]
open('out/labels/labels.jsonl','w').write(''.join(json.dumps(r)+'\n' for r in keep))
print(len(rows), 'rows,', len(rows)-len(keep), 'unsure excluded')"
python3 -B eligibility_eval.py split --labels out/labels/labels.jsonl --salt "$(date +%s)-$(head -c 4 /dev/urandom | xxd -p)" --out out/labels/split
cp out/labels/split/split.json labels/split-$(date +%F).json   # ids and salt only — tracked
```
Expected: three non-empty splits; `split.json` records the salt and the labels hash. Note in the results doc how many rows and hosts landed in `test`, and compare against the evaluator's floors (≥30 documents, ≥5 clients, ≥10 templates, ≥299 zero-error negatives for the FPR bound). **If the test split is short of a floor, say so in the record; do not redraw with another salt.**

- [ ] **Step 5: Commit the tracked outputs**

```bash
git add experiments/qwen-role-decisions/labels/split-*.json docs/research/document-remediation/heading-labels-*-results.md docs/research/document-remediation/heading-definition-2026-09-13.md
git commit -m "Seal the heading-label split by host; record agreement and counts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**What is deliberately not in this plan:** any model call, the baseline evaluation on the validation split (its own registered record), training, product wiring, a Word page image, OpenDataLoader options. The `test` split is evaluated once, ever, and only after a validation-driven candidate exists.
