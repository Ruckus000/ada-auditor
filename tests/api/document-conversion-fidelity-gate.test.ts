import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { DocumentStructure } from '../../src/domain/document-structure';
import type { SourceTruth } from '../../src/domain/source-truth';

/**
 * The gate, end to end — proving it FIRES, not just that it classifies.
 *
 * `source-fidelity.test.ts` proves `fidelityDefects` sorts inputs correctly and
 * `fidelity-fires.test.ts` proves no branch is blind. Neither proves the wiring:
 * that a delivered document claiming more than its source actually reaches a
 * refusal through `remediateWordBytes`. Until something watches that happen,
 * "0 assertions across 31 documents" is indistinguishable from a gate that
 * cannot produce an assertion under any input.
 *
 * That failure has a precedent in this project and it is recent. A change that
 * took conformant deliveries from 19 to 0 passed its whole campaign green,
 * because nothing asserted a document should come back conformant — silence
 * read as success. This file is the assertion that stops the same shape here.
 *
 * The conversion is stubbed rather than run, deliberately. The pipeline does not
 * invent structure — that is the finding, and it is why the real corpus reports
 * zero. Forging the divergence is the only way to see the gate work, and the
 * wiring is what is under test, not LibreOffice.
 */

const { convertSourceToPdf } = vi.hoisted(() => ({ convertSourceToPdf: vi.fn() }));
vi.mock('../../src/integrations/documents/convert', () => ({ convertSourceToPdf }));

const { checkUa1 } = vi.hoisted(() => ({ checkUa1: vi.fn() }));
vi.mock('../../src/integrations/documents/verapdf', () => ({ checkUa1 }));

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ logWarn, logInfo: vi.fn(), logError: vi.fn() }));

/**
 * The declare pass, stubbed — only the answers cases reach it.
 *
 * An operator's declared language sends `remediateWordBytes` through a second
 * `Finish` and a re-read before the fidelity check, and both want a JVM. The
 * stub writes the file the caller will `rename`, and hands back whatever
 * reading the case asked for, because what is under test is which REFERENCE
 * the gate compares against — not whether Java can write a tag.
 */
const { finishDocument, inspectDocument } = vi.hoisted(() => ({
  finishDocument: vi.fn(),
  inspectDocument: vi.fn(),
}));
vi.mock('../../src/integrations/documents/finish', () => ({ finishDocument }));
vi.mock('../../src/integrations/documents/inspect', () => ({ inspectDocument }));

const { remediateWordBytes } = await import('../../src/app/api/_lib/document-conversion');

const structure = (over: Partial<DocumentStructure> = {}): DocumentStructure => ({
  structureElements: 20,
  marked: true,
  signed: false,
  // Required since this fixture was written; a reading cannot omit them.
  encrypted: false,
  formFields: 0,
  formFieldsWithoutName: 0,
  embeddedFiles: 0,
  annotationsNotInStructure: 0,
  textChars: 800,
  images: 0,
  pages: 1,
  lang: 'en-US',
  title: 'Agenda',
  headings: ['H1'],
  headingTexts: [],
  figures: [],
  tables: [],
  lists: [],
  order: [],
  ...over,
});

const truth = (over: Partial<Extract<SourceTruth, { readable: true }>> = {}): SourceTruth => ({
  readable: true,
  oracle: 'ooxml',
  title: 'Agenda',
  language: 'en-US',
  headings: 1,
  headingLevels: [1],
  tables: 0,
  lists: 0,
  listItems: 0,
  figures: 0,
  figuresWithAlt: 0,
  ...over,
});

function conversionReturning(
  delivered: DocumentStructure,
  sourceTruth: SourceTruth,
  sourceLanguage: string | null = 'en-US',
) {
  convertSourceToPdf.mockImplementation(async (_src: string, out: string) => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(out, Buffer.from('%PDF-1.7\n%%EOF\n'));
    return {
      ok: true,
      pdfPath: out,
      provenance: {
        title: { kind: 'already-titled' as const, title: 'Agenda' },
        sourceLanguage,
        structure: delivered,
        sourceTruth,
      },
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkUa1.mockResolvedValue({ checker: 'verapdf-ua1', compliant: true });
  finishDocument.mockImplementation(async (request: { outputPath: string }) => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(request.outputPath, Buffer.from('%PDF-1.7\n%%EOF\n'));
    return { ok: true };
  });
});

