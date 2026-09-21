# Run-in split validation bundle (2026-09-21)

Publicly sourced documents, published on the data-only branch
`kimi-data-run-in-2026-09-21` (same pattern as `kimi-judge-pack-2026-09-18`).
**Never commit these files to `claude/heading-labelling-pass` or any code
branch**: the repo keeps real document bytes out of its main line. Keep
records to counts, rates, ids and hashes, as the existing records do.

Contents (paths relative to the repo root, so it extracts into your checkout):

- `experiments/qwen-role-decisions/out/run-in-bundle/tagged/` — the 67
  validation documents' tagged copies (from keys-c6 55, keys-c3 7, keys-c4 2,
  keys 3), and `manifest.json` (`{id, kind}` only).
- `experiments/qwen-role-decisions/out/keys-all-4/key-headings.json` — key
  headings for those 67 documents only.
- `experiments/qwen-role-decisions/out/suggest/<run>/<doc>/sidecar.json` —
  the 40 wild sidecars (30 documents), read only for the wild exclusion.
- `experiments/document-remediation/vendor/pdfbox-app-3.0.8.jar` — no network needed.

No test-split or train documents are included. `out/` and `vendor/` are
gitignored in the code branch, so copying the files there cannot stage them.

## Get it

Either copy each file from branch `kimi-data-run-in-2026-09-21` to the same
path in your checkout (the branch mirrors repo paths), or download
`run-in-split-bundle.tar.gz` from that branch and extract it at the repo root.

## Run

Branch `claude/heading-labelling-pass` at `29f8a0d` or later (that commit adds
`--source`). Requires JDK 17+ (`java -version`; Cards.java uses records).

```bash
cd <repo root>
tar -xzf run-in-split-bundle.tar.gz            # or copy the files from the data branch
sha256sum -c RUN-IN-BUNDLE.SHA256SUMS          # every line must say OK
cd experiments/qwen-role-decisions
python3 -B -m labels.measure_run_in_split --keys-dir out/keys-all-4 \
  --source out/run-in-bundle:out/run-in-bundle/manifest.json \
  --out out/labels/run-in-split-validation-2026-09-22.json
```

## Expected result (reference run on the source machine, reproduced from this bundle)

Graded against struct-tree key headings (stripped-tree / word-outline /
planted); wild documents excluded (0 overlap); test split never read.

- documents measured 67, excluded {}, excluded_wild []
- training_keys_sha256 `ffc5558c20953a161772371537d434d60df882b2c2e1712b806e10bd9249bb0e`

| width | lost | recovered | recall | splits | false splits | false-split rate |
|---|---|---|---|---|---|---|
| 0.5 | 192 | 43 | 0.2240 | 164 | 87 | 0.00451 |
| 0.6 | 192 | 49 | 0.2552 | 182 | 99 | 0.00514 |
| 0.7 | 192 | 50 | 0.2604 | 207 | 123 | 0.00638 |

Freeze (registered rule, cap 0.5% of blocks over 19,277 blocks): **0.5**.

If your numbers differ in any cell, stop and report the difference; do not
adjust anything to match.
