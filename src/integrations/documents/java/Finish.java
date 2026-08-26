import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentCatalog;
import org.apache.pdfbox.pdmodel.common.PDMetadata;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDMarkInfo;
import org.apache.pdfbox.pdmodel.interactive.viewerpreferences.PDViewerPreferences;

/**
 * Category-A finishing pass. Four document-catalog writes and nothing else.
 *
 * Each one closes a specific veraPDF ua1 failure that survived OpenDataLoader,
 * listed in docs/research/document-remediation/failure-classification.md. No
 * structure element is created, moved, re-parented or altered — if that ever
 * becomes necessary, the spike's kill criterion has fired and the answer is
 * STOP rather than a bigger version of this file.
 *
 * Usage: Finish <in.pdf> <out.pdf> <lang>
 *
 * The language is a required argument rather than something detected. Writing
 * /Lang is deterministic; deciding what it should say is inference, which is
 * category B and out of scope. A real service takes it from the client.
 */
public final class Finish {

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            System.err.println("usage: Finish <in.pdf> <out.pdf> <lang>");
            System.exit(2);
        }
        String in = args[0], out = args[1], lang = args[2];

        try (PDDocument doc = Loader.loadPDF(new File(in))) {
            PDDocumentCatalog catalog = doc.getDocumentCatalog();

            // 6.2-1 — catalog shall include MarkInfo with Marked true.
            PDMarkInfo markInfo = catalog.getMarkInfo();
            if (markInfo == null) {
                markInfo = new PDMarkInfo();
            }
            markInfo.setMarked(true);
            catalog.setMarkInfo(markInfo);

            // 7.2-34 / 7.2-22 / 7.2-24 — natural language shall be determined.
            // One catalog entry; content, Alt attributes and annotation
            // Contents all inherit it when they declare nothing of their own.
            catalog.setLanguage(lang);

            // 7.1-10 — ViewerPreferences shall include DisplayDocTitle.
            PDViewerPreferences prefs = catalog.getViewerPreferences();
            if (prefs == null) {
                prefs = new PDViewerPreferences(new org.apache.pdfbox.cos.COSDictionary());
            }
            prefs.setDisplayDocTitle(true);
            catalog.setViewerPreferences(prefs);

            // 7.1-8 — catalog shall contain a Metadata key. The title is
            // copied from DocInfo where one exists and omitted where it does
            // not: inventing one from visible content is category B.
            String title = doc.getDocumentInformation().getTitle();
            byte[] xmp = buildXmp(lang, title).getBytes(StandardCharsets.UTF_8);
            catalog.setMetadata(new PDMetadata(doc, new ByteArrayInputStream(xmp)));

            doc.save(out);
        }
    }

    private static String buildXmp(String lang, String title) {
        String dcTitle = (title == null || title.isBlank()) ? "" : String.format(
            "   <dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">%s</rdf:li></rdf:Alt></dc:title>%n",
            escape(title));

        return ""
            + "<?xpacket begin=\"﻿\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n"
            + "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n"
            + " <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n"
            + "  <rdf:Description rdf:about=\"\"\n"
            + "      xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n"
            + dcTitle
            + "   <dc:language><rdf:Bag><rdf:li>" + escape(lang) + "</rdf:li></rdf:Bag></dc:language>\n"
            + "  </rdf:Description>\n"
            + "  <rdf:Description rdf:about=\"\"\n"
            + "      xmlns:pdfuaid=\"http://www.aiim.org/pdfua/ns/id/\">\n"
            + "   <pdfuaid:part>1</pdfuaid:part>\n"
            + "  </rdf:Description>\n"
            + " </rdf:RDF>\n"
            + "</x:xmpmeta>\n"
            + "<?xpacket end=\"w\"?>";
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
