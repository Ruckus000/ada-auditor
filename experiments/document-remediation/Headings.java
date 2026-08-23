import java.io.File;
import java.util.List;
import java.util.Set;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;

/**
 * Experiment 2, technique 5: demote text that was promoted to a heading and is
 * not one.
 *
 * DEMOTION ONLY. Nothing here promotes anything, and that is a safety decision
 * rather than a scope one. Demoting a real heading costs an omission — a
 * reader loses navigation and a reviewer can see the gap. Promoting a
 * non-heading costs a false assertion — invented structure a reader navigates
 * by, with nothing to signal it is wrong. Under the gate those are not
 * comparable, so this pass can only ever trade an assertion for an omission.
 *
 * Two rules, both from the development corpus:
 *
 *   R1 LENGTH. Whole body paragraphs are being tagged as headings — five of
 *      them across documents 03, 05, 07 and 12. The longest real heading in
 *      the development corpus is 42 characters and 8 words, so 100 characters
 *      or 15 words leaves roughly 2.4x headroom and cannot reach a real one.
 *      (Thresholds set from the development corpus alone. The holdout's ground
 *      truth was deliberately not consulted.)
 *
 *   R2 NO LETTERS. Document 08's slide numerals "1", "2", "3" each became an
 *      H1. A heading with no letter in it is an ornament.
 *
 *   R3 PAGE MARKER. Document 02's running footer became an H3. This is a text
 *      rule rather than page-furniture detection on purpose: the occurrence is
 *      singular in the development corpus, it appears on one page only so
 *      cross-page repetition cannot see it, and it sits at the top of page 2
 *      where a legitimate H1 also lives — so a margin-band rule would be
 *      actively unsafe. Geometry here would be a subsystem built for one case.
 *
 * Usage: Headings <in.pdf> <out.pdf>
 */
public final class Headings {

    private static final Set<String> LEVELS = Set.of("H1", "H2", "H3", "H4", "H5", "H6");
    // Measured on the text with ALL whitespace removed, and word count is not
    // used at all. PDFMarkedContentExtractor yields glyph-level positions, so
    // an extracted paragraph reads "T w o s it e v is it s" — word count is
    // meaningless on that and raw character count is inflated by roughly two.
    // Non-whitespace length is stable under the artifact.
    //
    // The longest real heading in the DEVELOPMENT corpus is 35 non-whitespace
    // characters. 80 leaves better than 2x headroom. The holdout's ground
    // truth was deliberately not consulted when choosing this.
    private static final int MAX_DENSE_CHARS = 80;

    /**
     * R3 PAGE MARKER. "Page 3", "Page 1 of 1", "2 of 7" — a heading carrying one
     * is a running header or footer.
     *
     * Matched on the whitespace-stripped text for the same reason as R1. A real
     * heading containing the word "Page" without a digit beside it ("Page
     * Layout") does not match, and a bare digit is already covered by R2.
     */
    private static final java.util.regex.Pattern PAGE_MARKER =
        java.util.regex.Pattern.compile("page\\d|\\d+of\\d+", java.util.regex.Pattern.CASE_INSENSITIVE);

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: Headings <in.pdf> <out.pdf>");
            System.exit(2);
        }

        try (PDDocument doc = Loader.loadPDF(new File(args[0]))) {
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();
            int headings = 0, byLength = 0, byNoLetters = 0, byPageMarker = 0;

            if (root != null) {
                StructText text = new StructText(doc);
                List<PDStructureElement> found = StructText.find(root, LEVELS, root.getRoleMap());
                headings = found.size();

                for (PDStructureElement el : found) {
                    String t = text.of(el);
                    // An empty heading is left alone: we cannot read it, so we
                    // do not know it is wrong, and guessing is the thing this
                    // pass exists to avoid.
                    if (t.isEmpty()) continue;

                    String dense = t.replaceAll("\\s", "");
                    boolean tooLong = dense.length() > MAX_DENSE_CHARS;
                    boolean noLetters = !t.chars().anyMatch(Character::isLetter);

                    if (tooLong) { el.setStructureType("P"); byLength++; }
                    else if (noLetters) { el.setStructureType("P"); byNoLetters++; }
                    else if (PAGE_MARKER.matcher(dense).find()) { el.setStructureType("P"); byPageMarker++; }
                }
            }

            doc.save(args[1]);
            System.out.printf(
                "{\"headings\":%d,\"demotedLength\":%d,\"demotedNoLetters\":%d,\"demotedPageMarker\":%d,\"kept\":%d}%n",
                headings, byLength, byNoLetters, byPageMarker,
                headings - byLength - byNoLetters - byPageMarker);
        }
    }
}
