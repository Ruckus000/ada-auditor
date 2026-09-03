import { isDocumentConverterAvailable } from '../../../integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../integrations/documents/java-runtime';
import { RemediateFileScreen } from '../../platform/components/remediate-file-screen';
import { guarded } from '../guard';

export default guarded(async function WorkspaceRemediatePage() {
  const java = resolveJavaRuntime();

  return (
    <RemediateFileScreen
      toolchain={java.available ? { available: true } : { available: false, reason: java.reason }}
      converter={isDocumentConverterAvailable()}
    />
  );
});
