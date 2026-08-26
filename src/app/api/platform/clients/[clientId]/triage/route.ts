import { z } from 'zod';
import { actorFields } from '../../../../../../domain/operator';
import { MAX_TRIAGE_NOTE } from '../../../../../../domain/platform';
import type { TriageState } from '../../../../../../domain/platform';
import { getPlatformStore } from '../../../../../../integrations/persistence';
import { authorizePrincipal } from '../../../../_lib/authorize';
import { createRequestId } from '../../../../_lib/request-id';


/**
 * `source:code:pageUrl:selector`, produced by `findingKey`.
 *
 * Only the first two segments are recoverable from it. A page URL contains
 * colons and so does a selector (`a[href^="mailto:"]`), so splitting the tail
 * is guesswork — and guessing wrong files the decision against a selector that
 * matches nothing, which means the dismissal silently never applies. The
 * caller sends those two fields explicitly instead; they are stored for
 * display and for the regression diff, while the key alone does the joining.
 */
const KEY = /^[^:]+:[^:]+:.*$/;

const triageSchema = z
  .object({
    findingKey: z.string().min(3).max(2048).regex(KEY, 'findingKey must be source:code:page:selector'),
    // `fixed` is deliberately not in this union — see the note above.
    state: z.enum(['dismissed', 'accepted-risk', 'assigned']),
    note: z.string().trim().max(MAX_TRIAGE_NOTE).optional(),
    assignee: z.string().trim().max(120).optional(),
    assigneeOperatorId: z.string().trim().max(64).optional(),
    pageUrl: z.string().max(2048).optional(),
    selector: z.string().max(1024).optional(),
  })
  // Both note-bearing decisions, not just dismissal: an accepted risk with no
  // basis given is the record an auditor would have to defend, and there would
  // be nothing in it.
  .refine((value) => value.state === 'assigned' || (value.note?.length ?? 0) > 0, {
    message: 'that decision has to say why',
    path: ['note'],
  })
  .refine((value) => value.state !== 'assigned' || (value.assignee?.length ?? 0) > 0, {
    message: 'an assignment has to name somebody',
    path: ['assignee'],
  });

/**
 * What the activity feed records for each decision.
 *
 * A `Record`, so a fourth `TriageState` cannot inherit a third state's
 * sentence. The two-way ternary this replaces logged an accepted risk as
 * "dismissed a finding" — the opposite of what the operator decided, written
 * into a log that is only ever appended to.
 *
 * These words stay in the route rather than moving to
 * `services/presentation/triage.ts` with the rest of the vocabulary. The
 * screens' wording is a copy decision and may be edited; an audit record's is
 * not, and putting it beside the labels would make it editable by a copy pass
 * that never thought about the log.
 */
const EVENT_ACTION: Record<TriageState, string> = {
  dismissed: 'dismissed a finding',
  'accepted-risk': 'accepted the risk on a finding',
  assigned: 'assigned a finding',
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  let parsed: z.infer<typeof triageSchema>;
  try {
    parsed = triageSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  // A dangling assignee is worse than none: the finding would read as handled
  // by somebody who does not exist, and the foreign key would reject it in
  // Postgres while the in-memory double accepted it.
  if (parsed.assigneeOperatorId) {
    const assignee = await platform.getOperator(parsed.assigneeOperatorId);
    if (!assignee || assignee.disabledAt) {
      return Response.json({ error: 'unknown_assignee', requestId }, { status: 422 });
    }
  }

  const [source, code] = parsed.findingKey.split(':');

  await platform.setTriage({
    clientId,
    findingKey: parsed.findingKey,
    source,
    code,
    ...(parsed.pageUrl ? { pageUrl: parsed.pageUrl } : {}),
    ...(parsed.selector ? { selector: parsed.selector } : {}),
    state: parsed.state,
    ...(parsed.note ? { note: parsed.note } : {}),
    ...(parsed.assignee ? { assignee: parsed.assignee } : {}),
    ...(parsed.assigneeOperatorId ? { assigneeOperatorId: parsed.assigneeOperatorId } : {}),
    ...actorFields(principal),
  });

  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: EVENT_ACTION[parsed.state],
    subject: code,
    metadata: { findingKey: parsed.findingKey, state: parsed.state },
  });

  return Response.json({ requestId, findingKey: parsed.findingKey, state: parsed.state }, { status: 200 });
}

const clearSchema = z.object({
  findingKey: z.string().min(3).max(2048),
});

/** Undo. The decision goes; the finding stays, because the run still reports it. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  let parsed: z.infer<typeof clearSchema>;
  try {
    parsed = clearSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  await platform.clearTriage(clientId, parsed.findingKey);

  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: 'reopened a finding',
    metadata: { findingKey: parsed.findingKey },
  });

  return Response.json({ requestId, findingKey: parsed.findingKey }, { status: 200 });
}
