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
 */
public final class Mark {

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
        System.out.println(String.format(Locale.ROOT,
            "{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,\"imageWidth\":%d,\"imageHeight\":%d,\"inside\":%s}",
            px[0], px[1], px[2], px[3], img.getWidth(), img.getHeight(), inside));
        if (check) {
            System.exit(inside ? 0 : 1);
        }
        BufferedImage out = new BufferedImage(img.getWidth(), img.getHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.drawImage(img, 0, 0, null);
        g.setColor(Color.MAGENTA);
        g.setStroke(new BasicStroke(3f));
        g.drawRect(px[0] - 2, px[1] - 2, px[2] + 4, px[3] + 4);
        g.dispose();
        ImageIO.write(out, "png", new File(args[off + 7]));
    }

    /** Preview.java:37–47, then raster size over displayed crop. */
    static int[] mapPixels(PDPage page, float x0, float y0, float x1, float y1, int imgW, int imgH) {
        PDRectangle crop = page.getCropBox();
        float width = crop.getWidth(), height = crop.getHeight();
        int rotation = Math.floorMod(page.getRotation(), 360);
        double x = x0 - crop.getLowerLeftX();
        double y = y0 + crop.getUpperRightY() - page.getMediaBox().getHeight();
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
