import java.io.File;
import java.util.ArrayList;
import java.util.Map;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;

/**
 * Untags list structure the document does not justify.
 *
 * ONE RULE: an /L with fewer than two /LI children is not a list.
 *
 * Document 12 is tagged with six lists where its ground truth records two. The
 * five wrong ones have exactly one item each — four running page footers and a
 * figure caption, each wrapped in /L /LI as though it were a list of one. The
 * two real lists have five items and three. Across the whole development
 * corpus only two documents carry lists at all, and the split is unanimous: 5
 * of 5 spurious lists are single-item, 2 of 2 real ones are not.
 *
 * A list-marker test was written first and thrown away. It would have asked
 * whether the items open with "1." or a bullet, which is the more principled
 * question, but it assumes something about how a bullet glyph survives
 * extraction and the corpus offers no evidence either way. The item count needs
 * no such assumption, is unanimous on the evidence we have, and is less code.
 * If a multi-item spurious list ever appears, that is when the marker test
 * earns its place.
 *
 * A list of one conveys nothing a paragraph does not, so the failure direction
 * is the safe one: untagging a genuine single-item list costs an omission.
 *
 * RETYPE, DO NOT DETACH. The wrong lists carry real content — document 12's
 * footers put all twenty-one of their marked-content ids inside the /Lbl. The
 * public structure API can splice child ELEMENTS up to a parent but not marked
 * content, so removing the element would strip its text out of the structure
 * tree entirely and leave untagged content behind: a worse defect than the one
 * being fixed, and one veraPDF would catch. Every element is retyped in place
 * to something that carries no list meaning, and nothing moves.
 *
 *     L -> Div        grouping, no semantics
 *     LI -> P
 *     Lbl -> Span     the label was never a marker here, it was the text
 *     LBody -> Span
 *
 * An /Lbl or /LBody with no children at all is removed rather than retyped —
 * nothing references it, so nothing is orphaned, and an empty Span is noise.
 *
 * Usage: Lists <in.pdf> <out.pdf>
 */
public final class Lists {

    /** A list needs at least this many items to be a list. */
    private static final int MIN_ITEMS = 2;

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: Lists <in.pdf> <out.pdf>");
            System.exit(2);
        }

        try (PDDocument doc = Loader.loadPDF(new File(args[0]))) {
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();
            int lists = 0, untagged = 0;

            if (root != null) {
                Map<String, Object> roleMap = root.getRoleMap();
                for (PDStructureElement list : StructText.find(root, java.util.Set.of("L"), roleMap)) {
                    lists++;
                    if (items(list, roleMap) >= MIN_ITEMS) continue;
                    untag(list, roleMap);
                    untagged++;
                }
            }

            doc.save(args[1]);
            System.out.printf("{\"lists\":%d,\"untagged\":%d,\"kept\":%d}%n",
                lists, untagged, lists - untagged);
        }
    }

    /** Direct /LI children. A nested list's items belong to that list, not this one. */
    private static int items(PDStructureElement list, Map<String, Object> roleMap) {
        int n = 0;
        for (Object kid : list.getKids()) {
            if (kid instanceof PDStructureElement el && "LI".equals(standard(el, roleMap))) n++;
        }
        return n;
    }

    private static void untag(PDStructureElement list, Map<String, Object> roleMap) {
        list.setStructureType("Div");
        retypeKids(list, roleMap);
    }

    private static void retypeKids(PDStructureNode node, Map<String, Object> roleMap) {
        for (Object kid : new ArrayList<>(node.getKids())) {
            if (!(kid instanceof PDStructureElement el)) continue;
            String type = standard(el, roleMap);
            boolean empty = el.getKids().isEmpty();
            switch (type) {
                case "LI" -> el.setStructureType("P");
                case "Lbl", "LBody" -> {
                    if (empty) { node.removeKid(el); continue; }
                    el.setStructureType("Span");
                }
                // A list nested inside an unjustified list is judged on its own
                // items when the outer walk reaches it, so it is left alone here.
                case "L" -> { continue; }
                default -> { }
            }
            retypeKids(el, roleMap);
        }
    }

    /** The element's type after the role map, which is how Inspect reads it too. */
    private static String standard(PDStructureElement el, Map<String, Object> roleMap) {
        String type = el.getStructureType();
        if (roleMap != null && type != null && roleMap.get(type) != null) return roleMap.get(type).toString();
        return type == null ? "" : type;
    }

    private Lists() {}
}
