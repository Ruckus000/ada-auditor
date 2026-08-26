import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSBase;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
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
 * Experiment 2, technique 6: recover /TH from the one piece of evidence the
 * page actually carries about which cells are headers.
 *
 * OpenDataLoader emits /Table, /TR and /TD, correct /RowSpan and /ColSpan, and
 * zero /TH anywhere. Every header becomes a data cell and every header
 * relationship is lost.
 *
 * PROMOTION, unlike Headings.java's demotion, is inherently an assertion: a TH
 * on a data cell invents a relationship a screen reader announces, with nothing
 * to signal to a reviewer that it is wrong. So the bar here is not "probably a
 * header" but "the document says so". Where the document does not say so this
 * pass does nothing and the omission stands.
 *
 * WHAT THE DOCUMENT SAYS. Measured on the development corpus (documents 03 and
 * 12; document 06 is discussed below). In both real tables the header cells are
 * set in Georgia-Bold and every data cell in Georgia — a clean partition, with
 * no bold anywhere in the body and no regular weight anywhere in the headers:
 *
 *     row 0   Depot(rowspan 2) | Review period(colspan 4)      all bold
 *     row 1   Q1 | Q2 | Q3 | Q4                                all bold
 *     row 2   Northern | 184 | 191 | 203 | 221                 bold, then regular
 *     row 3   Southern | 142 | 139 | 145 | 144                 bold, then regular
 *     row 4   Coastal  |  98 |  94 |  91 |  88                 bold, then regular
 *
 * Weight comes from the PostScript font name. That is not the first choice, but
 * it is the only one available: /FontWeight is absent (0.0) on every font in
 * the corpus, the ForceBold descriptor flag is false on the bold faces, and the
 * descriptor flags carry only Serif|Symbolic. StemV does separate them
 * (189.9 bold against 133.8 regular) but only as a comparison inside one
 * family, and it says nothing across families. The name is what is left, and
 * its failure mode is the safe one: an opaquely named bold face is not
 * recognised, which costs an omission, not an assertion.
 *
 * BOLD ALONE IS NOT ENOUGH, so it is never used alone. A bolded total row, a
 * bolded outlier, an all-bold table — each would become a header under a bare
 * weight test. Two structural constraints carry most of the safety, and both
 * are unanimity rules over the whole table rather than judgements about one
 * cell:
 *
 *   R1 HEADER ROWS. The leading run of rows, from row 0, in which every cell is
 *      bold. The run stops at the first row that is not wholly bold, which is
 *      what makes the two-level header work without being told there are two
 *      levels. A bolded row further down the table is unreachable by
 *      construction: the run is anchored at the top and cannot resume.
 *
 *   R2 STUB COLUMN. In the body rows that remain, the first cell of EVERY row
 *      is bold and each of those rows also holds a non-bold cell. Unanimity is
 *      the point — one emphasised label cannot make a header column, and a
 *      wholly bold body row cannot either. A first column that is uniformly
 *      bold across every body row while the rest of each row is not is a stub
 *      column by universal typographic convention.
 *
 *   R3 CONTRAST. If the header run swallows every row there is no body to
 *      contrast against, so there is no evidence of a partition and the table
 *      is left alone entirely.
 *
 * An empty cell is NOT bold. This matters more than it looks: document 06
 * carries a spurious 2x5 /Table that OpenDataLoader invented over a grid of
 * photographs, and every one of its cells is empty. Treating "no glyphs" as
 * "not bold" makes R1 and R2 both fail there. Every unknown resolves towards
 * fewer /TH.
 *
 * That was once the whole answer for document 06, and it was half of one. No
 * /TH was added, which was right, but the /Table itself survived and announced
 * two rows and five columns over a grid of photographs. Refusing to describe a
 * table's headers is not the same as refusing to call it a table. R0 below now
 * removes it, and runs before promotion because a thing that is not a table has
 * no headers to look for.
 *
 * WHAT WAS REJECTED, with the evidence:
 *
 *   Background fill. Real, and in document 03 exactly as precise as weight: a
 *      light grey (0.910, 0.926, 0.945) fills the nine header cells and nothing
 *      else. Rejected because the signal does not generalise — zebra striping
 *      shades alternate BODY rows with the same operator and the same kind of
 *      colour, and nothing in the content stream distinguishes a header shade
 *      from a stripe. It would also need a graphics-stream pass and a
 *      coordinate flip to attribute rectangles to cells, for a signal that is
 *      redundant with weight where it is safe and wrong where it is not.
 *
 *   Text alignment. Checked and it carries nothing. In document 03 the Q1
 *      header ends at x=292.5 and the 184/142/98 cells beneath it end at
 *      x=292.5 — header and data are both right-aligned in the same column.
 *
 *   Data type contrast. Column headers are text over numeric bodies, but the
 *      row headers (Northern, Southern, Coastal) are text over a text column,
 *      so the signal cannot see them at all. It also breaks on any table whose
 *      body is not numeric, which is most tables.
 *
 *   Position alone. First row and first column are guesses, not evidence. The
 *      corpus tables have two header rows, so "first row" would under-tag one
 *      document and would assert a header row on any table that has none.
 *
 * /Scope IS written, and is not optional. The first version of this pass left
 * it out on the reasoning that Scope is a second assertion stacked on the
 * first. veraPDF disagreed: PDF/UA-1 rule 7.5-1 — "if the table's structure is
 * not determinable via Headers and IDs, then structure elements of type TH
 * shall have a Scope attribute" — failed document 03, which had been
 * conformant before this pass touched it. A non-conformant document is graded
 * INCONCLUSIVE, which is worse than the omission the pass set out to fix. So
 * bare TH is not a cheaper, safer TH; it is a broken one.
 *
 * The value follows from whichever rule promoted the cell, so it costs no new
 * inference: R1 cells head columns (Scope=Column), R2 cells head rows
 * (Scope=Row). The rowspan-2 stub head "Depot" was the worry, and it turns out
 * not to be ambiguous — it heads the column of depot names below it, so Column
 * is right, and it is what a hand-written <th scope="col"> would say.
 *
 * Usage: Tables <in.pdf> <out.pdf>
 */
