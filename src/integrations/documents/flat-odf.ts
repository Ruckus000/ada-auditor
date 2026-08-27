import type { TitleOutcome } from '../../domain/document-remediation';

/**
 * Reading and repairing a flat ODF source, as pure string transforms.
 *
 * Flat ODF (`.fodt`) is a whole document in one XML file, which is the reason
 * the conversion chain goes through it: it is the only point where the source
 * can be corrected *before* it becomes a PDF, and correcting a source is
 * categorically safer than mutating a delivered file.
 *
 * ## Why this replaces `repair-source.py`
 *
 * The spike's repair was Python — a reasonable choice there, since the standard
 * library parses XML with no dependency. It is now 99 lines doing exactly one
 * thing, and porting it removes a third language runtime from anything this
 * platform would have to deploy. Node and a JVM is already two.
 *
 * ## Why regex and not an XML parser
 *
 * Same reason the Python did. These are targeted reads and one targeted
 * insertion into metadata; a DOM parse of a multi-megabyte flat ODF buys
 * nothing here and costs a dependency. Nothing below descends into content.
 *
 * ## The rule every function here obeys
 *
 * **Copy what the document states. Never decide what it does not.** A title
 * transcribed from the document's own first heading is transcription; a title
 * built from the first line of body text is invention, and it is the same
 * mistake as guessing at alt text.
 */

/** XML entities, decoded for text we lift out of the document. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Strips tags and collapses whitespace, leaving the readable text. */
function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * The document's declared title, or null.
 *
 * Null and empty are the same answer here — `<dc:title/>` and `<dc:title>   </dc:title>`
 * both mean nobody filled it in — which is not the case for image alt text,
 * where empty is a positive claim and absent is an unanswered question. A title
 * has no equivalent of "deliberately blank".
 */
export function readTitle(xml: string): string | null {
  const match = /<dc:title>([\s\S]*?)<\/dc:title>/.exec(xml);
  if (!match) return null;
  const text = textOf(match[1] ?? '');
  return text === '' ? null : text;
}

/**
 * The text of the document's first heading, or null.
 *
 * Only a paragraph the source already marks as a heading (`<text:h>`). If the
 * document states no heading there is nothing to copy — and four of the nine
 * real municipal PDFs produce exactly zero headings, which is precisely why
 * this may not fall back to body text.
 */
export function firstHeading(xml: string): string | null {
  const match = /<text:h\b[^>]*>([\s\S]*?)<\/text:h>/.exec(xml);
  if (!match) return null;
  const text = textOf(match[1] ?? '');
  return text === '' ? null : text;
}

/**
 * The language the source declares, as a BCP-47 tag, or null.
 *
 * `[V]` This is load-bearing, and measured: LibreOffice writes `/Lang` as
 * `en-US` onto a PDF exported from a source with **every** `fo:language`
 * declaration stripped out. It also widens a declared `fo:language="en"` to
 * `en-US` on the way through. Both are claims about a document that the
 * document never made, and the second is not obviously better than the first.
 *
 * So the source is asked directly, and the export's answer is not trusted.
 * Returning null means "the source does not say" — an open question, never a
 * cue to guess.
 */
export function readLanguage(xml: string): string | null {
  const language = /fo:language="([A-Za-z]{2,3})"/.exec(xml);
  if (!language) return null;

  const tag = language[1];
  // `fo:country` is a separate attribute; pair them only when both appear on
  // the same style, which is how ODF expresses a regional variant.
  const paired = new RegExp(
    `fo:language="${tag}"[^>]*?fo:country="([A-Za-z]{2})"`,
  ).exec(xml);

  return paired ? `${tag}-${paired[1]}` : tag;
}

export type TitleRepair = {
  xml: string;
  /**
   * What happened, for the record a delivered document has to carry.
   *
   * The shape lives in `domain/document-remediation.ts`: the route and anything
   * in `services/` both need it, and neither may import an integration.
   */
  outcome: TitleOutcome;
};

/**
 * Gives the document a title, if and only if it already contains one.
 *
 * 2.4.2 is the single most common legal blocker in the real corpus — six of
 * nine documents, and the *only* thing blocking four of them. Copying the
 * document's own first heading clears it by transcription.
 *
 * When there is no heading, this declines and says so. That is not a failure to
 * handle; it is the correct answer, and the outcome is reported so the gap can
 * be surfaced rather than silently tolerated.
 */
