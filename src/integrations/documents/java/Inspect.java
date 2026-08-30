import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.interactive.annotation.PDAnnotation;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentNameDictionary;
import org.apache.pdfbox.pdmodel.common.PDNameTreeNode;
import org.apache.pdfbox.pdmodel.common.filespecification.PDComplexFileSpecification;
import org.apache.pdfbox.pdmodel.PDEmbeddedFilesNameTreeNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDResources;
import org.apache.pdfbox.pdmodel.graphics.PDXObject;
import org.apache.pdfbox.pdmodel.graphics.form.PDFormXObject;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
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

    private final List<String[]> headings = new ArrayList<>();  // {type, text}
    private final List<String[]> figures = new ArrayList<>();   // {type, alt, actualText}
    /**
     * Per table: cell counts, and the TEXT of every cell promoted to TH.
     *
     * Counts alone cannot catch a bad header pass. A tool that marked every
     * cell TH would clear the "zero /TH" omission and look like a fix, because
     * nothing was checking WHICH cells became headers. The texts are what let
     * the comparator verify promotions against ground truth instead of trusting
     * that some header is better than none.
     */
    private static final class Tbl {
        int th, td, tr;
        /** {type, text, scope, rowIndex} per cell, in document order. */
        final List<String[]> cells = new ArrayList<>();
    }

    private final List<Tbl> tables = new ArrayList<>();

    /** Block-level elements in structure order — the document's reading order. */
    private final List<String[]> order = new ArrayList<>();   // {type, text}

    /** Lists, with nesting depth and direct item count. */
    private static final class Lst {
        int depth, items;
    }
    private final List<Lst> lists = new ArrayList<>();

    private static final List<String> BLOCK = List.of(
        "H1", "H2", "H3", "H4", "H5", "H6", "P", "Figure", "Table", "L", "LI", "Caption", "Formula");
    private Map<String, Object> roleMap;
    private int elements = 0;

    /**
     * Structure elements already walked, so a hostile tree cannot be walked
     * forever.
     *
     * A structure tree is a tree by convention and a graph by format: nothing
     * in a PDF stops an element being its own descendant, or two parents
     * sharing one subtree. The first recurses until the JVM's stack gives out;
     * the second is exponential in the sharing depth, and both arrive as a
     * document somebody uploaded. `imageCount` above already declines to
     * recurse XObjects for exactly this reason — the tree walk simply never
     * got the same guard.
     *
     * Identity, not equality: two distinct elements can carry equal
     * dictionaries, and collapsing those would silently drop real content.
     * This asks the narrower question, "have I walked *this* object", which is
     * the one that bounds the walk.
     *
     * Skipping a repeat loses nothing. A second visit would re-report a node
     * already in `order`, `headings` or `tables`, so this removes duplicates
     * rather than truncating — which is why nothing in the output announces it.
     */
    private final Set<Object> visited =
        java.util.Collections.newSetFromMap(new IdentityHashMap<>());
    /** Shared with Headings, so the tool that measures and the tool that acts
        cannot disagree about what a heading says. */
    private StructText text;

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            System.err.println("usage: Inspect <file.pdf>");
            System.exit(2);
        }
        new Inspect().run(args[0]);
    }

    /**
     * How many image XObjects the pages draw, regardless of whether the
     * structure tree mentions them.
     *
     * The comparator needs this to tell two very different failures apart, and
     * it could not before. A meaningful image ARTIFACTED out of the tree is a
     * positive claim that it carries no meaning: the reader is told nothing is
     * there and veraPDF passes clean, because no Figure means no 7.3-1. A
     * document that simply never had the image is an honest gap. Both look
     * identical from the tree alone — `figures` is empty either way — which is
     * how a document that lost all four of its meaningful images scored
     * DELIVERABLE with zero defects.
     *
     * Reported as a count and nothing more. Deciding what it means belongs to
     * compare.mjs, and the split is the point.
     *
     * Forms are walked one level deep because that is where a placed image
     * usually lands; deeper nesting is rare and recursing needs cycle
     * detection, which is not worth it for a count.
     */
    /**
     * Widget and Link annotations that are not nested in the structure tree.
     *
     * An annotation reaches the reading order through `/StructParent`, which
     * indexes it into the number tree the structure elements point at. Absent,
     * the form field or link exists on the page and nowhere in the document's
     * structure — a screen reader cannot reach it in order, and veraPDF fails
     * it (7.18.1). Counted rather than repaired: nesting an annotation means
     * creating and placing a structure element, which is the inference the
     * spike's STOP forbids.
     *
     * Widget and Link only. Those are the kinds measured failing on the real
     * corpus, and PDF/UA exempts others (Popup among them) — counting every
     * subtype would report work that nobody has to do, which is its own kind
     * of dishonesty.
     */
    private static int unnestedAnnotations(PDDocument doc) {
        int n = 0;
        for (PDPage page : doc.getPages()) {
            List<PDAnnotation> annotations;
            try {
                annotations = page.getAnnotations();
            } catch (IOException e) {
                // One unreadable page's annotations must not fail the reading.
                continue;
            }
            for (PDAnnotation annotation : annotations) {
                String subtype = annotation.getSubtype();
                if (!"Widget".equals(subtype) && !"Link".equals(subtype)) continue;
                // PDFBox answers 0 for an absent key, and 0 is also a legal
                // index — so the key's presence is what is asked, not its
                // value.
                if (!annotation.getCOSObject().containsKey(COSName.STRUCT_PARENT)) {
                    n++;
                }
            }
        }
        return n;
    }

    /**
     * Documents attached to this one.
     *
     * A portfolio is a cover sheet with other documents inside it, and a plain
     * PDF can carry attachments the same way — both through the EmbeddedFiles
     * name tree. Neither instrument looks inside one: our reading walks this
     * document's structure, and veraPDF validates this document's bytes, so an
     * attached file that nobody remediated fails no clause and produces no
     * finding.
     *
     * `[V]` The blind corpus planted exactly that and watched it deliver
     * clean: a tagged cover sheet over an untagged payload, with an empty
     * punch list. Counted here so the punch list can say so — the count is all
     * that leaves this stage, never a filename, because attachment names are
     * document content and the punch list renders on a public page.
     *
     * Counted, not opened. Remediating an attachment would mean rewriting the
     * container around it, and the honest instruction is that each attached
     * document goes through this pipeline on its own.
     */
    private static int embeddedFiles(PDDocument doc) {
        PDDocumentNameDictionary names = doc.getDocumentCatalog().getNames();
        if (names == null) return 0;
        PDEmbeddedFilesNameTreeNode tree = names.getEmbeddedFiles();
        if (tree == null) return 0;
        return countNames(tree, 0);
    }

    /**
     * A name tree is a tree, and a malformed one can be a graph — so the walk
     * is depth-bounded for the reason the structure walk is.
     */
    private static int countNames(PDNameTreeNode<PDComplexFileSpecification> node, int depth) {
        if (depth > 64) return 0;
        int n = 0;
        try {
            Map<String, PDComplexFileSpecification> here = node.getNames();
            if (here != null) n += here.size();
        } catch (IOException e) {
            // An unreadable branch is not a reason to fail the whole reading.
        }
        List<PDNameTreeNode<PDComplexFileSpecification>> kids = node.getKids();
        if (kids != null) {
            for (PDNameTreeNode<PDComplexFileSpecification> kid : kids) {
                n += countNames(kid, depth + 1);
            }
        }
        return n;
    }

    private static int imageCount(PDDocument doc) {
        int n = 0;
        for (PDPage page : doc.getPages()) {
            PDResources res = page.getResources();
            if (res == null) continue;
            for (COSName name : res.getXObjectNames()) {
                try {
                    PDXObject xo = res.getXObject(name);
                    if (xo instanceof PDImageXObject) {
                        n++;
                    } else if (xo instanceof PDFormXObject form) {
                        PDResources inner = form.getResources();
                        if (inner == null) continue;
                        for (COSName k : inner.getXObjectNames()) {
                            if (inner.getXObject(k) instanceof PDImageXObject) n++;
                        }
                    }
                } catch (java.io.IOException e) {
                    // An XObject we cannot parse is one we cannot count. Skipping
                    // it undercounts, which reports an omission where there may be
                    // an assertion — the direction that under-claims rather than
                    // invents, which is the right way to be wrong here.
                }
            }
        }
        return n;
    }

    private void run(String path) throws Exception {
        try (PDDocument doc = Loader.loadPDF(new File(path))) {
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();

            StringBuilder json = new StringBuilder("{\n");
            json.append("  \"hasStructTree\": ").append(root != null).append(",\n");
            // What the document CLAIMS about itself, as distinct from what it
            // has. A file asserting Marked true with no structure elements is
            // making a false statement about its own accessibility, and that
            // is a finding rather than a detail — reporting it is the whole
            // difference between "we left a gap" and "somebody asserted".
            // Whether the document carries a real digital signature.
            //
            // PDFBox's own accessor rather than a search for /ByteRange: it
            // walks the AcroForm's signature fields and returns the signature
            // dictionaries, so an UNSIGNED signature field — a placeholder
            // waiting for somebody to sign — correctly reads as unsigned.
            //
            // Repair rewrites the document catalog, which invalidates a
            // signature. An incremental save does not rescue that: it
            // preserves earlier signatures only for additive operations
            // DocMDP permits, not for edits. So this fact exists to be
            // refused on, in `services/document-repair.ts`.
            json.append("  \"signed\": ")
                .append(!doc.getSignatureDictionaries().isEmpty())
                .append(",\n");
            json.append("  \"marked\": ")
                .append(doc.getDocumentCatalog().getMarkInfo() != null
                    && doc.getDocumentCatalog().getMarkInfo().isMarked())
                .append(",\n");

            text = new StructText(doc);

            if (root != null) {
                roleMap = root.getRoleMap();
                walk(root, null);
            }

            PDFTextStripper stripper = new PDFTextStripper();
            String text = stripper.getText(doc).trim();

            json.append("  \"structureElements\": ").append(elements).append(",\n");
            json.append("  \"textChars\": ").append(text.length()).append(",\n");
            json.append("  \"images\": ").append(imageCount(doc)).append(",\n");
            json.append("  \"annotationsNotInStructure\": ")
                .append(unnestedAnnotations(doc))
                .append(",\n");
            json.append("  \"embeddedFiles\": ").append(embeddedFiles(doc)).append(",\n");
            json.append("  \"pages\": ").append(doc.getNumberOfPages()).append(",\n");
            json.append("  \"lang\": ").append(q(doc.getDocumentCatalog().getLanguage())).append(",\n");
            json.append("  \"title\": ").append(q(doc.getDocumentInformation().getTitle())).append(",\n");

            json.append("  \"headings\": [");
            for (int i = 0; i < headings.size(); i++) {
                json.append(i > 0 ? ", " : "").append(q(headings.get(i)[0]));
            }
            json.append("],\n");

            json.append("  \"headingTexts\": [\n");
            for (int i = 0; i < headings.size(); i++) {
                json.append("    {\"level\": ").append(q(headings.get(i)[0]))
                    .append(", \"text\": ").append(q(headings.get(i)[1])).append("}")
                    .append(i < headings.size() - 1 ? "," : "").append("\n");
            }
            json.append("  ],\n");

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
                Tbl t = tables.get(i);
                json.append(i > 0 ? ",\n    " : "\n    ")
                    .append("{\"th\": ").append(t.th)
                    .append(", \"td\": ").append(t.td)
                    .append(", \"tr\": ").append(t.tr)
                    .append(", \"cells\": [");
                for (int k = 0; k < t.cells.size(); k++) {
                    String[] c = t.cells.get(k);
                    json.append(k > 0 ? ", " : "")
                        .append("{\"type\": ").append(q(c[0]))
                        .append(", \"text\": ").append(q(c[1]))
                        .append(", \"scope\": ").append(q(c[2]))
                        .append(", \"row\": ").append(c[3]).append("}");
                }
                json.append("]}");
            }
            json.append("\n  ],\n");

            json.append("  \"lists\": [");
            for (int i = 0; i < lists.size(); i++) {
                json.append(i > 0 ? ", " : "")
                    .append("{\"depth\": ").append(lists.get(i).depth)
                    .append(", \"items\": ").append(lists.get(i).items).append("}");
            }
            json.append("],\n");

            json.append("  \"order\": [\n");
            for (int i = 0; i < order.size(); i++) {
                json.append("    {\"type\": ").append(q(order.get(i)[0]))
                    .append(", \"text\": ").append(q(order.get(i)[1])).append("}")
                    .append(i < order.size() - 1 ? "," : "").append("\n");
            }
            json.append("  ]\n}");

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

    private void walk(PDStructureNode node, Tbl enclosingTable) {
        walk(node, enclosingTable, null, 0);
    }

    private void walk(PDStructureNode node, Tbl enclosingTable, Lst enclosingList, int listDepth) {
        for (Object kid : node.getKids()) {
            if (!(kid instanceof PDStructureElement el)) continue;
            // Before `elements++`, so the count stays a count of distinct
            // elements rather than of visits.
            if (!visited.add(el.getCOSObject())) continue;
            elements++;

            String type = standard(el.getStructureType());
            Tbl table = enclosingTable;
            Lst list = enclosingList;
            int depth = listDepth;

            if (BLOCK.contains(type)) {
                String t = text.of(el);
                order.add(new String[] { type, t.length() > 90 ? t.substring(0, 90) : t });
            }
            if ("L".equals(type)) {
                list = new Lst();
                depth = listDepth + 1;
                list.depth = depth;
                lists.add(list);
            } else if ("LI".equals(type) && list != null && depth == listDepth) {
                // Counted against the nearest enclosing list only, so a nested
                // list's items are not also credited to its parent.
                list.items++;
            }

            if (HEADINGS.contains(type)) {
                // Text matters as much as level: knowing a document has one
                // heading too many says nothing about which one is wrong.
                headings.add(new String[] { type, text.of(el) });
            } else if ("Figure".equals(type) || "Formula".equals(type)) {
                figures.add(new String[] {
                    type, el.getAlternateDescription(), el.getActualText(),
                });
            } else if ("Table".equals(type)) {
                table = new Tbl();
                tables.add(table);
            }

            // Counted against the nearest enclosing Table so a document with two
            // tables does not pool its header cells into one score.
            if (table != null) {
                if ("TR".equals(type)) {
                    table.tr++;
                } else if ("TH".equals(type) || "TD".equals(type)) {
                    if ("TH".equals(type)) table.th++; else table.td++;
                    // Row index matters as much as the text. A header with the
                    // right words in the wrong row is still an invented
                    // relationship, and a set comparison cannot see it.
                    table.cells.add(new String[] {
                        type, text.of(el), scopeOf(el), String.valueOf(table.tr - 1),
                    });
                }
            }

            walk(el, table, list, depth);
        }
    }

    /** /Scope from the cell's Table attribute dictionary, or null if it has none. */
    private static String scopeOf(PDStructureElement el) {
        org.apache.pdfbox.cos.COSBase a = el.getCOSObject().getDictionaryObject(COSName.A);
        if (a instanceof org.apache.pdfbox.cos.COSDictionary d) return nameAt(d);
        if (a instanceof org.apache.pdfbox.cos.COSArray arr) {
            for (int i = 0; i < arr.size(); i++) {
                if (arr.getObject(i) instanceof org.apache.pdfbox.cos.COSDictionary d2) {
                    String v = nameAt(d2);
                    if (v != null) return v;
                }
            }
        }
        return null;
    }

    private static String nameAt(org.apache.pdfbox.cos.COSDictionary d) {
        org.apache.pdfbox.cos.COSBase v = d.getDictionaryObject(COSName.getPDFName("Scope"));
        return v instanceof COSName n ? n.getName() : null;
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
