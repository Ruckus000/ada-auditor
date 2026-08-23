import java.awt.geom.Point2D;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.contentstream.PDFGraphicsStreamEngine;
import org.apache.pdfbox.contentstream.operator.Operator;
import org.apache.pdfbox.cos.COSBase;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSInteger;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdfparser.PDFStreamParser;
import org.apache.pdfbox.pdfwriter.ContentStreamWriter;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDStream;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDMarkedContentReference;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;
import org.apache.pdfbox.pdmodel.graphics.image.PDImage;
import org.apache.pdfbox.util.Matrix;

/**
 * Experiment 2, technique 6: stop asserting that decorative and repeated
 * graphics are content.
 *
 * OpenDataLoader wraps a /Figure around every image it finds, including a
 * gradient rule used as a visual separator and a logo repeated in a running
 * brand bar. A /Figure is a claim that the graphic carries meaning, and a
 * screen reader announces it. On three corpus documents that claim is false.
 *
 * The danger runs the other way too, and harder. Marking a MEANINGFUL image as
 * an artifact hides it from a screen reader with no signal that anything went
 * missing — a worse defect than the one being fixed, and an invisible one. So
 * the two tests below were chosen to be things that can be MEASURED about an
 * image rather than guessed about it, and each is deliberately narrow.
 *
 * TEST 1 — a band too thin to depict anything.
 *   The image's short side is at most 16 source pixels AND its placed box is at
 *   least 20 times longer than it is thick. Both halves are load-bearing. Area
 *   is NOT used and must not be: in document 06 the decorative rule covers more
 *   of the page than the meaningful logo does, so any size threshold hides the
 *   logo and keeps the rule. Elongation says "this is a rule, not a picture";
 *   the pixel bound says "there is no room in here for a picture". A 16x16 icon
 *   fails the first, a full-width wordmark rendered at 40px tall fails the
 *   second, and both stay figures.
 *
 * TEST 2 — the same image already tagged as a figure on another page.
 *   Byte-identical images tagged as separate figures on different pages are
 *   running page furniture. The FIRST occurrence is kept, so the graphic is
 *   still described once; only the repeats become artifacts. This cannot hide
 *   anything, because nothing is removed that is not also still present.
 *
 * A figure that already carries an Alt or ActualText is never touched. Captions
 * runs upstream and only writes an Alt it found in the document, so a figure
 * holding one has an author-written description and is meaningful by
 * definition.
 *
 * Marking as artifact means two edits, not one: the content stream's
 * "/Figure <</MCID n>> BDC" becomes "/Artifact <<>> BDC", and the Figure
 * element leaves the structure tree. Doing only the second orphans the marked
 * content and fails PDF/UA 7.1. Any structural children the Figure had — in
 * document 06 the tagger parked an entire paragraph under the rule as a
 * Caption — move up into the Figure's place rather than leaving with it.
 *
 * Usage: Figures <in.pdf> <out.pdf>          (writes a JSON report to stdout)
 */
public final class Figures {

    /** An image can hold no picture across this few pixels. */
    private static final int MAX_THIN_PIXELS = 16;
    /** And a rule is far longer than it is thick. */
    private static final float MIN_RULE_RATIO = 20f;

    /** One drawn image, keyed to the marked-content id that encloses it. */
    private record Draw(int page, int mcid, float placedW, float placedH, int pixelW, int pixelH, String sha) {
        float ratio() {
            float lo = Math.min(placedW, placedH), hi = Math.max(placedW, placedH);
            return lo <= 0 ? 0 : hi / lo;
        }
        boolean thinBand() {
            return Math.min(pixelW, pixelH) <= MAX_THIN_PIXELS && ratio() >= MIN_RULE_RATIO;
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: Figures <in.pdf> <out.pdf>");
            System.exit(2);
        }
        new Figures().run(args[0], args[1]);
    }

