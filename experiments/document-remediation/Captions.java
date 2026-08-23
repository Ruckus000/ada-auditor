import java.awt.geom.Point2D;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;
import org.apache.pdfbox.pdmodel.graphics.image.PDImage;
import org.apache.pdfbox.contentstream.PDFGraphicsStreamEngine;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;
import org.apache.pdfbox.util.Matrix;
import org.apache.pdfbox.util.Vector;

/**
 * Experiment 2, technique 1: recover figure descriptions that already exist in
 * the document as visible captions.
 *
 * OpenDataLoader writes "image 1", "image 2" as the Alt for every figure, and
 * does so even when a human-written caption sits directly beneath the image.
 * That is not a gap a reviewer can see — the Alt slot is filled and veraPDF is
 * satisfied — which is what makes it the largest single source of false
 * assertions in the corpus. Nothing here generates a description; it only moves
 * one the author already wrote.
 *
 * Scope is deliberately one technique. Where no caption associates
 * confidently the existing Alt is left ALONE rather than cleared, so the
 * measurement isolates what caption extraction removes and changes nothing
 * else. Whether an un-captioned figure should keep a placeholder or lose its
 * Alt is a policy question for after the numbers exist.
 *
 * Usage: Captions <in.pdf> <out.pdf>          (writes a JSON report to stdout)
 */
public final class Captions {

    /** "Figure 3:", "Fig. 2 —", "Plate 1", "Figure 1 (a-c):" */
    private static final java.util.regex.Pattern CAPTION_START = java.util.regex.Pattern.compile(
        "^\\s*(figure|fig\\.?|plate|chart|diagram|illustration|exhibit|photo|image)\\s*"
        + "([0-9]+|[ivxlc]+)\\s*(\\([^)]*\\))?\\s*[:.\\u2013\\u2014-]",
        java.util.regex.Pattern.CASE_INSENSITIVE);

    /** Caption must start within this many points of the image edge. */
    private static final float MAX_GAP = 46f;
    /** And overlap the image horizontally by at least this fraction of its width. */
    private static final float MIN_OVERLAP = 0.25f;

    /** An image placement keyed by the marked-content id that encloses it. */
    private record Keyed(int page, int mcid, Box box) {}

    private record Box(float x0, float y0, float x1, float y1) {
        float w() { return x1 - x0; }
        float overlapX(Box o) { return Math.max(0, Math.min(x1, o.x1) - Math.max(x0, o.x0)); }
    }
    private record Line(Box box, String text) {}
    private record Placement(int page, Box box) {}

    public static void main(String[] args) throws Exception {
        if (args.length == 2 && "--dump".equals(args[0])) { new Captions().dump(args[1]); return; }
        if (args.length != 2) {
            System.err.println("usage: Captions <in.pdf> <out.pdf>  |  Captions --dump <in.pdf>");
            System.exit(2);
        }
        new Captions().run(args[0], args[1]);
    }

    /** Development aid: what the text stripper and image finder actually see. */
    private void dump(String in) throws Exception {
        try (PDDocument doc = Loader.loadPDF(new File(in))) {
            for (int i = 0; i < doc.getNumberOfPages(); i++) {
                PDPage page = doc.getPage(i);
                List<Placement> imgs = new ArrayList<>();
                new ImageFinder(page, i, imgs, new ArrayList<>()).processPage(page);
                System.out.printf("--- page %d ---%n", i + 1);
                for (Placement pl : imgs) {
                    System.out.printf("  IMAGE  x %.0f-%.0f  y %.0f-%.0f%n",
                        pl.box().x0(), pl.box().x1(), pl.box().y0(), pl.box().y1());
                }
                for (Line l : collectLines(doc, i + 1, page)) {
                    System.out.printf("  LINE   x %.0f-%.0f  y %.0f-%.0f  %s%n",
                        l.box().x0(), l.box().x1(), l.box().y0(), l.box().y1(),
                        l.text().length() > 62 ? l.text().substring(0, 62) + "..." : l.text().trim());
                }
            }
        }
    }

