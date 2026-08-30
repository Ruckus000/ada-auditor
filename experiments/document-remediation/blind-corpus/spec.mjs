/**
 * The blind corpus, as one list of rows.
 *
 * Each row produces BOTH the document and its answer key, so the two cannot
 * drift: a corpus where the key says one thing and the bytes another produces
 * failures that are indistinguishable from product defects, and the campaign
 * spends its time proving the corpus rather than the product.
 *
 * ## What a key claims, and what it deliberately does not
 *
 * `needs` is an EXACT multiset of the criteria our own instrument should
 * voice — `3.1.1`, `1.3.1`, `1.1.1`, `2.4.10`. Those are predictable from what
 * is planted, so they are predicted exactly.
 *
 * Punch items derived from veraPDF clauses are NOT enumerated here. Which
 * clauses a hand-built PDF fails is the checker's business and guessing it
 * would author a key from imagination. They are held to a PROPERTY instead,
 * enforced by the scorer on every delivery: every failing clause must be
 * voiced — by a named family, by suppression because one of our own items
 * already says it, or by the catch-all. That property is the promise the
 * product makes; an exact clause list would be a weaker check that also
 * happened to be a guess.
 *
 * `weight: 'probe'` marks a row whose expected outcome is an open question
 * rather than a claim the product makes. A probe miss is data, not a failure.
 */

/** New prose. Not one sentence of the Arm A corpus, which this pipeline was tuned on. */
const BODY = 'Applications close at the end of the month and late submissions are held for the following cycle.';
const BODY2 = 'Questions about eligibility go to the program desk, which answers in the order received.';

const rows = [];
const add = (row) => {
  rows.push(row);
  return row;
};

// ---------------------------------------------------------------- the door
//
// These rows test the door rather than the pipeline: what the product accepts
// and what it turns away before any toolchain is asked to do anything. Most
// mutate the REQUEST rather than the document, so they share one ordinary
// file and differ in how it is sent.

const door = (id, tests, request, status, opts = {}) =>
  add({ id, tests, kind: 'door', weight: 'core', request, expected: { status }, ...opts });

door('d01-no-auth', 'No credential at all is refused before anything is read.', { auth: 'none' }, 401);
door('d02-bad-token', 'A wrong credential is refused, and the refusal says nothing about the document.', { auth: 'wrong' }, 401);
door('d03-not-multipart', 'A JSON body where a form was expected.', { body: 'json' }, 400);
door('d04-wrong-field', 'The file arrives under the wrong part name.', { field: 'document' }, 400);
door('d05-two-file-parts', 'Two parts both named file — whatever it does, it must be deterministic.', { field: 'duplicate' }, 200, {
  weight: 'probe',
  expected: { statusOneOf: [200, 400] },
});
door('d06-empty-part', 'A file part carrying no bytes.', { build: 'empty' }, 415, {
  weight: 'probe',
  expected: { statusOneOf: [400, 415, 422] },
});
door('d07-text-named-pdf', 'Plain text wearing a .pdf extension: the name is not evidence.', { build: 'text-named-pdf' }, 415);
door('d08-magic-late', 'The PDF marker appears past the window the sniffer reads.', { build: 'magic-late' }, 415);
door('d09-zip-no-types', 'A ZIP with no [Content_Types].xml is not an OOXML package.', { build: 'zip-plain' }, 415);
door('d10-xlsx-like', 'An OOXML package with no word/ part is a spreadsheet, not a document.', { build: 'xlsx-like' }, 415);
door('d11-oversize', 'A document past the size cap is refused on the cap, not on its contents.', { build: 'oversize' }, 413);

// ------------------------------------------------------------ the PDF path

const pdfRow = (id, tests, build, expected, opts = {}) =>
  add({ id, tests, kind: 'pdf', weight: 'core', build, expected, ...opts });