    private void run(String in, String out) throws Exception {
        try (PDDocument doc = Loader.loadPDF(new File(in))) {
            Map<PDPage, Integer> pageIndex = new HashMap<>();
            List<Draw> draws = new ArrayList<>();
            for (int i = 0; i < doc.getNumberOfPages(); i++) {
                PDPage page = doc.getPage(i);
                pageIndex.put(page, i);
                new ImageFinder(page, i, draws).processPage(page);
            }

            List<PDStructureElement> figures = new ArrayList<>();
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();
            if (root != null) collectFigures(root, figures);

            // Figure -> the single image it encloses, in document order.
            Map<PDStructureElement, Draw> located = new LinkedHashMap<>();
            int described = 0, unlocated = 0;
            for (PDStructureElement fig : figures) {
                if (notBlank(fig.getAlternateDescription()) || notBlank(fig.getActualText())) { described++; continue; }
                Draw d = locate(fig, draws, pageIndex);
                if (d == null) unlocated++; else located.put(fig, d);
            }

            // Test 2 needs to know which pages each image is already a figure on.
            Map<String, Integer> firstPage = new HashMap<>();
            for (Draw d : located.values()) firstPage.putIfAbsent(d.sha(), d.page());

            Map<Integer, List<Integer>> targetsByPage = new LinkedHashMap<>();
            Map<PDStructureElement, String> reasons = new LinkedHashMap<>();
            for (Map.Entry<PDStructureElement, Draw> e : located.entrySet()) {
                Draw d = e.getValue();
                String why = d.thinBand() ? "thin-band"
                           : d.page() != firstPage.get(d.sha()) ? "repeated-on-later-page"
                           : null;
                if (why == null) continue;
                reasons.put(e.getKey(), why);
                targetsByPage.computeIfAbsent(d.page(), k -> new ArrayList<>()).add(d.mcid());
            }

            // Rewrite first: a Figure only leaves the tree if its content
            // actually became an artifact, so the two can never disagree.
            int converted = 0;
            for (Map.Entry<Integer, List<Integer>> e : targetsByPage.entrySet()) {
                converted += artifact(doc, doc.getPage(e.getKey()), e.getValue());
            }
            int removed = 0;
            for (Map.Entry<PDStructureElement, String> e : reasons.entrySet()) {
                Draw d = located.get(e.getKey());
                if (!targetsByPage.getOrDefault(d.page(), List.of()).contains(d.mcid())) continue;
                if (detach(e.getKey())) removed++;
            }

            doc.save(out);

            long thin = reasons.values().stream().filter("thin-band"::equals).count();
            System.out.println("{\"figures\":" + figures.size()
                + ",\"described\":" + described
                + ",\"unlocated\":" + unlocated
                + ",\"thinBand\":" + thin
                + ",\"repeated\":" + (reasons.size() - thin)
                + ",\"artifacted\":" + converted
                + ",\"removed\":" + removed
                + ",\"kept\":" + (figures.size() - removed) + "}");
        }
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }

    /**
     * Turns "/Figure <</MCID n>> BDC" into "/Artifact <<>> BDC" for the given
     * ids. Returns how many were actually converted — a property list held
     * indirectly in the page resources is left alone rather than guessed at.
     */
    private int artifact(PDDocument doc, PDPage page, List<Integer> mcids) throws IOException {
        List<Object> tokens = new PDFStreamParser(page).parse();
        int done = 0;
        for (int i = 2; i < tokens.size(); i++) {
            if (!(tokens.get(i) instanceof Operator op) || !"BDC".equals(op.getName())) continue;
            if (!(tokens.get(i - 1) instanceof COSDictionary props)) continue;
            if (!(props.getDictionaryObject(COSName.MCID) instanceof COSInteger id)) continue;
            if (!mcids.contains(id.intValue())) continue;
            tokens.set(i - 2, COSName.getPDFName("Artifact"));
            tokens.set(i - 1, new COSDictionary());
            done++;
        }
        if (done == 0) return 0;
        PDStream rewritten = new PDStream(doc);
        try (OutputStream os = rewritten.createOutputStream(COSName.FLATE_DECODE)) {
            new ContentStreamWriter(os).writeTokens(tokens);
        }
        page.setContents(rewritten);
        return done;
    }

