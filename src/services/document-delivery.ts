import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ArtifactStore } from '../domain/artifacts';
import type { DeliveryBundle, DocumentSignoff } from '../domain/document-delivery';
import type { ClientDocumentRecord, PlatformStore, StoredDocumentAnswer } from '../domain/platform';
import type { Conformance } from '../domain/document-remediation';
import { pairDocuments } from './document-pairing';
import { logInfo } from './logger';

export const MAX_DELIVERY_DOCUMENTS = 100;
export const MAX_DELIVERY_BYTES = 100 * 1024 * 1024;
export class DeliveryRefusal extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
export const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export type DeliveryDependencies = {
  platform: PlatformStore;
  artifacts: ArtifactStore;
  verify: (bytes: Buffer) => Promise<{conformance: Conformance; verificationReport?: string}>;
  archive: (entries: Array<{name: string; bytes: Uint8Array}>) => Promise<Buffer>;
};
export type DeliveryActor = {id: string; name: string};

/** Bounded streaming read: a private blob is not assumed small or intact. */
export async function deliveryBytes(artifacts: ArtifactStore, url: string | undefined, expectedHash?: string, limit = MAX_DELIVERY_BYTES): Promise<Buffer> {
  if (!url) throw new DeliveryRefusal('artifact_not_stored');
  const result = await artifacts.read(url);
  if (result.status !== 'ok') throw new DeliveryRefusal('artifact_not_stored');
  const reader = result.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DeliveryRefusal('bundle_too_large', 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (expectedHash && digest(bytes) !== expectedHash) throw new DeliveryRefusal('artifact_hash_mismatch');
  return bytes;
}

export async function allDeliveryDocuments(platform: PlatformStore, clientId: string): Promise<ClientDocumentRecord[]> {
  const records: ClientDocumentRecord[] = [];
  let before: {lastSeenAt: string; id: string} | undefined;
  while (true) {
    const page = await platform.listClientDocuments(clientId, before ? {before} : undefined);
    records.push(...page.documents);
    if (!page.hasMore) return records;
    const last = page.documents.at(-1);
    if (!last) throw new DeliveryRefusal('inventory_incomplete');
    before = {lastSeenAt: last.lastSeenAt, id: last.id};
  }
}

function sourceLabel(value: string): string {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
  catch { return value; }
}

function currentDocument(record: ClientDocumentRecord, records: ClientDocumentRecord[], answers: StoredDocumentAnswer[], pairs: ReturnType<typeof pairDocuments>) {
  const pair = pairs.get(record.id);
  const source = pair ? records.find(r => r.id === pair.id)! : record;
  const conversion = source.latestConversion;
  const answerDocuments = new Set([source.id, ...records.filter(r => pairs.get(r.id)?.id === source.id).map(r => r.id)]);
  const currentAnswers = answers.filter(a => answerDocuments.has(a.documentId) && a.inputSha256 === conversion?.inputSha256);
  const fingerprint = digest(JSON.stringify({document: record.id, hash: record.contentSha256 ?? null,
    source: source.id, sourceHash: source.contentSha256 ?? null, conversion: conversion?.id ?? null,
    answers: currentAnswers.map(a => a.id).sort()}));
  let reason: string | null = null;
  if (record.kind !== 'pdf' && [...pairs.values()].some(p => p.id === record.id)) reason = 'This Word source is paired with a PDF. Deliver its remediated PDF from that inventory row.';
  else if (!conversion) reason = 'No remediated output is on record.';
  else if (!conversion.artifactUrl) reason = 'The output file was not stored. Remediate again to retain it.';
  else if (!source.contentSha256 || source.contentSha256 !== conversion.inputSha256) reason = 'The source has changed or its identity is unknown. Read and remediate it again.';
  else if (conversion.summary.conformance?.checker !== 'verapdf-ua1' || !conversion.summary.conformance.compliant) reason = 'The output has not passed veraPDF verification.';
  else if (conversion.summary.gaps.length || (conversion.summary.needs ?? []).some((_, i) => conversion.summary.asks?.[i]?.answerable !== 'none')) reason = 'The output still has unresolved remediation gaps.';
  else if (currentAnswers.some(a => a.disposition === 'declared' && !conversion.answerIds?.includes(a.id))) reason = 'Answers are waiting to be applied and verified.';
  return {record, source, conversion, fingerprint, currentAnswers, reason};
}

export async function deliveryOverview(platform: PlatformStore, clientId: string) {
  const revision = await platform.documentRevision(clientId);
  const records = await allDeliveryDocuments(platform, clientId);
  const [answers, signoffs, exclusions, bundles] = await Promise.all([
    platform.latestDocumentAnswers(clientId, records.map(r => r.id)), platform.listDocumentSignoffs(clientId),
    platform.listDocumentExclusions(clientId), platform.listDeliveryBundles(clientId),
  ]);
  const pairs = pairDocuments(records);
  const rows = records.map(record => {
    const current = currentDocument(record, records, answers, pairs);
    const exclusion = exclusions.find(e => e.documentId === record.id && !e.reversedAt);
    const signoff = signoffs.find(s => s.documentId === record.id && s.fingerprint === current.fingerprint);
    const delivered = !exclusion && !current.reason && Boolean(signoff && bundles.some(b => b.issuedAt && b.entries.some(e => e.signoffId === signoff.id)));
    return {...current, exclusion, signoff, delivered};
  });
  return {revision, records, answers, bundles, rows,
    signedOff: new Set(rows.filter(r => !r.exclusion && !r.reason && r.signoff).map(r => r.conversion!.id)).size,
    delivered: new Set(rows.filter(r => r.delivered).map(r => r.conversion!.id)).size,
    excluded: rows.filter(r => r.exclusion).length,
    eligible: rows.filter(r => !r.exclusion && !r.reason).length};
}

export async function signDocument(deps: DeliveryDependencies, clientId: string, documentId: string, actor: DeliveryActor, note?: string): Promise<DocumentSignoff> {
  const view = await deliveryOverview(deps.platform, clientId);
  const row = view.rows.find(r => r.record.id === documentId);
  if (!row) throw new DeliveryRefusal('document_not_found', 404);
  if (row.exclusion || row.reason || !row.conversion) throw new DeliveryRefusal('signoff_not_eligible');
  const conversion = row.conversion;
  const output = await deliveryBytes(deps.artifacts, conversion.artifactUrl, conversion.outputSha256);
  let verificationArtifactUrl = row.signoff?.verificationArtifactUrl ?? conversion.verificationArtifactUrl;
  let verificationSha256 = row.signoff?.verificationSha256 ?? conversion.verificationSha256;
  if (verificationArtifactUrl && verificationSha256) {
    await deliveryBytes(deps.artifacts, verificationArtifactUrl, verificationSha256);
  } else {
    // Legacy records retain their original conversion. New verification belongs to this sign-off.
    const verified = await deps.verify(output);
    if (verified.conformance.checker !== 'verapdf-ua1' || !verified.conformance.compliant || !verified.verificationReport) throw new DeliveryRefusal('verification_unavailable');
    verificationSha256 = digest(verified.verificationReport);
    const artifact = await deps.artifacts.storeBytes(`documents/${clientId}/verification-${randomUUID()}.json`, Buffer.from(verified.verificationReport), 'application/json');
    if (!artifact) throw new DeliveryRefusal('artifact_not_stored');
    verificationArtifactUrl = artifact.url;
  }
  if (row.signoff) {
    if (await deps.platform.documentRevision(clientId) !== view.revision) throw new DeliveryRefusal('document_changed');
    return row.signoff;
  }
  const signoff: DocumentSignoff = {id: digest(`${clientId}:${documentId}:${row.fingerprint}`), clientId, documentId,
    conversionId: conversion.id, fingerprint: row.fingerprint, inputSha256: conversion.inputSha256, outputSha256: conversion.outputSha256,
    verificationArtifactUrl, verificationSha256, actor: actor.name, operatorId: actor.id,
    signedAt: new Date().toISOString(), ...(note ? {note} : {})};
  if (!await deps.platform.saveDocumentSignoff(signoff, view.revision)) throw new DeliveryRefusal('document_changed');
  await deps.platform.recordEvent({clientId, actor: actor.name, actorOperatorId: actor.id, action: 'document.signed-off', subject: documentId});
  logInfo('document_signed_off', {clientId, documentId, conversionId: conversion.id});
  return signoff;
}

function csv(rows: string[][]): string {
  return rows.map(row => row.map(cell => `"${(/^[=+@\-\t\r]/.test(cell) ? "'" : '') + cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
}

export async function prepareDelivery(deps: DeliveryDependencies, clientId: string, documentIds: string[], actor: DeliveryActor): Promise<DeliveryBundle> {
  if (!documentIds.length || documentIds.length > MAX_DELIVERY_DOCUMENTS || new Set(documentIds).size !== documentIds.length) throw new DeliveryRefusal('bundle_selection_invalid', 400);
  const client = await deps.platform.getClient(clientId);
  if (!client) throw new DeliveryRefusal('client_not_found', 404);
  const view = await deliveryOverview(deps.platform, clientId);
  const selected = documentIds.map(id => view.rows.find(r => r.record.id === id));
  if (selected.some(r => !r || r.exclusion || r.reason || !r.signoff)) throw new DeliveryRefusal('signoff_not_eligible');
  if (new Set(selected.map(r => r!.conversion!.id)).size !== selected.length) throw new DeliveryRefusal('duplicate_delivery_output', 400);
  const workLog = await deps.platform.documentWorkLog(clientId, [...new Set(selected.flatMap(r => [r!.record.id, r!.source.id]))]);
  if (workLog.length > 10000) throw new DeliveryRefusal('work_log_too_large', 413);
  const bundleId = randomUUID();
  const entries: DeliveryBundle['entries'] = [];
  const files: Array<{name: string; bytes: Uint8Array}> = [];
  let bytes = 0;
  const add = (name: string, data: Uint8Array) => {
    bytes += data.byteLength;
    if (bytes > MAX_DELIVERY_BYTES) throw new DeliveryRefusal('bundle_too_large', 413);
    files.push({name, bytes: data});
  };
  const attestations: Array<Record<string, unknown>> = [];
  const work: string[][] = [['document', 'action', 'operator', 'timestamp']];
  for (const [index, row] of selected.entries()) {
    const r = row!;
    const c = r.conversion!;
    const s = r.signoff!;
    const name = `document-${index + 1}`;
    add(`files/${name}.pdf`, await deliveryBytes(deps.artifacts, c.artifactUrl, c.outputSha256, MAX_DELIVERY_BYTES - bytes));
    add(`verification/${name}.json`, await deliveryBytes(deps.artifacts, s.verificationArtifactUrl, s.verificationSha256, MAX_DELIVERY_BYTES - bytes));
    entries.push({documentId: r.record.id, conversionId: c.id, signoffId: s.id, source: sourceLabel(r.record.url),
      inputSha256: c.inputSha256, outputSha256: c.outputSha256, verificationSha256: s.verificationSha256,
      signedBy: s.actor, signedAt: s.signedAt});
    const relevantAnswers = r.currentAnswers.filter(a => c.answerIds?.includes(a.id) || a.disposition !== 'declared');
    for (const a of relevantAnswers) {
      attestations.push({document: name, askId: a.askId, disposition: a.disposition, value: a.value, actor: a.actor, at: a.declaredAt});
      work.push([name, `answer.${a.disposition}`, a.actor, a.declaredAt]);
    }
    const events = workLog.filter(e => e.documentId === r.record.id || e.documentId === r.source.id);
    for (const event of events) work.push([name, event.action, event.actor, event.at]);
    if (!events.some(e => e.conversionId === c.id)) work.push([name, c.kind ?? 'conversion', 'Not recorded', c.convertedAt]);
    if (!events.some(e => e.action === 'document.signed-off' && e.actor === s.actor)) work.push([name, 'signed-off', s.actor, s.signedAt]);
    // Only the content-free account goes into the public manifest.
    add(`provenance/${name}.json`, Buffer.from(JSON.stringify({kind: c.kind ?? 'conversion', instrumentVersion: c.instrumentVersion,
      title: c.summary.title, conformance: c.summary.conformance, scope: c.summary.scope, inputSha256: c.inputSha256, outputSha256: c.outputSha256})));
  }
  const omissions = view.rows.filter(r => !documentIds.includes(r.record.id)).map(r => ({documentId: r.record.id, source: sourceLabel(r.record.url),
    reason: r.exclusion?.reason ?? r.reason ?? (!r.signoff ? 'Not signed off.' : 'Not selected for this delivery.')}));
  const preparedAt = new Date().toISOString();
  add('manifest.json', Buffer.from(JSON.stringify({id: bundleId, client: client.name, preparedAt, entries, omissions}, null, 2)));
  add('attestations.json', Buffer.from(JSON.stringify(attestations, null, 2)));
  add('work-log.csv', Buffer.from(csv(work)));
  const archive = await deps.archive(files);
  if (archive.byteLength > MAX_DELIVERY_BYTES) throw new DeliveryRefusal('bundle_too_large', 413);
  const stored = await deps.artifacts.storeBytes(`documents/${clientId}/delivery-${bundleId}.zip`, archive, 'application/zip');
  if (!stored) throw new DeliveryRefusal('artifact_not_stored');
  const bundle: DeliveryBundle = {id: bundleId, clientId, clientName: client.name, revision: view.revision, entries, omissions,
    artifactUrl: stored.url, sha256: digest(archive), bytes: archive.byteLength, preparedAt, preparedBy: actor.name};
  if (!await deps.platform.saveDeliveryBundle(bundle, view.revision)) throw new DeliveryRefusal('document_changed');
  await deps.platform.recordEvent({clientId, actor: actor.name, actorOperatorId: actor.id, action: 'delivery.prepared', subject: bundleId});
  logInfo('delivery_prepared', {clientId, bundleId, documents: entries.length, bytes: archive.byteLength});
  return bundle;
}

export async function issueDelivery(deps: DeliveryDependencies, bundle: DeliveryBundle, actor: DeliveryActor): Promise<DeliveryBundle> {
  if (bundle.revokedAt) throw new DeliveryRefusal('delivery_revoked');
  if (bundle.issuedAt) return bundle;
  const view = await deliveryOverview(deps.platform, bundle.clientId);
  if (view.revision !== bundle.revision || bundle.entries.some(e => !view.rows.some(r => r.record.id === e.documentId && r.signoff?.id === e.signoffId && !r.reason && !r.exclusion))) throw new DeliveryRefusal('document_changed');
  await deliveryBytes(deps.artifacts, bundle.artifactUrl, bundle.sha256);
  for (const e of bundle.entries) {
    const r = view.rows.find(r => r.record.id === e.documentId)!;
    await deliveryBytes(deps.artifacts, r.conversion!.artifactUrl, e.outputSha256);
    await deliveryBytes(deps.artifacts, r.signoff!.verificationArtifactUrl, e.verificationSha256);
  }
  if (!await deps.platform.issueDeliveryBundle(bundle.id, view.revision, randomBytes(32).toString('hex'), actor.name, new Date().toISOString())) throw new DeliveryRefusal('document_changed');
  await deps.platform.recordEvent({clientId: bundle.clientId, actor: actor.name, actorOperatorId: actor.id, action: 'delivery.issued', subject: bundle.id});
  logInfo('delivery_issued', {clientId: bundle.clientId, bundleId: bundle.id});
  return (await deps.platform.getDeliveryBundle(bundle.id))!;
}
