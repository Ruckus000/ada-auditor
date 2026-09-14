import { describe, expect, it, vi } from 'vitest';
import { MemoryPlatformStore } from '../../src/integrations/persistence/memory-platform-store';
import { deliveryOverview, digest, issueDelivery, prepareDelivery, revokeDelivery, signDocument, type DeliveryDependencies } from '../../src/services/document-delivery';
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
/** What the operator's screen showed for the document: the sign-off is bound to it. */
async function shown(platform: DeliveryDependencies['platform'], documentId: string) {
  const row = (await deliveryOverview(platform, 'client-a')).rows.find(r => r.record.id === documentId);
  if (!row) throw new Error('no row');
  return row.fingerprint;
}

describe('verified document delivery', () => {
  it('signs, prepares an immutable private snapshot, issues once, then revokes access', async () => {
    const {deps, platform, record, archive} = await setup();
    const fingerprint = await shown(platform, record.id);
    const signoff = await signDocument(deps, 'client-a', record.id, actor, {fingerprint, note: 'PRIVATE NOTE'});
    expect((await deliveryOverview(platform, 'client-a')).delivered).toBe(0);
    expect(await signDocument(deps, 'client-a', record.id, actor, {fingerprint})).toEqual(signoff);
    const bundle = await prepareDelivery(deps, 'client-a', [record.id], actor);
    expect(bundle.token).toBeUndefined();
    expect(JSON.stringify(archive.mock.calls)).not.toContain('PRIVATE NOTE');
    expect(JSON.stringify(archive.mock.calls)).not.toContain('secret=private');
    expect(JSON.stringify(archive.mock.calls)).not.toContain('artifactUrl');
    const issued = await issueDelivery(deps, bundle, actor);
    expect(issued.token).toMatch(/^[a-f0-9]{64}$/);
    expect((await deliveryOverview(platform, 'client-a')).delivered).toBe(1);
    expect((await issueDelivery(deps, issued, actor)).token).toBe(issued.token);
    await revokeDelivery(deps, issued, actor);
    expect(await platform.getDeliveryByToken(issued.token!)).toBeNull();
    expect((await platform.getDeliveryBundle(bundle.id))?.issuedAt).toBeTruthy();
    // A revoked link delivers nothing: the client can no longer reach the files,
    // so the documents go back to waiting for a delivery rather than reading
    // "delivered" beside a dead link.
    expect((await deliveryOverview(platform, 'client-a')).delivered).toBe(0);
  });

  it('signs only the state the operator was shown', async () => {
    // The fingerprint pins conversion, source hash and answers. A re-remediation
    // between page load and click must not be signed on the operator's name.
    const {deps, platform, record} = await setup();
    const fingerprint = await shown(platform, record.id);
    await platform.saveDocumentConversion({...(await platform.getDocumentConversion('conversion-a'))!, id: 'conversion-b', convertedAt: '2026-09-03T00:00:00.000Z'});
    expect(await shown(platform, record.id)).not.toBe(fingerprint);
    await expect(signDocument(deps, 'client-a', record.id, actor, {fingerprint})).rejects.toMatchObject({code: 'document_changed'});
    expect(await platform.listDocumentSignoffs('client-a')).toEqual([]);
  });

  it('delivers a document with a known difference from its source, and says so', async () => {
    // Fidelity items are answerable by nobody, so they do not block — but the
    // client must not receive "verification passed" and nothing else. Counts only.
    const detail = '4 list items in the delivered document for 5 declared in the source — 1 did not survive conversion';
    const {deps, platform, record, archive} = await setup({
      needs: [{criterion: '1.3.1', item: detail}],
      asks: [{id: 'fidelity:0', kind: 'fidelity', criterion: '1.3.1', answerable: 'none'}],
      fidelity: {checked: true, oracle: 'ooxml', defects: [{kind: 'omission', criterion: '1.3.1', detail, oracle: 'ooxml'}]},
    });
    const row = (await deliveryOverview(platform, 'client-a')).rows[0]!;
    expect(row.reason).toBeNull();
    expect(row.knownDifferences).toEqual([{criterion: '1.3.1', detail}]);
    await signDocument(deps, 'client-a', record.id, actor, {fingerprint: row.fingerprint});
    const bundle = await prepareDelivery(deps, 'client-a', [record.id], actor);
    expect(bundle.entries[0]?.knownDifferences).toEqual([{criterion: '1.3.1', detail}]);
    const provenance = archive.mock.calls[0]![0].find(e => e.name === 'provenance/document-1.json');
    expect(JSON.parse(Buffer.from(provenance!.bytes).toString()).knownDifferences).toEqual([{criterion: '1.3.1', detail}]);
  });

  it('refuses to revoke a link that was never issued, and records nothing', async () => {
    const {deps, platform, record} = await setup();
    await signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(platform, record.id)});
    const bundle = await prepareDelivery(deps, 'client-a', [record.id], actor);
    await expect(revokeDelivery(deps, bundle, actor)).rejects.toMatchObject({code: 'delivery_not_issued'});
    expect((await platform.listEvents({clientId: 'client-a'})).map(e => e.action)).not.toContain('delivery.revoked');
  });

  it('records one issue and one revocation, however often either is asked for', async () => {
    const {deps, platform, record} = await setup();
    await signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(platform, record.id)});
    const bundle = await prepareDelivery(deps, 'client-a', [record.id], actor);
    const [first, second] = await Promise.all([issueDelivery(deps, bundle, actor), issueDelivery(deps, bundle, {id: 'operator-b', name: 'Blair'})]);
    expect(first.token).toBe(second.token);
    await revokeDelivery(deps, first, actor);
    await revokeDelivery(deps, (await platform.getDeliveryBundle(bundle.id))!, actor);
    const actions = (await platform.listEvents({clientId: 'client-a'})).map(e => e.action);
    expect(actions.filter(a => a === 'delivery.issued')).toHaveLength(1);
    expect(actions.filter(a => a === 'delivery.revoked')).toHaveLength(1);
  });
  it.each([
    {conformance: {checker: 'none', reason: 'unavailable'}},
    {conformance: {checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.1-1']}},
    {gaps: ['Unresolved heading']},
    {needs: [{criterion: '1.1.1', item: 'Review figure'}]},
  ] as Partial<RemediationSummary>[])('never signs incomplete or failing verification %j', async override => {
    const {deps, record} = await setup(override);
    await expect(signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(deps.platform, record.id)})).rejects.toMatchObject({code: 'signoff_not_eligible'});
  });
  it('refuses corrupted output and missing evidence', async () => {
    const {deps, record, blobs} = await setup();
    blobs.set('output', Buffer.from('changed'));
    await expect(signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(deps.platform, record.id)})).rejects.toMatchObject({code: 'artifact_hash_mismatch'});
    blobs.set('output', Buffer.from('verified output')); blobs.delete('report');
    await expect(signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(deps.platform, record.id)})).rejects.toMatchObject({code: 'artifact_not_stored'});
  });
  it('rechecks legacy stored output without rewriting the conversion', async () => {
    const {deps, record, platform, conversion} = await setup();
    const legacy = {...conversion, id: 'legacy-new', verificationArtifactUrl: undefined, verificationSha256: undefined, convertedAt: '2026-09-03T00:00:00.000Z'};
    await platform.saveDocumentConversion(legacy);
    const signed = await signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(deps.platform, record.id)});
    expect(deps.verify).toHaveBeenCalledOnce();
    expect(signed.verificationSha256).toBe(digest('{"new":true}'));
    expect((await platform.getDocumentConversion(legacy.id))?.verificationArtifactUrl).toBeUndefined();
  });
  it('never issues after new answers or a changed source', async () => {
    const {deps, platform, record} = await setup();
    await signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(deps.platform, record.id)});
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
    await expect(signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(deps.platform, record.id)})).rejects.toMatchObject({code: 'document_changed'});
    expect(await platform.listDocumentSignoffs('client-a')).toEqual([]);
  });
  it('does not create a bundle when the archive or blob write fails', async () => {
    const {deps, platform, record} = await setup();
    await signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(deps.platform, record.id)});
    deps.archive = async () => {throw new Error('interrupted');};
    await expect(prepareDelivery(deps, 'client-a', [record.id], actor)).rejects.toThrow('interrupted');
    expect(await platform.listDeliveryBundles('client-a')).toEqual([]);
    expect((await deliveryOverview(platform, 'client-a')).signedOff).toBe(1);
  });
  it('records omissions and prevents excluded documents from entering deliveries', async () => {
    const {deps, platform, record} = await setup();
    await signDocument(deps, 'client-a', record.id, actor, {fingerprint: await shown(deps.platform, record.id)});
    await platform.saveDocumentExclusion('client-a', {documentId: record.id, reason: 'Outside this engagement', actor: actor.name, operatorId: actor.id, at: new Date().toISOString()}, await platform.documentRevision('client-a'));
    expect((await deliveryOverview(platform, 'client-a')).excluded).toBe(1);
    await expect(prepareDelivery(deps, 'client-a', [record.id], actor)).rejects.toMatchObject({code: 'signoff_not_eligible'});
  });
});
