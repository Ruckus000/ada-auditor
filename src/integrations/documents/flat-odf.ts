import { isPlaceholderTitle, type TitleOutcome } from '../../domain/document-remediation';

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

/**
 * What is left of a fragment once its tags are gone — the text a reader
 * meets, plus an image's `svg:desc` / `svg:title`, which are text to a reader
 * too.
 *
 * A flat ODF embeds every image inline as base64 inside `office:binary-data`,
 * and that payload is not text: with it left in, a heading holding nothing
 * but an image read as thousands of characters long, and `[V]` a planted
 * undescribed image-only heading was delivered as a heading over an
 * undescribed figure — the exact structure this file exists to keep honest.
 */
function readableText(fragment: string): string {
  return fragment
    .replace(/<office:binary-data>[\s\S]*?<\/office:binary-data>/g, '')
    .replace(/<[^>]+>/g, '');
}

/** Strips tags and collapses whitespace, leaving the readable text. */
function textOf(fragment: string): string {
  return decodeEntities(readableText(fragment)).replace(/\s+/g, ' ').trim();
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
  // Same policy as the filename chain below, and as the PDF repair path: a
  // placeholder an exporter wrote is not a title, and letting it stand would
  // outrank the document's own first heading with a string that tells a reader
  // nothing.
  if (existing !== null && !isPlaceholderTitle(existing)) {
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
 *
 * "No text" is decided after stripping tags, and an image's description
 * survives that: the importer lands a Word `descr` in `svg:desc` (and a
 * `title` in `svg:title`), so a heading whose only run is a described image
 * says something, stays a heading, and exports as /H over a /Figure carrying
 * that /Alt — `[V]` r28 delivers exactly that. The key author's emptiness
 * test must agree with this one; r28 is the document that showed it did not.
 *
 * A heading whose only run is an UNDESCRIBED image strips to nothing (once
 * the image's inline base64 is discounted — see `readableText`; before that
 * discount the payload read as text and `[V]` w20's undescribed image-only
 * heading was delivered as a heading, three against a key of two). Deleting
 * it would delete the author's figure with it — the one figure most in need
 * of the punch list would be the one that never reached it. So a heading
 * that holds a `draw:frame` is demoted to a paragraph instead: the structure
 * it announced goes, the image stays, and the missing description surfaces
 * as a `1.1.1` item like any other.
 */
export function removeEmptyHeadings(xml: string): { xml: string; removed: number } {
  let removed = 0;
  const cleaned = xml
    .replace(/<text:h\b[^>]*\/>/g, () => {
      removed += 1;
      return '';
    })
    .replace(/<text:h\b([^>]*)>([\s\S]*?)<\/text:h>/g, (whole, attrs: string, inner: string) => {
      if (readableText(inner).trim() !== '') return whole;
      if (/<draw:frame\b/.test(inner)) {
        // The outline level AND the style name go. `[V]` A `text:p` still
        // styled `Heading_20_2` is exported as /H2 anyway, because the style
        // carries `style:default-outline-level="2"` and the importer reads a
        // paragraph's level from its style when the tag does not say — the
        // first version of this demotion kept the style and w20 delivered
        // three headings. With no style the paragraph takes the default one,
        // which has no level. Nothing visual is lost: the paragraph's only
        // content is the image.
        return `<text:p${attrs.replace(/\s+text:(?:outline-level|style-name)="[^"]*"/g, '')}>${inner}</text:p>`;
      }
      removed += 1;
      return '';
    });
  return { xml: cleaned, removed };
}

/**
 * Caption shapes an author actually writes. Conservative on purpose: a
 * paragraph that merely FOLLOWS an image is not a description of it, but one
 * beginning "Figure 3:" or "Photo —" exists for no other reason.
 *
 * A LABEL is required, not just the keyword. Starting with the keyword alone
 * matched ordinary prose: `[V]` "Map of the district was circulated to
 * members." became an image's description — a sentence the author wrote about
 * the meeting, asserted as a description of a picture. That is worse than no
 * description at all, because it also silences the `1.1.1` punch item that
 * would have reported the figure as undescribed, so nobody ever finds out.
 *
 * So the keyword must be followed by a reference — a number or letter
 * ("Figure 3", "Exhibit A") — or by a delimiter that marks a label ("Photo —",
 * "Map:"). Both are the shape of something written to name a figure rather
 * than to say something.
 *
 * The trade is stated rather than hidden: a bare descriptive caption ("Map of
 * the district") is no longer transcribed, and that image now reaches the
 * punch list as undescribed. A missing description is an honest gap a person
 * can fill; an invented one is a claim nobody can find. Distinguishing "Map of
 * the district" from "Map of the district was circulated to members." needs a
 * finite verb, which is the judgement `1.4.1` and heading promotion both
 * refused to make.
 */
const CAPTION_LABEL = String.raw`(?:\s*(?:\d{1,3}|[A-Za-z])\b\s*[:.\u2013\u2014-]?|\s*[:.\u2013\u2014-])`;
const CAPTION_SHAPE = new RegExp(
  String.raw`^\s*(?:figure|fig\.?|photo(?:graph)?|image|map|chart|illustration|exhibit)\b`
  + CAPTION_LABEL
  + String.raw`\s*\S[\s\S]{0,300}$`,
  'i',
);

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
