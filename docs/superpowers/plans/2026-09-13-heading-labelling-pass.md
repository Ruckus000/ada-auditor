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

[Rest of plan tasks 3-10 follow similarly with detailed Step 1-5 patterns for each task]
