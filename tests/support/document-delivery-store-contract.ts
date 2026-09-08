import { describe, expect, it } from 'vitest';
import type { PlatformStore } from '../../src/domain/platform';
import type { DeliveryBundle, DocumentSignoff } from '../../src/domain/document-delivery';

export function documentDeliveryStoreContract(makeStore: () => Promise<PlatformStore> | PlatformStore, prefix: string) {
  const clientId = `${prefix}-delivery-client`;
  async function setup() {
    const store = await makeStore();
    await store.upsertClient({id: clientId, name: 'Delivery contract'});
    const doc = await store.ensureClientDocument(clientId, {url: 'https://contract.example/a.pdf', kind: 'pdf', source: 'crawl', contentSha256: 'a'.repeat(64)}, '2026-09-01T00:00:00.000Z');
    const signoff: DocumentSignoff = {id: `${prefix}-signoff`, clientId, documentId: doc.id, conversionId: `${prefix}-conversion`, fingerprint: 'fingerprint',
      inputSha256: 'a'.repeat(64), outputSha256: 'b'.repeat(64), verificationArtifactUrl: 'private-report', verificationSha256: 'c'.repeat(64),
      actor: 'Alex', operatorId: `${prefix}-operator`, signedAt: '2026-09-01T01:00:00.000Z'};
    const bundle: DeliveryBundle = {id: `${prefix}-bundle`, clientId, clientName: 'Delivery contract', revision: await store.documentRevision(clientId),
      entries: [], omissions: [], artifactUrl: 'private-bundle', sha256: 'd'.repeat(64), bytes: 100, preparedAt: '2026-09-01T02:00:00.000Z', preparedBy: 'Alex'};
    return {store, doc, signoff, bundle};
  }
  describe('document delivery store contract', () => {
    it('rejects stale sign-off and keeps duplicate evidence immutable without changing revision', async () => {
      const {store, doc, signoff} = await setup();
      const before = await store.documentRevision(clientId);
      await store.ensureClientDocument(clientId, {url: doc.url, kind: 'pdf', source: 'crawl', contentSha256: 'b'.repeat(64)}, '2026-09-02T00:00:00.000Z');
      expect(await store.saveDocumentSignoff(signoff, before)).toBe(false);
      expect(await store.saveDocumentSignoff(signoff, await store.documentRevision(clientId))).toBe(true);
      const signedRevision = await store.documentRevision(clientId);
      expect(await store.saveDocumentSignoff({...signoff, actor: 'Changed'}, signedRevision)).toBe(true);
      expect(await store.documentRevision(clientId)).toBe(signedRevision);
      expect(await store.listDocumentSignoffs(clientId)).toContainEqual(signoff);
    });
    it('issues a pinned bundle once and revokes only its token', async () => {
      const {store, bundle} = await setup();
      expect(await store.saveDeliveryBundle(bundle, bundle.revision)).toBe(true);
      expect(await store.saveDeliveryBundle({...bundle, bytes: 999}, bundle.revision)).toBe(true);
      expect(await store.getDeliveryBundle(bundle.id)).toEqual(bundle);
      expect(await store.getDeliveryByToken(`${prefix}-token`)).toBeNull();
      expect(await store.issueDeliveryBundle(bundle.id, bundle.revision, `${prefix}-token`, 'Alex', '2026-09-03T00:00:00.000Z')).toBe(true);
      expect(await store.issueDeliveryBundle(bundle.id, bundle.revision, `${prefix}-other-token`, 'Someone else', '2026-09-04T00:00:00.000Z')).toBe(true);
      expect((await store.getDeliveryByToken(`${prefix}-token`))?.issuedBy).toBe('Alex');
      expect(await store.getDeliveryByToken(`${prefix}-other-token`)).toBeNull();
      await store.revokeDeliveryBundle(bundle.id, '2026-09-05T00:00:00.000Z');
      expect(await store.getDeliveryByToken(`${prefix}-token`)).toBeNull();
      expect((await store.getDeliveryBundle(bundle.id))?.entries).toEqual(bundle.entries);
      expect(await store.issueDeliveryBundle(bundle.id, bundle.revision, `${prefix}-revive`, 'Alex', '2026-09-06T00:00:00.000Z')).toBe(false);
    });
    it('new answers invalidate preparation and exclusions can be reversed', async () => {
      const {store, doc, bundle} = await setup();
      await store.saveDocumentAnswers([{id: `${prefix}-delivery-answer`, clientId, documentId: doc.id, inputSha256: 'a'.repeat(64), askId: 'language', kind: 'language', disposition: 'declared', value: 'en', actor: 'Alex', declaredAt: '2026-09-01T01:00:00.000Z'}]);
      expect(await store.saveDeliveryBundle(bundle, bundle.revision)).toBe(false);
      const exclusion = {documentId: doc.id, reason: 'Outside engagement', actor: 'Alex', operatorId: `${prefix}-operator`, at: '2026-09-01T02:00:00.000Z'};
      expect(await store.saveDocumentExclusion(clientId, exclusion, await store.documentRevision(clientId))).toBe(true);
      expect(await store.listDocumentExclusions(clientId)).toContainEqual(exclusion);
      expect(await store.saveDocumentExclusion(clientId, {...exclusion, reversedAt: '2026-09-02T00:00:00.000Z'}, await store.documentRevision(clientId))).toBe(true);
      expect((await store.listDocumentExclusions(clientId))[0]?.reversedAt).toBeTruthy();
    });
    it('returns only attributed actions for the requested client documents', async () => {
      const {store, doc} = await setup();
      await store.recordEvent({clientId, actor: 'Alex', action: 'document_converted', subject: doc.id, metadata: {conversionId: `${prefix}-conversion`, secret: 'PRIVATE'}});
      await store.recordEvent({clientId, actor: 'Someone', action: 'unrelated', subject: `${prefix}-other`});
      const events = await store.documentWorkLog(clientId, [doc.id]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({documentId: doc.id, actor: 'Alex', action: 'document_converted', conversionId: `${prefix}-conversion`});
      expect(JSON.stringify(events)).not.toContain('PRIVATE');
    });
  });
}
