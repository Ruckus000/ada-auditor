import java.io.File;
import java.util.Locale;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentCatalog;

/**
 * Experiment-only: drop the structure tree so a tagged document can stand in
 * for an untagged one. Catalog entries only; page content streams are not
 * rewritten. Usage: Strip <in.pdf> <out.pdf>
 */
public final class Strip {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) { System.err.println("usage: Strip <in.pdf> <out.pdf>"); System.exit(2); }
        try (PDDocument doc = Loader.loadPDF(new File(args[0]))) {
            PDDocumentCatalog cat = doc.getDocumentCatalog();
            boolean had = cat.getStructureTreeRoot() != null;
            cat.getCOSObject().removeItem(COSName.STRUCT_TREE_ROOT);
            cat.getCOSObject().removeItem(COSName.MARK_INFO);
            doc.save(new File(args[1]));
            System.out.println(String.format(Locale.ROOT, "{\"pages\":%d,\"hadTree\":%s}", doc.getNumberOfPages(), had));
        }
    }
}
