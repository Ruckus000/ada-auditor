import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDMarkedContentReference;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;
import org.apache.pdfbox.pdmodel.documentinterchange.markedcontent.PDMarkedContent;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.text.PDFMarkedContentExtractor;
import org.apache.pdfbox.text.TextPosition;

/**
 * Experiment-only PDF → classifier-card dump.
 *
 * Candidate universe is Inspect.order BLOCK types via StructText.find.
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
            json.append("  \"hasStructTree\": true,\n");
            json.append("  \"blocks\": [\n");
            for (int i = 0; i < found.size(); i++) {
                PDStructureElement el = found.get(i);
                String type = el.getStructureType();
                Map<String, Object> roleMap = root.getRoleMap();
                if (roleMap != null && type != null && roleMap.get(type) != null) {
                    type = roleMap.get(type).toString();
                }
                List<Glyph> gs = new ArrayList<>();
                gather(el, null, pageIndex, glyphs, gs, new IdentityHashMap<>());
                String t = wordsOf(gs);
                Face face = gs.isEmpty() ? null : new Face(
                    Math.round(gs.get(0).fontPt),
                    gs.get(0).bold ? "bold" : "regular");
                json.append("    {\"locator\": ").append(q(stem + ":" + i));
                json.append(", \"existing_tag\": ").append(q(type == null ? "" : type));
                json.append(", \"text\": ").append(q(t));
                if (face == null) {
                    json.append(", \"font_pt\": null, \"weight\": null");
                } else {
                    json.append(", \"font_pt\": ").append(face.fontPt);
                    json.append(", \"weight\": ").append(q(face.weight));
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
