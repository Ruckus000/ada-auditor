import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocumentCatalog;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDResources;
import org.apache.pdfbox.pdmodel.font.PDCIDFont;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDFontDescriptor;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.graphics.form.PDFormXObject;
import org.apache.pdfbox.pdmodel.interactive.action.PDActionURI;
import org.apache.pdfbox.pdmodel.interactive.annotation.PDAnnotation;
import org.apache.pdfbox.pdmodel.interactive.annotation.PDAnnotationLink;
import org.apache.pdfbox.pdmodel.common.PDMetadata;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDMarkInfo;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;
import org.apache.pdfbox.pdmodel.interactive.viewerpreferences.PDViewerPreferences;

/**
 * Category-A finishing pass: make this document's metadata state only true
 * things, and state nothing it has not earned.
 *
 * Four document-catalog writes, each conditioned on the document actually
 * earning the claim it makes, plus the removal of a font index that lies —
 * see `stripCidSets`. Both halves are the same job, which is why they live
 * together: a MarkInfo claiming tags that do not exist and a CIDSet claiming
 * glyphs that do not match are the same defect wearing different keys.
 *
 * Each one closes a specific veraPDF ua1 failure that survived OpenDataLoader,
 * listed in docs/research/document-remediation/failure-classification.md. No
 * structure element is created, moved, re-parented or altered — if that ever
 * becomes necessary, the spike's kill criterion has fired and the answer is
 * STOP rather than a bigger version of this file.
 *
 * Usage: Finish <in.pdf> <out.pdf> [lang] [--title-file <path>]
 *
 * The title arrives in a FILE rather than on the command line, because it is
 * document content: a municipal record's title names the matter and sometimes
 * a person, and a process argument list is readable by anything else on the
 * machine. The path costs three lines and keeps the rule this project applies
 * everywhere else — titles may live in the database and in the delivered
 * file, and nowhere a bystander can read them. Absent, the title is copied
 * from DocInfo exactly as before.
 *
 * The language is an argument rather than something detected. Writing /Lang is
 * deterministic; deciding what it should say is inference, which is category B
 * and out of scope. A real service takes it from the source, or from the client.
 *
 * OMITTING IT REMOVES ANY LANGUAGE CLAIM the file already carries, and that is
 * a deliberate capability rather than a degenerate case. `[V]` LibreOffice's PDF
 * export writes /Lang as `en-US` onto a document exported from a source with
 * every fo:language declaration stripped out, and widens a declared `en` to
 * `en-US`. Those are statements the document never made. When the source
 * declares no language, the honest output declares none either: it fails
 * 7.2-34 visibly, which a reviewer can see, instead of asserting a language
 * nobody chose, which no reader can.
 */
