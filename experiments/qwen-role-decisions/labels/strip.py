"""Strip a tagged PDF's structure tree so the tagger sees an untagged copy."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from run import CARDS_CLASSES, HERE, PDFBOX, dump_pdf, java_tool

STRIP_JAVA = HERE / "Strip.java"
_compiled = False


def compile_strip() -> None:
    global _compiled
    if _compiled:
        return
    CARDS_CLASSES.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run([str(java_tool("javac")), "-cp", str(PDFBOX), "-d", str(CARDS_CLASSES), str(STRIP_JAVA)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:])
    _compiled = True


def strip_pdf(src: Path, dest: Path) -> dict:
    compile_strip()
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run([str(java_tool("java")), "-Djava.awt.headless=true", "-cp", f"{PDFBOX}:{CARDS_CLASSES}", "Strip", str(src), str(dest)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:])
    info = json.loads(proc.stdout.strip().splitlines()[-1])
    after = dump_pdf(dest, compile=False)
    if after.get("hasStructTree"):
        raise RuntimeError(f"{dest} still has a structure tree")
    return info
