import { getPlatformStore } from '../../../../integrations/persistence';
import { authorizePrincipal } from '../../_lib/authorize';
import { createRequestId } from '../../_lib/request-id';

/**
 * The people a finding can be assigned to.
 *
 * `finding_triage.state` has always allowed `assigned`, and the route has
 * always accepted an assignee — but nothing offered the control, because there
 * was nobody to point at. This is what closes that gap.
 *
 * Disabled operators are left out. Assigning work to somebody who cannot sign
 * in produces a finding that looks handled and is not. They stay resolvable by
 * id, so an existing assignment still renders their name.
 *
 * The store never returns a password hash from this call — asserted in the
 * shared store contract rather than trusted, because this response is exactly
 * where such a leak would surface.
 */
export async function GET(request: Request) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const operators = (await getPlatformStore().listOperators())
    .filter((operator) => !operator.disabledAt)
    .map((operator) => ({ id: operator.id, name: operator.name, email: operator.email }));

  return Response.json({ requestId, operators, count: operators.length }, { status: 200 });
}