export function repairTitle(xml: string, filenameTitle?: string | null): TitleRepair {
  const existing = readTitle(xml);
  if (existing !== null) {
    return { xml, outcome: { kind: 'already-titled', title: existing } };
  }

  // Transcription order is a policy: the document's own first heading first,
  // the author's filename second (`[V]` nine real documents had only the
  // second), the honest gap last.
  const heading = firstHeading(xml);
  const source: TitleOutcome | null =
    heading !== null
      ? { kind: 'transcribed', title: heading }
      : filenameTitle
        ? { kind: 'filename-derived', title: filenameTitle }
        : null;
  if (source === null) {
    return { xml, outcome: { kind: 'no-heading-to-copy' } };
  }

  const written = writeTitle(xml, source.title);
  if (written === null) {
    // No metadata block to write into. Reported as "nothing to copy into"
    // rather than pretending the repair happened.
    return { xml, outcome: { kind: 'no-heading-to-copy' } };
  }
  return { xml: written, outcome: source };
}

/**
 * Writes a title into the metadata block, or returns null when there is none.
 *
 * An empty `<dc:title/>` is replaced in place; otherwise the element is added
 * to the document's metadata block. Writing it anywhere else would produce a
 * file that opens and carries no title.
 */
function writeTitle(xml: string, title: string): string | null {
  const element = `<dc:title>${encodeEntities(title)}</dc:title>`;
  const empty = /<dc:title\s*\/>|<dc:title>\s*<\/dc:title>/;
  if (empty.test(xml)) {
    return xml.replace(empty, element);
  }
  if (xml.includes('<office:meta>')) {
    return xml.replace('<office:meta>', `<office:meta>${element}`);
  }
  return null;
}

/**
 * Removes headings with no text from the flat ODF, before export.
 *
 * `[V]` Measured on three real municipal documents: every heading "lost" in
 * conversion was an EMPTY one — a blank line an author left heading-styled,
 * which Word keeps, the importer partially collapses, and the PDF export
 * drops inconsistently. An empty heading is itself an accessibility defect
 * (a screen reader announces a heading and then nothing), so deleting one is
 * not loss and not invention: it removes a structure element that carried no
 * content, and it makes "headings in" equal "headings out" for every heading
 * that says something.
 *
 * Self-closing and empty-paired forms both; whitespace-only content counts
 * as empty (a heading of three spaces announces exactly as much as none).
 */
export function removeEmptyHeadings(xml: string): { xml: string; removed: number } {
  let removed = 0;
  const cleaned = xml
    .replace(/<text:h\b[^>]*\/>/g, () => {
      removed += 1;
      return '';
    })
    .replace(/<text:h\b[^>]*>([\s\S]*?)<\/text:h>/g, (whole, inner: string) => {
      if (inner.replace(/<[^>]+>/g, '').trim() === '') {
        removed += 1;
        return '';
      }
      return whole;
    });
  return { xml: cleaned, removed };
}

/**
 * Caption shapes an author actually writes. Conservative on purpose: a
 * paragraph that merely FOLLOWS an image is not a description of it, but one
 * beginning "Figure 3:" or "Photo —" exists for no other reason.
 */
const CAPTION_SHAPE =
  /^\s*(?:figure|fig\.?|photo(?:graph)?|image|map|chart|illustration|exhibit)\b[\s\S]{0,300}$/i;

/**
 * Transcribes an adjacent caption into an image's alternative description.
 *
 * The same move as title-from-heading: the author already described the
 * image — in a caption a sighted reader sees beside it — and transcribing
 * that description into `svg:desc` (which the tagged-PDF export carries into
 * `/Alt` — `[V]` verified empirically, and only when the element sits before
 * the frame's close tag) moves it where assistive technology can reach.
 * Images with no caption are left alone: their absence of a description is a
 * fact for the punch list, not something to paper over. The VLM ban stands —
 * nothing here generates a description.
 */
export function deriveAltFromCaptions(xml: string): { xml: string; derived: number } {
  let derived = 0;
  const out = xml.replace(
    /(<draw:frame\b[^>]*>)([\s\S]*?)(<\/draw:frame>)(\s*(?:<\/text:p>)?\s*<text:p[^>]*>)([\s\S]*?)(<\/text:p>)/g,
    (whole, open: string, inner: string, close: string, between: string, para: string, paraClose: string) => {
      if (/<svg:(?:desc|title)>/.test(inner)) {
        return whole;
      }
      const caption = para.replace(/<[^>]+>/g, '').trim();
      if (caption === '' || !CAPTION_SHAPE.test(caption)) {
        return whole;
      }
      derived += 1;
      // No re-encoding: `caption` was cut FROM this XML with only tags
      // stripped, so its entities (&amp; and friends) are already in valid
      // XML form — encoding again would deliver "&amp;amp;" to a reader.
      return `${open}${inner}<svg:desc>${caption}</svg:desc>${close}${between}${para}${paraClose}`;
    },
  );
  return { xml: out, derived };
}
