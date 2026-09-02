import { z } from 'zod';

import {
  ACCEPTS,
  MAX_ANSWER_TEXT,
  cleanOperatorText,
  type AnswerDisposition,
} from '../../../../../../../../domain/document-answers';
import { languageTagSchema } from '../../../../../../../../domain/document-structure';
import { actorFields } from '../../../../../../../../domain/operator';
import type { StoredDocumentAnswer } from '../../../../../../../../domain/platform';
import { getPlatformStore } from '../../../../../../../../integrations/persistence';
import { pairDocuments } from '../../../../../../../../services/document-pairing';
import { documentState, latestReading } from '../../../../../../../../services/document-state';
import { logInfo } from '../../../../../../../../services/logger';
import { authorizePrincipal } from '../../../../../../_lib/authorize';
import { createRequestId } from '../../../../../../_lib/request-id';

/**
 * A person's answers to one document's punch list.
 *
 * The channel through which a claim reaches a delivered file. Nothing here
 * is inferred: every answer names an ask the LATEST reading raised, is keyed
 * to the bytes that reading was of, and is attributed to the principal who
 * made it. The pipeline consumes `declared` answers on the next run; a
 * `decided` answer closes an item without touching the file; a `requested`
 * answer records that the client has been asked.
 *
 * Refusals are the contract as much as saves are: an ask the reading never
 * raised, a disposition the kind does not take, an empty description (that
 * is the decorative decision wearing a value's clothes), a language nobody
 * could resolve, and a reading that does not know its own bytes — answers
 * against unknown bytes could never be matched to a run.
 *
 * ## Logs
 *
 * Counts and kinds only. A description is document content, and the log
 * line travels further than the row.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

/** How many answers one save may carry — a page of figures, or one act on a group. */
const MAX_ANSWERS_PER_SAVE = 500;

const answerSchema = z
  .object({
    askId: z.string().min(1).max(64),
    disposition: z.enum(['declared', 'decided', 'requested']),
    value: z.string().max(MAX_ANSWER_TEXT).optional(),
    note: z.string().max(MAX_ANSWER_TEXT).optional(),
  })
  .strict();

const bodySchema = z.object({ answers: z.array(answerSchema).max(MAX_ANSWERS_PER_SAVE) }).strict();

/** What a `declared` value must be, per kind. Everything else takes none. */
function declaredValue(kind: string, raw: string | undefined): string | null {
  const value = cleanOperatorText(raw ?? '');
  if (value === '') return null;
  switch (kind) {
    case 'language':
      return languageTagSchema.safeParse(value).success ? value : null;
    case 'heading':
      // The one heading declaration the pipeline can apply: re-rank the ladder
      // onto H1, which `Finish --renumber-headings` already does.
      return value === 'start-at-h1' ? value : null;
    default:
      return value;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string; documentId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId, documentId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'expected_json_body', requestId }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  // The inventory universe rather than a by-id read: the reading a paired
  // PDF is answered against may be its source's conversion, and pairing is
  // derived over the whole inventory. Same 200-row bound the GET accepts.
  const universe = (await platform.listClientDocuments(clientId)).documents;
  const record = universe.find((doc) => doc.id === documentId);
  if (record === undefined) {
    return Response.json({ error: 'document_not_found', requestId }, { status: 404 });
  }
  const pairs = pairDocuments(universe);
  const source = pairs.get(record.id);
  const reading = latestReading(record, source === undefined ? undefined : universe.find((doc) => doc.id === source.id));
  if (reading === null) {
    return Response.json({ error: 'no_reading', requestId }, { status: 409 });
  }
  if (reading.inputSha256 === undefined) {
    // A reading stored before it recorded its bytes. Answers keyed to nothing
    // could never be matched to a run, so the honest answer is a new reading.
    return Response.json({ error: 'reading_has_no_bytes', requestId }, { status: 409 });
  }

  const asks = new Map((reading.summary.asks ?? []).map((ask) => [ask.id, ask]));
  const now = new Date().toISOString();
  const actor = actorFields(principal);
  const rows: StoredDocumentAnswer[] = [];

  for (const [index, answer] of parsed.data.answers.entries()) {
    const ask = asks.get(answer.askId);
    if (ask === undefined) {
      return Response.json({ error: 'unknown_ask', detail: answer.askId, requestId }, { status: 422 });
    }
    if (!ACCEPTS[ask.kind].includes(answer.disposition as AnswerDisposition)) {
      return Response.json(
        { error: 'disposition_not_accepted', detail: answer.askId, requestId },
        { status: 422 },
      );
    }

    let value: string | undefined;
    if (answer.disposition === 'declared') {
      const cleaned = declaredValue(ask.kind, answer.value);
      if (cleaned === null) {
        return Response.json({ error: 'invalid_request_body', detail: answer.askId, requestId }, { status: 400 });
      }
      value = cleaned;
    } else if (answer.value !== undefined) {
      // A decision or a request carries no value: a value here would be a
      // claim about the file that nothing is going to write.
      return Response.json({ error: 'invalid_request_body', detail: answer.askId, requestId }, { status: 400 });
    }
    const note = answer.note === undefined ? undefined : cleanOperatorText(answer.note) || undefined;

    rows.push({
      id: `${requestId}-${index}`,
      clientId,
      documentId: record.id,
      inputSha256: reading.inputSha256,
      askId: ask.id,
      kind: ask.kind,
      ...(ask.target === undefined ? {} : { target: ask.target }),
      disposition: answer.disposition,
      ...(value === undefined ? {} : { value }),
      ...(note === undefined ? {} : { note }),
      actor: actor.actor,
      ...(actor.actorOperatorId === undefined ? {} : { operatorId: actor.actorOperatorId }),
      declaredAt: now,
    });
  }

  await platform.saveDocumentAnswers(rows);

  const counts = {
    declared: rows.filter((row) => row.disposition === 'declared').length,
    decided: rows.filter((row) => row.disposition === 'decided').length,
    requested: rows.filter((row) => row.disposition === 'requested').length,
  };
  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: 'document_answered',
    subject: record.id,
    metadata: { answered: rows.length, ...counts, kinds: [...new Set(rows.map((row) => row.kind))] },
  });
  logInfo('document_answered', { requestId, clientId, answered: rows.length, ...counts });

  // The state this leaves the document in — the row's next word, so the
  // screen can move on without a second round trip. Answers of a paired
  // PDF and its source both count, because either row may have been the
  // one answered.
  const ids = source === undefined ? [record.id] : [record.id, source.id];
  const standing = documentState(record, reading, await platform.latestDocumentAnswers(clientId, ids));

  return Response.json(
    { requestId, saved: rows.length, state: standing.state, open: standing.open.length },
    { status: 200 },
  );
}
