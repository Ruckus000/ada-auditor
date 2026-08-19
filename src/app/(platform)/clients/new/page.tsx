import { getPlatformStore } from '../../../../integrations/persistence';
import { NewClientScreen } from '../../../platform/components/setup/new-client-screen';
import { guarded } from '../../guard';

/**
 * Stage 1 of onboarding: the client. A route rather than a modal so it can be
 * linked, resumed and tested like every other screen — and so browser-back
 * from the setup stages has somewhere honest to land.
 */
export default guarded(async function NewClientPage() {
  // For the duplicate hint only. Names are not secrets to an operator who can
  // already read the whole portfolio.
  const clients = await getPlatformStore().listClients();

  return <NewClientScreen existingNames={clients.map((client) => client.name)} />;
});
