import { readDeploymentConfig } from '../../../services/deployment-config';
import { isDocumentToolchainAvailable } from '../../../integrations/documents/java-runtime';
import { isDocumentConverterAvailable } from '../../../integrations/documents/libreoffice-runtime';
import { SettingsScreen } from '../../platform/components/settings-screen';
import { guarded } from '../guard';

export default guarded(async function WorkspaceSettingsPage() {
  // Read per request rather than at module scope: the route group is dynamic,
  // and a value captured at build time would describe the builder's
  // environment rather than the running one.
  //
  // The toolchain check is resolved here rather than inside the service: it
  // asks the filesystem, and nothing in `services/` imports an integration.
  return (
    <SettingsScreen
      config={readDeploymentConfig(process.env, {
        documentToolchainAvailable: isDocumentToolchainAvailable(),
        documentConverterAvailable: isDocumentConverterAvailable(),
      })}
    />
  );
});