public final class Tables {

    private static final Set<String> TABLES = Set.of("Table");
    private static final Set<String> ROWS = Set.of("TR");
    private static final Set<String> CELLS = Set.of("TD", "TH");

    /** Subset-embedded fonts arrive as "DAAAAA+Georgia-Bold"; the tag is noise. */
    private static final java.util.regex.Pattern SUBSET_TAG =
        java.util.regex.Pattern.compile("^[A-Z]{6}\\+");

    private static int tables, skippedNoContrast, colHeaderCells, rowHeaderCells, untagged;

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: Tables <in.pdf> <out.pdf>");
            System.exit(2);
        }

        try (PDDocument doc = Loader.loadPDF(new File(args[0]))) {
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();

            if (root != null) {
                Map<String, Boolean> boldByMcid = boldByMcid(doc);
                Map<String, Object> roleMap = root.getRoleMap();
                for (PDStructureElement t : StructText.find(root, TABLES, roleMap)) {
                    tables++;
                    // Before asking which cells are headers, ask whether this is
                    // a table at all. A table none of whose cells reference any
                    // content announces rows and columns over nothing.
                    if (empty(t, roleMap)) { untag(t); untagged++; continue; }
                    promote(t, roleMap, boldByMcid);
                }
            }

            doc.save(args[1]);
            System.out.printf(
                "{\"tables\":%d,\"untagged\":%d,\"skippedNoContrast\":%d,\"colHeaderCells\":%d,"
                + "\"rowHeaderCells\":%d,\"th\":%d}%n",
                tables, untagged, skippedNoContrast, colHeaderCells, rowHeaderCells,
                colHeaderCells + rowHeaderCells);
        }
    }

    /**
     * R0. True when no cell in the table references anything at all.
     *
     * Document 06 carries a 2x5 /Table that the tagger invented over a grid of
     * photographs. All seven of its cells are empty — not merely textless, but
     * without a single kid — while every real table in the development corpus
     * has content in 100% of its cells (21, 21, 9, 42, 116 and 132 of each).
     *
     * The test is "references nothing", not "holds no text", and the difference
     * is deliberate. A cell holding a figure and no glyphs would be textless,
     * and removing its table would strip that figure out of the structure tree.
     * Announcing a table that is not there is a false assertion; orphaning
     * content is a worse one. The narrower test still reaches document 06 and
     * cannot reach anything that would be damaged by it.
     */
    private static boolean empty(PDStructureElement table, Map<String, Object> roleMap) {
        List<PDStructureElement> cells = new ArrayList<>();
        for (PDStructureElement tr : StructText.find(table, ROWS, roleMap)) {
            for (Object kid : tr.getKids()) {
                if (kid instanceof PDStructureElement c && CELLS.contains(standard(c, roleMap))) {
                    cells.add(c);
                }
            }
        }
        if (cells.isEmpty()) return false;  // no cells at all is a shape we have not seen
        for (PDStructureElement c : cells) if (!c.getKids().isEmpty()) return false;
        return true;
    }

    /**
     * Removes the table outright. Safe only for the case above: with no cell
     * referencing anything, the whole subtree points at no content and nothing
     * is orphaned by deleting it.
     */
    private static void untag(PDStructureElement table) {
        PDStructureNode parent = table.getParent();
        if (parent != null) parent.removeKid(table);
    }

    private static void promote(PDStructureElement table, Map<String, Object> roleMap,
                                Map<String, Boolean> boldByMcid) {
        List<List<PDStructureElement>> rows = new ArrayList<>();
        for (PDStructureElement tr : StructText.find(table, ROWS, roleMap)) {
            List<PDStructureElement> cells = new ArrayList<>();
            for (Object kid : tr.getKids()) {
                if (kid instanceof PDStructureElement c && CELLS.contains(standard(c, roleMap))) {
                    cells.add(c);
                }
            }
            rows.add(cells);
        }
        if (rows.isEmpty()) return;

        // R1. Leading run of wholly bold rows, anchored at row 0.
        int headerRows = 0;
        while (headerRows < rows.size() && allBold(rows.get(headerRows), boldByMcid)) headerRows++;

        // R3. A header run covering the whole table has nothing to contrast with.
        if (headerRows == rows.size()) { skippedNoContrast++; return; }

        for (int r = 0; r < headerRows; r++) {
            for (PDStructureElement c : rows.get(r)) { markHeader(c, "Column"); colHeaderCells++; }
        }

        // R2. Unanimous bold first cell across every body row, each row also
        // holding a non-bold cell.
        List<List<PDStructureElement>> body = rows.subList(headerRows, rows.size());
        for (List<PDStructureElement> row : body) {
            if (row.size() < 2) return;
            if (!bold(row.get(0), boldByMcid)) return;
            boolean anyRegular = false;
            for (int i = 1; i < row.size(); i++) if (!bold(row.get(i), boldByMcid)) anyRegular = true;
            if (!anyRegular) return;
        }
        for (List<PDStructureElement> row : body) { markHeader(row.get(0), "Row"); rowHeaderCells++; }
    }

    /**
     * TH plus its /Scope, together, because PDF/UA-1 7.5-1 makes a TH without
     * one a conformance failure.
     *
     * OpenDataLoader already writes an /A dictionary carrying /O /Table and the
     * RowSpan or ColSpan on merged cells, so Scope joins that dictionary where
     * it exists rather than replacing it — losing a span would be a worse
     * assertion than the one being added.
     */
    private static void markHeader(PDStructureElement cell, String scope) {
        COSBase a = cell.getCOSObject().getDictionaryObject(COSName.A);
        COSDictionary attrs;
        if (a instanceof COSDictionary d) {
            attrs = d;
        } else if (a instanceof COSArray arr) {
            attrs = new COSDictionary();
            attrs.setItem(COSName.O, TABLE);
            arr.add(attrs);
        } else {
            attrs = new COSDictionary();
            attrs.setItem(COSName.O, TABLE);
            cell.getCOSObject().setItem(COSName.A, attrs);
        }
        attrs.setItem(COSName.O, TABLE);
        attrs.setItem(SCOPE, COSName.getPDFName(scope));
        cell.setStructureType("TH");
    }

    private static final COSName TABLE = COSName.getPDFName("Table");
    private static final COSName SCOPE = COSName.getPDFName("Scope");

    /** Every cell bold, and the row is not empty. */
    private static boolean allBold(List<PDStructureElement> row, Map<String, Boolean> boldByMcid) {
        if (row.isEmpty()) return false;
        for (PDStructureElement c : row) if (!bold(c, boldByMcid)) return false;
        return true;
    }

    /**
     * A cell is bold when it has glyphs and every one of them is set in a bold
     * face. No glyphs means not bold: an unreadable cell is not evidence.
     */
    private static boolean bold(PDStructureElement cell, Map<String, Boolean> boldByMcid) {
        List<Boolean> found = new ArrayList<>();
        gather(cell, null, boldByMcid, found);
        if (found.isEmpty()) return false;
        for (boolean b : found) if (!b) return false;
        return true;
    }

    private static void gather(PDStructureElement el, Integer inherited,
                               Map<String, Boolean> boldByMcid, List<Boolean> out) {
        Integer page = el.getPage() != null ? pageIndex.get(el.getPage()) : inherited;
        for (Object kid : el.getKids()) {
            if (kid instanceof PDStructureElement c) {
                gather(c, page, boldByMcid, out);
            } else if (kid instanceof Integer mcid) {
                add(page, mcid, boldByMcid, out);
            } else if (kid instanceof PDMarkedContentReference ref) {
                Integer p = ref.getPage() != null ? pageIndex.get(ref.getPage()) : page;
                add(p, ref.getMCID(), boldByMcid, out);
            }
        }
    }

    private static void add(Integer page, int mcid, Map<String, Boolean> boldByMcid, List<Boolean> out) {
        if (page != null) {
            Boolean b = boldByMcid.get(page + ":" + mcid);
            if (b != null) { out.add(b); return; }
        }
        // No /Pg on the element — take the id from whichever page holds it.
        for (Map.Entry<String, Boolean> e : boldByMcid.entrySet()) {
            if (e.getKey().endsWith(":" + mcid)) { out.add(e.getValue()); return; }
        }
    }

    private static final Map<PDPage, Integer> pageIndex = new HashMap<>();

    /**
     * "page:mcid" to whether every glyph under that marked content is bold.
     *
     * StructText resolves marked content to text and to a box but not to a
     * font, and it is shared with Inspect and Headings so it is not mine to
     * widen. This is the same walk kept to the one fact this pass needs.
     */
    private static Map<String, Boolean> boldByMcid(PDDocument doc) throws java.io.IOException {
        Map<String, Boolean> out = new HashMap<>();
        for (int i = 0; i < doc.getNumberOfPages(); i++) {
            PDPage page = doc.getPage(i);
            pageIndex.put(page, i);
            PDFMarkedContentExtractor ex = new PDFMarkedContentExtractor();
            ex.processPage(page);
            for (PDMarkedContent mc : ex.getMarkedContents()) harvest(mc, i, out);
        }
        return out;
    }

    private static void harvest(PDMarkedContent mc, int page, Map<String, Boolean> out) {
        for (Object o : mc.getContents()) {
            if (o instanceof TextPosition tp) {
                if (mc.getMCID() < 0) continue;
                out.merge(page + ":" + mc.getMCID(), isBoldFace(tp.getFont()), (a, b) -> a && b);
            } else if (o instanceof PDMarkedContent child) {
                harvest(child, page, out);
            }
        }
    }

    private static boolean isBoldFace(PDFont font) {
        if (font == null || font.getName() == null) return false;
        return SUBSET_TAG.matcher(font.getName()).replaceFirst("").toLowerCase().contains("bold");
    }

    private static String standard(PDStructureElement el, Map<String, Object> roleMap) {
        String type = el.getStructureType();
        if (roleMap != null && type != null && roleMap.get(type) != null) return roleMap.get(type).toString();
        return type == null ? "" : type;
    }
}
