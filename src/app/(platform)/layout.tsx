import type { Metadata } from 'next';
import { Suspense } from 'react';
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
 * `Suspense` wraps the provider because it reads `useSearchParams`, which opts
 * a subtree out of static rendering unless it has a boundary above it.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await hasOperatorSession())) {
    return <PlatformLocked />;
  }

  return (
    <Suspense>
      <PlatformProvider>
        <PlatformShell>{children}</PlatformShell>
      </PlatformProvider>
    </Suspense>
  );
}
