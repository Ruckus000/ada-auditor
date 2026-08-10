import { z } from 'zod';
import { operatorName } from '../../../../../../domain/operator';
import { getPlatformStore } from '../../../../../../integrations/persistence';
import { hasOperatorSession } from '../../../../_lib/operator-session';
import { isRunAuthorized } from '../../../../_lib/auth';
import { isSameOriginConsoleRequest } from '../../../../_lib/same-origin';
import { createRequestId } from '../../../../_lib/request-id';

/**
 * One human decision about one defect.
 *
 * The findings screen has shown triage since it was built — a dismissed
 * finding renders dimmed with its reason — but nothing could write it, so the
 * whole column was theoretical. This is that write.
 *
 * There is no `fixed` state and this route will not accept one. A finding is
 * fixed when the next run stops reporting it; storing that as a human decision
 * lets the flag and the evidence contradict each other, and when they do the
 * evidence is right.
 */
async function authorize(request: Request): Promise<boolean> {
  if (isRunAuthorized(request)) {
    return true;
  }
  // A cookie alone is not enough for a state-changing request: it travels on
  // cross-site form posts too.
  return isSameOriginConsoleRequest(request) && (await hasOperatorSession());
}

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
    note: z.string().trim().max(2000).optional(),
    assignee: z.string().trim().max(120).optional(),
    pageUrl: z.string().max(2048).optional(),
    selector: z.string().max(1024).optional(),
  })
  .refine((value) => value.state === 'assigned' || (value.note?.length ?? 0) > 0, {
    message: 'a dismissal has to say why',
    path: ['note'],
  })
  .refine((value) => value.state !== 'assigned' || (value.assignee?.length ?? 0) > 0, {
    message: 'an assignment has to name somebody',
    path: ['assignee'],
  });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  if (!(await authorize(request))) {
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
    actor: operatorName(),
  });

  await platform.recordEvent({
    clientId,
    actor: operatorName(),
    action: parsed.state === 'assigned' ? 'assigned a finding' : 'dismissed a finding',
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

  if (!(await authorize(request))) {
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
    actor: operatorName(),
    action: 'reopened a finding',
    metadata: { findingKey: parsed.findingKey },
  });

  return Response.json({ requestId, findingKey: parsed.findingKey }, { status: 200 });
}
