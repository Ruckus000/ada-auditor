import java.io.File;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.Locale;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.rendering.ImageType;

/** On-demand page image. No output PDF or metadata is written. */
public final class Preview {
  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("Preview <pdf> <page>");
    int number = Integer.parseInt(args[1]);
    try (PDDocument doc = Loader.loadPDF(new File(args[0]))) {
      if (number < 1 || number > doc.getNumberOfPages()) throw new IllegalArgumentException("page outside document");
      var page = doc.getPage(number - 1);
      var crop = page.getCropBox();
      float width = crop.getWidth(), height = crop.getHeight();
      if (!Float.isFinite(width) || !Float.isFinite(height) || width <= 0 || height <= 0) throw new IllegalArgumentException("invalid page dimensions");
      int rotation = Math.floorMod(page.getRotation(), 360);
      var renderer = new PDFRenderer(doc);
      renderer.setSubsamplingAllowed(true);
      var raster = renderer.renderImage(number - 1, Math.min(2f, 1600f / Math.max(width, height)), ImageType.RGB);
      var png = new ByteArrayOutputStream();
      ImageIO.write(raster, "png", png);
      if (png.size() > 12 * 1024 * 1024) throw new IllegalArgumentException("preview too large");
      var root = doc.getDocumentCatalog().getStructureTreeRoot();
      var figures = FigureOrder.inOrder(root, root == null ? null : root.getRoleMap());
      var located = FigureOrder.locate(doc, figures);
      var marks = new StringBuilder();
      for (int i = 0; i < figures.size(); i++) {
        var location = located.get(figures.get(i));
        var box = location == null ? null : location.box();
        if (box == null || box.page() != number) continue;
        double x = box.x() - crop.getLowerLeftX();
        double y = box.y() + crop.getUpperRightY() - page.getMediaBox().getHeight();
        double w = box.w(), h = box.h(), dw = width, dh = height;
        // FigureOrder uses unrotated top-down media coordinates. PDFRenderer
        // displays the crop and then rotates clockwise; transform the same box.
        if (rotation == 90) { double old = x; x = height - y - h; y = old; double swap = w; w = h; h = swap; dw = height; dh = width; }
        else if (rotation == 180) { x = width - x - w; y = height - y - h; }
        else if (rotation == 270) { double old = x; x = y; y = width - old - w; double swap = w; w = h; h = swap; dw = height; dh = width; }
        else if (rotation != 0) continue;
        double right = Math.min(dw, x + w), bottom = Math.min(dh, y + h);
        x = Math.max(0, x); y = Math.max(0, y); w = right - x; h = bottom - y;
        if (!(w > 0 && h > 0)) continue;
        if (marks.length() > 0) marks.append(',');
        marks.append(String.format(Locale.ROOT, "{\"ordinal\":%d,\"x\":%.8f,\"y\":%.8f,\"w\":%.8f,\"h\":%.8f}", i, x/dw, y/dh, w/dw, h/dh));
      }
      System.out.println("{\"page\":" + number + ",\"pages\":" + doc.getNumberOfPages() + ",\"width\":" + raster.getWidth() + ",\"height\":" + raster.getHeight() + ",\"png\":\"" + Base64.getEncoder().encodeToString(png.toByteArray()) + "\",\"figures\":[" + marks + "]}");
    }
  }
}