    /** Removes the element, leaving any structural children in its place. */
    private boolean detach(PDStructureElement fig) {
        PDStructureNode parent = fig.getParent();
        if (parent == null) return false;
        for (Object kid : new ArrayList<>(fig.getKids())) {
            if (!(kid instanceof PDStructureElement child)) continue;
            fig.removeKid(child);
            parent.insertBefore(child, fig);
            child.setParent(parent);
        }
        return parent.removeKid(fig);
    }

    /**
     * The image this Figure encloses. Only the element's OWN marked-content
     * ids count: in document 06 the tagger nested a whole paragraph under a
     * rule as a Caption, and descending into it would locate the wrong thing.
     */
    private Draw locate(PDStructureElement fig, List<Draw> draws, Map<PDPage, Integer> pageIndex) {
        Integer page = fig.getPage() != null ? pageIndex.get(fig.getPage()) : null;
        for (Object kid : fig.getKids()) {
            int mcid;
            Integer p = page;
            if (kid instanceof Integer i) mcid = i;
            else if (kid instanceof PDMarkedContentReference r) {
                mcid = r.getMCID();
                if (r.getPage() != null) p = pageIndex.get(r.getPage());
            } else continue;
            for (Draw d : draws) if (d.mcid() == mcid && (p == null || d.page() == p)) return d;
        }
        return null;
    }

    private void collectFigures(PDStructureNode node, List<PDStructureElement> out) {
        for (Object kid : node.getKids()) {
            if (!(kid instanceof PDStructureElement el)) continue;
            if ("Figure".equals(el.getStructureType())) out.add(el);
            collectFigures(el, out);
        }
    }

    /** Placed size, source size and content hash of every drawn image. */
    private static final class ImageFinder extends PDFGraphicsStreamEngine {
        private final int pageIndex;
        private final List<Draw> out;
        private final java.util.ArrayDeque<Integer> mcids = new java.util.ArrayDeque<>();

        ImageFinder(PDPage page, int pageIndex, List<Draw> out) {
            super(page);
            this.pageIndex = pageIndex;
            this.out = out;
        }

        @Override
        protected void processOperator(Operator op, List<COSBase> operands) throws IOException {
            String name = op.getName();
            if ("BDC".equals(name) || "BMC".equals(name)) {
                Integer mcid = null;
                if (operands.size() >= 2 && operands.get(1) instanceof COSDictionary props
                        && props.getDictionaryObject(COSName.MCID) instanceof COSInteger ci) {
                    mcid = ci.intValue();
                }
                mcids.push(mcid == null ? -1 : mcid);
            } else if ("EMC".equals(name)) {
                if (!mcids.isEmpty()) mcids.pop();
            }
            super.processOperator(op, operands);
        }

        @Override
        public void drawImage(PDImage image) throws IOException {
            int mcid = mcids.isEmpty() ? -1 : mcids.peek();
            if (mcid < 0) return;
            Matrix m = getGraphicsState().getCurrentTransformationMatrix();
            out.add(new Draw(pageIndex, mcid,
                Math.abs(m.getScalingFactorX()), Math.abs(m.getScalingFactorY()),
                image.getWidth(), image.getHeight(), sha1(image)));
        }

        private static String sha1(PDImage image) {
            try (java.io.InputStream is = image.createInputStream()) {
                MessageDigest md = MessageDigest.getInstance("SHA-1");
                byte[] buf = new byte[16384];
                for (int n; (n = is.read(buf)) > 0; ) md.update(buf, 0, n);
                return HexFormat.of().formatHex(md.digest());
            } catch (Exception e) {
                // Unreadable bytes mean no identity, so no repeat can be
                // claimed. A unique value keeps this image out of every group.
                return "unreadable-" + System.identityHashCode(image);
            }
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
