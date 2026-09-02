import java.awt.geom.Point2D;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.pdfbox.contentstream.PDFGraphicsStreamEngine;
import org.apache.pdfbox.contentstream.operator.Operator;
import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSBase;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSInteger;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDMarkedContentReference;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;
import org.apache.pdfbox.pdmodel.graphics.image.PDImage;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.apache.pdfbox.util.Matrix;

/**
 * The figures of a document, in the one order every stage agrees on — and,
 * for each, where it is drawn and what it draws.
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
 *
 * ## Where, and what
 *
 * `locate` runs one content-stream pass per page — the same kind of pass
 * `StructText` makes for text — tracking marked-content ids and recording
 * every image drawn inside one: its placed box from the CTM, and a digest of
 * its raw bytes. `[V]` Page furniture — a logo on every page, a seal, a rule
 * — is one XObject drawn many times, and accounted for 25 of the 35 figures
 * shared across the blind corpus's documents; the digest is what lets a
 * person describe it once and have the description land on every repeat.
 *
 * Only images. A figure drawn as paths (a rule, a chart) locates nothing
 * here and reports null — absent, never invented — the same rule the page
 * number follows. Path geometry can join this pass when something consumes it.
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

    /** Top-down page points, 1-based page — the frame `StructText.Box` uses. */
    public record Box(int page, float x, float y, float w, float h) {
        Box union(Box o) {
            if (o == null || o.page != page) return this;
            float x0 = Math.min(x, o.x), y0 = Math.min(y, o.y);
            float x1 = Math.max(x + w, o.x + o.w), y1 = Math.max(y + h, o.y + o.h);
            return new Box(page, x0, y0, x1 - x0, y1 - y0);
        }
    }

    /** Where a figure is drawn and what it draws; every field null when nothing was found. */
    public record Located(Box box, String digest, String filter) {
        public static final Located NONE = new Located(null, null, null);
    }

    /** One drawn image, keyed to the marked-content id that encloses it. */
    private record Draw(int page, int mcid, Box box, String digest, String filter) {}

    /**
     * Where each figure is drawn and what it draws.
     *
     * The figure's OWN marked content and its children's — a caption parked
     * under a figure by a tagger contributes no image, so descending is safe,
     * and a figure whose image sits in a nested element is found. The page a
     * marked-content id belongs to is the element's `/Pg` or the reference's
     * own; an id with neither is skipped rather than searched for on every
     * page, because ids restart at 0 per page and a first-page hit would be a
     * fabricated location.
     */
    public static Map<PDStructureElement, Located> locate(PDDocument doc, List<PDStructureElement> figures)
            throws IOException {
        Map<PDStructureElement, Located> out = new IdentityHashMap<>();
        if (figures.isEmpty()) return out;

        Map<COSDictionary, Integer> pageNumbers = new HashMap<>();
        Map<Long, List<Draw>> draws = new HashMap<>();
        for (int i = 0; i < doc.getNumberOfPages(); i++) {
            PDPage page = doc.getPage(i);
            pageNumbers.put(page.getCOSObject(), i + 1);
            List<Draw> found = new ArrayList<>();
            new ImageFinder(page, i + 1, found).processPage(page);
            for (Draw d : found) {
                draws.computeIfAbsent(key(d.page, d.mcid), k -> new ArrayList<>()).add(d);
            }
        }

        for (PDStructureElement figure : figures) {
            List<Draw> own = new ArrayList<>();
            collect(figure, pageNumbers, draws, own, Collections.newSetFromMap(new IdentityHashMap<>()));
            if (own.isEmpty()) {
                out.put(figure, Located.NONE);
                continue;
            }
            Box box = null;
            for (Draw d : own) box = d.box.union(box);
            out.put(figure, new Located(box, own.get(0).digest, own.get(0).filter));
        }
        return out;
    }

    private static long key(int page, int mcid) {
        return ((long) page << 32) | (mcid & 0xffffffffL);
    }

    private static void collect(PDStructureElement el, Map<COSDictionary, Integer> pageNumbers,
            Map<Long, List<Draw>> draws, List<Draw> out, Set<Object> seen) {
        if (!seen.add(el.getCOSObject())) return;
        PDPage own = el.getPage();
        Integer page = own == null ? null : pageNumbers.get(own.getCOSObject());
        for (Object kid : el.getKids()) {
            if (kid instanceof PDStructureElement child) {
                collect(child, pageNumbers, draws, out, seen);
            } else if (kid instanceof Integer mcid) {
                if (page != null) out.addAll(draws.getOrDefault(key(page, mcid), List.of()));
            } else if (kid instanceof PDMarkedContentReference ref) {
                PDPage refPage = ref.getPage();
                Integer p = refPage == null ? page : pageNumbers.get(refPage.getCOSObject());
                if (p != null) out.addAll(draws.getOrDefault(key(p, ref.getMCID()), List.of()));
            }
        }
    }

    /** Placed box and content digest of every image drawn inside marked content. */
    private static final class ImageFinder extends PDFGraphicsStreamEngine {
        private final int pageNumber;
        private final float pageHeight;
        private final List<Draw> out;
        private final java.util.ArrayDeque<Integer> mcids = new java.util.ArrayDeque<>();

        ImageFinder(PDPage page, int pageNumber, List<Draw> out) {
            super(page);
            this.pageNumber = pageNumber;
            this.pageHeight = page.getMediaBox().getHeight();
            this.out = out;
        }

        @Override
        protected void processOperator(Operator op, List<COSBase> operands) throws IOException {
            String name = op.getName();
            if ("BDC".equals(name) || "BMC".equals(name)) {
                int mcid = -1;
                if (operands.size() >= 2 && operands.get(1) instanceof COSDictionary props
                        && props.getDictionaryObject(COSName.MCID) instanceof COSInteger ci) {
                    mcid = ci.intValue();
                }
                mcids.push(mcid);
            } else if ("EMC".equals(name)) {
                if (!mcids.isEmpty()) mcids.pop();
            }
            super.processOperator(op, operands);
        }

        @Override
        public void drawImage(PDImage image) {
            int mcid = mcids.isEmpty() ? -1 : mcids.peek();
            if (mcid < 0) return;
            // The unit square under the CTM is where the image lands; its
            // bounding box in top-down page points is what a person can be
            // pointed at.
            Matrix m = getGraphicsState().getCurrentTransformationMatrix();
            float x0 = Float.MAX_VALUE, y0 = Float.MAX_VALUE, x1 = -Float.MAX_VALUE, y1 = -Float.MAX_VALUE;
            for (float[] corner : new float[][] {{0, 0}, {1, 0}, {0, 1}, {1, 1}}) {
                Point2D p = m.transformPoint(corner[0], corner[1]);
                x0 = Math.min(x0, (float) p.getX());
                x1 = Math.max(x1, (float) p.getX());
                y0 = Math.min(y0, (float) p.getY());
                y1 = Math.max(y1, (float) p.getY());
            }
            Box box = new Box(pageNumber, x0, pageHeight - y1, x1 - x0, y1 - y0);
            out.add(new Draw(pageNumber, mcid, box, digest(image), filter(image)));
        }

        /**
         * SHA-256 of the RAW stream plus its dimensions: two producers' shapes
         * — one shared XObject drawn on every page, and per-page copies of the
         * same bytes — hash the same, and decoding is never attempted, so an
         * image this toolchain cannot decode (JPX) still has an identity.
         */
        private static String digest(PDImage image) {
            try {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream is = image instanceof PDImageXObject x
                        ? x.getCOSObject().createRawInputStream()
                        : image.createInputStream()) {
                    byte[] buf = new byte[16384];
                    for (int n; (n = is.read(buf)) > 0; ) md.update(buf, 0, n);
                }
                md.update((image.getWidth() + "x" + image.getHeight() + "x" + image.getBitsPerComponent())
                    .getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                return "sha256:" + HexFormat.of().formatHex(md.digest());
            } catch (Exception e) {
                // Unreadable bytes mean no identity, so no repeat can be
                // claimed for this image.
                return null;
            }
        }

        private static String filter(PDImage image) {
            if (!(image instanceof PDImageXObject x)) return null;
            COSBase filters = x.getCOSObject().getDictionaryObject(COSName.FILTER);
            if (filters instanceof COSName name) return name.getName();
            if (filters instanceof COSArray array && array.size() > 0) {
                List<String> names = new ArrayList<>();
                for (int i = 0; i < array.size(); i++) {
                    if (array.getObject(i) instanceof COSName name) names.add(name.getName());
                }
                return String.join("+", names);
            }
            return null;
        }

        @Override public void appendRectangle(Point2D p0, Point2D p1, Point2D p2, Point2D p3) {}
        @Override public void clip(int windingRule) {}
        @Override public void moveTo(float x, float y) {}
        @Override public void lineTo(float x, float y) {}
        @Override public void curveTo(float x1, float y1, float x2, float y2, float x3, float y3) {}
        @Override public Point2D getCurrentPoint() { return new Point2D.Float(); }
        @Override public void closePath() {}
        @Override public void endPath() {}
        @Override public void strokePath() {}
        @Override public void fillPath(int windingRule) {}
        @Override public void fillAndStrokePath(int windingRule) {}
        @Override public void shadingFill(COSName shadingName) {}
    }
}