    private void run(String in, String out) throws Exception {
        try (PDDocument doc = Loader.loadPDF(new File(in))) {
            List<Placement> images = new ArrayList<>();
            List<Keyed> keyed = new ArrayList<>();
            List<List<Line>> linesByPage = new ArrayList<>();
            java.util.Map<PDPage, Integer> pageIndex = new java.util.HashMap<>();

            for (int i = 0; i < doc.getNumberOfPages(); i++) {
                PDPage page = doc.getPage(i);
                pageIndex.put(page, i);
                new ImageFinder(page, i, images, keyed).processPage(page);
                linesByPage.add(collectLines(doc, i + 1, page));
            }

            List<PDStructureElement> figures = new ArrayList<>();
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();
            if (root != null) collectFigures(root, figures);

            int applied = 0, noCaption = 0, unlocated = 0, captionsFound = 0;
            for (PDStructureElement fig : figures) {
                Box box = locate(fig, keyed, pageIndex);
                if (box == null) { unlocated++; continue; }
                int page = pageOf(fig, keyed, pageIndex);
                String caption = page < 0 ? null : findCaption(new Placement(page, box), linesByPage.get(page));
                if (caption == null) { noCaption++; continue; }
                captionsFound++;
                fig.setAlternateDescription(caption);
                applied++;
            }

            doc.save(out);

            StringBuilder j = new StringBuilder("{");
            j.append("\"images\":").append(images.size());
            j.append(",\"figures\":").append(figures.size());
            j.append(",\"located\":").append(figures.size() - unlocated);
            j.append(",\"unlocated\":").append(unlocated);
            j.append(",\"captionsFound\":").append(captionsFound);
            j.append(",\"applied\":").append(applied);
            j.append(",\"noCaption\":").append(noCaption);
            j.append("}");
            System.out.println(j);
        }
    }

    /**
     * Nearest caption-shaped line below the image, then above it.
     *
     * Below is tried first because it is the common convention, but above is a
     * real one — h03 in the holdout uses it with a distractor note underneath,
     * and a below-only rule binds the wrong text there. Requiring the caption
     * marker means a plain sentence near an image is never mistaken for one.
     */
    private String findCaption(Placement p, List<Line> lines) {
        Line best = null;
        float bestGap = Float.MAX_VALUE;

        for (Line line : lines) {
            if (!CAPTION_START.matcher(line.text()).find()) continue;
            if (line.box().overlapX(p.box()) < MIN_OVERLAP * p.box().w()) continue;

            float gap = line.box().y0() >= p.box().y1()
                ? line.box().y0() - p.box().y1()      // below
                : p.box().y0() - line.box().y1();     // above
            if (gap < 0 || gap > MAX_GAP) continue;
            if (gap < bestGap) { bestGap = gap; best = line; }
        }
        if (best == null) return null;

        // Captions wrap. Take continuation lines while they stay close and do
        // not start a new caption.
        // Continuation tolerance scales with the caption's own line height
        // rather than a fixed number of points. A fixed 6pt dropped the last
        // line of every wrapped caption in the corpus, which silently produced
        // a truncated description — worse than none, because it reads as
        // complete.
        float lineHeight = Math.max(1f, best.box().y1() - best.box().y0());
        StringBuilder sb = new StringBuilder(best.text().trim());
        float prevBottom = best.box().y1();
        for (Line line : lines) {
            if (line == best) continue;
            if (line.box().y0() < best.box().y1()) continue;
            if (CAPTION_START.matcher(line.text()).find()) continue;
            // Overlap is measured against the SHORTER line, not the caption's
            // first line. A wrapped caption's last line is usually short, and
            // requiring it to cover half the full-width first line dropped it
            // every time — producing a truncated description, which reads as
            // complete and is therefore worse than none.
            if (line.box().overlapX(best.box()) < 0.6f * Math.min(line.box().w(), best.box().w())) continue;
            float gap = line.box().y0() - prevBottom;
            // 1.6x, because the measured box is glyph height and the gap is
            // leading. In the corpus a 7pt caption line sits 7pt below its
            // predecessor, so a 0.9x threshold rejected every continuation by a
            // fraction of a point. The following body paragraph sits ~22pt away,
            // so this stays comfortably clear of it.
            if (gap < -0.3f * lineHeight || gap > 1.6f * lineHeight) continue;
            sb.append(' ').append(line.text().trim());
            prevBottom = line.box().y1();
        }
        return sb.toString().replaceAll("\\s+", " ").trim();
    }

    /**
     * The image a Figure element encloses, found through its marked-content id
     * rather than its position among all images on the page. Returns null when
     * the element references no image we saw — in which case nothing is
     * written, because a caption on an unlocated figure is a guess.
     */
    private Box locate(PDStructureElement fig, List<Keyed> keyed, java.util.Map<PDPage, Integer> pageIndex) {
        List<Integer> ids = new ArrayList<>();
        mcids(fig, ids);
        int page = pageOf(fig, keyed, pageIndex);
        for (int id : ids) {
            for (Keyed k : keyed) {
                if (k.mcid() == id && (page < 0 || k.page() == page)) return k.box();
            }
        }
        return null;
    }

