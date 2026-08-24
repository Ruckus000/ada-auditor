import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDMarkedContentReference;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.markedcontent.PDMarkedContent;
import org.apache.pdfbox.text.PDFMarkedContentExtractor;
import org.apache.pdfbox.text.TextPosition;

/**
 * Resolves what a structure element points at on the page: its words, and its
 * extent.
 *
 * Both come from one marked-content pass, and both are the same act of
 * resolution — the structure tree references glyphs by id and this turns those
 * ids into something usable. Splitting them would mean walking every page
 * twice to answer two halves of one question.
 *
 * Shared between Inspect (which measures) and Headings (which acts)
 * deliberately: if the two disagreed about what a heading says, the measurement
 * of the fix would be wrong in a way that is very hard to see.
 */
public final class StructText {

    /**
     * Top-down page coordinates, matching what PDFTextStripper reports, and the
     * page they belong to.
     *
     * The page is not decoration. Coordinates restart on every page, so without
     * it a heading on page 4 sits "24 points below" a table on page 3 and gets
     * demoted as its caption — which is exactly what happened to a real heading
     * in the kitchen-sink document before this field existed.
     */
    public record Box(int page, float x0, float y0, float x1, float y1) {
        public float width() { return x1 - x0; }

        /** Union within a page. Boxes on different pages do not combine. */
        public Box union(Box o) {
            if (o == null) return this;
            if (o.page != page) return this;
            return new Box(page, Math.min(x0, o.x0), Math.min(y0, o.y0),
                                 Math.max(x1, o.x1), Math.max(y1, o.y1));
        }
        public float overlapX(Box o) { return Math.max(0, Math.min(x1, o.x1) - Math.max(x0, o.x0)); }
        public boolean samePage(Box o) { return o != null && o.page == page; }
    }

    private final Map<Integer, Map<Integer, String>> byPage = new HashMap<>();
    private final Map<Integer, Map<Integer, Box>> boxByPage = new HashMap<>();
    private final Map<PDPage, Integer> pageIndex = new HashMap<>();

    public StructText(PDDocument doc) throws IOException {
        for (int i = 0; i < doc.getNumberOfPages(); i++) {
            PDPage page = doc.getPage(i);
            pageIndex.put(page, i);
            PDFMarkedContentExtractor ex = new PDFMarkedContentExtractor();
            ex.processPage(page);
            Map<Integer, String> ids = new HashMap<>();
            Map<Integer, Box> boxes = new HashMap<>();
            for (PDMarkedContent mc : ex.getMarkedContents()) harvest(mc, ids, boxes, i);
            byPage.put(i, ids);
            boxByPage.put(i, boxes);
        }
    }

    /** ActualText, then Alt, then the glyphs the element references. */
    public String of(PDStructureElement el) {
        if (el.getActualText() != null) return el.getActualText().trim();
        if (el.getAlternateDescription() != null) return el.getAlternateDescription().trim();
        StringBuilder b = new StringBuilder();
        collect(el, b);
        return b.toString().replaceAll("\\s+", " ").trim();
    }

    /** Union extent of everything the element references, or null if nothing is locatable. */
    public Box boxOf(PDStructureElement el) {
        return box(el, null);
    }

    private Box box(PDStructureElement el, Box acc) {
        Integer page = el.getPage() != null ? pageIndex.get(el.getPage()) : null;
        for (Object kid : el.getKids()) {
            if (kid instanceof PDStructureElement child) {
                acc = box(child, acc);
            } else if (kid instanceof Integer mcid) {
                acc = merge(page, mcid, acc);
            } else if (kid instanceof PDMarkedContentReference ref) {
                Integer p = ref.getPage() != null ? pageIndex.get(ref.getPage()) : page;
                acc = merge(p, ref.getMCID(), acc);
            }
        }
        return acc;
    }

    private Box merge(Integer page, int mcid, Box acc) {
        Box b = page != null ? boxByPage.getOrDefault(page, Map.of()).get(mcid) : null;
        if (b == null) {
            for (Map<Integer, Box> m : boxByPage.values()) { b = m.get(mcid); if (b != null) break; }
        }
        return b == null ? acc : b.union(acc);
    }

    private void collect(PDStructureElement el, StringBuilder b) {
        Integer page = el.getPage() != null ? pageIndex.get(el.getPage()) : null;
        for (Object kid : el.getKids()) {
            if (kid instanceof PDStructureElement child) collect(child, b);
            else if (kid instanceof Integer mcid) append(page, mcid, b);
            else if (kid instanceof PDMarkedContentReference ref) {
                Integer p = ref.getPage() != null ? pageIndex.get(ref.getPage()) : page;
                append(p, ref.getMCID(), b);
            } else if (kid instanceof String s) b.append(s).append(' ');
        }
    }

    private void append(Integer page, int mcid, StringBuilder b) {
        if (page != null) {
            String t = byPage.getOrDefault(page, Map.of()).get(mcid);
            if (t != null) b.append(t).append(' ');
            return;
        }
        // No /Pg on the element — take the id from whichever page holds it.
        for (Map<Integer, String> m : byPage.values()) {
            String t = m.get(mcid);
            if (t != null) { b.append(t).append(' '); return; }
        }
    }

    private void harvest(PDMarkedContent mc, Map<Integer, String> ids, Map<Integer, Box> boxes, int page) {
        StringBuilder sb = new StringBuilder();
        Box b = null;
        for (Object o : mc.getContents()) {
            if (o instanceof TextPosition tp) {
                sb.append(tp.getUnicode());
                Box g = new Box(page, tp.getXDirAdj(), tp.getYDirAdj() - tp.getHeightDir(),
                                tp.getXDirAdj() + tp.getWidthDirAdj(), tp.getYDirAdj());
                b = g.union(b);
            } else if (o instanceof PDMarkedContent child) {
                harvest(child, ids, boxes, page);
            }
        }
        if (mc.getMCID() >= 0 && sb.length() > 0) {
            ids.merge(mc.getMCID(), sb.toString(), String::concat);
            if (b != null) boxes.merge(mc.getMCID(), b, Box::union);
        }
    }

    /** Depth-first structure elements of the given types, in document order. */
    public static List<PDStructureElement> find(
            org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode node,
            java.util.Set<String> types, Map<String, Object> roleMap) {
        List<PDStructureElement> out = new ArrayList<>();
        walk(node, types, roleMap, out);
        return out;
    }

    private static void walk(org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode node,
                             java.util.Set<String> types, Map<String, Object> roleMap,
                             List<PDStructureElement> out) {
        for (Object kid : node.getKids()) {
            if (!(kid instanceof PDStructureElement el)) continue;
            String type = el.getStructureType();
            if (roleMap != null && type != null && roleMap.get(type) != null) type = roleMap.get(type).toString();
            if (types.contains(type)) out.add(el);
            walk(el, types, roleMap, out);
        }
    }
}
