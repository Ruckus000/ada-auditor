import { notFound } from 'next/navigation';
import { setupStage } from '../../../../../services/setup-state';
import { SetupScreen } from '../../../../platform/components/setup/setup-screen';
import { loadClient } from '../load';
import { guarded } from '../../../guard';

/**
 * Stages 2–5 of onboarding, derived from the record on every render. The
 * wizard has no memory: refresh, back and deep links land on whatever stage
 * the data has earned, and a finished client sees the results summary — not a
 * redirect, so the page is idempotent.
 */
export default guarded(async function ClientSetupPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const detail = await loadClient(clientId);

  if (!detail) notFound();

  return <SetupScreen detail={detail} stage={setupStage(detail)} />;
});
