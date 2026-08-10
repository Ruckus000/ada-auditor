import type { Metadata } from 'next';
import { connection } from 'next/server';
import { hasOperatorSession } from '../api/_lib/operator-session';
import { PlatformProvider } from '../platform/components/platform-provider';
import { PlatformLocked, PlatformShell } from '../platform/components/platform-shell';

export const metadata: Metadata = {
  title: 'ADA Auditor',
  description:
    'The agency worklist: a portfolio of client sites, their verdicts, findings, journeys and reports.',
};

/**
 * The gate, and the chrome.
 *
 * Checked here rather than in each page so a new screen cannot be added
 * unprotected — the failure mode of per-page auth is the page somebody forgot.
 * `/console` sits outside this group and keeps its own gate; `/r/[token]` is
 * outside too and unauthenticated by design.
 *
 * There is deliberately no `<Suspense>` here. One was added because the
 * provider reads `useSearchParams`, but wrapping the whole app in a boundary
 * is the anti-pattern Next's own docs warn about twice: "place the boundary as
 * close to the hook call as possible — wrapping a large subtree forces the
 * entire subtree into the fallback", and "do not pass `{children}` through in
 * the fallback". This layout did both. It is also unnecessary: the boundary
 * only matters for routes that prerender, and `hasOperatorSession()` reads
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

  if (!(await hasOperatorSession())) {
    return <PlatformLocked />;
  }

  return (
    <PlatformProvider>
      <PlatformShell>{children}</PlatformShell>
    </PlatformProvider>
  );
}
