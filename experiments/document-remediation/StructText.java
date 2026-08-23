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
 * Resolves the words behind a structure element.
 *
 * The structure tree references glyphs by marked-content id, so an element's
 * kids are integers rather than text. Shared between Inspect (which measures)
 * and Headings (which acts) deliberately: if the two disagreed about what a
 * heading says, the measurement of the fix would be wrong in a way that is very
 * hard to see.
 */
public final class StructText {

    private final Map<Integer, Map<Integer, String>> byPage = new HashMap<>();
    private final Map<PDPage, Integer> pageIndex = new HashMap<>();

    public StructText(PDDocument doc) throws IOException {
        for (int i = 0; i < doc.getNumberOfPages(); i++) {
            PDPage page = doc.getPage(i);
            pageIndex.put(page, i);
            PDFMarkedContentExtractor ex = new PDFMarkedContentExtractor();
            ex.processPage(page);
            Map<Integer, String> ids = new HashMap<>();
            for (PDMarkedContent mc : ex.getMarkedContents()) harvest(mc, ids);
            byPage.put(i, ids);
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

    private void harvest(PDMarkedContent mc, Map<Integer, String> ids) {
        StringBuilder sb = new StringBuilder();
        for (Object o : mc.getContents()) {
            if (o instanceof TextPosition tp) sb.append(tp.getUnicode());
            else if (o instanceof PDMarkedContent child) harvest(child, ids);
        }
        if (mc.getMCID() >= 0 && sb.length() > 0) ids.merge(mc.getMCID(), sb.toString(), String::concat);
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
