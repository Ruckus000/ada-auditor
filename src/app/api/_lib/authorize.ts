import { machinePrincipal, type Principal } from '../../../domain/operator';
import { isRunAuthorized } from './auth';
import { principalFromRequest } from './principal';
import { isSameOriginConsoleRequest } from './same-origin';

/**
 * Who, if anyone, is making this request.
 *
 * This exact function was copy-pasted into four route files — clients,
 * journeys, reports and triage — each with its own copy of the reasoning in a
 * comment above it. Four copies of an authorization rule is four places to fix
 * it and four chances to fix only three.
 *
 * Two ways in, and both are needed:
 *
 *  - **Bearer token.** CI, scripts and the scheduler. Resolves to the machine
 *    principal: real, trusted, and not a person.
 *  - **Session cookie, same-origin.** The screens. A cookie alone is not
 *    enough for a state-changing request because it travels on cross-site form
 *    posts too, which is what the same-origin check stops. That check is CSRF
 *    defence only — `sec-fetch-site` and `Origin` are trustworthy from a
 *    browser and forged freely by anything else — so it never stands alone.
 *
 * The screens' auth gate (`(platform)/guard.tsx`) protects *rendering*. An API
 * route is reachable directly and has to check for itself — which is the same
 * reasoning that turned out to apply to the screens too: the gate used to live
 * in the route-group layout, and a layout cannot stop the pages beneath it
 * from running.
 */
export async function authorizePrincipal(request: Request): Promise<Principal | null> {
  if (isRunAuthorized(request)) {
    return machinePrincipal();
  }

  if (!isSameOriginConsoleRequest(request)) {
    return null;
  }

  return principalFromRequest(request);
}
