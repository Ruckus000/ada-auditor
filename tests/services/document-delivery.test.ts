import { describe, expect, it, vi } from 'vitest';
import { MemoryPlatformStore } from '../../src/integrations/persistence/memory-platform-store';
import { deliveryOverview, digest, issueDelivery, prepareDelivery, signDocument, type DeliveryDependencies } from '../../src/services/document-delivery';
import type { RemediationSummary } from '../../src/domain/document-remediation';
import type { ArtifactStore } from '../../src/domain/artifacts';

const summary: RemediationSummary = {title: 'already-titled', sourceLanguage: 'en', tagged: true, pages: 1,
  headings: 1, figures: 0, tables: 0, lists: 0, gaps: [], conformance: {checker: 'verapdf-ua1', compliant: true}};
const actor = {id: 'operator-a', name: 'Alex'};
async function setup(overrides: Partial<RemediationSummary> = {}) {
  const platform = new MemoryPlatformStore();
  await platform.upsertClient({id: 'client-a', name: 'Town'});
  const record = await platform.ensureClientDocument('client-a', {url: 'https://town.example/agenda.pdf?secret=private', kind: 'pdf', source: 'crawl', contentSha256: digest('source')}, '2026-09-01T00:00:00.000Z');
  const blobs = new Map<string, Buffer>([['output', Buffer.from('verified output')], ['report', Buffer.from('{"verified":true}')]]);
  const artifacts: ArtifactStore = {
    upload: async () => ({}),
    storeBytes: vi.fn(async (path, bytes) => {blobs.set(path, Buffer.from(bytes)); return {url: path};}),
    read: vi.fn(async url => {
      const bytes = blobs.get(url);
      return bytes ? {status: 'ok' as const, contentType: 'application/octet-stream', body: new ReadableStream({start(c) {c.enqueue(bytes); c.close();}})} : {status: 'pruned' as const};
    }),
  };
  const conversion = {id: 'conversion-a', clientId: 'client-a', documentId: record.id, summary: {...summary, ...overrides},
    inputSha256: digest('source'), outputSha256: digest('verified output'), artifactUrl: 'output',
    verificationArtifactUrl: 'report', verificationSha256: digest('{"verified":true}'), convertedAt: '2026-09-02T00:00:00.000Z'};
  await platform.saveDocumentConversion(conversion);
  const archive = vi.fn(async (entries: Array<{name: string; bytes: Uint8Array}>) => Buffer.from(JSON.stringify(entries.map(e => ({name: e.name, content: Buffer.from(e.bytes).toString()})))));
  const deps: DeliveryDependencies = {platform, artifacts, archive,
    verify: vi.fn(async () => ({conformance: {checker: 'verapdf-ua1', compliant: true} as const, verificationReport: '{"new":true}'}))};
  return {deps, platform, blobs, conversion, record, archive};
}

