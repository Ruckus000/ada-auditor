import type { ActivityEvent, ActivityStore, ClientStore } from '../domain/platform';

/**
 * The activity log, as the screen needs it.
 *
 * Every row here was written by something that happened: a client added, a
 * journey recorded, a finding dismissed or reopened. The screen this replaces
 * invented an audit trail — signatures, approvals, report deliveries and
 * comment threads for eight fictional clients — which is a strange thing for a
 * product whose entire value is that its record is trustworthy.
 *
 * A run is deliberately *not* an activity event. Runs have their own table and
 * their own screens, and duplicating them here would give two records that can
 * disagree about what happened.
 */

export type ActivityRow = {
  id: string;
  actor: string;
  action: string;
  subject?: string;
  clientId?: string;
  /** Resolved for display; absent when the client has since been removed. */
  clientName?: string;
  createdAt: string;
};

export type ActivityDeps = {
  clients: ClientStore;
  activity: ActivityStore;
};

export type ActivityOptions = {
  clientId?: string;
  limit?: number;
};

export async function buildActivity(
  deps: ActivityDeps,
  options: ActivityOptions = {},
): Promise<ActivityRow[]> {
  const events = await deps.activity.listEvents({
    ...(options.clientId ? { clientId: options.clientId } : {}),
    limit: options.limit ?? 100,
  });

  const names = new Map((await deps.clients.listClients()).map((c) => [c.id, c.name]));

  return events.map((event, index) => toRow(event, index, names));
}

function toRow(
  event: ActivityEvent,
  index: number,
  names: Map<string, string>,
): ActivityRow {
  const clientName = event.clientId ? names.get(event.clientId) : undefined;

  return {
    // `id` is the store's row id where there is one. The index fallback exists
    // because the memory double does not assign them, and a React key that
    // collides silently reorders the list.
    id: String(event.id ?? `${event.createdAt ?? ''}-${index}`),
    actor: event.actor,
    action: event.action,
    ...(event.subject === undefined ? {} : { subject: event.subject }),
    ...(event.clientId === undefined ? {} : { clientId: event.clientId }),
    ...(clientName === undefined ? {} : { clientName }),
    createdAt: event.createdAt ?? '',
  };
}
