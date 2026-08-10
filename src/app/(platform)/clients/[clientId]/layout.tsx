import { notFound } from 'next/navigation';
import { knownSlug } from '../../../platform/lib/client-slugs';

/**
 * Refuses a client that does not exist.
 *
 * Without this, `indexForSlug` falls back to index 0 and `/clients/anything`
 * renders the *first* client's overview, findings and reports under a URL
 * naming a different one. In an auditor product, showing one client's
 * accessibility findings under another client's address is the worst available
 * failure — worse than an error page, because it looks like an answer.
 *
 * It lives in a layout rather than in each page so a new tab cannot be added
 * without the check; the failure mode of per-page validation is the page
 * somebody forgot.
 */
export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  if (!knownSlug(clientId)) {
    notFound();
  }

  return <>{children}</>;
}
