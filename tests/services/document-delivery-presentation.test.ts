import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_DELIVERY_BYTES, MAX_DELIVERY_DOCUMENTS } from '../../src/services/document-delivery';
import { deliveryError, inDeliveryQueue, selectableForDelivery, type DeliveryRow } from '../../src/services/presentation/document-delivery';
const row: DeliveryRow = { documentId: 'd1', url: 'https://example.test/a.pdf', reason: null, excluded: false, signedOff: false, delivered: false, eligible: true, fingerprint: 'f'.repeat(64), knownDifferences: [] };

/**
 * Every refusal a delivery door can send, read off the source rather than
 * listed by hand: a hand list is how a code the routes grow goes unnoticed.
 * The service, the route helper and the four delivery routes all refuse
 * through `new DeliveryRefusal('code'…)`; the budget arrives through
 * `documentBudgetRefusal`, whose code is its own.
 */
function routeCodes(): string[] {
  const routeFiles = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [path] : [];
  });
  const sources = [
    'src/services/document-delivery.ts',
    'src/app/api/_lib/document-delivery.ts',
    ...routeFiles('src/app/api/platform/clients').filter((file) => /delivery|signoff|exclusion/.test(file)),
  ];
  const codes = new Set<string>(['document_budget_exceeded']);
  for (const file of sources) {
    for (const match of readFileSync(file, 'utf8').matchAll(/DeliveryRefusal\('([a-z_]+)'/g)) codes.add(match[1]!);
  }
  return [...codes].sort();
}

describe('what an operator reads when a delivery action does not happen', () => {
  it('finds the codes it claims to cover', () => {
    // Guards the reader above: if the source stops matching, the loop below
    // would pass over nothing.
    expect(routeCodes()).toEqual(expect.arrayContaining(['document_changed', 'delivery_not_issued', 'operator_required', 'unauthorized']));
    expect(routeCodes().length).toBeGreaterThanOrEqual(20);
  });

  it('has one sentence for every code the doors send, and never prints the code', () => {
    for (const error of routeCodes()) {
      const copy = deliveryError({ error, status: 409 });
      expect(copy, error).not.toContain(error);
      expect(copy, error).not.toMatch(/^The action stopped:/);
      expect(copy, error).toMatch(/[.]$/);
      // No request id, no parenthesised code: the house rule every other
      // copy module follows.
      expect(copy, error).not.toMatch(/\(|; request/);
    }
  });

  it('says try again only where trying again can change the answer', () => {
    // Repeating these cannot help: the state that refused is still there, or
    // the request itself was wrong.
    for (const error of ['document_changed', 'signoff_not_eligible', 'bundle_too_large', 'bundle_selection_invalid',
      'duplicate_delivery_output', 'delivery_revoked', 'delivery_not_issued', 'artifact_hash_mismatch',
      'operator_required', 'exclusion_not_found', 'delivery_not_found', 'document_not_found', 'client_not_found', 'work_log_too_large']) {
      expect(deliveryError({ error }), error).not.toMatch(/try again/i);
    }
  });

  it('does not send a stale bundle round a loop that cannot end', () => {
    // `issueDelivery` refuses a bundle whose revision is behind the inventory's,
    // and any sign-off, exclusion or crawl moves the revision. Refreshing and
    // pressing Issue again refuses forever; only a new bundle gets past it.
    expect(deliveryError({ error: 'document_changed' })).toMatch(/new bundle/i);
  });

  it('offers the move that can work when a file could not be stored or read', () => {
    // Storing the ZIP or a verification report failing is usually the store
    // being briefly unavailable, which remediating the document cannot fix.
    const copy = deliveryError({ error: 'artifact_not_stored' });
    expect(copy).toMatch(/try again/i);
    expect(copy).toMatch(/new bundle/i);
    expect(deliveryError({ error: 'artifact_hash_mismatch' })).toMatch(/new bundle/i);
  });

  it('describes eligibility in terms that fit signing as well as delivering', () => {
    // The sign route throws this for an excluded or unready output; a sign-off
    // is not a precondition of signing.
    const copy = deliveryError({ error: 'signoff_not_eligible' });
    expect(copy).toMatch(/exclu/i);
    expect(copy).not.toMatch(/needs[^.]*current sign-off/i);
  });

  it('does not promise the budget resets on the hour when the window may be a day', () => {
    expect(deliveryError({ error: 'document_budget_exceeded' })).not.toMatch(/on the hour/i);
  });

  it('names the limits the service actually enforces', () => {
    expect(deliveryError({ error: 'bundle_too_large' })).toContain(`${MAX_DELIVERY_BYTES / 1024 / 1024} MB`);
    expect(deliveryError({ error: 'bundle_selection_invalid' })).toContain(`${MAX_DELIVERY_DOCUMENTS}`);
  });

  it("says the server's own sentence for a spent budget, and never tells anyone to try again", () => {
    const message = 'Document work has reached its hourly limit. It resets at 14:00.';
    const copy = deliveryError({ error: 'document_budget_exceeded', message });
    expect(copy).toBe(message);
    // Without the route's sentence there is still a next step, not a code.
    expect(deliveryError({ error: 'document_budget_exceeded' })).toMatch(/capped|later/i);
  });

  it('tells a server that answered without a code apart from one that was never reached', () => {
    // A 502 with an HTML body is not "could not reach the server": it was
    // reached, and whatever it did may have happened. Refreshing is the move.
    const failed = deliveryError({ status: 502 });
    expect(failed).toContain('502');
    expect(failed).toMatch(/refresh/i);
    expect(failed).not.toMatch(/could not be reached/i);

    const unreached = deliveryError({});
    expect(unreached).toMatch(/could not be reached/i);
    expect(unreached).toMatch(/refresh/i);
  });

  it('prints an unknown code rather than inventing a sentence, and does not walk the prototype', () => {
    expect(deliveryError({ error: 'something_new' })).toBe('The action stopped: something_new.');
    expect(deliveryError({ error: '__proto__' })).toBe('The action stopped: __proto__.');
  });
});

describe('delivery queues', () => {
  it('requires a current eligible signoff for bundle selection', () => {
    expect(selectableForDelivery(row)).toBe(false);
    expect(selectableForDelivery({ ...row, signedOff: true })).toBe(true);
    expect(selectableForDelivery({ ...row, signedOff: true, eligible: false })).toBe(false);
    expect(selectableForDelivery({ ...row, signedOff: true, excluded: true })).toBe(false);
  });
  it('keeps excluded documents out of action and delivered queues', () => {
    const excluded = { ...row, excluded: true, signedOff: true, delivered: true };
    for (const queue of ['work', 'signoff', 'delivery', 'delivered'] as const) expect(inDeliveryQueue(excluded, queue)).toBe(false);
    expect(inDeliveryQueue(excluded, 'excluded')).toBe(true);
    expect(inDeliveryQueue(excluded, 'all')).toBe(true);
  });
  it('separates readiness, signoff and issuance', () => {
    expect(inDeliveryQueue(row, 'signoff')).toBe(true);
    expect(inDeliveryQueue(row, 'delivery')).toBe(false);
    expect(inDeliveryQueue({ ...row, signedOff: true }, 'delivery')).toBe(true);
    expect(inDeliveryQueue({ ...row, signedOff: true }, 'delivered')).toBe(false);
    expect(inDeliveryQueue({ ...row, eligible: false }, 'work')).toBe(true);
  });
});