public final class Finish {

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: Finish <in.pdf> <out.pdf> [lang] [--title-file <path>]");
            System.exit(2);
        }
        String in = args[0], out = args[1];
        // Absent means "remove the claim", not "leave whatever is there".
        String lang = null;
        String givenTitle = null;
        int i = 2;
        // Positional language first, so every existing caller keeps working.
        if (i < args.length && !args[i].startsWith("--")) {
            lang = args[i];
            i++;
        }
        for (; i < args.length; i++) {
            if ("--title-file".equals(args[i]) && i + 1 < args.length) {
                givenTitle = Files.readString(Path.of(args[++i]), StandardCharsets.UTF_8);
            } else {
                System.err.println("usage: Finish <in.pdf> <out.pdf> [lang] [--title-file <path>]");
                System.exit(2);
            }
        }

        try (PDDocument doc = Loader.loadPDF(new File(in))) {
            PDDocumentCatalog catalog = doc.getDocumentCatalog();

            // 6.2-1 — catalog shall include MarkInfo with Marked true, but
            // ONLY for a document that has structure to be marked about.
            //
            // This used to be unconditional, which was safe while the only
            // caller was the conversion pipeline: LibreOffice always emits a
            // structure tree. Pointed at a client's own PDF it would write
            // "this document is tagged" onto one that is not — an assertion,
            // in this project's terms, and produced by us rather than merely
            // carried forward. The reader cannot see it; every machine check
            // for it now passes; and the file is worse than before we touched
            // it.
            PDMarkInfo markInfo = catalog.getMarkInfo();
            if (hasStructureElements(catalog)) {
                if (markInfo == null) {
                    markInfo = new PDMarkInfo();
                }
                markInfo.setMarked(true);
                catalog.setMarkInfo(markInfo);
            } else if (markInfo != null && markInfo.isMarked()) {
                // The producer already claimed tagged on a document with no
                // structure elements. We are writing these bytes, so we own
                // every claim in them: correct it rather than carry it
                // forward, exactly as /Lang below clears an exporter's guess.
                markInfo.setMarked(false);
                catalog.setMarkInfo(markInfo);
            }

            // 7.2-34 / 7.2-22 / 7.2-24 — natural language shall be determined.
            // One catalog entry; content, Alt attributes and annotation
            // Contents all inherit it when they declare nothing of their own.
            //
            // A null here removes the entry, because PDFBox's setString drops a
            // key whose value is null. That is the point: an exporter's guess is
            // cleared rather than carried forward.
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
            //
            // A caller may supply one instead, and only ever a TRANSCRIBED
            // one — the document's own first heading, or the name its author
            // saved it under. The decision of which lives in
            // `services/document-repair.ts`, where it is testable; this end
            // writes what it is told. DocInfo and XMP are both set, because
            // 7.1-11 checks that the two agree and a title in one alone
            // trades a missing-title failure for a mismatch.
            String title = doc.getDocumentInformation().getTitle();
            if (givenTitle != null && !givenTitle.isEmpty()) {
                title = givenTitle;
                doc.getDocumentInformation().setTitle(title);
            }
            byte[] xmp = buildXmp(lang, title).getBytes(StandardCharsets.UTF_8);
            catalog.setMetadata(new PDMetadata(doc, new ByteArrayInputStream(xmp)));

            // 7.18.5-2 / 7.18.1-2 — a Link annotation shall carry an
            // alternate description in Contents, and 7.18.3-1 — a page with
            // annotations shall declare a tab order. `[V]` Two real municipal
            // documents were blocked by exactly this: hyperlinks the author
            // wrote, exported without Contents. The description TRANSCRIBES —
            // the link's own URI is the author's stated destination — and
            // never invents; a link with no URI keeps its silence.
            for (PDPage page : doc.getPages()) {
                boolean hasAnnotation = false;
                for (PDAnnotation annotation : page.getAnnotations()) {
                    hasAnnotation = true;
                    if (annotation instanceof PDAnnotationLink link
                            && (link.getContents() == null || link.getContents().isEmpty())) {
                        String destination = linkUri(link);
                        if (destination != null && !destination.isEmpty()) {
                            link.setContents(destination);
                        }
                    }
                }
                if (hasAnnotation && page.getCOSObject().getItem(COSName.getPDFName("Tabs")) == null) {
                    page.getCOSObject().setName(COSName.getPDFName("Tabs"), "S");
                }
            }

            stripCidSets(doc);

            doc.save(out);
        }
    }

    /**
     * Drop every CIDSet stream from the document's embedded CID fonts.
     *
     * `[V]` UA-1 7.21.4.2-2: "if the FontDescriptor dictionary of an embedded
     * CID font contains a CIDSet stream, then it shall identify all CIDs
     * which are present in the font program". Four of twenty real municipal
     * PDFs fail it — the font IS embedded, and a producer wrote an index of
     * it that does not match. A false statement about the file, not a missing
     * capability.
     *
     * Removed rather than regenerated, for the reason /Lang is cleared rather
     * than guessed: we will not carry forward a claim we cannot stand behind.
     * The rule is conditional on the stream's presence, so removing a wrong
     * one satisfies it honestly rather than by evasion, and CIDSet is
     * OPTIONAL in PDF/UA — nothing here reads it.
     *
     * The one thing this depends on, said plainly so it cannot rot: CIDSet's
     * real consumer is PDF/A subset validation, and the XMP write above
     * REPLACES the whole packet, so any PDF/A identification is already gone
     * from our output before this runs. **If that write is ever changed to
     * merge rather than replace, revisit this.**
     *
     * Structure is untouched, so `Finish`'s standing claim — no structure
     * element created, moved, re-parented or altered — still holds, and
     * `contentChanges` still checks it.
     */
    private static void stripCidSets(PDDocument doc) {
        for (PDPage page : doc.getPages()) {
            stripCidSets(page.getResources(), new java.util.HashSet<>());
        }
    }

    /**
     * Fonts can live in a Form XObject's own resources as well as a page's,
     * so this recurses. `seen` is identity-based on the resource dictionary:
     * a malformed document can point two XObjects at each other, and a walk
     * without it would not terminate.
     */
    private static void stripCidSets(PDResources resources, java.util.Set<Object> seen) {
        if (resources == null || !seen.add(resources.getCOSObject())) {
            return;
        }

        for (COSName name : resources.getFontNames()) {
            PDFont font;
            try {
                font = resources.getFont(name);
            } catch (Exception e) {
                // One unreadable font must not fail a repair that is otherwise
                // sound. Nothing is written for it, which is the safe outcome.
                continue;
            }
            if (font instanceof PDType0Font type0) {
                PDCIDFont descendant = type0.getDescendantFont();
                if (descendant != null) {
                    PDFontDescriptor descriptor = descendant.getFontDescriptor();
                    if (descriptor != null) {
                        descriptor.getCOSObject().removeItem(COSName.getPDFName("CIDSet"));
                    }
                }
            }
        }

        for (COSName name : resources.getXObjectNames()) {
            try {
                if (resources.getXObject(name) instanceof PDFormXObject form) {
                    stripCidSets(form.getResources(), seen);
                }
            } catch (Exception e) {
                continue;
            }
        }
    }

    /**
     * Whether the document has at least one structure element.
     *
     * The same question `isTagged()` asks in `domain/document-structure.ts`
     * (`structureElements > 0`), and the equivalence is exact: `Inspect`
     * counts elements reachable from the tree root, skipping any kid that is
     * not a `PDStructureElement` without descending into it — so a root whose
     * kids are all non-elements counts zero, which is what this returns.
     *
     * Deliberately not shared code with `Inspect`. Its count is produced by a
     * walk that simultaneously builds reading order, tables and lists, and
     * extracting it would mean restructuring a working stage to serve a
     * one-line question. Two implementations of one definition is a drift
     * risk, so the drift is what gets tested: `java-finish.test.ts` asserts
     * this agrees with `Inspect`'s own count on both a tagged and an untagged
     * document, and fails if they ever diverge.
     */
    private static boolean hasStructureElements(PDDocumentCatalog catalog) {
        PDStructureTreeRoot root = catalog.getStructureTreeRoot();
        if (root == null) {
            return false;
        }
        java.util.List<Object> kids = root.getKids();
        if (kids == null) {
            return false;
        }
        for (Object kid : kids) {
            if (kid instanceof PDStructureElement) {
                return true;
            }
        }
        return false;
    }

    /** The URI a link action points at, or null for every other action kind. */
    private static String linkUri(PDAnnotationLink link) {
        if (link.getAction() instanceof PDActionURI uri) {
            return uri.getURI();
        }
        return null;
    }

    private static String buildXmp(String lang, String title) {
        String dcLanguage = lang == null ? "" : String.format(
            "   <dc:language><rdf:Bag><rdf:li>%s</rdf:li></rdf:Bag></dc:language>%n",
            escape(lang));

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
            + dcLanguage
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
