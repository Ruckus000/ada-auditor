import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { ArtifactStore } from '../../../../src/domain/artifacts';
import { zipEntry } from '../../../../src/domain/docx-language';
import { createDeliveryArchive } from '../../../../src/integrations/documents/archive';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';
import { MemoryPlatformStore } from '../../../../src/integrations/persistence/memory-platform-store';
import { deliveryOverview, prepareDelivery, signDocument } from '../../../../src/services/document-delivery';

/**
 * The bundle a client downloads, built by the real Archive stage and opened.
 *
 * `archive.test.ts` mocks the JVM and `document-delivery.test.ts` mocks the
 * archive, so until this file nothing had ever looked inside a delivery zip.
 * The promise a bundle makes is that its manifest names the exact bytes it
 * carries — this is the one test that holds it to that, on the real stage.
 */

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const java = resolveJavaRuntime();
if (!java.available) console.warn(`delivery archive skipped — ${java.reason}`);

describe.skipIf(!java.available)('a delivery bundle, zipped by the real Archive stage', () => {
  it('carries exactly the bytes its manifest names', async () => {
    const platform = new MemoryPlatformStore();
    await platform.upsertClient({ id: 'client-a', name: 'Town' });
    const record = await platform.ensureClientDocument('client-a', { url: 'https://town.example/agenda.pdf', kind: 'pdf', source: 'crawl', contentSha256: sha256('source') }, '2026-09-01T00:00:00.000Z');

    const output = Buffer.from('%PDF-1.7 a delivered document');
    const report = Buffer.from('{"compliant":true}');
    const blobs = new Map<string, Buffer>([['output', output], ['report', report]]);
    const artifacts: ArtifactStore = {
      upload: async () => ({}),
      storeBytes: async (path, bytes) => { blobs.set(path, Buffer.from(bytes)); return { url: path }; },
      read: async (url) => {
        const bytes = blobs.get(url);
        return bytes
          ? { status: 'ok' as const, contentType: 'application/octet-stream', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }) }
          : { status: 'pruned' as const };
      },
    };
    const detail = '4 list items in the delivered document for 5 declared in the source — 1 did not survive conversion';
    await platform.saveDocumentConversion({
      id: 'conversion-a', clientId: 'client-a', documentId: record.id, inputSha256: sha256('source'), outputSha256: sha256(output),
      artifactUrl: 'output', verificationArtifactUrl: 'report', verificationSha256: sha256(report), convertedAt: '2026-09-02T00:00:00.000Z',
      summary: { title: 'already-titled', sourceLanguage: 'en', tagged: true, pages: 1, headings: 1, figures: 0, tables: 0, lists: 0, gaps: [],
        conformance: { checker: 'verapdf-ua1', compliant: true },
        needs: [{ criterion: '1.3.1', item: detail }],
        asks: [{ id: 'fidelity:0', kind: 'fidelity', criterion: '1.3.1', answerable: 'none' }],
        fidelity: { checked: true, oracle: 'ooxml', defects: [{ kind: 'omission', criterion: '1.3.1', detail, oracle: 'ooxml' }] } },
    });

    const actor = { id: 'operator-a', name: 'Alex' };
    const deps = { platform, artifacts, archive: (entries: Array<{ name: string; bytes: Uint8Array }>) => createDeliveryArchive(entries),
      verify: async () => { throw new Error('a stored verification is on record; nothing should re-verify'); } };
    const fingerprint = (await deliveryOverview(platform, 'client-a')).rows[0]!.fingerprint;
    await signDocument(deps, 'client-a', record.id, actor, { fingerprint });
    const bundle = await prepareDelivery(deps, 'client-a', [record.id], actor);

    const zip = blobs.get(bundle.artifactUrl)!;
    expect(sha256(zip)).toBe(bundle.sha256);

    const manifest = JSON.parse(zipEntry(zip, 'manifest.json')!.toString('utf8'));
    const [entry] = manifest.entries;
    expect(sha256(zipEntry(zip, 'files/document-1.pdf')!)).toBe(entry.outputSha256);
    expect(sha256(zipEntry(zip, 'verification/document-1.json')!)).toBe(entry.verificationSha256);
    expect(entry.knownDifferences).toEqual([{ criterion: '1.3.1', detail }]);

    const provenance = JSON.parse(zipEntry(zip, 'provenance/document-1.json')!.toString('utf8'));
    expect(provenance.knownDifferences).toEqual([{ criterion: '1.3.1', detail }]);
    expect(zipEntry(zip, 'attestations.json')).not.toBeNull();
    expect(zipEntry(zip, 'work-log.csv')).not.toBeNull();
  }, 60_000);
});