describe('the fidelity gate refuses a delivered document that claims more than its source', () => {
  it('fires on a title that is not the one the source declared', async () => {
    conversionReturning(
      structure({ title: 'Something Else' }),
      truth({ title: 'Budget Hearing' }),
    );

    const outcome = await remediateWordBytes(new Uint8Array([1, 2, 3]), 'docx', 'req-title');

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal.status).toBe(422);
      expect(outcome.refusal.detail).toBe('fidelity-assertion');
    }
  });

  it('fires on a language that disagrees with the source', async () => {
    conversionReturning(structure({ lang: 'cy' }), truth({ language: 'en-US' }));

    const outcome = await remediateWordBytes(new Uint8Array([1]), 'docx', 'req-lang2');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.detail).toBe('fidelity-assertion');
  });

  it('fires on a language the source never declared', async () => {
    conversionReturning(structure({ lang: 'en-US' }), truth({ language: null }));

    const outcome = await remediateWordBytes(new Uint8Array([1]), 'docx', 'req-lang');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.detail).toBe('fidelity-assertion');
  });

  /**
   * The same shape, one difference: a PERSON supplied the language.
   *
   * The case above and this one are indistinguishable from inside
   * `source-fidelity.ts` — a source declaring nothing, a delivered document
   * carrying `en-US`. Only the caller knows which, and the gate refused both
   * until it was told. `applyDeclarations` writes the answer onto the
   * structure and `CONTENT_FIELDS` omits `lang` so the content gate passes it,
   * which is exactly why nothing else caught this.
   *
   * The 3.1.1 language ask is the cheapest item on the punch list and the one
   * operators answer most, so the refusal would have landed on the product's
   * commonest path — and blamed the pipeline for a transcription a person
   * supplied.
   */
  it('does NOT fire on a language an operator declared', async () => {
    // The real shape: the source declares nothing, so the converted file
    // carries nothing either — which is the precondition `applyDeclarations`
    // checks before it will accept a language answer at all.
    conversionReturning(structure({ lang: null }), truth({ language: null }), null);
    // What the declare pass writes: the answer, on the delivered reading.
    inspectDocument.mockResolvedValue({ ok: true, value: structure({ lang: 'en-US' }) });

    // Answers are keyed to the exact bytes they were written against, so the
    // fixture has to carry the real digest or it never reaches the gate.
    const bytes = new Uint8Array([1]);
    const { createHash } = await import('node:crypto');
    const inputSha256 = createHash('sha256').update(bytes).digest('hex');

    const outcome = await remediateWordBytes(bytes, 'docx', 'req-lang-declared', {
      answers: { inputSha256, language: 'en-US', figures: [] },
    });

    expect(outcome.ok).toBe(true);
  });

  it('logs the refusal with criteria only, never document text', async () => {
    conversionReturning(
      structure({ title: 'A Confidential Permit Applicant' }),
      truth({ title: 'A Different Confidential Name' }),
    );

    await remediateWordBytes(new Uint8Array([1]), 'docx', 'req-log');

    expect(logWarn).toHaveBeenCalledWith(
      'document_remediation_fidelity_assertion',
      expect.objectContaining({ requestId: 'req-log', criteria: expect.arrayContaining(['2.4.2']) }),
    );
    // The document's own words may not reach a log line, which persists and
    // travels where a response does not.
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain('Permit Applicant');
  });
});

describe('the gate does NOT refuse what it should let through', () => {
  it('delivers a faithful conversion', async () => {
    conversionReturning(structure(), truth());

    const outcome = await remediateWordBytes(new Uint8Array([1]), 'docx', 'req-ok');
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    expect(outcome.ok).toBe(true);
  });

  it('delivers when the delivered document reads as MORE structure than the source', async () => {
    // `[V]` The count rows do not gate: the source read is a lower bound, and
    // it has been short four times in a week. Blind corpus r28 (headings) and
    // r34 (list items) were both refused by an under-count, and in r28's case a
    // lost heading was reported as an invented one.
    conversionReturning(
      structure({ headings: ['H1', 'H2', 'H2'], tables: [{ th: 0, td: 2, tr: 1, cells: [] }] }),
      truth({ headings: 1, headingLevels: [1], tables: 0 }),
    );

    const outcome = await remediateWordBytes(new Uint8Array([1]), 'docx', 'req-more');
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.summary.needs?.some((n) => n.criterion === '1.3.1')).toBe(true);
    }
  });

  it('delivers a document that LOST structure, and says so on the punch list', async () => {
    // Delivered-fewer-than-source is an omission, never an assertion. This is
    // the asymmetry that lets the gate be strict without refusing the benign
    // restructuring a converter legitimately does.
    conversionReturning(structure({ headings: [] }), truth({ headings: 2, headingLevels: [1, 2] }));

    const outcome = await remediateWordBytes(new Uint8Array([1]), 'docx', 'req-lost');
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.summary.needs?.some((n) => n.criterion === '1.3.1')).toBe(true);
    }
  });

  it('delivers when an engine-derived reading disagrees, because a weaker oracle may not gate', async () => {
    conversionReturning(
      structure({ figures: [{ type: 'Figure', alt: null, actualText: null, page: null }] }),
      truth({ oracle: 'engine-derived', figures: 0 }),
    );

    const outcome = await remediateWordBytes(new Uint8Array([1]), 'docx', 'req-doc');
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    expect(outcome.ok).toBe(true);
  });

  it('delivers when there was no source reading at all', async () => {
    conversionReturning(structure({ headings: ['H1', 'H2', 'H3'] }), { readable: false });

    const outcome = await remediateWordBytes(new Uint8Array([1]), 'docx', 'req-none');
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    if (!outcome.ok) console.log("REFUSAL:", JSON.stringify(outcome.refusal));
    expect(outcome.ok).toBe(true);
  });
});
