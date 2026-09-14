import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDMarkedContentReference;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;
import org.apache.pdfbox.pdmodel.documentinterchange.markedcontent.PDMarkedContent;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.text.PDFMarkedContentExtractor;
import org.apache.pdfbox.text.TextPosition;

/**
 * Experiment-only PDF → classifier-card dump.
 *
 * Candidate universe is Inspect.order BLOCK types via StructText.find.
 * Each block also carries `ancestors`: the role-mapped parent chain from
 * `el.getParent()`, the same walk Tables.java / Figures.java already use.
 * Text and font come from the same PDFMarkedContentExtractor walk StructText
 * already makes; this file keeps the first glyph's size/weight (StructText
 * discards them) and inserts a space when the x/y gap between glyphs exceeds
 * a quarter em — PDFMarkedContentExtractor yields one MCID per letter, and
 * StructText.of joins those with spaces, which would feed the frozen
 * role-only prompt "QuarterlyOperationsSummary". Missing font is JSON null,
 * never a default.
 *
 * Usage: Cards &lt;file.pdf&gt;
 */
public final class Cards {

    /** Same universe Inspect.order uses. */
    private static final Set<String> BLOCK = Set.of(
        "H1", "H2", "H3", "H4", "H5", "H6", "P", "Figure", "Table", "L", "LI",
        "Caption", "Formula");

    /** Subset-embedded fonts arrive as "DAAAAA+Georgia-Bold"; Tables.java:142. */
    private static final Pattern SUBSET_TAG = Pattern.compile("^[A-Z]{6}\\+");

    /**
     * Gap vs font size that counts as a word or line break, not letter spacing.
     * On Chromium→PDFBox development PDFs, letter x-gaps are ≈0 and word gaps
     * without a space glyph are ≈0.19em (measured on tagged 01).
     */
    private static final float WORD_GAP_EM = 0.12f;

    /** Headings.java R5. Copied, not retuned. */
    private static final float CAPTION_GAP = 24f;
    private static final float MIN_OVERLAP = 0.5f;

    private record Glyph(String u, float x, float y, float w, float fontPt, boolean bold) {}

