import { notFound } from 'next/navigation';
import { ClientShell } from '../../../platform/components/client/client-shell';
import { loadClient } from './load';
import { guarded } from '../../guard';

/**
 * Refuses a client that does not exist.
 *
 * It lives in a layout rather than in each page so a new tab cannot be added
 * without the check; the failure mode of per-page validation is the page
 * somebody forgot. This used to test the slug against the fixture list, whose
 * lookup fell back to the *first* client — so `/clients/anything` rendered one
 * client's findings under another client's address. In an auditor product that
 * is the worst available failure, because it looks like an answer.
 */
export default guarded(async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const detail = await loadClient(clientId);

  if (!detail) {
    notFound();
  }

  return <ClientShell detail={detail}>{children}</ClientShell>;
});
