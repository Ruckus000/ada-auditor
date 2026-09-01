import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;
import java.util.TreeMap;

import org.apache.fontbox.ttf.CmapLookup;
import org.apache.fontbox.ttf.TTFParser;
import org.apache.fontbox.ttf.TrueTypeFont;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSBase;
import org.apache.pdfbox.cos.COSNumber;
import org.apache.pdfbox.io.RandomAccessReadBuffer;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocumentCatalog;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDResources;
import org.apache.pdfbox.pdmodel.font.PDCIDFont;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDFontDescriptor;
import org.apache.pdfbox.pdmodel.font.PDTrueTypeFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.font.encoding.Encoding;
import org.apache.pdfbox.pdmodel.font.encoding.GlyphList;
import org.apache.pdfbox.pdmodel.font.encoding.MacRomanEncoding;
import org.apache.pdfbox.pdmodel.font.encoding.WinAnsiEncoding;
import org.apache.pdfbox.pdmodel.graphics.form.PDFormXObject;
import org.apache.pdfbox.pdmodel.interactive.action.PDActionURI;
import org.apache.pdfbox.pdmodel.interactive.annotation.PDAnnotation;
import org.apache.pdfbox.pdmodel.interactive.annotation.PDAnnotationLink;
import org.apache.pdfbox.pdmodel.common.PDMetadata;
import org.apache.pdfbox.pdmodel.common.PDStream;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDMarkInfo;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDObjectReference;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureNode;
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
 * structure element is created, moved, re-parented or altered — with ONE
 * deliberate exception, taken as a standing policy rather than drifted into:
 * `--renumber-headings` re-ranks H* levels onto a gapless ladder, and only the
 * CONVERSION lane passes it, where the levels being corrected are an
 * exporter's mapping of the author's outline rather than a client's own PDF.
 * See `renumberHeadings` for what it refuses. Everything else in this file
 * still creates, moves and re-parents nothing — if more than this one
 * exception ever becomes necessary, the spike's kill criterion has fired and
 * the answer is STOP rather than a bigger version of this file.
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
            System.err.println("usage: Finish <in.pdf> <out.pdf> [lang] [--title-file <path>] [--no-ua-identifier] [--renumber-headings] [--embed-fonts <dir>]");
            System.exit(2);
        }
        String in = args[0], out = args[1];
        // Absent means "remove the claim", not "leave whatever is there".
        String lang = null;
        String givenTitle = null;
        // The PDF/UA-1 identifier is a CLAIM, and this stage is the one party
        // that cannot know whether it is true: conformance is decided by
        // veraPDF after the file is written. Default on, so every existing
        // caller keeps its behaviour; the conversion path passes the flag once
        // it holds a verdict. Same shape as the MarkInfo gate below, which is
        // already conditional on the document having earned it.
        boolean claimUa1 = true;
        // Heading re-ranking is OFF unless the caller asks: the repair lane
        // never asks, because renumbering a client's own PDF is guessing a
        // heading level, which its charter forbids.
        boolean renumberHeadings = false;
        // Font programs to embed from, or null to embed nothing. Only the
        // repair lane passes it — LibreOffice already embeds on conversion.
        Path fontDir = null;
        int i = 2;
        // Positional language first, so every existing caller keeps working.
        if (i < args.length && !args[i].startsWith("--")) {
            lang = args[i];
            i++;
        }
        for (; i < args.length; i++) {
            if ("--title-file".equals(args[i]) && i + 1 < args.length) {
                givenTitle = Files.readString(Path.of(args[++i]), StandardCharsets.UTF_8);
            } else if ("--no-ua-identifier".equals(args[i])) {
                claimUa1 = false;
            } else if ("--renumber-headings".equals(args[i])) {
                renumberHeadings = true;
            } else if ("--embed-fonts".equals(args[i]) && i + 1 < args.length) {
                fontDir = Path.of(args[++i]);
            } else {
                System.err.println("usage: Finish <in.pdf> <out.pdf> [lang] [--title-file <path>] [--no-ua-identifier] [--renumber-headings] [--embed-fonts <dir>]");
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
            // The author travels with the title, for the same reason and by the
            // same route. `setMetadata` REPLACES the whole XMP packet, so
            // everything the document declared there is gone unless it is
            // written again — and `[V]` 35 of the 52 real PDFs in the blind
            // corpus declare `dc:creator`. Losing the author of a municipal
            // record while repairing its accessibility is a silent edit to
            // somebody's document.
            //
            // Taken from DocInfo, which this pass preserves, rather than by
            // parsing and merging the old packet: DocInfo is already the
            // source of truth for the title here, and a bad merge writes
            // wrong metadata where a rebuild writes none.
            String author = doc.getDocumentInformation().getAuthor();
            byte[] xmp = buildXmp(lang, title, author, claimUa1).getBytes(StandardCharsets.UTF_8);
            catalog.setMetadata(new PDMetadata(doc, new ByteArrayInputStream(xmp)));

            // 7.18.5-2 / 7.18.1-2 — a Link annotation shall carry an
            // alternate description in Contents, and 7.18.3-1 — a page with
            // annotations shall declare a tab order. `[V]` Two real municipal
            // documents were blocked by exactly this: hyperlinks the author
            // wrote, exported without Contents. The description TRANSCRIBES —
            // the link's own URI is the author's stated destination — and
            // never invents; a link with no URI keeps its silence.
            List<PDAnnotationLink> undescribed = new ArrayList<>();
            for (PDPage page : doc.getPages()) {
                boolean hasAnnotation = false;
                for (PDAnnotation annotation : page.getAnnotations()) {
                    hasAnnotation = true;
                    if (annotation instanceof PDAnnotationLink link
                            && (link.getContents() == null || link.getContents().isEmpty())) {
                        String destination = linkUri(link);
                        if (destination != null && !destination.isEmpty()) {
                            link.setContents(destination);
                        } else {
                            undescribed.add(link);
                        }
                    }
                }
                if (hasAnnotation && page.getCOSObject().getItem(COSName.getPDFName("Tabs")) == null) {
                    page.getCOSObject().setName(COSName.getPDFName("Tabs"), "S");
                }
            }
            describeInternalLinks(doc, undescribed);

            if (renumberHeadings) {
                renumberHeadings(catalog);
            }

            if (fontDir != null) {
                embedFonts(doc, fontDir);
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
    /**
     * 7.21.4.1-1 — attach a metric-identical font program to fonts a producer
     * named but never embedded.
     *
     * The population this exists for is measured, not imagined: the real
     * corpus's non-embedded fonts are overwhelmingly TrueType dictionaries
     * naming the Windows faces — ArialMT, TimesNewRomanPSMT, CourierNewPSMT
     * and their bold/italic variants — with WinAnsi encoding and full /Widths
     * arrays. The Liberation family exists to be metrically identical to
     * exactly those faces, and GUARD THREE proves it per document rather than
     * trusting the reputation: every defined, non-zero /Widths entry must
     * match the replacement's own advance within 0.5/1000 em, or that font is
     * refused and keeps its punch item.
     *
     * Nothing but the descriptor's FontFile2 is written. BaseFont, Encoding,
     * /Widths and every content stream stay byte-identical, so layout cannot
     * move: viewers advance simple-font text by /Widths, which this never
     * touches. What changes is that glyph shapes stop being whatever each
     * reader substitutes and become one deterministic, licensed face.
     *
     * Refusal-first, in order: not simple TrueType; no descriptor; already
     * embedded; symbolic; an Encoding that is not the WinAnsi or MacRoman
     * NAME (a dictionary with Differences is a custom mapping this does not
     * model); a subset-prefixed BaseFont (a full program under a subset name
     * would trip the subsetting clauses); a face this table does not map; a
     * width mismatch. Every refusal is silent and leaves the document exactly
     * as it was — the honest state, still voiced by the 7.21.4 punch item.
     */
    private static void embedFonts(PDDocument doc, Path dir) {
        Map<String, FontProgram> cache = new HashMap<>();
        Set<Object> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        try {
            for (PDPage page : doc.getPages()) {
                embedFonts(doc, dir, page.getResources(), cache, seen);
            }
        } finally {
            for (FontProgram program : cache.values()) {
                program.close();
            }
        }
    }

    private static void embedFonts(PDDocument doc, Path dir, PDResources resources,
            Map<String, FontProgram> cache, Set<Object> seen) {
        if (resources == null || !seen.add(resources.getCOSObject())) {
            return;
        }
        for (COSName name : resources.getFontNames()) {
            PDFont font;
            try {
                font = resources.getFont(name);
            } catch (Exception e) {
                continue;
            }
            if (!(font instanceof PDTrueTypeFont trueType)) {
                continue;
            }
            PDFontDescriptor descriptor = trueType.getFontDescriptor();
            if (descriptor == null || descriptor.getFontFile() != null
                    || descriptor.getFontFile2() != null || descriptor.getFontFile3() != null
                    || descriptor.isSymbolic()) {
                continue;
            }
            COSBase encodingName = trueType.getCOSObject().getDictionaryObject(COSName.ENCODING);
            Encoding encoding;
            if (COSName.WIN_ANSI_ENCODING.equals(encodingName)) {
                encoding = WinAnsiEncoding.INSTANCE;
            } else if (COSName.MAC_ROMAN_ENCODING.equals(encodingName)) {
                encoding = MacRomanEncoding.INSTANCE;
            } else {
                continue;
            }
            String base = trueType.getName();
            if (base == null || base.matches("[A-Z]{6}\\+.*")) {
                continue;
            }
            String face = faceFor(base);
            if (face == null) {
                continue;
            }
            FontProgram program = cache.computeIfAbsent(face, f -> FontProgram.load(doc, dir, f));
            if (program == FontProgram.UNAVAILABLE || !widthsMatch(trueType, encoding, program)) {
                continue;
            }
            descriptor.setFontFile2(program.stream);
        }
        for (COSName name : resources.getXObjectNames()) {
            try {
                if (resources.getXObject(name) instanceof PDFormXObject form) {
                    embedFonts(doc, dir, form.getResources(), cache, seen);
                }
            } catch (Exception e) {
                continue;
            }
        }
    }

    /**
     * The Liberation face metrically matching this BaseFont, or null.
     *
     * A candidate only — guard three still measures every width. The
     * exclusions are family members that merely CONTAIN the target name while
     * carrying different metrics (Arial Narrow, Arial Black, Arial Unicode);
     * the width guard would refuse them anyway, but a table should not
     * nominate what it knows is wrong.
     */
    private static String faceFor(String baseFont) {
        String n = baseFont.toLowerCase().replaceAll("[^a-z]", "");
        String family;
        if (n.contains("arialunicode") || n.contains("narrow") || n.contains("black")
                || n.contains("condensed") || n.contains("light") || n.contains("rounded")) {
            return null;
        }
        if (n.contains("arial")) {
            family = "LiberationSans";
        } else if (n.contains("timesnewroman")) {
            family = "LiberationSerif";
        } else if (n.contains("couriernew")) {
            family = "LiberationMono";
        } else {
            return null;
        }
        boolean bold = n.contains("bold");
        boolean italic = n.contains("italic") || n.contains("oblique");
        String style = bold && italic ? "BoldItalic" : bold ? "Bold" : italic ? "Italic" : "Regular";
        return family + "-" + style + ".ttf";
    }

    /**
     * Guard three: every defined, non-zero /Widths entry equals the
     * replacement's own advance within 0.5/1000 em.
     *
     * Codes the base encoding leaves undefined are exempt — a producer that
     * filled the whole FirstChar..LastChar range wrote SOMETHING there, but
     * no glyph can be selected through the encoding, so no reader can draw
     * one. Everything else is compared, and one mismatch refuses the font.
     */
    private static boolean widthsMatch(PDTrueTypeFont font, Encoding encoding, FontProgram program) {
        COSDictionary dict = font.getCOSObject();
        int first = dict.getInt(COSName.FIRST_CHAR, -1);
        if (first < 0 || !(dict.getDictionaryObject(COSName.WIDTHS) instanceof COSArray widths)) {
            return false;
        }
        GlyphList adobe = GlyphList.getAdobeGlyphList();
        for (int i = 0; i < widths.size(); i++) {
            if (!(widths.getObject(i) instanceof COSNumber number)) {
                return false;
            }
            float width = number.floatValue();
            if (width == 0) {
                continue;
            }
            String glyphName = encoding.getName(first + i);
            if (glyphName == null || ".notdef".equals(glyphName)) {
                continue;
            }
            String unicode = adobe.toUnicode(glyphName);
            if (unicode == null || unicode.isEmpty()) {
                return false;
            }
            int glyphId = program.cmap.getGlyphId(unicode.codePointAt(0));
            if (glyphId == 0) {
                return false;
            }
            float advance;
            try {
                advance = program.ttf.getAdvanceWidth(glyphId) * 1000f / program.unitsPerEm;
            } catch (IOException e) {
                return false;
            }
            if (Math.abs(advance - width) > 0.5f) {
                return false;
            }
        }
        return true;
    }

    /** One parsed face: the program bytes as a PDStream, and its own metrics. */
    private static final class FontProgram {
        static final FontProgram UNAVAILABLE = new FontProgram(null, null, 1000, null);

        final TrueTypeFont ttf;
        final CmapLookup cmap;
        final float unitsPerEm;
        final PDStream stream;

        private FontProgram(TrueTypeFont ttf, CmapLookup cmap, float unitsPerEm, PDStream stream) {
            this.ttf = ttf;
            this.cmap = cmap;
            this.unitsPerEm = unitsPerEm;
            this.stream = stream;
        }

        static FontProgram load(PDDocument doc, Path dir, String face) {
            try {
                byte[] bytes = Files.readAllBytes(dir.resolve(face));
                TrueTypeFont ttf = new TTFParser().parse(new RandomAccessReadBuffer(bytes));
                PDStream stream = new PDStream(doc, new ByteArrayInputStream(bytes), COSName.FLATE_DECODE);
                // Length1 is the UNCOMPRESSED program length; readers need it
                // to slice the program back out of the FLATE stream.
                stream.getCOSObject().setInt(COSName.LENGTH1, bytes.length);
                return new FontProgram(ttf, ttf.getUnicodeCmapLookup(), ttf.getUnitsPerEm(), stream);
            } catch (IOException | RuntimeException e) {
                // A face that cannot be read embeds nothing — every candidate
                // font keeps its punch item, which is the state before this
                // pass existed.
                return UNAVAILABLE;
            }
        }

        void close() {
            if (ttf != null) {
                try {
                    ttf.close();
                } catch (IOException e) {
                    // Closing a parsed font failed; nothing depends on it.
                }
            }
        }
    }

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
                    // 7.21.3.2-1 — an EMBEDDED CIDFontType2 shall contain a
                    // CIDToGIDMap entry. Absent, ISO 32000 defines the value
                    // as Identity, so writing /Identity states the default
                    // every reader already applies: zero semantic change,
                    // one clause honestly closed. Never written where a map
                    // exists, and never onto an unembedded font, whose real
                    // problem is the missing program.
                    COSDictionary cid = descendant.getCOSObject();
                    if (COSName.getPDFName("CIDFontType2").equals(cid.getDictionaryObject(COSName.SUBTYPE))
                            && descriptor != null && descriptor.getFontFile2() != null
                            && cid.getDictionaryObject(COSName.CID_TO_GID_MAP) == null) {
                        cid.setItem(COSName.CID_TO_GID_MAP, COSName.IDENTITY);
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
    /**
     * Give a link with no URI the accessible name it already displays.
     *
     * The loop above transcribes a link's destination from its URI action. An
     * INTERNAL link has none — a Word table of contents exports as a `/Dest`
     * array naming a page, and `linkUri` returns null for every one of them, so
     * the whole table of contents ships with no accessible name at all. `[V]`
     * On one real delivered document: 70 link annotations, 35 with a URI and
     * described, 35 with a direct `/Dest` and silent.
     *
     * What gets written is the link's OWN TEXT — the glyphs the `/Link`
     * structure element already references, read by `StructText`, which is the
     * same resolution `Inspect` and `Headings` use. It is the author's word for
     * their own link, and it is on the page: a reader sees it, and until now
     * only a sighted reader did.
     *
     * NOT the destination, which is the one thing a `/Dest` could offer. It
     * resolves to a page index or an exporter's `__RefHeading___Toc12345`, and
     * "page 14" thirty times over is our phrasing of a fact about the file
     * rather than anything the document says. A named destination is worse — it
     * is exporter noise wearing the shape of a description.
     *
     * A link with NO text keeps its silence and its punch item, exactly as a
     * link with no URI did before this. An image link has nothing to
     * transcribe, and inventing a name for it would silence the item that asks
     * a person to write a real one.
     *
     * The tree is read, never touched: this sets `/Contents` on the ANNOTATION.
     * `Finish`'s standing claim — no structure element created, moved,
     * re-parented or altered — still holds, and `contentChanges` still checks
     * it.
     *
     * Nothing is built unless a document needs it. `StructText` runs a
     * marked-content pass over every page, and a document whose links all carry
     * a URI never pays for one.
     *
     * ONE COUPLING, because it is invisible from either side. A `/Contents`
     * string is text, and `7.2-24` requires a determinable natural language for
     * it. We never default `/Lang`, so on a document that declares none this
     * describes links the document could not otherwise name AND adds `7.2-24`
     * to its clause list. That trade is right — a named link in an undeclared
     * language beats a nameless one, and such a document already fails `7.2-34`
     * on every word it contains — but it is a clause appearing because we
     * wrote something, which is the kind of thing that reads as a regression
     * later. `[V]` No longer empty on the corpus: one real undeclared document
     * now carries described links failing `7.2-24` on exactly this coupling
     * (two checks, against 32,399 `7.2-34` failures in the same file — the
     * trade stands). An earlier version of this note said the case was empty,
     * and it was, until the corpus grew.
     */
    /**
     * Re-rank heading levels onto a gapless ladder starting at H1 — the
     * conversion lane's standing policy for PDF/UA 7.4.2.
     *
     * RANK-preserving, never merging: the distinct levels the author used map
     * onto 1..k in first-to-deepest order, so an exporter's flat H2 ladder
     * becomes H1, and H1-then-H3 becomes H1-then-H2 — but two levels the
     * author distinguished STAY distinct. A sequence skip across levels that
     * both survive the re-rank is left exactly as it stands, because clearing
     * it would mean deciding which of two authored levels was the mistake,
     * and that is the punch list's question, not this stage's.
     *
     * `[V]` Both real Word documents failing 7.4.2-1 are a flat ladder the
     * exporter parked below H1 — 19×H2 and 49×H3 — which is the case this
     * exists for: one authored level, wrongly seated.
     *
     * REFUSED outright when any heading is reached through the RoleMap: the
     * element's own /S is then not the name a reader resolves, and rewriting
     * /S underneath a live mapping trades one lie for another. The punch item
     * survives, which is the honest outcome.
     */
    private static void renumberHeadings(PDDocumentCatalog catalog) {
        PDStructureTreeRoot root = catalog.getStructureTreeRoot();
        if (root == null) {
            return;
        }
        List<PDStructureElement> headings = new ArrayList<>();
        boolean[] roleMapped = { false };
        collectHeadings(root, headings, roleMapped,
            Collections.newSetFromMap(new IdentityHashMap<>()));
        if (roleMapped[0] || headings.isEmpty()) {
            return;
        }
        // TreeMap so iteration order IS rank order.
        TreeMap<Integer, Integer> rank = new TreeMap<>();
        for (PDStructureElement el : headings) {
            rank.put(headingLevel(el.getStructureType()), 0);
        }
        int next = 1;
        boolean identity = true;
        for (Map.Entry<Integer, Integer> entry : rank.entrySet()) {
            entry.setValue(next);
            if (entry.getKey() != next) {
                identity = false;
            }
            next++;
        }
        if (identity) {
            return;
        }
        for (PDStructureElement el : headings) {
            el.setStructureType("H" + rank.get(headingLevel(el.getStructureType())));
        }
    }

    /** H1..H9 by the element's OWN /S — a plain "H" is not a numbered level. */
    private static int headingLevel(String type) {
        if (type != null && type.length() == 2 && type.charAt(0) == 'H'
                && type.charAt(1) >= '1' && type.charAt(1) <= '9') {
            return type.charAt(1) - '0';
        }
        return -1;
    }

    private static void collectHeadings(PDStructureNode node, List<PDStructureElement> out,
            boolean[] roleMapped, Set<Object> seen) {
        if (!seen.add(node.getCOSObject())) {
            return;
        }
        for (Object kid : node.getKids()) {
            if (kid instanceof PDStructureElement el) {
                if (headingLevel(el.getStructureType()) > 0) {
                    out.add(el);
                } else if (headingLevel(el.getStandardStructureType()) > 0) {
                    // Reached only via the RoleMap — the refusal case.
                    roleMapped[0] = true;
                }
            }
            if (kid instanceof PDStructureNode child) {
                collectHeadings(child, out, roleMapped, seen);
            }
        }
    }

    private static void describeInternalLinks(PDDocument doc, List<PDAnnotationLink> links) {
        if (links.isEmpty()) {
            return;
        }
        PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();
        if (root == null) {
            return;
        }

        // Identity, because COSBase does not override equals: two dictionaries
        // holding equal keys are still two objects, and the one we want is the
        // instance the annotation wraps. PDFBox resolves an indirect reference
        // to a cached instance, which is what makes the lookup below hit.
        Map<COSDictionary, PDAnnotationLink> wanted = new IdentityHashMap<>();
        for (PDAnnotationLink link : links) {
            wanted.put(link.getCOSObject(), link);
        }

        StructText text;
        try {
            text = new StructText(doc);
        } catch (IOException | RuntimeException e) {
            // Until this pass, `Finish` never parsed a content stream — every
            // other write here reads the catalog. `StructText` runs the page
            // through PDFBox's marked-content extractor, and a malformed
            // content stream can throw where nothing threw before. Letting it
            // propagate would turn a document that used to be DELIVERED with a
            // punch list into a stage crash, which is a far worse trade than
            // the naming this buys.
            //
            // Swallowed rather than counted, unlike `stripCidSets`, because
            // the degraded state tells no lie: the links keep their silence and
            // keep the punch item that asks a person to name them, which is
            // exactly what the document got before this existed.
            return;
        }

        describe(root, text, wanted, Collections.newSetFromMap(new IdentityHashMap<>()));
    }

    /**
     * `seen` is identity-based and per traversal, for the reason `StructText`
     * carries the same guard: a structure tree is a tree by convention and a
     * graph by format, and `p07-cyclic-tree` is the fixture that proved an
     * unguarded walk recurses until the stack gives out.
     */
    private static void describe(PDStructureNode node, StructText text,
            Map<COSDictionary, PDAnnotationLink> wanted, Set<Object> seen) {
        if (wanted.isEmpty() || !seen.add(node.getCOSObject())) {
            return;
        }
        for (Object kid : node.getKids()) {
            if (kid instanceof PDStructureNode child) {
                describe(child, text, wanted, seen);
            } else if (kid instanceof PDObjectReference ref && node instanceof PDStructureElement owner) {
                if (!(ref.getCOSObject().getDictionaryObject(COSName.getPDFName("Obj"))
                        instanceof COSDictionary referenced)) {
                    continue;
                }
                PDAnnotationLink link = wanted.get(referenced);
                if (link == null) {
                    continue;
                }
                String described = text.of(owner);
                if (!described.isEmpty()) {
                    link.setContents(described);
                    wanted.remove(referenced);
                }
            }
        }
    }

    private static String linkUri(PDAnnotationLink link) {
        if (link.getAction() instanceof PDActionURI uri) {
            return uri.getURI();
        }
        return null;
    }

    private static String buildXmp(String lang, String title, String author, boolean claimUa1) {
        String dcLanguage = lang == null ? "" : String.format(
            "   <dc:language><rdf:Bag><rdf:li>%s</rdf:li></rdf:Bag></dc:language>%n",
            escape(lang));

        // An ordered list, because dc:creator is a Seq in the XMP schema and a
        // reader that expects one must not find a bare literal.
        String dcCreator = (author == null || author.isBlank()) ? "" : String.format(
            "   <dc:creator><rdf:Seq><rdf:li>%s</rdf:li></rdf:Seq></dc:creator>%n",
            escape(author));

        String dcTitle = (title == null || title.isBlank()) ? "" : String.format(
            "   <dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">%s</rdf:li></rdf:Alt></dc:title>%n",
            escape(title));

        // The identifier is an ASSERTION OF CONFORMANCE, not metadata, and
        // it is how conformance is machine-detected downstream. Emitted
        // unconditionally it said "this conforms to PDF/UA-1" on files our own
        // checker had just failed, which is the conduct the FTC fined a
        // competitor $1M for. A reader trusts the bytes over any report
        // travelling beside them.
        String uaIdentifier = claimUa1
            ? "  <rdf:Description rdf:about=\"\"\n"
                + "      xmlns:pdfuaid=\"http://www.aiim.org/pdfua/ns/id/\">\n"
                + "   <pdfuaid:part>1</pdfuaid:part>\n"
                + "  </rdf:Description>\n"
            : "";

        return ""
            + "<?xpacket begin=\"﻿\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n"
            + "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n"
            + " <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n"
            + "  <rdf:Description rdf:about=\"\"\n"
            + "      xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n"
            + dcTitle
            + dcCreator
            + dcLanguage
            + "  </rdf:Description>\n"
            + uaIdentifier
            + " </rdf:RDF>\n"
            + "</x:xmpmeta>\n"
            + "<?xpacket end=\"w\"?>";
    }

    /**
     * XML-safe text for the XMP packet.
     *
     * The three entities, plus the characters XML 1.0 forbids OUTRIGHT: a C0
     * control other than tab, newline or carriage return cannot appear in a
     * conforming XML document at all, not even escaped as a numeric reference.
     * One of them in a title produces a malformed XMP packet, and veraPDF then
     * fails the delivered file for a metadata reason this vocabulary cannot
     * name -- it arrives in the catch-all as a bare clause id.
     *
     * The title is not ours and is not validated anywhere: it is either copied
     * from a heading in the client's document or, on the repair path, read
     * straight out of the document's own info dictionary. So this is the
     * boundary where it has to be made safe.
     *
     * Dropped rather than replaced. A control character carries no meaning a
     * reader loses, and substituting a visible character would put something
     * in the client's title that their document never said.
     */
    private static String escape(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < 0x20 && c != '\t' && c != '\n' && c != '\r') continue;
            switch (c) {
                case '&' -> b.append("&amp;");
                case '<' -> b.append("&lt;");
                case '>' -> b.append("&gt;");
                default -> b.append(c);
            }
        }
        return b.toString();
    }
}