describe('verified document delivery', () => {
  it('signs, prepares an immutable private snapshot, issues once, then revokes access', async () => {
    const {deps, platform, record, archive} = await setup();
    const signoff = await signDocument(deps, 'client-a', record.id, actor, 'PRIVATE NOTE');
    expect((await deliveryOverview(platform, 'client-a')).delivered).toBe(0);
    expect(await signDocument(deps, 'client-a', record.id, actor)).toEqual(signoff);
    const bundle = await prepareDelivery(deps, 'client-a', [record.id], actor);
    expect(bundle.token).toBeUndefined();
    expect(JSON.stringify(archive.mock.calls)).not.toContain('PRIVATE NOTE');
    expect(JSON.stringify(archive.mock.calls)).not.toContain('secret=private');
    expect(JSON.stringify(archive.mock.calls)).not.toContain('artifactUrl');
    const issued = await issueDelivery(deps, bundle, actor);
    expect(issued.token).toMatch(/^[a-f0-9]{64}$/);
    expect((await deliveryOverview(platform, 'client-a')).delivered).toBe(1);
    expect((await issueDelivery(deps, issued, actor)).token).toBe(issued.token);
    await platform.revokeDeliveryBundle(bundle.id, new Date().toISOString());
    expect(await platform.getDeliveryByToken(issued.token!)).toBeNull();
    expect((await platform.getDeliveryBundle(bundle.id))?.issuedAt).toBeTruthy();
    expect((await deliveryOverview(platform, 'client-a')).delivered).toBe(1);
  });
  it.each([
    {conformance: {checker: 'none', reason: 'unavailable'}},
    {conformance: {checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.1-1']}},
    {gaps: ['Unresolved heading']},
    {needs: [{criterion: '1.1.1', item: 'Review figure'}]},
  ] as Partial<RemediationSummary>[])('never signs incomplete or failing verification %j', async override => {
    const {deps, record} = await setup(override);
    await expect(signDocument(deps, 'client-a', record.id, actor)).rejects.toMatchObject({code: 'signoff_not_eligible'});
  });
  it('refuses corrupted output and missing evidence', async () => {
    const {deps, record, blobs} = await setup();
    blobs.set('output', Buffer.from('changed'));
    await expect(signDocument(deps, 'client-a', record.id, actor)).rejects.toMatchObject({code: 'artifact_hash_mismatch'});
    blobs.set('output', Buffer.from('verified output')); blobs.delete('report');
    await expect(signDocument(deps, 'client-a', record.id, actor)).rejects.toMatchObject({code: 'artifact_not_stored'});
  });
  it('rechecks legacy stored output without rewriting the conversion', async () => {
    const {deps, record, platform, conversion} = await setup();
    const legacy = {...conversion, id: 'legacy-new', verificationArtifactUrl: undefined, verificationSha256: undefined, convertedAt: '2026-09-03T00:00:00.000Z'};
    await platform.saveDocumentConversion(legacy);
    const signed = await signDocument(deps, 'client-a', record.id, actor);
    expect(deps.verify).toHaveBeenCalledOnce();
    expect(signed.verificationSha256).toBe(digest('{"new":true}'));
    expect((await platform.getDocumentConversion(legacy.id))?.verificationArtifactUrl).toBeUndefined();
  });
  it('never issues after new answers or a changed source', async () => {
    const {deps, platform, record} = await setup();
    await signDocument(deps, 'client-a', record.id, actor);
    const bundle = await prepareDelivery(deps, 'client-a', [record.id], actor);
    await platform.saveDocumentAnswers([{id: 'new-answer', clientId: 'client-a', documentId: record.id, inputSha256: digest('source'), askId: 'language',
      kind: 'language', disposition: 'declared', value: 'fr', actor: 'Alex', declaredAt: new Date().toISOString()}]);
    await expect(issueDelivery(deps, bundle, actor)).rejects.toMatchObject({code: 'document_changed'});
    expect((await deliveryOverview(platform, 'client-a')).eligible).toBe(0);
    await platform.ensureClientDocument('client-a', {url: record.url, kind: 'pdf', source: 'crawl', contentSha256: digest('new source')}, new Date().toISOString());
    expect((await deliveryOverview(platform, 'client-a')).signedOff).toBe(0);
  });
  it('rejects a source update during verification before committing sign-off', async () => {
    const {deps, platform, record} = await setup();
    const original = deps.artifacts.read;
    let changed = false;
    deps.artifacts.read = async url => {
      if (!changed) {changed = true; await platform.recordDocumentSightings('client-a', [{url: record.url, kind: 'pdf', source: 'crawl', contentSha256: digest('changed')}], new Date().toISOString());}
      return original(url);
    };
    await expect(signDocument(deps, 'client-a', record.id, actor)).rejects.toMatchObject({code: 'document_changed'});
    expect(await platform.listDocumentSignoffs('client-a')).toEqual([]);
  });
  it('does not create a bundle when the archive or blob write fails', async () => {
    const {deps, platform, record} = await setup();
    await signDocument(deps, 'client-a', record.id, actor);
    deps.archive = async () => {throw new Error('interrupted');};
    await expect(prepareDelivery(deps, 'client-a', [record.id], actor)).rejects.toThrow('interrupted');
    expect(await platform.listDeliveryBundles('client-a')).toEqual([]);
    expect((await deliveryOverview(platform, 'client-a')).signedOff).toBe(1);
  });
  it('records omissions and prevents excluded documents from entering deliveries', async () => {
    const {deps, platform, record} = await setup();
    await signDocument(deps, 'client-a', record.id, actor);
    await platform.saveDocumentExclusion('client-a', {documentId: record.id, reason: 'Outside this engagement', actor: actor.name, operatorId: actor.id, at: new Date().toISOString()}, await platform.documentRevision('client-a'));
    expect((await deliveryOverview(platform, 'client-a')).excluded).toBe(1);
    await expect(prepareDelivery(deps, 'client-a', [record.id], actor)).rejects.toMatchObject({code: 'signoff_not_eligible'});
  });
});
