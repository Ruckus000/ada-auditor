import { currentPrincipal } from '../api/_lib/principal';
import { PlatformLocked } from '../platform/components/platform-shell';

/**
 * The gate, on the screen itself.
 *
 * This group used to be gated once, in `layout.tsx`, on the reasoning that a
 * single check cannot be forgotten by the next screen. The reasoning was
 * sound and the mechanism was not: **a layout cannot gate its children.**
 *
 * Next renders a page segment in parallel with its parent layout. A layout
 * that returns `<PlatformLocked />` instead of `{children}` removes the page
 * from the *composition* — it does not stop the page's Server Component from
 * running, and Next serialises whatever that component returned into the RSC
 * flight payload embedded in the response either way. So the portfolio query
 * ran for anonymous visitors, and the result was in the bytes:
 *
 *     curl -s http://host/          # no cookie
 *     …"clients":[{"id":"acme","name":"Acme Corp",…
 *
 * A browser showed the unlock card. `curl` showed the client list. The
 * existing test asserted on `innerText`, which is why this shipped green.
 *
 * Worse at `/reports`, where `buildReports` carries each report's live
 * `shareToken` — and those tokens are the only thing protecting the
 * unauthenticated `/r/[token]` pages. Anonymous read of that payload was a
 * working key to every published report.
 *
 * So the check has to happen before the fetch, in the thing that does the
 * fetching. A wrapper rather than two lines at the top of each function
 * because a wrapper cannot be applied *partially* — there is no way to put it
 * after the query by mistake — and because "is the default export wrapped" is
 * a property a test can check on every file in the group. That test is what
 * now carries the "a new screen cannot be added unprotected" guarantee the
 * layout was trusted with.
 *
 * The layout keeps its own check. It is what an unauthenticated visitor
 * actually sees, and it is defence in depth for anything added here later.
 */
export function guarded<Props>(
  Screen: (props: Props) => Promise<React.ReactNode>,
): (props: Props) => Promise<React.ReactNode> {
  return async function Guarded(props: Props): Promise<React.ReactNode> {
    if (!(await currentPrincipal())) {
      // Never composed — the layout above has already replaced `children`.
      // Returned rather than `null` so that a screen is still correct on its
      // own, which is the property this group turned out not to have.
      return <PlatformLocked />;
    }

    return Screen(props);
  };
}
