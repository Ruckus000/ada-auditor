import { describe, expect, it } from 'vitest';
import { deliveryError, inDeliveryQueue, selectableForDelivery, type DeliveryRow } from '../../src/services/presentation/document-delivery';
const row: DeliveryRow = { documentId: 'd1', url: 'https://example.test/a.pdf', reason: null, excluded: false, signedOff: false, delivered: false, eligible: true };
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
  it('retains actionable refusal and request identity', () => {
    expect(deliveryError('document_changed', 'req-1')).toContain('Refresh');
    expect(deliveryError('document_changed', 'req-1')).toContain('request req-1');
    expect(deliveryError('unknown', 'req-2')).toContain('unknown; request req-2');
  });
});
