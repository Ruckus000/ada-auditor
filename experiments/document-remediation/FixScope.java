import java.io.File;
import java.util.ArrayList;
import java.util.List;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;

/**
 * Removes one thing LibreOffice's PDF export invents: the scope on a header cell.
 *
 * THE DEFECT. The exporter derives /TH from a paragraph style — a cell styled
 * "Table Heading" becomes a header — and then stamps Scope=Column on it
 * unconditionally. The source states a style. It states no scope. So for any
 * header cell that is not in a header row, Column is the exporter's own claim
 * and it is wrong: the cell heads a row. Thirteen of twenty-one assertions in
 * the measured source-export arm are this one behaviour.
 *
 * WHY NOT FIX IT IN THE SOURCE. The obvious repair is to restyle those cells so
 * they emit /TD instead. Two measurements killed it. "Table Heading" carries
 * fo:font-weight="bold", so restyling strips bold from the client's row labels,
 * and changing how a document looks is not remediating it. And the cells are
 * genuinely <th> upstream — HTML can express a row header, ODF cannot — so
 * restyling throws away true information in order to avoid a false claim, when
 * the false claim can be corrected on its own.
 *
 * THE RULE. A /TH that shares a row with any /TD heads that row: Scope=Row. A row
 * of nothing but /TH is a header row and keeps Scope=Column.
 *
 * This is structural rather than typographic, which is the distinction that
 * matters. Every heading heuristic this project has killed inferred meaning from
 * how something LOOKED. This reads what the table IS. It also handles a two-row
 * header correctly — in a fee schedule with a group header, rows 0 and 1 are
 * entirely /TH and rows 2 onward are one /TH among /TDs — which a "row 0 only"
 * rule would get wrong.
 *
 * It is needed because the export emits no /THead, so there is nothing else to
 * tell a header row by.
 *
 * WHAT IT WILL NOT DO. It never creates a /TH, never removes one, and never
 * touches a cell whose row it cannot read. Deciding whether a cell is a header
 * is the author's, already made in the source. Only the direction is corrected.
 *
 * Usage: FixScope <in.pdf> <out.pdf>
 */
public final class FixScope {

    private static final COSName SCOPE = COSName.getPDFName("Scope");
    private static final COSName ROW = COSName.getPDFName("Row");
    private static final COSName TABLE_ATTR_OWNER = COSName.getPDFName("Table");

    private int fixed = 0;
    private int keptColumn = 0;

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: FixScope <in.pdf> <out.pdf>");
            System.exit(2);
        }
        FixScope f = new FixScope();
        try (PDDocument doc = Loader.loadPDF(new File(args[0]))) {
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();
            if (root != null) f.walk(root);
            doc.save(new File(args[1]));
        }
        System.out.printf("{\"scopeSetToRow\":%d,\"keptColumn\":%d}%n", f.fixed, f.keptColumn);
    }

    private void walk(PDStructureNode node) {
        for (Object kid : node.getKids()) {
            if (!(kid instanceof PDStructureElement el)) continue;
            if ("TR".equals(el.getStandardStructureType())) {
                fixRow(el);
            }
            walk(el);
        }
    }

    /**
     * A row is a header row only if every cell in it is a /TH. One /TH among
     * /TDs is a row label, whatever the exporter claimed about it.
     */
    private void fixRow(PDStructureElement row) {
        List<PDStructureElement> headers = new ArrayList<>();
        boolean sawData = false;
        for (Object kid : row.getKids()) {
            if (!(kid instanceof PDStructureElement cell)) continue;
            String type = cell.getStandardStructureType();
            if ("TH".equals(type)) headers.add(cell);
            else if ("TD".equals(type)) sawData = true;
        }
        if (headers.isEmpty()) return;
        if (!sawData) {
            keptColumn += headers.size();
            return;
        }
        for (PDStructureElement th : headers) {
            if (setScopeRow(th)) fixed++;
        }
    }

    /**
     * Attributes live either in a single dictionary or an array of them, and the
     * one that matters is the dictionary owned by /Table. Writing into the wrong
     * owner produces a file that validates and means nothing, so the owner is
     * checked rather than assumed.
     */
    private boolean setScopeRow(PDStructureElement th) {
        COSDictionary attr = attributeDict(th);
        if (attr == null) return false;
        if (ROW.equals(attr.getCOSName(SCOPE))) return false;
        attr.setItem(SCOPE, ROW);
        return true;
    }

    private COSDictionary attributeDict(PDStructureElement el) {
        var base = el.getCOSObject().getDictionaryObject(COSName.A);
        if (base instanceof COSDictionary d) {
            return TABLE_ATTR_OWNER.equals(d.getCOSName(COSName.O)) ? d : null;
        }
        if (base instanceof org.apache.pdfbox.cos.COSArray arr) {
            for (int i = 0; i < arr.size(); i++) {
                if (arr.getObject(i) instanceof COSDictionary d
                    && TABLE_ATTR_OWNER.equals(d.getCOSName(COSName.O))) {
                    return d;
                }
            }
        }
        return null;
    }
}
