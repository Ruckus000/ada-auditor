# Picture description — tested, and it fails in the worst possible way

**Date:** 2026-08-25 · `--enrich-picture-description` on OpenDataLoader's docling
hybrid backend. Model: **SmolVLM-256M-Instruct**, local, MPS.

# It produces confident, fluent, wrong alt text

That is worse than producing none, and worse than the `"image 1"` placeholder
this project already eliminated. A placeholder is *visibly* a placeholder. A
fluent sentence passes a human skim and passes veraPDF, which sees `/Alt`
populated and clears 7.3-1.

## What it said, and what was actually there

`lacity-clerk-misc` page 4 carries two photographs. They are **proof-of-posting
evidence** — the legally required record that a public hearing notice was
physically posted at a property, with a dated newspaper beside it to establish
when. In a city clerk's file, that evidentiary purpose is the entire reason the
photographs exist.

| what the model wrote | what the image shows |
|---|---|
| *"In this image we can see a poster on the wall."* | A **NOTICE OF PUBLIC HEARING** placard propped on a ledge, with a dated newspaper alongside it. Not on a wall. The newspaper — the date evidence — is not mentioned. |
| *"In this image I can see the building. In the background I can see the sky."* | A storefront with the **same hearing notice** displayed by the entrance. The notice is missed entirely. There is no meaningful sky. |
| *"In the center of the image there is text."* | True and contentless. |

A screen-reader user is told there is a poster on a wall and a building with sky
behind it. **The legal meaning of both photographs is destroyed**, and nothing
in the document signals that the description is wrong.

This is the assertion problem in its purest form: the same failure as a wrong
table header, but in prose, and more persuasive.

## Two mechanical findings that matter independently

**1. The descriptions never reach the PDF.** Even with enrichment on and
descriptions generated, the tagged output still carries `Alt="image 1"`.
OpenDataLoader's own JSON reports `"alt_source":"missing"` for every image. The
model runs, docling returns annotations, and the tagged-PDF writer does not
consume them. **The capability is not wired end to end.**

**2. Most images are silently skipped.** Docling's `picture_area_threshold`
defaults to **0.05** — a picture below 5% of page area is never described, with
no warning. Measured:

| document | image | % of page | described |
|---|---|---:|---|
| `nyc-notice-form` | both | 0.91%, 1.11% | **no** |
| `lacity-clerk-misc` | 5 of 8 | all under 5% | **no** |
| `lacity-clerk-misc` | 3 of 8 | 6.6%–39% | yes |

Logos, seals, signature blocks and departmental marks — the images that dominate
municipal documents — sit well under the threshold. **The first three documents
tested produced zero descriptions and reported no error**, which is why the
capability looked broken before the threshold was found.

## Cost

| | |
|---|---|
| SmolVLM download plus cache | **9.2 GB** |
| `lacity-clerk-misc`, 5 pages | **21 s** with enrichment against ~1 s without |

## A correction I owe

The plan for this experiment stated the hybrid backend *"has no alt-text
capability — it is layout analysis, not image description."* That was wrong, and
I had grepped the npm wrapper's TypeScript options rather than the Python
server's CLI. The capability exists. It simply does not work well enough to use.

## What this means for zero human input

**Alt text is not solvable this way.** The constraint is not compute or wiring —
both are fixable. It is that a 256M-parameter model describes *pixels*, and WCAG
1.1.1 requires describing **purpose**. Two photographs of a posted notice are
not "a poster" and "a building"; they are evidence that a statutory notice was
displayed. No amount of prompt engineering recovers a purpose that is only
visible from the document's context.

A larger local VLM would produce better sentences. It would still be asserting,
and **nothing we have can check the assertion** — that is what makes this
different from headings or tables, where ground truth or geometry gives us a
test.

Against the alternatives already recorded:

- **Clearing the Alt** — an omission, honest, fails 1.1.1, fails zero-human.
- **Artifacting the image** — asserts it is decorative. Wrong for evidence photos.
- **This** — asserts a description that is wrong and undetectable.

Under zero human input there is no safe option among the three. That is the
finding, and it is a constraint on the goal rather than on the tooling.
