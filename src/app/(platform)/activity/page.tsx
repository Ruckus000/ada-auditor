import { getPlatformStore } from '../../../integrations/persistence';
import { buildActivity } from '../../../services/activity-view';
import { ActivityScreen } from '../../platform/components/activity-screen';

export default async function WorkspaceActivityPage() {
  const platform = getPlatformStore();
  const rows = await buildActivity({ clients: platform, activity: platform });

  return <ActivityScreen rows={rows} />;
}
