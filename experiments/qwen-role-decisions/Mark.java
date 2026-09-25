import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.Locale;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDRectangle;

/**
 * Experiment-only: map a StructText glyph box onto an existing Preview PNG
 * and draw one rectangle. Mapping copies Preview.java's crop/rotation
 * overlay (the six lines java-preview.test.ts already pins). Not a renderer
 * API, not a crop pipeline.
 *
 * Usage:
 *   Mark &lt;pdf&gt; &lt;page-1based&gt; &lt;x0&gt; &lt;y0&gt; &lt;x1&gt; &lt;y1&gt; &lt;in.png&gt; &lt;out.png&gt;
 *   Mark --check &lt;pdf&gt; &lt;page-1based&gt; &lt;x0&gt; &lt;y0&gt; &lt;x1&gt; &lt;y1&gt; &lt;in.png&gt;
 *
 * Exit 3 from the writing form means the outline falls off the raster and no
 * image was written; {@code --check} keeps its own 0/1 on {@code inside}.
 */
public final class Mark {

    /** Outline stroke, in pixels of the page raster. */
    static final float STROKE = 3f;

    /** Smallest outer side of the drawn outline, in pixels of the page raster.
     * A glyph-sized box on a large-format page maps to a handful of pixels
     * (c8-0004's page number "1" is 5.2x9.5 units on a 2592x2016 page: 3x6 px
     * at 1600x1244), and the marked page is reduced to 448,000 px before the
     * model sees it (reduce_marked_408.py), a bicubic scale near 0.45. A 12 px
     * outline measures 16 magenta pixels in the reduced copy over white,
     * black, yellow and navy; smaller outlines thin out with the background. */
    static final int MIN_MARK = 12;

    public static void main(String[] args) throws Exception {
        boolean check = args.length > 0 && "--check".equals(args[0]);
        int off = check ? 1 : 0;
        if (args.length != off + (check ? 7 : 8)) {
            System.err.println("usage: Mark [--check] <pdf> <page> <x0> <y0> <x1> <y1> <in.png> [out.png]");
            System.exit(2);
        }
        File pdf = new File(args[off]);
        int number = Integer.parseInt(args[off + 1]);
        float x0 = Float.parseFloat(args[off + 2]);
        float y0 = Float.parseFloat(args[off + 3]);
        float x1 = Float.parseFloat(args[off + 4]);
        float y1 = Float.parseFloat(args[off + 5]);
        File inPng = new File(args[off + 6]);
        BufferedImage img = ImageIO.read(inPng);
        if (img == null) throw new IllegalArgumentException("unreadable png");
        int[] px;
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            if (number < 1 || number > doc.getNumberOfPages()) {
                throw new IllegalArgumentException("page outside document");
            }
            px = mapPixels(doc.getPage(number - 1), x0, y0, x1, y1, img.getWidth(), img.getHeight());
        }
        boolean inside = px[0] >= 0 && px[1] >= 0
            && px[0] + px[2] <= img.getWidth()
            && px[1] + px[3] <= img.getHeight();
        int[] mark = markRect(px[0], px[1], px[2], px[3]);
        boolean visible = visible(mark, img.getWidth(), img.getHeight());
        System.out.println(String.format(Locale.ROOT,
            "{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,\"imageWidth\":%d,\"imageHeight\":%d,\"inside\":%s,"
            + "\"markX\":%d,\"markY\":%d,\"markW\":%d,\"markH\":%d,\"visible\":%s}",
            px[0], px[1], px[2], px[3], img.getWidth(), img.getHeight(), inside,
            mark[0], mark[1], mark[2], mark[3], visible));
        if (check) {
            System.exit(inside ? 0 : 1);
        }
        if (!visible) {
            // Nothing would be drawn, and an unmarked page is the one input the
            // prompt cannot be read against: it says "the box drawn in magenta"
            // over a page that has none. Refuse, and leave the caller to decide
            // (labels/key_context.marked_image drops the image for that card).
            System.err.println("mark falls outside the page raster; no image written");
            System.exit(3);
        }
        BufferedImage out = new BufferedImage(img.getWidth(), img.getHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.drawImage(img, 0, 0, null);
        g.setColor(Color.MAGENTA);
        g.setStroke(new BasicStroke(STROKE));
        g.drawRect(mark[0], mark[1], mark[2], mark[3]);
        g.dispose();
        ImageIO.write(out, "png", new File(args[off + 7]));
    }

    /** The rectangle {@code drawRect} gets: the mapped box with a 2 px gap
     * around it, grown about its centre when that outline would come out under
     * {@link #MIN_MARK}. An outline already at or over MIN_MARK is returned
     * untouched, so every normal-size box keeps the geometry the marked images
     * released so far were drawn with. */
    static int[] markRect(int px, int py, int pw, int ph) {
        int x = px - 2, y = py - 2, w = pw + 4, h = ph + 4;
        int growW = Math.max(0, MIN_MARK - w), growH = Math.max(0, MIN_MARK - h);
        return new int[] {x - growW / 2, y - growH / 2, w + growW, h + growH};
    }

    /** Whether the outline puts any ink on the raster. A box outside the crop
     * window, or with coordinates past the page box, maps off the image and
     * {@code drawRect} then draws nothing at all. The stroke straddles the
     * path, so half of it counts as reach on each side. */
    static boolean visible(int[] mark, int imgW, int imgH) {
        int reach = (int) Math.ceil(STROKE / 2.0);
        return mark[0] - reach < imgW && mark[1] - reach < imgH
            && mark[0] + mark[2] + reach >= 0 && mark[1] + mark[3] + reach >= 0;
    }

    /** Preview.java:37–47, then raster size over displayed crop. */
    static int[] mapPixels(PDPage page, float x0, float y0, float x1, float y1, int imgW, int imgH) {
        PDRectangle crop = page.getCropBox();
        float width = crop.getWidth(), height = crop.getHeight();
        int rotation = Math.floorMod(page.getRotation(), 360);
        // Already crop-relative. PDFBox reports text positions against the crop
        // box and `Preview` renders the crop, so unlike a `FigureOrder` box --
        // media space, which Preview.java:37-47 is right to shift -- there is
        // nothing here to take off. Subtracting the origin a second time drove
        // the box off the raster: c8-0077's crop starts at x=597 while its cards
        // span 31.9..610.4, inside the crop width. The `y` term was spurious the
        // same way, and read as zero whenever the crop reaches the media top,
        // which is why only `x` ever showed.
        double x = x0, y = y0;
        double w = x1 - x0, h = y1 - y0, dw = width, dh = height;
        if (rotation == 90) { double old = x; x = height - y - h; y = old; double swap = w; w = h; h = swap; dw = height; dh = width; }
        else if (rotation == 180) { x = width - x - w; y = height - y - h; }
        else if (rotation == 270) { double old = x; x = y; y = width - old - w; double swap = w; w = h; h = swap; dw = height; dh = width; }
        else if (rotation != 0) throw new IllegalArgumentException("unsupported rotation");
        int px = (int) Math.round(x / dw * imgW);
        int py = (int) Math.round(y / dh * imgH);
        int pw = Math.max(1, (int) Math.round(w / dw * imgW));
        int ph = Math.max(1, (int) Math.round(h / dh * imgH));
        return new int[] {px, py, pw, ph};
    }
}