    private int pageOf(PDStructureElement fig, List<Keyed> keyed, java.util.Map<PDPage, Integer> pageIndex) {
        PDPage pg = fig.getPage();
        if (pg != null && pageIndex.containsKey(pg)) return pageIndex.get(pg);
        List<Integer> ids = new ArrayList<>();
        mcids(fig, ids);
        for (int id : ids) for (Keyed k : keyed) if (k.mcid() == id) return k.page();
        return -1;
    }

    private void mcids(PDStructureElement el, List<Integer> out) {
        for (Object kid : el.getKids()) {
            if (kid instanceof Integer i) out.add(i);
            else if (kid instanceof org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDMarkedContentReference r) {
                out.add(r.getMCID());
            } else if (kid instanceof PDStructureElement child) {
                mcids(child, out);
            }
        }
    }

    private void collectFigures(PDStructureNode node, List<PDStructureElement> out) {
        for (Object kid : node.getKids()) {
            if (!(kid instanceof PDStructureElement el)) continue;
            if ("Figure".equals(el.getStructureType())) out.add(el);
            collectFigures(el, out);
        }
    }

    /** Text lines with top-down bounding boxes, matching the image coordinates below. */
    private List<Line> collectLines(PDDocument doc, int oneBasedPage, PDPage page) throws IOException {
        List<Line> lines = new ArrayList<>();
        PDFTextStripper stripper = new PDFTextStripper() {
            @Override
            protected void writeString(String text, List<TextPosition> positions) {
                if (text.isBlank() || positions.isEmpty()) return;
                float x0 = Float.MAX_VALUE, y0 = Float.MAX_VALUE, x1 = -Float.MAX_VALUE, y1 = -Float.MAX_VALUE;
                for (TextPosition t : positions) {
                    x0 = Math.min(x0, t.getXDirAdj());
                    y1 = Math.max(y1, t.getYDirAdj());
                    x1 = Math.max(x1, t.getXDirAdj() + t.getWidthDirAdj());
                    y0 = Math.min(y0, t.getYDirAdj() - t.getHeightDir());
                }
                lines.add(new Line(new Box(x0, y0, x1, y1), text));
            }
        };
        stripper.setSortByPosition(true);
        stripper.setStartPage(oneBasedPage);
        stripper.setEndPage(oneBasedPage);
        stripper.getText(doc);
        return lines;
    }

    /** Image placements, converted to the same top-down space the text uses. */
    private static final class ImageFinder extends PDFGraphicsStreamEngine {
        private final int pageIndex;
        private final List<Placement> out;
        private final List<Keyed> keyed;
        private final float pageHeight;
        private final java.util.ArrayDeque<Integer> mcids = new java.util.ArrayDeque<>();

        ImageFinder(PDPage page, int pageIndex, List<Placement> out, List<Keyed> keyed) {
            super(page);
            this.pageIndex = pageIndex;
            this.out = out;
            this.keyed = keyed;
            this.pageHeight = page.getMediaBox().getHeight();
        }

        // BDC/BMC push, EMC pops. Maintaining the stack here is what lets an
        // image be tied to the structure element that encloses it, instead of
        // matching figures to images by position in the document — which breaks
        // the moment the tagger marks some images as artifacts, as it does on
        // the kitchen-sink document (8 images, 4 Figure elements).
        @Override
        protected void processOperator(org.apache.pdfbox.contentstream.operator.Operator op,
                                       List<org.apache.pdfbox.cos.COSBase> operands) throws IOException {
            String name = op.getName();
            if ("BDC".equals(name) || "BMC".equals(name)) {
                Integer mcid = null;
                if (operands.size() >= 2 && operands.get(1) instanceof org.apache.pdfbox.cos.COSDictionary props) {
                    org.apache.pdfbox.cos.COSBase v = props.getDictionaryObject(COSName.MCID);
                    if (v instanceof org.apache.pdfbox.cos.COSInteger ci) mcid = ci.intValue();
                }
                mcids.push(mcid == null ? -1 : mcid);
            } else if ("EMC".equals(name)) {
                if (!mcids.isEmpty()) mcids.pop();
            }
            super.processOperator(op, operands);
        }

        @Override
        public void drawImage(PDImage pdImage) {
            Matrix m = getGraphicsState().getCurrentTransformationMatrix();
            float x = m.getTranslateX();
            float yBottom = m.getTranslateY();
            float w = m.getScalingFactorX();
            float h = m.getScalingFactorY();
            float yTop = pageHeight - (yBottom + h);
            Box box = new Box(x, yTop, x + w, yTop + h);
            out.add(new Placement(pageIndex, box));
            int mcid = mcids.isEmpty() ? -1 : mcids.peek();
            if (mcid >= 0) keyed.add(new Keyed(pageIndex, mcid, box));
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
