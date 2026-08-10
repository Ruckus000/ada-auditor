import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryPlatformStore } from '../../src/integrations/persistence/memory-platform-store';
import { buildActivity } from '../../src/services/activity-view';

let platform: MemoryPlatformStore;

beforeEach(async () => {
  platform = new MemoryPlatformStore();
  await platform.upsertClient({ id: 'acme', name: 'Acme Outfitters' });
});

function deps() {
  return { clients: platform, activity: platform };
}

describe('buildActivity', () => {
  it('is empty before anything has happened', async () => {
    // The prototype's version was never empty: it shipped with an invented
    // audit trail, which is a strange thing for a product whose value is that
    // its record is trustworthy.
    expect(await buildActivity(deps())).toEqual([]);
  });

  it('resolves the client name for display', async () => {
    await platform.recordEvent({
      clientId: 'acme',
      actor: 'Alex Reed',
      action: 'added a client',
      subject: 'Acme Outfitters',
    });

    expect((await buildActivity(deps()))[0]).toMatchObject({
      actor: 'Alex Reed',
      action: 'added a client',
      clientId: 'acme',
      clientName: 'Acme Outfitters',
    });
  });

  it('keeps an event whose client has since gone', async () => {
    // Deleting the row would rewrite history to match the present, which is
    // the one thing an audit log must never do.
    await platform.recordEvent({ clientId: 'vanished', actor: 'Alex Reed', action: 'did a thing' });

    const [row] = await buildActivity(deps());
    expect(row.clientId).toBe('vanished');
    expect(row.clientName).toBeUndefined();
  });

  it('filters to one client', async () => {
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await platform.recordEvent({ clientId: 'acme', actor: 'A', action: 'added a client' });
    await platform.recordEvent({ clientId: 'other', actor: 'A', action: 'added a client' });

    const rows = await buildActivity(deps(), { clientId: 'acme' });
    expect(rows).toHaveLength(1);
    expect(rows[0].clientId).toBe('acme');
  });

  it('gives every row a distinct key', async () => {
    // Two identical actions a millisecond apart are ordinary. A colliding React
    // key silently reorders the list, which in an audit log reads as a
    // different sequence of events.
    await platform.recordEvent({ clientId: 'acme', actor: 'A', action: 'dismissed a finding' });
    await platform.recordEvent({ clientId: 'acme', actor: 'A', action: 'dismissed a finding' });

    const ids = (await buildActivity(deps())).map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
