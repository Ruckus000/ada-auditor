import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;
import org.apache.pdfbox.text.PDFTextStripper;

/**
 * Dumps the facts a ground-truth comparison needs, as JSON on stdout.
 *
 * This exists because token-counting a decoded PDF is not good enough. In
 * experiment 1 it reported 27 /H1 tokens for a document with one heading, which
 * is why heading-level accuracy went unverified. A structure-tree walk gives the
 * real sequence.
 *
 * It reports. It does not judge — comparing against ground truth is compare.mjs
 * and stays out of here, so the thing measuring and the thing deciding are not
 * the same file.
 *
 * Usage: Inspect <file.pdf>
 */
public final class Inspect {

    private static final List<String> HEADINGS = List.of("H1", "H2", "H3", "H4", "H5", "H6");

    private final List<String> headings = new ArrayList<>();
    private final List<String[]> figures = new ArrayList<>();   // {type, alt, actualText}
    private final List<int[]> tables = new ArrayList<>();       // {th, td, tr}
    private Map<String, Object> roleMap;
    private int elements = 0;

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            System.err.println("usage: Inspect <file.pdf>");
            System.exit(2);
        }
        new Inspect().run(args[0]);
    }

    private void run(String path) throws Exception {
        try (PDDocument doc = Loader.loadPDF(new File(path))) {
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();

            StringBuilder json = new StringBuilder("{\n");
            json.append("  \"hasStructTree\": ").append(root != null).append(",\n");

            if (root != null) {
                roleMap = root.getRoleMap();
                walk(root, null);
            }

            PDFTextStripper stripper = new PDFTextStripper();
            String text = stripper.getText(doc).trim();

            json.append("  \"structureElements\": ").append(elements).append(",\n");
            json.append("  \"textChars\": ").append(text.length()).append(",\n");
            json.append("  \"pages\": ").append(doc.getNumberOfPages()).append(",\n");
            json.append("  \"lang\": ").append(q(doc.getDocumentCatalog().getLanguage())).append(",\n");
            json.append("  \"title\": ").append(q(doc.getDocumentInformation().getTitle())).append(",\n");

            json.append("  \"headings\": [");
            for (int i = 0; i < headings.size(); i++) {
                json.append(i > 0 ? ", " : "").append(q(headings.get(i)));
            }
            json.append("],\n");

            json.append("  \"figures\": [\n");
            for (int i = 0; i < figures.size(); i++) {
                String[] f = figures.get(i);
                json.append("    {\"type\": ").append(q(f[0]))
                    .append(", \"alt\": ").append(q(f[1]))
                    .append(", \"actualText\": ").append(q(f[2])).append("}")
                    .append(i < figures.size() - 1 ? "," : "").append("\n");
            }
            json.append("  ],\n");

            json.append("  \"tables\": [");
            for (int i = 0; i < tables.size(); i++) {
                int[] t = tables.get(i);
                json.append(i > 0 ? ", " : "")
                    .append("{\"th\": ").append(t[0])
                    .append(", \"td\": ").append(t[1])
                    .append(", \"tr\": ").append(t[2]).append("}");
            }
            json.append("]\n}");

            System.out.println(json);
        }
    }

    /** Resolves a structure type through the role map, so custom types are scored as what they map to. */
    private String standard(String type) {
        if (type == null) return "";
        if (roleMap != null && roleMap.containsKey(type)) {
            Object mapped = roleMap.get(type);
            if (mapped != null) return mapped.toString();
        }
        return type;
    }

    private void walk(PDStructureNode node, int[] enclosingTable) {
        for (Object kid : node.getKids()) {
            if (!(kid instanceof PDStructureElement el)) continue;
            elements++;

            String type = standard(el.getStructureType());
            int[] table = enclosingTable;

            if (HEADINGS.contains(type)) {
                headings.add(type);
            } else if ("Figure".equals(type) || "Formula".equals(type)) {
                figures.add(new String[] {
                    type, el.getAlternateDescription(), el.getActualText(),
                });
            } else if ("Table".equals(type)) {
                table = new int[] { 0, 0, 0 };
                tables.add(table);
            }

            // Counted against the nearest enclosing Table so a document with two
            // tables does not pool its header cells into one score.
            if (table != null) {
                if ("TH".equals(type)) table[0]++;
                else if ("TD".equals(type)) table[1]++;
                else if ("TR".equals(type)) table[2]++;
            }

            walk(el, table);
        }
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
                default   -> { if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c); }
            }
        }
        return b.append('"').toString();
    }
}
