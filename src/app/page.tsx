import type { Metadata } from 'next';
import { PlatformApp } from './platform/components/platform-app';

export const metadata: Metadata = {
  title: 'ADA Auditor',
  description:
    'The agency worklist: a portfolio of client sites, their verdicts, findings, journeys and reports.',
};

/**
 * `?review=1` reveals the States and Coverage tabs; `?firstRun=1` renders the
 * portfolio with no clients. Both exist so the design's own review surfaces
 * stay reachable without shipping them in the default navigation.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <PlatformApp
      showReview={params.review === '1'}
      firstRun={params.firstRun === '1'}
    />
  );
}
