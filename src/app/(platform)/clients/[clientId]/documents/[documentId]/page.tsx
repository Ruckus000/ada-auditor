import { notFound } from 'next/navigation';
import { DocumentWorkbench } from '../../../../../platform/components/client/document-workbench';
import { getPlatformStore } from '../../../../../../integrations/persistence';
import { pairDocuments } from '../../../../../../services/document-pairing';
import { documentState, latestReading } from '../../../../../../services/document-state';
import { loadClient } from '../../load';
import { guarded } from '../../../../guard';

/**
 * One document's workbench: its punch list as a form.
 *
 * A page rather than a panel in the inventory, so it is deep-linkable and so
 * "save and open the next" can chain through the queue. Reads the store
 * directly, the way `load.ts` does: the inventory universe (pairing and
 * state are derived over the whole of it), the latest reading, and the
 * answers on record — all of which the route derives the same way, so the
 * page and the row cannot disagree about one document.
 */
export default guarded(async function DocumentWorkbenchPage({
  params,
}: {
  params: Promise<{ clientId: string; documentId: string }>;
}) {
  const { clientId, documentId } = await params;
  const detail = await loadClient(clientId);
  if (!detail) notFound();

  const platform = getPlatformStore();
  const universe = (await platform.listClientDocuments(clientId)).documents;
  const record = universe.find((doc) => doc.id === documentId);
  if (!record) notFound();

  const pairs = pairDocuments(universe);
  const sourceRef = pairs.get(record.id);
  const source = sourceRef === undefined ? undefined : universe.find((doc) => doc.id === sourceRef.id);
  const reading = latestReading(record, source);
  const answers = await platform.latestDocumentAnswers(
    clientId,
    source === undefined ? [record.id] : [record.id, source.id],
  );
  const standing = documentState(record, reading, answers);

  // The queue: the next document still needing answers, in inventory order,
  // so "save and open the next" needs no second listing.
  const answerable = universe.filter((doc) => {
    if (doc.id === record.id) return false;
    const docSource = pairs.get(doc.id);
    const docReading = latestReading(doc, docSource === undefined ? undefined : universe.find((d) => d.id === docSource.id));
    return documentState(doc, docReading, []).state === 'needs-answers';
  });

  return (
    <DocumentWorkbench
      clientId={clientId}
      document={{
        id: record.id,
        url: record.url,
        kind: record.kind,
        source: record.source,
        ...(record.foundOn === undefined ? {} : { foundOn: record.foundOn }),
        ...(sourceRef === undefined ? {} : { sourceUrl: sourceRef.url }),
      }}
      reading={
        reading === null
          ? null
          : {
              summary: reading.summary,
              at: reading.at,
              by: reading.by,
              ...(reading.inputSha256 === undefined ? {} : { inputSha256: reading.inputSha256 }),
              ...(reading.conversionId === undefined ? {} : { conversionId: reading.conversionId }),
            }
      }
      answers={answers.filter((answer) => answer.inputSha256 === reading?.inputSha256)}
      standing={{
        state: standing.state,
        open: standing.open.map((ask) => ask.id),
        waiting: standing.waiting.map((ask) => ask.id),
        expired: standing.expired,
      }}
      nextDocumentId={answerable[0]?.id ?? null}
    />
  );
});
