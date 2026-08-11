import type { Metadata } from 'next';
import { connection } from 'next/server';
import { operatorInitials } from '../../domain/operator';
import { currentPrincipal } from '../api/_lib/principal';
import { PlatformProvider } from '../platform/components/platform-provider';
import { PlatformLocked, PlatformShell } from '../platform/components/platform-shell';

export const metadata: Metadata = {
  title: 'ADA Auditor',
  description:
    'The agency worklist: a portfolio of client sites, their verdicts, findings, journeys and reports.',
};

/**
 * The chrome, and what an unauthenticated visitor sees.
 *
 * This check used to be the *only* one, on the reasoning that a single gate
 * cannot be forgotten by the next screen. It does not hold: a layout cannot
 * gate its children. Next runs a page segment in parallel with its parent
 * layout, so returning `<PlatformLocked />` here removed the page from the
 * composition while its Server Component still ran, still queried, and still
 * had its result serialised into the flight payload. `curl` with no cookie
 * returned the client list. See `guard.tsx`, which now holds the real check,
 * and the test that proves every screen in this group applies it.
 *
 * What remains here is honest: this is the screen an anonymous visitor
 * actually gets, and a second check costs nothing because `currentPrincipal()`
 * is memoised per render.
 *
 * `/console` sits outside this group and keeps its own gate; `/r/[token]` is
 * outside too and unauthenticated by design.
 *
 * There is deliberately no `<Suspense>` here. One was added because the
 * provider reads `useSearchParams`, but wrapping the whole app in a boundary
 * is the anti-pattern Next's own docs warn about twice: "place the boundary as
 * close to the hook call as possible — wrapping a large subtree forces the
 * entire subtree into the fallback", and "do not pass `{children}` through in
 * the fallback". This layout did both. It is also unnecessary: the boundary
 * only matters for routes that prerender, and `currentPrincipal()` reads
 * cookies below, which makes every route here dynamic — and on a dynamic route
 * `useSearchParams` is available during the server render.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Nothing below this line may be prerendered.
  //
  // Reading `cookies()` is supposed to be enough, and locally it was: every
  // route built as dynamic. CI built `/`, `/activity`, `/settings` and
  // `/reports` as STATIC and baked the gate's output into the shell — so the
  // build, which has no cookie, shipped the locked screen to every visitor
  // including authenticated ones. The inverse is the dangerous direction: a
  // shell prerendered from an authenticated render would serve the portfolio,
  // with real client names in it, to anyone who asked.
  //
  // `connection()` is the documented way to say "wait for an actual request",
  // and it states the requirement instead of relying on a side effect of
  // `cookies()` that turned out to be environment-dependent.
  await connection();

  const principal = await currentPrincipal();
  if (!principal) {
    return <PlatformLocked />;
  }

  // Resolved here because this is the only server component above the header,
  // and the header cannot resolve a principal for itself. The name is now the
  // signed-in operator's rather than a configured string — and for a machine
  // principal it is still that configured string, which is what keeps CI and
  // the harness rendering something sensible.
  const name = principal.name;

  return (
    <PlatformProvider operator={{ name, initials: operatorInitials(name) }}>
      <PlatformShell>{children}</PlatformShell>
    </PlatformProvider>
  );
}
