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
