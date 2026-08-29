import { readDeploymentConfig } from '../../../services/deployment-config';
import { currentPrincipal, passkeyRelyingParty } from '../../api/_lib/principal';
import { getPlatformStore } from '../../../integrations/persistence';
import { isDocumentToolchainAvailable } from '../../../integrations/documents/java-runtime';
import { isDocumentConverterAvailable } from '../../../integrations/documents/libreoffice-runtime';
import { SettingsScreen } from '../../platform/components/settings-screen';
import { guarded } from '../guard';

export default guarded(async function WorkspaceSettingsPage() {
  // `guarded` already refused anyone without a principal, so this is a
  // narrowing rather than a second gate. A machine principal has no passkeys
  // to manage — the run token is not a person.
  const principal = await currentPrincipal();
  const passkeys =
    principal?.kind === 'operator'
      ? await getPlatformStore().listOperatorPasskeys(principal.id)
      : [];

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
      passkeys={passkeys.map((passkey) => ({
        credentialId: passkey.credentialId,
        label: passkey.label,
        createdAt: passkey.createdAt,
        ...(passkey.lastUsedAt ? { lastUsedAt: passkey.lastUsedAt } : {}),
      }))}
      passkeysAvailable={Boolean(passkeyRelyingParty())}
      showPasskeys={principal?.kind === 'operator'}
    />
  );
});
