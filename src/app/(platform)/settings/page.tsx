import { readDeploymentConfig } from '../../../services/deployment-config';
import { SettingsScreen } from '../../platform/components/settings-screen';
import { guarded } from '../guard';

export default guarded(async function WorkspaceSettingsPage() {
  // Read per request rather than at module scope: the route group is dynamic,
  // and a value captured at build time would describe the builder's
  // environment rather than the running one.
  return <SettingsScreen config={readDeploymentConfig()} />;
});
