import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlatformStore, getRunStore } from '../../../integrations/persistence';
import { buildSharedReport } from '../../../services/report-view';
import { SharedReportPage } from './shared-report';

/**
 * A report, readable by whoever holds the link.
 *
 * Outside the `(platform)` route group on purpose: the auth gate lives in that
 * group's layout, and this page is the one surface that is meant to be
 * reachable without a session. That is also why it is the one that most needs
 * to be careful — the token is the whole access-control story, so the page
 * shows the audit and nothing else. No navigation into the console, no client
 * list, no other runs.
 */
export const metadata: Metadata = {
  // A shared audit is not for a search index. `noindex` does not keep a leaked
  // link private, but a report that quietly turned up in search results would
  // be a breach of a client's trust that no revocation could undo.
  robots: { index: false, follow: false },
};

export default async function SharedReportRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const platform = getPlatformStore();

  const report = await buildSharedReport(token, {
    reports: platform,
    clients: platform,
    journeys: platform,
    runs: getRunStore(),
  });

  // One answer for a token that never existed, one that was revoked, and one
  // whose run has gone. Telling them apart would tell an unauthenticated
  // holder of a URL whether they once had a valid link.
  if (!report) {
    notFound();
  }

  return <SharedReportPage report={report} />;
}
