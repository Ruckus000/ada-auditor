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
 * Rules, all from the development corpus:
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
 *   R4 CAPTION TEXT. A heading opening "Figure 2:" is a caption. Uses the same
 *      definition as the caption extractor, so one line cannot be a figure's
 *      description and a document heading at once.
 *
 *      Matched on the whitespace-stripped text. It was matched on the raw text
 *      until h03 showed why that fails: extraction yields glyph positions, so
 *      the line reads "P l a t e 1 : R a i l w e a r", and a pattern looking
 *      for "plate" never sees it. Two captions escaped a rule written for
 *      exactly them. R1 and R3 already stripped whitespace for this reason;
 *      R4 did not.
 *
 *   R6 SHORT FOLLOWING PARAGRAPH. A heading whose next block is a paragraph of
 *      fewer than 24 non-whitespace characters. A real heading introduces
 *      prose; a chart title is followed by another chart label.
 *
 *      Across the 61 legitimate headings in the development corpus that are
 *      followed by a paragraph, the shortest such paragraph is 32 characters.
 *      The three wrong ones sit at 3 ("200"), 10 ("Containers") and 16
 *      ("Western quay, 2026"). The threshold is placed in that gap, nearer the
 *      wrong ones. This is what finally reaches document 07's chart title,
 *      which R5 could not: an SVG chart offers no Table or Figure region to be
 *      contained by, but it does put its title among its own axis labels.
 *
 *   R7 NOTHING FOLLOWS. A heading with no block after it anywhere in the
 *      document. Exactly one heading in the 28 development documents has no
 *      successor and it is h08's closing sentence, wrongly promoted. A heading
 *      that introduces nothing introduces nothing.
 *
 *   R5 TABLE CONTAINMENT. A table's caption carries no marker and sits at
 *      ordinary heading length — "Containers handled, by depot and quarter
 *      (hundreds)" is indistinguishable from a real heading by its words. What
 *      separates it is where it is: inside the table's extent, or immediately
 *      above or below it and horizontally within it.
 *
 *      Scoped to tables because that is where the evidence is. Document 07's
 *      chart title cannot be reached this way at all: the chart is SVG text
 *      over vector paths, so there is no Figure and no Table to be contained
 *      by. That was recorded here as needing vector-density analysis. It did
 *      not — R6 reaches it from the other side, by what follows rather than by
 *      what encloses.
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
    private static final Set<String> TABLES = Set.of("Table");

    /**
     * What counts as a block for R6 and R7 — the same set Inspect walks to
     * report reading order, so "the next block" means the same thing to the
     * tool that acts and the tool that measures.
     */
    private static final Set<String> BLOCK = Set.of(
        "H1", "H2", "H3", "H4", "H5", "H6", "P", "Figure", "Table", "L", "LI", "Caption", "Formula");

    /**
     * R6. Shortest paragraph that can follow a real heading, in non-whitespace
     * characters. Development corpus: 61 legitimate headings are followed by a
     * paragraph and the shortest is 32; the three wrong ones are at 3, 10 and
     * 16. Set in the gap. The holdout's ground truth was not consulted.
     */
    private static final int MIN_FOLLOWING_CHARS = 24;

    /** R7's marker for "no block follows this one". */
    private static final String NOTHING = "\u0000end";

    /**
     * How far outside a table's extent a caption may sit, in points. A caption
     * sits directly against its table; body text is a paragraph break away.
     */
    private static final float CAPTION_GAP = 24f;
    /** And it must sit horizontally within the table, not merely near it. */
    private static final float MIN_OVERLAP = 0.5f;
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
            int headings = 0, byLength = 0, byNoLetters = 0, byPageMarker = 0,
                byCaptionText = 0, byTable = 0, byShortFollowing = 0, byNothingAfter = 0;

            if (root != null) {
                StructText text = new StructText(doc);
                List<PDStructureElement> found = StructText.find(root, LEVELS, root.getRoleMap());
                headings = found.size();

                List<StructText.Box> tables = new java.util.ArrayList<>();
                for (PDStructureElement t : StructText.find(root, TABLES, root.getRoleMap())) {
                    StructText.Box b = text.boxOf(t);
                    if (b != null) tables.add(b);
                }

                // What follows each heading, read BEFORE any demotion. Demoting
                // a heading turns it into a P, so a loop that read the tree as
                // it went would let one demotion change the evidence for the
                // next. Snapshot first, decide after.
                List<PDStructureElement> blocks =
                    StructText.find(root, BLOCK, root.getRoleMap());
                //
                // Keyed by the COS dictionary, NOT by the element. Every call to
                // getKids() builds fresh PDStructureElement wrappers around the
                // same underlying object, so two walks of one tree return two
                // sets of instances that are never equal to each other. Keying
                // by element silently missed every lookup, R6 and R7 never
                // fired, and the pass reported a clean run.
                java.util.Map<Object, String> nextType = new java.util.HashMap<>();
                java.util.Map<Object, Integer> nextChars = new java.util.HashMap<>();
                for (int i = 0; i < blocks.size(); i++) {
                    PDStructureElement next = i + 1 < blocks.size() ? blocks.get(i + 1) : null;
                    Object key = blocks.get(i).getCOSObject();
                    // A distinct sentinel, not "": standard() also returns ""
                    // for an element with no /S, and R7 must not fire on that.
                    nextType.put(key, next == null ? NOTHING : standard(next, root.getRoleMap()));
                    nextChars.put(key,
                        next == null ? 0 : text.of(next).replaceAll("\\s", "").length());
                }

                for (PDStructureElement el : found) {
                    String t = text.of(el);
                    // An empty heading is left alone: we cannot read it, so we
                    // do not know it is wrong, and guessing is the thing this
                    // pass exists to avoid.
                    if (t.isEmpty()) continue;

                    String dense = t.replaceAll("\\s", "");
                    boolean tooLong = dense.length() > MAX_DENSE_CHARS;
                    boolean noLetters = !t.chars().anyMatch(Character::isLetter);

                    Object key = el.getCOSObject();
                    String after = nextType.getOrDefault(key, "P");
                    boolean nothingAfter = NOTHING.equals(after);
                    boolean shortAfter = "P".equals(after)
                        && nextChars.getOrDefault(key, Integer.MAX_VALUE) < MIN_FOLLOWING_CHARS;

                    if (tooLong) { el.setStructureType("P"); byLength++; }
                    else if (noLetters) { el.setStructureType("P"); byNoLetters++; }
                    else if (PAGE_MARKER.matcher(dense).find()) { el.setStructureType("P"); byPageMarker++; }
                    else if (CaptionPattern.OPENING.matcher(dense).find()) { el.setStructureType("P"); byCaptionText++; }
                    else if (belongsToTable(text.boxOf(el), tables)) { el.setStructureType("P"); byTable++; }
                    else if (nothingAfter) { el.setStructureType("P"); byNothingAfter++; }
                    else if (shortAfter) { el.setStructureType("P"); byShortFollowing++; }
                }
            }

            doc.save(args[1]);
            System.out.printf(
                "{\"headings\":%d,\"length\":%d,\"noLetters\":%d,\"pageMarker\":%d,"
                + "\"captionText\":%d,\"inTable\":%d,\"nothingAfter\":%d,\"shortFollowing\":%d,"
                + "\"kept\":%d}%n",
                headings, byLength, byNoLetters, byPageMarker, byCaptionText, byTable,
                byNothingAfter, byShortFollowing,
                headings - byLength - byNoLetters - byPageMarker - byCaptionText - byTable
                    - byNothingAfter - byShortFollowing);
        }
    }

    /** The element's type after the role map, which is how Inspect reads it too. */
    private static String standard(PDStructureElement el, java.util.Map<String, Object> roleMap) {
        String type = el.getStructureType();
        if (roleMap != null && type != null && roleMap.get(type) != null) return roleMap.get(type).toString();
        return type == null ? "" : type;
    }

    /** Inside a table's extent, or hard against its top or bottom edge. */
    private static boolean belongsToTable(StructText.Box h, List<StructText.Box> tables) {
        if (h == null) return false;
        for (StructText.Box t : tables) {
            if (!h.samePage(t)) continue;
            if (h.overlapX(t) < MIN_OVERLAP * Math.min(h.width(), t.width())) continue;
            boolean inside = h.y0() >= t.y0() && h.y1() <= t.y1();
            boolean above = t.y0() - h.y1() >= 0 && t.y0() - h.y1() <= CAPTION_GAP;
            boolean below = h.y0() - t.y1() >= 0 && h.y0() - t.y1() <= CAPTION_GAP;
            if (inside || above || below) return true;
        }
        return false;
    }
}
