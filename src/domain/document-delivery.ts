/** Delivery records pin evidence, never a mutable inventory view. */
export type DocumentSignoff = {
  id: string;
  clientId: string;
  documentId: string;
  conversionId: string;
  fingerprint: string;
  inputSha256: string;
  outputSha256: string;
  verificationArtifactUrl: string;
  verificationSha256: string;
  actor: string;
  operatorId: string;
  signedAt: string;
  note?: string;
};

export type DocumentExclusion = {
  documentId: string;
  reason: string;
  actor: string;
  operatorId: string;
  at: string;
  reversedAt?: string;
};

export type DeliveryEntry = {
  documentId: string;
  conversionId: string;
  signoffId: string;
  source: string;
  inputSha256: string;
  outputSha256: string;
  verificationSha256: string;
  signedBy: string;
  signedAt: string;
  /**
   * What the fidelity check found and nobody can answer: a count the delivered
   * PDF and its source disagree on. It does not block sign-off (no one can
   * supply the list item an export dropped), so it has to travel with the file
   * instead — a client told only "verification passed" would be told less than
   * we know. Count-only sentences. Absent on bundles prepared before it existed.
   */
  knownDifferences?: KnownDifference[];
};

export type KnownDifference = {criterion: string; detail: string};

export type DeliveryBundle = {
  id: string;
  clientId: string;
  clientName: string;
  revision: string;
  entries: DeliveryEntry[];
  omissions: Array<{ documentId: string; source: string; reason: string }>;
  artifactUrl: string;
  sha256: string;
  bytes: number;
  preparedAt: string;
  preparedBy: string;
  issuedAt?: string;
  issuedBy?: string;
  token?: string;
  revokedAt?: string;
};

export type DocumentWorkEvent = {documentId: string; action: string; actor: string; at: string; conversionId?: string};

export interface DocumentDeliveryStore {
  /** 10,001 is a sentinel: callers must refuse rather than truncate a work log. */
  documentWorkLog(clientId: string, documentIds: string[]): Promise<DocumentWorkEvent[]>;
  documentRevision(clientId: string): Promise<string>;
  listDocumentSignoffs(clientId: string): Promise<DocumentSignoff[]>;
  saveDocumentSignoff(record: DocumentSignoff, expectedRevision: string): Promise<boolean>;
  listDocumentExclusions(clientId: string): Promise<DocumentExclusion[]>;
  saveDocumentExclusion(clientId: string, record: DocumentExclusion, expectedRevision: string): Promise<boolean>;
  saveDeliveryBundle(record: DeliveryBundle, expectedRevision: string): Promise<boolean>;
  listDeliveryBundles(clientId: string): Promise<DeliveryBundle[]>;
  getDeliveryBundle(id: string): Promise<DeliveryBundle | null>;
  getDeliveryByToken(token: string): Promise<DeliveryBundle | null>;
  issueDeliveryBundle(id: string, expectedRevision: string, token: string, actor: string, at: string): Promise<boolean>;
  /** True only when this call revoked a live link; an unissued or already-revoked bundle answers false. */
  revokeDeliveryBundle(id: string, at: string): Promise<boolean>;
}
