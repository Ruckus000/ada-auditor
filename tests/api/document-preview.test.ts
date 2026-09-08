import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { previewDocument } = vi.hoisted(() => ({ previewDocument: vi.fn() }));
vi.mock('../../src/integrations/documents/preview', () => ({ previewDocument }));
import { previewPage, previewPdfBytes } from '../../src/app/api/_lib/document-preview';
import { isDocumentWideAsk } from '../../src/domain/document-preview';

describe('preview boundary', () => {
  beforeEach(() => { previewDocument.mockReset(); });
  it.each(['0', '-1', '1.2', '10000000', 'NaN'])('refuses invalid page %s', value => {
    expect(previewPage(new Request(`https://example.test/preview?page=${value}`))).toBeNull();
  });
  it('rejects changed bytes before writing or invoking the renderer', async () => {
    const response = await previewPdfBytes(Buffer.from('changed'), 1, 'req-1', 'old');
    expect(response.status).toBe(409); expect((await response.json()).error).toBe('preview_bytes_changed');
    expect(previewDocument).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('cleans temporary source on renderer exceptions and returns a bounded error', async () => {
    let path = '';
    previewDocument.mockImplementation(async (source: string) => { path = source; expect(await readFile(source, 'utf8')).toBe('pdf'); throw new Error('private host path'); });
    const response = await previewPdfBytes(Buffer.from('pdf'), 1, 'req-2');
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'preview_unavailable', requestId: 'req-2' });
    await expect(access(path)).rejects.toThrow();
  });
  it('returns matching identity and removes temporary input after success', async () => {
    let path = ''; previewDocument.mockImplementation(async (source: string) => { path = source; return { ok: true, value: { page: 1, pages: 1, width: 1, height: 1, png: 'png', figures: [] } }; });
    const bytes = Buffer.from('pdf'); const hash = createHash('sha256').update(bytes).digest('hex');
    const response = await previewPdfBytes(bytes, 1, 'req-3', hash);
    expect(response.status).toBe(200); expect((await response.json()).sha256).toBe(hash);
    await expect(access(path)).rejects.toThrow();
  });
  it('does not claim headings and form controls apply to the whole document', () => {
    for (const kind of ['heading', 'form-fields', 'annotations', 'contrast', 'figure'] as const) expect(isDocumentWideAsk({ kind })).toBe(false);
    for (const kind of ['language', 'identifier', 'untagged'] as const) expect(isDocumentWideAsk({ kind })).toBe(true);
  });
});