pdfRow(
  'p01-tagged-titled',
  'The ordinary good case: tagged, titled, a language, a heading ladder that starts at H1.',
  { fn: 'structured', args: { title: 'Program Notice', lang: 'en-US', elements: [
    { type: 'H1', text: 'Program Notice' }, { type: 'H2', text: 'Eligibility' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Program Notice', language: 'en-US',
    counts: { pages: 1, headings: 2, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

pdfRow(
  'p02-title-from-heading',
  'No title in the document information, but a first heading to transcribe one from.',
  { fn: 'structured', args: { title: null, lang: 'en-US', elements: [
    { type: 'H1', text: 'Drainage Assessment' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'transcribed', titleText: 'Drainage Assessment', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

pdfRow(
  'p03-nothing-to-title-with',
  'No title, no heading, and a filename that is a scanner serial number rather than a name.',
  { fn: 'structured', args: { title: null, lang: 'en-US', elements: [{ type: 'P', text: BODY }] }, filename: 'scan_0001.pdf' },
  { disposition: 'delivered', title: 'no-heading-to-copy', titleText: null, language: 'en-US',
    counts: { pages: 1, headings: 0, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: ['2.4.2'] },
  { weight: 'probe' },
);

pdfRow(
  'p04-junk-docinfo-title',
  'The title an exporter left behind. A heading exists to transcribe instead.',
  { fn: 'structured', args: { title: 'Microsoft Word - Document1.docx', lang: 'en-US', elements: [
    { type: 'H1', text: 'Annual Report' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'transcribed', titleText: 'Annual Report', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
  { weight: 'probe' },
);

pdfRow(
  'p05-untagged',
  'No structure tree: there is nothing to transcribe, and inferring one would be inventing it.',
  { fn: 'structured', args: { tagged: false, marked: false, title: 'Untagged Notice', lang: 'en-US', elements: [] } },
  { disposition: 'refused-not-tagged' },
);

pdfRow(
  'p06-empty-tree',
  'A structure tree root with no elements under it — a claim of structure that is not there.',
  { fn: 'empty-tree' },
  { disposition: 'refused-not-tagged' },
);

pdfRow(
  'p07-cyclic-tree',
  'A structure graph, not a tree: the element is its own child. The read must terminate.',
  { fn: 'cyclic' },
  { dispositionOneOf: ['delivered', 'refused-not-tagged'], mustNotHang: true },
  { weight: 'probe' },
);

pdfRow(
  'p08-marked-lie',
  'The catalog claims the document is marked, and there is no structure tree behind the claim.',
  { fn: 'structured', args: { tagged: false, marked: true, title: 'Marked Notice', lang: 'en-US', elements: [] } },
  { disposition: 'refused-not-tagged' },
);

pdfRow(
  'p09-marked-absent',
  'A real structure tree that the catalog never claimed. Repair states what is true.',
  { fn: 'structured', args: { marked: false, title: 'Quiet Notice', lang: 'en-US', elements: [
    { type: 'H1', text: 'Quiet Notice' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Quiet Notice', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

pdfRow('p10-signed', 'A signed document: repair would invalidate the signature, so it is refused.', { fn: 'signed', args: {} }, { disposition: 'refused-signed' });
pdfRow('p11-signed-garbage', 'A signature that could never verify is still a signature to destroy.', { fn: 'signed', args: { garbage: true } }, { disposition: 'refused-signed' });
pdfRow('p12-signed-untagged', 'Signed AND untagged: the refusal that names the signature must win, because it is the one that would destroy evidence.', { fn: 'signed', args: { tagged: false } }, { disposition: 'refused-signed' });

pdfRow(
  'p13-encrypted',
  'An encrypted document. Whatever happens, it is not a silent delivery.',
  { fn: 'encrypted' },
  { dispositionOneOf: ['refused-not-tagged', 'refused-pipeline'], mustNotDeliver: true },
  { weight: 'probe' },
);

pdfRow(
  'p14-xfa-untagged',
  'An XFA form with no structure tree: the form lives outside anything a reader can follow.',
  { fn: 'structured', args: { tagged: false, marked: true, title: 'Application Form', lang: 'en-US', elements: [],
    extraCatalog: ' /AcroForm << /Fields [] /SigFlags 0 /XFA [(preamble) (config)] >>' } },
  { disposition: 'refused-not-tagged' },
);

pdfRow(
  'p15-form-fields-outside-structure',
  'A tagged form whose fields are not in the structure tree: on the page, and nowhere in the reading order.',
  { fn: 'structured', args: { title: 'Permit Application', lang: 'en-US',
    elements: [{ type: 'H1', text: 'Permit Application' }, { type: 'P', text: BODY }],
    annots: [{ nested: true }, { nested: false }] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Permit Application', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: ['1.3.1'], gapCriteria: [] },
);

pdfRow(
  'p16-portfolio',
  'A portfolio: a tagged cover sheet with unremediated documents attached to it.',
  { fn: 'portfolio' },
  { dispositionOneOf: ['delivered', 'refused-not-tagged'] },
  { weight: 'probe', note: 'The open question is whether attachments nobody remediated are voiced at all.' },
);

pdfRow(
  'p17-shifted-xref',
  'Every recorded offset is wrong by two bytes, the way a file arrives after something rewrote it badly.',
  { fn: 'structured', args: { title: 'Shifted Notice', lang: 'en-US', offsetShift: 2, elements: [
    { type: 'H1', text: 'Shifted Notice' }, { type: 'P', text: BODY },
  ] } },
  { dispositionOneOf: ['delivered', 'refused-pipeline'] },
  { weight: 'probe' },
);

pdfRow(
  'p18-xref-stream',
  'p01 again with a cross-reference stream instead of a table: a different container, the same document.',
  { fn: 'structured', args: { title: 'Program Notice', lang: 'en-US', xrefStyle: 'stream', elements: [
    { type: 'H1', text: 'Program Notice' }, { type: 'H2', text: 'Eligibility' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Program Notice', language: 'en-US',
    counts: { pages: 1, headings: 2, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
  { sameSummaryAs: 'p01-tagged-titled' },
);

pdfRow(
  'p19-incremental-title',
  'A title changed by an incremental update. Transcribing the superseded one would be a false claim reached by carelessness.',
  { fn: 'incremental', args: { original: 'Superseded Title', updated: 'Current Title' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Current Title', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
  { mustNotClaim: ['Superseded Title'] },
);

pdfRow(
  'p20-cidset',
  'An embedded font with a producer-written index of it. The index is removable; the font is not.',
  { fn: 'structured', args: { title: 'Indexed Notice', lang: 'en-US', font: 'cidset', elements: [
    { type: 'H1', text: 'Indexed Notice' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Indexed Notice', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

pdfRow(
  'p21-lang-empty',
  'A language entry that is present and says nothing. An empty declaration is not a declaration.',
  { fn: 'structured', args: { title: 'Empty Language', lang: '', elements: [
    { type: 'H1', text: 'Empty Language' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Empty Language', language: null,
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: ['3.1.1'], gapCriteria: ['3.1.1'] },
);

pdfRow(
  'p22-lang-junk',
  'A malformed language tag. It is passed through, never corrected — a guess is a guess even when it looks obvious.',
  { fn: 'structured', args: { title: 'Odd Language', lang: 'en US', elements: [
    { type: 'H1', text: 'Odd Language' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Odd Language', language: 'en US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
  { weight: 'probe', mustNotClaim: ['en-US'] },
);

pdfRow(
  'p23-no-lang',
  'No language anywhere. It becomes a named human task, never a guess.',
  { fn: 'structured', args: { title: 'Unstated Language', lang: null, elements: [
    { type: 'H1', text: 'Unstated Language' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Unstated Language', language: null,
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: ['3.1.1'], gapCriteria: ['3.1.1'] },
);

pdfRow(
  'p24-rtl-arabic',
  'A right-to-left document. The language is transcribed as declared and the counts are unaffected by direction.',
  { fn: 'structured', args: { title: 'إشعار البرنامج', lang: 'ar-SA', titleEncoding: 'utf16', elements: [
    { type: 'H1', text: 'إشعار' }, { type: 'P', text: 'نص' },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'إشعار البرنامج', language: 'ar-SA',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

pdfRow(
  'p25-heading-starts-deep',
  'The first heading is an H3. Whether the document should start at H1 is a decision, so it becomes a task.',
  { fn: 'structured', args: { title: 'Deep Start', lang: 'en-US', elements: [
    { type: 'H3', text: 'Deep Start' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Deep Start', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: ['2.4.10'], gapCriteria: [] },
);

pdfRow(
  'p26-heading-skip',
  'H1 then H3. The missing level might be a mistake or might be deliberate, so a person decides.',
  { fn: 'structured', args: { title: 'Skipped Level', lang: 'en-US', elements: [
    { type: 'H1', text: 'Skipped Level' }, { type: 'H3', text: 'Detail' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Skipped Level', language: 'en-US',
    counts: { pages: 1, headings: 2, tables: 0, lists: 0, figures: 0 }, needs: ['2.4.10'], gapCriteria: [] },
);

pdfRow(
  'p27-figure-no-alt',
  'One described figure and one undescribed. Only the undescribed one is work.',
  { fn: 'structured', args: { title: 'Two Figures', lang: 'en-US', elements: [
    { type: 'H1', text: 'Two Figures' },
    { type: 'Figure', alt: 'The east basin after the storm', text: 'figure one' },
    { type: 'Figure', text: 'figure two' },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Two Figures', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 2 }, needs: ['1.1.1'], gapCriteria: ['1.1.1'] },
);

pdfRow(
  'p28-figure-empty-alt',
  'An empty alt is a claim that the figure is decorative. That is a claim, not an omission.',
  { fn: 'structured', args: { title: 'Decorative Figure', lang: 'en-US', elements: [
    { type: 'H1', text: 'Decorative Figure' }, { type: 'Figure', alt: '', text: 'rule' },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Decorative Figure', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 1 }, needs: [], gapCriteria: [] },
  { weight: 'probe' },
);

pdfRow(
  'p29-table-and-list',
  'A table and a list, counted as what they are.',
  { fn: 'structured', args: { title: 'Schedule', lang: 'en-US', elements: [
    { type: 'H1', text: 'Schedule' }, { type: 'Table', text: 'rows' }, { type: 'L', text: 'items' }, { type: 'P', text: BODY2 },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Schedule', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 1, lists: 1, figures: 0 }, needs: [], gapCriteria: [] },
);

pdfRow(
  'p30-link-outside-structure',
  'A link annotation outside the structure tree: reachable by eye, unreachable by reader.',
  { fn: 'structured', args: { title: 'Linked Notice', lang: 'en-US',
    elements: [{ type: 'H1', text: 'Linked Notice' }, { type: 'P', text: BODY }],
    annots: [{ nested: false, subtype: 'Link' }] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Linked Notice', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: ['1.3.1'], gapCriteria: [] },
);

pdfRow(
  'p31-fonts-not-embedded',
  'Nothing embedded the fonts, and no repair can invent glyph outlines. The remedy is the source document.',
  { fn: 'structured', args: { title: 'Unembedded Notice', lang: 'en-US', font: 'not-embedded', elements: [
    { type: 'H1', text: 'Unembedded Notice' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Unembedded Notice', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [],
    conformance: { compliant: false, mustVoice: ['7.21.4'] } },
);

pdfRow(
  'p32-utf16-title',
  'A title stored as UTF-16 with accents. Transcription that mangles bytes states something the document does not.',
  { fn: 'structured', args: { title: 'Rapport Général — Février', titleEncoding: 'utf16', lang: 'fr-CA', elements: [
    { type: 'H1', text: 'Rapport' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Rapport Général — Février', language: 'fr-CA',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

pdfRow(
  'p33-pdf20',
  'A PDF 2.0 header on an otherwise ordinary document.',
  { fn: 'structured', args: { title: 'Modern Notice', lang: 'en-US', header: '%PDF-2.0', elements: [
    { type: 'H1', text: 'Modern Notice' }, { type: 'P', text: BODY },
  ] } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Modern Notice', language: 'en-US',
    counts: { pages: 1, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
  { weight: 'probe' },
);

pdfRow('p34-no-pages', 'A valid file containing no pages at all.', { fn: 'no-pages' },
  { dispositionOneOf: ['refused-not-tagged', 'refused-pipeline'], mustNotDeliver: true }, { weight: 'probe' });

pdfRow(
  'p35-many-pages',
  'Sixty pages of structure: the counts stay right and the work stays bounded.',
  { fn: 'structured', args: { title: 'Long Notice', lang: 'en-US', pages: 60, elements: Array.from({ length: 60 }, (_, i) => (
    i === 0 ? { type: 'H1', text: 'Long Notice', page: 0 } : { type: 'P', text: `Section ${i + 1}`, page: i }
  )) } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Long Notice', language: 'en-US',
    counts: { pages: 60, headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

// ----------------------------------------------------------- the Word path

const wordRow = (id, tests, build, expected, opts = {}) =>
  add({ id, tests, kind: 'word', weight: 'core', build, expected, ...opts });

const LADDER = (h) => [h(1, 'Program Notice'), h(2, 'Eligibility')];

wordRow(
  'w01-baseline',
  'The easy case: titled, a language, a real heading ladder, a data table and a real list.',
  { fn: 'docx', args: { title: 'Program Notice', lang: 'en-US', shape: 'baseline' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Program Notice', language: 'en-US',
    counts: { headings: 2, tables: 1, lists: 1, figures: 0 }, needs: [], gapCriteria: [] },
);

wordRow(
  'w02-legacy-doc',
  'The same document as a legacy .doc, which has no marker but the OLE container.',
  { fn: 'legacy-doc', from: 'w01-baseline' },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Program Notice', language: 'en-US',
    counts: { headings: 2, tables: 1, lists: 1, figures: 0 }, needs: [], gapCriteria: [] },
  { weight: 'probe', note: 'The round trip through the legacy format is the converter\'s, not ours.' },
);

wordRow(
  'w03-no-language',
  'A document that declares no language anywhere.',
  { fn: 'docx', args: { title: 'Unstated Notice', lang: null, shape: 'simple' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Unstated Notice', language: null,
    counts: { headings: 1, tables: 0, lists: 0, figures: 0 }, needs: ['3.1.1'], gapCriteria: ['3.1.1'] },
  { weight: 'probe', note: 'Whether the converter injects a default of its own is the open question.' },
);

wordRow(
  'w04-fake-headings',
  'Bold twenty-four point text that looks like a heading and is structurally a paragraph.',
  { fn: 'docx', args: { title: 'Looks Structured', lang: 'en-US', shape: 'fake-headings' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Looks Structured', language: 'en-US',
    counts: { headings: 0, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

wordRow(
  'w05-typed-list',
  'A list made by typing numbers. Promoting it to a real list would be inventing structure.',
  { fn: 'docx', args: { title: 'Typed List', lang: 'en-US', shape: 'typed-list' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Typed List', language: 'en-US',
    counts: { headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

wordRow(
  'w06-layout-table',
  'A borderless table used for placement rather than data.',
  { fn: 'docx', args: { title: 'Placement Grid', lang: 'en-US', shape: 'layout-table' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Placement Grid', language: 'en-US',
    counts: { headings: 1, tables: 1, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
  { weight: 'probe' },
);

wordRow(
  'w07-figure-no-alt',
  'An image with no description. The description is a person\'s sentence to write.',
  { fn: 'docx', args: { title: 'Undescribed Figure', lang: 'en-US', shape: 'figure-no-alt' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Undescribed Figure', language: 'en-US',
    counts: { headings: 1, tables: 0, lists: 0, figures: 1 }, needs: ['1.1.1'], gapCriteria: ['1.1.1'] },
);

wordRow(
  'w08-figure-with-alt',
  'An image whose author already described it: transcribed, and no work invented on top.',
  { fn: 'docx', args: { title: 'Described Figure', lang: 'en-US', shape: 'figure-alt' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Described Figure', language: 'en-US',
    counts: { headings: 1, tables: 0, lists: 0, figures: 1 }, needs: [], gapCriteria: [] },
);

wordRow(
  'w09-foreign-runs',
  'An English document quoting two German sentences. A document-level language is not wrong because a run differs.',
  { fn: 'docx', args: { title: 'Quoted Sources', lang: 'en-US', shape: 'foreign-runs' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Quoted Sources', language: 'en-US',
    counts: { headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

wordRow(
  'w10-rtl-arabic',
  'A right-to-left document, declared as such.',
  { fn: 'docx', args: { title: 'إشعار', lang: 'ar-SA', shape: 'rtl' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'إشعار', language: 'ar-SA',
    counts: { headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
  { weight: 'probe' },
);

wordRow(
  'w11-cjk',
  'A Chinese document, whose language lives in a different slot than a Latin one.',
  { fn: 'docx', args: { title: '项目通知', lang: 'zh-CN', shape: 'cjk' } },
  { disposition: 'delivered', title: 'already-titled', titleText: '项目通知', language: 'zh-CN',
    counts: { headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
  { weight: 'probe' },
);

wordRow(
  'w12-tracked-changes',
  'Unresolved tracked changes and a comment. Nothing invented, and nothing silently accepted on the author\'s behalf.',
  { fn: 'docx', args: { title: 'Under Review', lang: 'en-US', shape: 'tracked' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Under Review', language: 'en-US',
    counts: { headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
  { weight: 'probe' },
);

wordRow(
  'w13-heading-starts-deep',
  'A document whose first heading is a Heading 3.',
  { fn: 'docx', args: { title: 'Deep Start', lang: 'en-US', shape: 'deep-start' } },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Deep Start', language: 'en-US',
    counts: { headings: 1, tables: 0, lists: 0, figures: 0 }, needs: ['2.4.10'], gapCriteria: [] },
);

wordRow(
  'w14-untitled',
  'No title in the document properties, and a first heading to transcribe one from.',
  { fn: 'docx', args: { title: null, lang: 'en-US', shape: 'simple' } },
  { disposition: 'delivered', title: 'transcribed', titleText: 'Program Notice', language: 'en-US',
    counts: { headings: 1, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

wordRow(
  'w15-empty-body',
  'A document with nothing in it.',
  { fn: 'docx', args: { title: 'Nothing Here', lang: 'en-US', shape: 'empty' } },
  { dispositionOneOf: ['delivered', 'refused-pipeline'] },
  { weight: 'probe' },
);

wordRow(
  'w16-macro-enabled',
  'A macro-enabled document. Whether the door cares is the question; a silent macro-carrying delivery is not acceptable either way.',
  { fn: 'docx', args: { title: 'Macro Notice', lang: 'en-US', shape: 'simple', macro: true }, filename: 'w16-macro-enabled.docm' },
  { dispositionOneOf: ['delivered', 'refused-pipeline', 'door'] },
  { weight: 'probe' },
);

wordRow(
  'w17-ole-not-word',
  'An OLE container carrying no Word document — the shape an encrypted .docx also arrives in.',
  { fn: 'ole' },
  { disposition: 'refused-pipeline', mustNotDeliver: true },
);

wordRow(
  'w18-pdf-named-docx',
  'PDF bytes under a .docx name. The container decides, not the name.',
  { fn: 'pdf-named-docx' },
  { disposition: 'delivered', title: 'already-titled', titleText: 'Program Notice', language: 'en-US',
    counts: { pages: 1, headings: 2, tables: 0, lists: 0, figures: 0 }, needs: [], gapCriteria: [] },
);

export const SPEC = rows;

/** Guard against a row silently disappearing in an edit. */
export const EXPECTED_ROWS = rows.length;
