import { documentPreviewSchema, type DocumentPreview } from '../../domain/document-preview';
import { runStage, type StageOptions, type StageResult } from './stage';

/** One bounded raster at a time; the same geometry/figure identity as Inspect. */
export function previewDocument(pdfPath: string, page: number, options: StageOptions = {}): Promise<StageResult<DocumentPreview>> {
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('page must be a positive integer');
  return runStage('Preview', [pdfPath, String(page)], documentPreviewSchema, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 45_000, 45_000) });
}
