# The blind corpus

92 documents the document pipeline had never seen, and the answers written
down before it saw them.

Every earlier number this pipeline produced — 2/20 PDFs green, 23/31 Word
documents green, parity 10/10 — was measured on corpora it had been **tuned
against**. Those can show that nothing regressed. They cannot answer whether
the thing works.

Results: `docs/research/document-remediation/blind-test-2026-08-29-*.md`.

## Running it

```bash
npm run build && npm run build:documents     # it drives the BUILT app
npm run blind:documents run                  # posts all 92, prints progress only
npm run blind:documents score                # grades what the run recorded
```

The two are separate on purpose. Reading results while a run is going invites
stopping at the first disappointment and calling the rest unaffected.

Needs a JVM, LibreOffice, and `vendor/verapdf/cli.jar`. The runner refuses to
start if the toolchain is missing or if a canary document comes back without a
conformance verdict — a run where every verdict is `none` measures nothing and
would read as a clean sweep. A uniform verdict is always the instrument.

## What is tracked and what is not

| | |
|---|---|
| tracked | the spec, the generators, every key, `manifest.json`, `prior-hashes.txt`, `real-names.txt`, `corrections.json` |
| never tracked | `docs/`, `real/`, `work/` — planted bytes are regenerable, real bytes are somebody else's documents |

All three byte directories were named in `.gitignore` **before** the first byte
landed. That rule exists because it was broken twice; see the comments in
`../.gitignore`.

## The pieces

| file | what it does |
|---|---|
| `spec.mjs` | 64 planted rows. Each emits BOTH the document and its key, so the two cannot drift |
| `pdf-builders.mjs` | PDFs written byte by byte, offsets computed. Chromium is deliberately not used: its output carries a timestamp, and a corpus whose hashes move cannot be locked |
| `docx-builders.mjs` | OOXML authored by hand, so LibreOffice is not the producer of its own inputs |
| `generate.mjs` | writes `docs/` and the planted keys |
| `verify.mjs` | proves each planted document contains what its key claims, read by qpdf and unzip |
| `harvest.mjs` | fetches the real documents and proves they are fresh |
| `author-real-keys.mjs` | authors real keys from third-party instruments; `--corrections` re-derives without overwriting |
| `corrections.json` | key errors found after the lock, each with its evidence |

## The rules that make it blind

The same person wrote the pipeline and the keys, so true double-blindness is
not available. These bound the leak, and the residual holes are stated in the
predictions document rather than left to be discovered.

1. **Real keys are authored by qpdf, unzip, xmllint and the veraPDF CLI, and
   by nothing in `src/`.** A key authored by the instrument it grades measures
   only that the product agrees with itself. Enforced by
   `tests/scripts/blind-corpus-keys-are-independent.test.ts`, because a rule
   that lives in a comment is a rule until somebody is in a hurry.
2. **Hash-locked before first contact**, in a commit pushed to the remote so
   that rewriting it is visible. The runner refuses to start on a mismatch.
3. **Corrections are an overlay, never an edit.** A key that turns out to be
   wrong gets a `corrections.json` row citing third-party evidence; the count
   prints on every future scorecard. It currently reads 40 across 18 of 28 real
   documents — 64%, which is a finding about the keys, and they are mine.
4. **A real document's title is content**, so keys store its SHA-256.
   Transcription stays checkable and no document text enters a tracked file.

## What fails a run

The five promises: an accurate disposition, no invented claim, no silent gap,
no drift between the product's verdict and an independent one, and a punch list
that names the work. Plus the door behaving and the corpus matching its keys.

**Not conformance.** The Matterhorn Protocol puts 47 of PDF/UA-1's 136 failure
conditions beyond any machine. A probe surprise, a punch item the key did not
predict, and a count no third-party instrument could verify are all printed and
cost nothing — a key author is not the authority on their own corpus.

## Adding a document

Planted: add a row to `spec.mjs`, `node generate.mjs`, `node verify.mjs`, and
commit the new key and hash. Real: add a line to `real-names.txt`,
`node harvest.mjs real-names.txt` (it refuses training-set domains and
byte-identical files), then `node author-real-keys.mjs`.

Rebuilding the planted corpus changes its hashes. That is a new lock, and the
commit should say so.
