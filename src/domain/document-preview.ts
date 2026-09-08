import type { Ask } from './document-answers';
import { z } from 'zod';

/** Page geometry is normalized to the displayed crop box, including rotation. */
export const documentPreviewSchema = z.object({
  page: z.number().int().positive(),
  pages: z.number().int().positive(),
  width: z.number().positive().max(1600),
  height: z.number().positive().max(1600),
  png: z.string().min(1).max(16 * 1024 * 1024),
  figures: z.array(z.object({
    ordinal: z.number().int().nonnegative(),
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    w: z.number().positive().max(1), h: z.number().positive().max(1),
  })),
});
export type DocumentPreview = z.infer<typeof documentPreviewSchema>;

/** These claims apply to the entire file. Element issues without measured
 * geometry stay unplaced, even when their current target has no page field. */
export function isDocumentWideAsk(ask: Pick<Ask, 'kind'>): boolean {
  return ['language', 'fonts', 'untagged', 'identifier', 'pdfua', 'repair', 'attachments'].includes(ask.kind);
}
