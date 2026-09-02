import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;

/**
 * The figures of a document, in the one order every stage agrees on.
 *
 * A punch item names a figure by its ORDINAL — "Figure 3 (p5)" — and a
 * person's description comes back keyed to that ordinal. `Inspect` produces
 * the number and `Finish` writes the description, and if the two ever walked
 * the tree differently a description would land on the wrong figure: a
 * fabricated claim about a client's document that no reviewer could see.
 *
 * So the walk lives here, shared, the way `StructText` is shared between the
 * tool that measures and the tool that acts. Pre-order over `/K`, structure
 * elements only, each visited once by identity (a structure tree is a tree by
 * convention and a graph by format), the type resolved through the RoleMap —
 * exactly the rules `Inspect.walk` applies to everything else, so the k-th
 * `Figure|Formula` entry of its reading order IS the k-th element here.
 *
 * The pipeline's fidelity gate still proves the agreement on every run rather
 * than trusting this file: a description written onto the wrong ordinal moves
 * the `figures` field, and the run is refused.
 */
public final class FigureOrder {

    private FigureOrder() {}

    public static boolean isFigure(String standardType) {
        return "Figure".equals(standardType) || "Formula".equals(standardType);
    }

    public static List<PDStructureElement> inOrder(PDStructureTreeRoot root, Map<String, Object> roleMap) {
        List<PDStructureElement> out = new ArrayList<>();
        if (root != null) {
            walk(root, roleMap, out, Collections.newSetFromMap(new IdentityHashMap<>()));
        }
        return out;
    }

    private static void walk(PDStructureNode node, Map<String, Object> roleMap,
            List<PDStructureElement> out, Set<Object> visited) {
        for (Object kid : node.getKids()) {
            if (!(kid instanceof PDStructureElement el)) continue;
            if (!visited.add(el.getCOSObject())) continue;
            if (isFigure(standard(el.getStructureType(), roleMap))) {
                out.add(el);
            }
            walk(el, roleMap, out, visited);
        }
    }

    /** A structure type through the role map, so custom types count as what they map to. */
    public static String standard(String type, Map<String, Object> roleMap) {
        if (type == null) return "";
        if (roleMap != null && roleMap.containsKey(type)) {
            Object mapped = roleMap.get(type);
            if (mapped != null) return mapped.toString();
        }
        return type;
    }
}