    private record Face(int fontPt, String weight) {}

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            System.err.println("usage: Cards <file.pdf>");
            System.exit(2);
        }
        File pdf = new File(args[0]);
        String stem = pdf.getName().replaceFirst("\\.pdf$", "");
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();
            StringBuilder json = new StringBuilder();
            json.append("{\n");
            json.append("  \"pdf\": ").append(q(pdf.getName())).append(",\n");
            json.append("  \"stem\": ").append(q(stem)).append(",\n");
            if (root == null) {
                json.append("  \"hasStructTree\": false,\n");
                json.append("  \"error\": \"no_structure_tree\",\n");
                json.append("  \"blocks\": []\n}");
                System.out.println(json);
                return;
            }
            Map<String, List<Glyph>> glyphs = glyphsByMcid(doc);
            Map<COSDictionary, Integer> pageIndex = new HashMap<>();
            for (int i = 0; i < doc.getNumberOfPages(); i++) {
                pageIndex.put(doc.getPage(i).getCOSObject(), i);
            }
            List<PDStructureElement> found = StructText.find(root, BLOCK, root.getRoleMap());
            Map<String, Object> roleMap = root.getRoleMap();
            StructText text = new StructText(doc);
            List<StructText.Box> tables = new ArrayList<>();
            for (PDStructureElement el : found) {
                if ("Table".equals(standard(el, roleMap))) {
                    StructText.Box b = text.boxOf(el);
                    if (b != null) tables.add(b);
                }
            }
            json.append("  \"hasStructTree\": true,\n");
            json.append("  \"blocks\": [\n");
            for (int i = 0; i < found.size(); i++) {
                PDStructureElement el = found.get(i);
                String type = standard(el, roleMap);
                List<Glyph> gs = new ArrayList<>();
                gather(el, null, pageIndex, glyphs, gs, new IdentityHashMap<>());
                String t = wordsOf(gs);
                Face face = gs.isEmpty() ? null : new Face(
                    Math.round(gs.get(0).fontPt),
                    gs.get(0).bold ? "bold" : "regular");
                StructText.Box box = text.boxOf(el);
                boolean inTable = belongsToTable(box, tables);
                json.append("    {\"locator\": ").append(q(stem + ":" + i));
                json.append(", \"existing_tag\": ").append(q(type == null ? "" : type));
                json.append(", \"text\": ").append(q(t));
                if (face == null) {
                    json.append(", \"font_pt\": null, \"weight\": null");
                } else {
                    json.append(", \"font_pt\": ").append(face.fontPt);
                    json.append(", \"weight\": ").append(q(face.weight));
                }
                json.append(", \"ancestors\": [");
                List<String> ancestors = ancestorTypes(el, roleMap);
                for (int a = 0; a < ancestors.size(); a++) {
                    if (a > 0) json.append(", ");
                    json.append(q(ancestors.get(a)));
                }
                json.append("]");
                json.append(", \"in_table_box\": ").append(inTable);
                if (box != null) {
                    json.append(", \"page\": ").append(box.page());
                    json.append(String.format(Locale.ROOT,
                        ", \"x0\":%.4f, \"y0\":%.4f, \"x1\":%.4f, \"y1\":%.4f",
                        box.x0(), box.y0(), box.x1(), box.y1()));
                }
                json.append("}");
                json.append(i < found.size() - 1 ? ",\n" : "\n");
            }
            json.append("  ]\n}");
            System.out.println(json);
        }
    }

    private static Map<String, List<Glyph>> glyphsByMcid(PDDocument doc) throws Exception {
        Map<String, List<Glyph>> out = new HashMap<>();
        for (int i = 0; i < doc.getNumberOfPages(); i++) {
            PDFMarkedContentExtractor ex = new PDFMarkedContentExtractor();
            ex.processPage(doc.getPage(i));
            for (PDMarkedContent mc : ex.getMarkedContents()) harvest(mc, i, out);
        }
        return out;
    }

    private static void harvest(PDMarkedContent mc, int page, Map<String, List<Glyph>> out) {
        for (Object o : mc.getContents()) {
            if (o instanceof TextPosition tp) {
                if (mc.getMCID() < 0) continue;
                String u = tp.getUnicode();
                if (u == null || u.isEmpty()) continue;
                out.computeIfAbsent(page + ":" + mc.getMCID(), k -> new ArrayList<>())
                    .add(new Glyph(
                        u,
                        tp.getXDirAdj(),
                        tp.getYDirAdj(),
                        tp.getWidthDirAdj(),
                        tp.getFontSizeInPt(),
                        isBoldFace(tp.getFont())));
            } else if (o instanceof PDMarkedContent child) {
                harvest(child, page, out);
            }
        }
    }

    private static boolean isBoldFace(PDFont font) {
        if (font == null || font.getName() == null) return false;
        return SUBSET_TAG.matcher(font.getName()).replaceFirst("").toLowerCase().contains("bold");
    }

    private static void gather(
            PDStructureElement el,
            Integer inherited,
            Map<COSDictionary, Integer> pageIndex,
            Map<String, List<Glyph>> glyphs,
            List<Glyph> out,
            Map<Object, Boolean> seen) {
        if (seen.put(el.getCOSObject(), Boolean.TRUE) != null) return;
        List<?> kids = el.getKids();
        if (kids == null) return;
        Integer page = el.getPage() != null
            ? pageIndex.get(el.getPage().getCOSObject())
            : inherited;
        for (Object kid : kids) {
            if (kid instanceof PDStructureElement child) {
                gather(child, page, pageIndex, glyphs, out, seen);
            } else if (kid instanceof Integer mcid) {
                add(page, mcid, glyphs, out);
            } else if (kid instanceof PDMarkedContentReference ref) {
                Integer p = ref.getPage() != null
                    ? pageIndex.get(ref.getPage().getCOSObject())
                    : page;
                add(p, ref.getMCID(), glyphs, out);
            }
        }
    }

    private static void add(Integer page, int mcid, Map<String, List<Glyph>> glyphs, List<Glyph> out) {
        if (page != null) {
            List<Glyph> gs = glyphs.get(page + ":" + mcid);
            if (gs != null) { out.addAll(gs); return; }
        }
        String suffix = ":" + mcid;
        for (Map.Entry<String, List<Glyph>> e : glyphs.entrySet()) {
            if (e.getKey().endsWith(suffix)) { out.addAll(e.getValue()); return; }
        }
    }

    /** Join glyphs; a quarter-em x gap or a line change is a word space. */
    static String wordsOf(List<Glyph> glyphs) {
        if (glyphs.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        Glyph prev = null;
        for (Glyph g : glyphs) {
            if (prev != null) {
                float em = g.fontPt > 0 ? g.fontPt : prev.fontPt;
                float gap = g.x - (prev.x + prev.w);
                float dy = Math.abs(g.y - prev.y);
                if (dy > 0.5f * em || gap > WORD_GAP_EM * em) sb.append(' ');
            }
            sb.append(g.u);
            prev = g;
        }
        return sb.toString().replaceAll("\\s+", " ").trim();
    }

    /**
     * Same parent walk Tables.java / Figures.java already use (`el.getParent()`).
     * Document / Part / Sect stay in the list; the gate keys on Table and Figure.
     */
    private static List<String> ancestorTypes(PDStructureElement el, Map<String, Object> roleMap) {
        List<String> out = new ArrayList<>();
        PDStructureNode n = el.getParent();
        while (n instanceof PDStructureElement p) {
            out.add(standard(p, roleMap));
            n = p.getParent();
        }
        return out;
    }

    /** Headings.java:311–321. Same constants, same tests. Not retuned. */
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

    /** Role-mapped type, same reading Inspect / Headings use. */
    private static String standard(PDStructureElement el, Map<String, Object> roleMap) {
        String type = el.getStructureType();
        if (roleMap != null && type != null && roleMap.get(type) != null) {
            return roleMap.get(type).toString();
        }
        return type == null ? "" : type;
    }

    private static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"'  -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default   -> {
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
                }
            }
        }
        return b.append('"').toString();
    }
}
