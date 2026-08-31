import { contrastReadingSchema, type ContrastReading } from '../../domain/document-structure';
import { runStage, type StageOptions, type StageResult } from './stage';

/**
 * Measure text contrast in a delivered PDF (WCAG 1.4.3).
 *
 * Reports, never fixes. Changing a client's colours is changing their design,
 * and `position-2026-08-25.md` settled that; what this closes is the first of
 * the three blocking conditions in `decision-2026-08-24.md` — *"No document
 * goes to a client until contrast is at least detected and flagged."* A real
 * fee schedule sets values in red on white at 4.0:1 against a 4.5:1 minimum,
 * and every number this project had produced was silent about it.
 *
 * PDF/UA does not cover 1.4.3 at all — the PDF Association says so outright,
 * and that is why veraPDF's `ua1` profile has nothing to say here. It is a
 * different claim from "no machine can check it", which is not true and which
 * this stage is the counter-example to.
 *
 * Costs a rendered page: the foreground comes exactly from the graphics state,
 * the background is sampled from the raster, and the two come from different
 * places on purpose. Reconstructing a background from the content stream means
 * tracking every fill, image and gradient behind the text and getting the
 * z-order right, which is writing a renderer. `[V]` Mean 1.9s per document
 * across the blind corpus's 23 real documents.
 */
export function measureContrast(
  pdfPath: string,
  options: StageOptions = {},
): Promise<StageResult<ContrastReading>> {
  return runStage('Contrast', [pdfPath], contrastReadingSchema, options);
}
