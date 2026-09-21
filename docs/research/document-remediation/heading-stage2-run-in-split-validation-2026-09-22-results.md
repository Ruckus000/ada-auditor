# Heading suggestions — Stage 2 run-in heading split: validation freeze (2026-09-22)

**Plan:** `docs/superpowers/plans/2026-09-22-stage2-run-in-heading-split.md`. **Label source for every number below:** struct-tree key headings (`stripped-tree` / `word-outline` / `planted`). No judged labels read; wild gate documents excluded; test split never read.

## Validation measurement

- Bundle checksum lines: **110 / 110 OK**.
- Validation documents measured: **67**.
- Excluded documents: **0**.
- Excluded wild-gate documents: **0**.
- Blocks measured: **19,277**.
- Training keys sha256: `ffc5558c20953a161772371537d434d60df882b2c2e1712b806e10bd9249bb0e`.

| Width | Lost headings | Recovered | Recall | Splits | False splits | False-split rate |
|---|---:|---:|---:|---:|---:|---:|
| 0.5 | 192 | 43 | 0.2240 | 164 | 87 | 0.00451 |
| 0.6 | 192 | 49 | 0.2552 | 182 | 99 | 0.00514 |
| 0.7 | 192 | 50 | 0.2604 | 207 | 123 | 0.00638 |

## Frozen width

Registered freeze rule: highest recall among widths with false-split rate ≤ 0.005 of blocks; ties take the smaller width.

**Frozen width: 0.5.**

No wild re-measurement or judging was performed.
