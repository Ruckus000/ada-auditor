import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewDocument } from '../../../integrations/documents/preview';
import { logWarn } from '../../../services/logger';

export const previewHeaders = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
export function previewPage(request: Request): number | null {
  const value = new URL(request.url).searchParams.get('page') ?? '1';
  return /^[1-9]\d{0,6}$/.test(value) ? Number(value) : null;
}
export async function previewPdfBytes(bytes: Uint8Array, page: number, requestId: string, expectedSha?: string) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha !== undefined && sha256 !== expectedSha) {
    return Response.json({ error: 'preview_bytes_changed', requestId }, { status: 409, headers: previewHeaders });
  }
  let work: string | undefined;
  try {
    work = await mkdtemp(join(tmpdir(), 'ada-preview-'));
    const source = `${work}/source.pdf`;
    await writeFile(source, bytes);
    const result = await previewDocument(source, page);
    if (!result.ok) {
      logWarn('document_preview_failed', { requestId, failure: result.failure.kind });
      return Response.json({ error: 'preview_unavailable', requestId }, { status: 422, headers: previewHeaders });
    }
    return Response.json({ requestId, sha256, ...result.value }, { headers: previewHeaders });
  } catch {
    logWarn('document_preview_failed', { requestId, failure: 'preview_exception' });
    return Response.json({ error: 'preview_unavailable', requestId }, { status: 503, headers: previewHeaders });
  } finally { if (work) await rm(work, { recursive: true, force: true }).catch(() => { logWarn('document_preview_cleanup_failed', { requestId }); }); }
}
