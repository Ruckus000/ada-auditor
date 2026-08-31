import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import java.util.ArrayDeque;
import java.util.Deque;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.contentstream.operator.color.SetNonStrokingColor;
import org.apache.pdfbox.contentstream.operator.color.SetNonStrokingColorN;
import org.apache.pdfbox.contentstream.operator.color.SetNonStrokingColorSpace;
import org.apache.pdfbox.contentstream.operator.color.SetNonStrokingDeviceCMYKColor;
import org.apache.pdfbox.contentstream.operator.color.SetNonStrokingDeviceGrayColor;
import org.apache.pdfbox.contentstream.operator.color.SetNonStrokingDeviceRGBColor;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.graphics.color.PDColor;
import org.apache.pdfbox.pdmodel.graphics.state.RenderingMode;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.util.Matrix;
import org.apache.pdfbox.util.Vector;

/**
 * WCAG 2.1 SC 1.4.3 Contrast (Minimum), which nothing else here can see.
 *
 * veraPDF's ua1 profile does not check contrast. Neither does wt1a, and neither
 * does compare.mjs. Every number this project has ever recorded is silent about
 * it, and a real municipal fee schedule sets a subset of its values in red on
 * white at 4.00:1 against a 4.5:1 minimum. **We would have shipped that document
 * as remediated.**
 *
 * REPORTS, NEVER FIXES. Changing a client's colours is changing their design,
 * and it is not remediation. 1.4.1 Use of Color — meaning carried by colour
 * alone — is a judgement about authorial intent that nothing here can make. The
 * output is a finding for the manifest.
 *
 * HOW THE TWO COLOURS ARE OBTAINED. They come from different places on purpose:
 *
 *   FOREGROUND is exact, from the graphics state at the glyph operator, through
 *      PDColorSpace.toRGB. That handles CMYK, Lab, Indexed and Separation, which
 *      is the objection usually raised against doing this at all.
 *
 *   BACKGROUND is sampled from the RENDERED page. Reconstructing it from the
 *      content stream would mean tracking every fill, image and gradient behind
 *      the text and getting the z-order right. Rendering is what the reader
 *      actually sees, and it costs one PDFRenderer call per page.
 *
 * THE TRAP, and it cost two wrong runs. PDFTextStripper does not register the
 * colour operators — it only needs glyph positions — so without the six
 * SetNonStroking* operators added below, the graphics state stays at its default
 * and EVERY GLYPH REPORTS #000000 however it actually renders. The probe that
 * became this file confidently reported a clean document twice before the cause
 * was found. Anyone reading this later will hit the same thing.
 *
 * LARGE TEXT IS 3:1, NOT 4.5:1. WCAG sets the lower threshold at 18pt, or 14pt
 * when bold. Ignoring that would invent failures on every heading in the corpus,
 * which is the same class of error as inventing structure.
 *
 * Usage: Contrast <in.pdf>          (JSON to stdout; the file is not modified)
 */
public final class Contrast extends PDFTextStripper {

    /** WCAG 1.4.3: normal text. */
    private static final double MIN_NORMAL = 4.5;
    /** WCAG 1.4.3: large text — 18pt, or 14pt bold. */
    private static final double MIN_LARGE = 3.0;
    private static final float LARGE_PT = 18f;
    private static final float LARGE_PT_BOLD = 14f;

    /** No confident background could be sampled, so no ratio is claimed. */
    private static final int UNDETERMINED = -1;

    /** Rendering DPI. 150 is enough to sample a background and cheap enough for a 90-page packet. */
    private static final float DPI = 150f;
    private static final float SCALE = DPI / 72f;

    /** Subset-embedded fonts arrive as "DAAAAA+Georgia-Bold"; the tag is noise. */
    private static final java.util.regex.Pattern SUBSET_TAG =
        java.util.regex.Pattern.compile("^[A-Z]{6}\\+");

    private record Pair(String fg, String bg, boolean large, int page, boolean exempt) {}
    private static final class Tally {
        int glyphs;
        double ratio;
    }

    private final Map<Pair, Tally> tallies = new LinkedHashMap<>();
    /** The marked-content tags enclosing the glyph being drawn, outermost first. */
    private final Deque<String> marked = new ArrayDeque<>();
    private PDFRenderer renderer;
    private BufferedImage rendered;
    private int renderedPage = -1;

    public Contrast() throws IOException {
        super();
        addOperator(new SetNonStrokingColorSpace(this));
        addOperator(new SetNonStrokingDeviceRGBColor(this));
        addOperator(new SetNonStrokingDeviceGrayColor(this));
        addOperator(new SetNonStrokingDeviceCMYKColor(this));
        addOperator(new SetNonStrokingColor(this));
        addOperator(new SetNonStrokingColorN(this));
    }

    /**
     * WCAG exempts text that is pure decoration or part of a logo, and a PDF
     * says both — in the only place it can, the marked-content tags around the
     * glyph. `/Artifact` is the format's own word for "this is not content",
     * and a `/Figure` sequence is where a logotype drawn as live text lives.
     *
     * COUNTED SEPARATELY, NEVER DROPPED. `/Artifact` is broader than WCAG's
     * exemption: it covers pure decoration, but also running heads and page
     * numbers, which are visible text a sighted reader uses and which WCAG
     * does NOT exempt. `[V]` Excluding them outright silenced a real 4.0:1
     * failure on 82 glyphs of a running header in a federal publication.
     * So the tally keeps them in their own bucket and the punch list asks a
     * person whether they are decoration — the same answer the undetermined
     * bucket gives, for the same reason: we cannot tell, so we say so.
     */
    @Override
    public void beginMarkedContentSequence(COSName tag, COSDictionary properties) {
        marked.push(tag == null ? "" : tag.getName());
        super.beginMarkedContentSequence(tag, properties);
    }

    @Override
    public void endMarkedContentSequence() {
        if (!marked.isEmpty()) marked.pop();
        super.endMarkedContentSequence();
    }

    private boolean exempt() {
        for (String tag : marked) {
            if ("Artifact".equals(tag) || "Figure".equals(tag)) return true;
        }
        return false;
    }

    @Override
    protected void showGlyph(Matrix trm, PDFont font, int code, Vector displacement) throws IOException {
        String glyph = font == null ? null : font.toUnicode(code);
        // Whitespace has no foreground to contrast, and counting it would swamp
        // the tally with the page's background against itself.
        if (glyph == null || glyph.isBlank()) { super.showGlyph(trm, font, code, displacement); return; }

        // Text that paints nothing has no contrast. Rendering mode 3 is the
        // invisible OCR layer under every scanned page, and mode 7 only clips;
        // measuring either invents a failure a reader could never see.
        RenderingMode mode = getGraphicsState().getTextState().getRenderingMode();
        if (!mode.isFill() && !mode.isStroke()) { super.showGlyph(trm, font, code, displacement); return; }


        int fg = rgbOf(getGraphicsState().getNonStrokingColor());
        float size = trm.getScaleY();
        boolean bold = font != null && font.getName() != null
            && SUBSET_TAG.matcher(font.getName()).replaceFirst("").toLowerCase().contains("bold");
        boolean large = size >= LARGE_PT || (bold && size >= LARGE_PT_BOLD);

        int bg = backgroundAt(trm, size, fg);
        Pair key = new Pair(hex(fg), bg == UNDETERMINED ? "undetermined" : hex(bg), large,
            getCurrentPageNo(), exempt());
        Tally t = tallies.computeIfAbsent(key, k -> new Tally());
        t.glyphs++;
        t.ratio = bg == UNDETERMINED ? Double.NaN : ratio(fg, bg);

        super.showGlyph(trm, font, code, displacement);
    }

    /**
     * The most common colour in a band around the glyph, excluding anything close
     * to the text colour itself.
     *
     * The exclusion is what makes it a background rather than an average: without
     * it, a bold glyph fills enough of its own box to become the modal colour and
     * every run reports 1:1.
     */
    private int backgroundAt(Matrix trm, float size, int fg) throws IOException {
        if (rendered == null) return UNDETERMINED;
        int px = Math.round(trm.getTranslateX() * SCALE);
        int py = rendered.getHeight() - Math.round(trm.getTranslateY() * SCALE);
        int r = Math.max(2, Math.round(size * SCALE));
        Map<Integer, Integer> histogram = new HashMap<>();
        int sampled = 0;
        for (int dy = -r; dy <= r / 2; dy++) {
            for (int dx = -r; dx <= r; dx++) {
                int x = px + dx, y = py + dy;
                if (x < 0 || y < 0 || x >= rendered.getWidth() || y >= rendered.getHeight()) continue;
                int c = rendered.getRGB(x, y) & 0xFFFFFF;
                if (near(c, fg)) continue;
                histogram.merge(c, 1, Integer::sum);
                sampled++;
            }
        }
        Map.Entry<Integer, Integer> modal = histogram.entrySet().stream()
            .max(Map.Entry.comparingByValue()).orElse(null);
        if (modal == null || sampled == 0) return UNDETERMINED;
        // ABSTAIN rather than guess. A glyph sitting against a rule, an image or
        // dense neighbouring text has no single background, and the modal colour
        // there is whatever ink happened to be nearest. Reporting a ratio from it
        // invents a failure, which is the same class of error as inventing a
        // heading. The first run of this pass produced eleven such findings, most
        // of them a single glyph against an implausible dark grey.
        if (modal.getValue() * 2 < sampled) return UNDETERMINED;
        return modal.getKey();
    }

    /** Antialiasing produces a halo of near-text colours; they are ink, not background. */
    private static boolean near(int a, int b) {
        return Math.abs(((a >> 16) & 255) - ((b >> 16) & 255))
             + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255))
             + Math.abs((a & 255) - (b & 255)) < 90;
    }

    private static int rgbOf(PDColor c) throws IOException {
        float[] v = c.getColorSpace().toRGB(c.getComponents());
        return (Math.round(v[0] * 255) << 16) | (Math.round(v[1] * 255) << 8) | Math.round(v[2] * 255);
    }

    private static String hex(int rgb) { return String.format("#%06X", rgb); }

    /** WCAG relative luminance. */
    private static double luminance(int rgb) {
        double[] lin = new double[3];
        int[] ch = { (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255 };
        for (int i = 0; i < 3; i++) {
            double s = ch[i] / 255.0;
            lin[i] = s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    }

    private static double ratio(int fg, int bg) {
        double a = luminance(fg), b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    @Override
    protected void startPage(org.apache.pdfbox.pdmodel.PDPage page) throws IOException {
        int index = getCurrentPageNo() - 1;
        if (index != renderedPage) {
            // Anti-aliasing OFF. WCAG 1.4.3 Note 2 says outright that "the
            // contrast ratio for text can be evaluated with anti-aliasing
            // turned off", and it has to be: a blended edge pixel is a mix of
            // the two colours being compared, so sampling it drags the measured
            // foreground toward the background and flatters every ratio.
            renderer.setRenderingHints(noAntiAliasing());
            rendered = renderer.renderImageWithDPI(index, DPI);
            renderedPage = index;
        }
        super.startPage(page);
    }

    private static java.awt.RenderingHints noAntiAliasing() {
        java.awt.RenderingHints hints = new java.awt.RenderingHints(
            java.awt.RenderingHints.KEY_ANTIALIASING,
            java.awt.RenderingHints.VALUE_ANTIALIAS_OFF);
        hints.put(java.awt.RenderingHints.KEY_TEXT_ANTIALIASING,
            java.awt.RenderingHints.VALUE_TEXT_ANTIALIAS_OFF);
        return hints;
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            System.err.println("usage: Contrast <in.pdf>");
            System.exit(2);
        }
        try (PDDocument doc = Loader.loadPDF(new File(args[0]))) {
            Contrast c = new Contrast();
            c.renderer = new PDFRenderer(doc);
            c.getText(doc);

            List<String> findings = new ArrayList<>();
            int failing = 0, passing = 0, failingGlyphs = 0, undetermined = 0, undeterminedGlyphs = 0;
            int decorative = 0, decorativeGlyphs = 0;
            for (Map.Entry<Pair, Tally> e : c.tallies.entrySet()) {
                Pair p = e.getKey();
                Tally t = e.getValue();
                if (Double.isNaN(t.ratio)) { undetermined++; undeterminedGlyphs += t.glyphs; continue; }
                double need = p.large() ? MIN_LARGE : MIN_NORMAL;
                boolean ok = t.ratio >= need;
                if (ok) { passing++; continue; }
                // Below the threshold, but the document marks it as decoration or
                // as part of a figure. Its own bucket: not a failure we assert,
                // not a pass we invent.
                if (p.exempt()) { decorative++; decorativeGlyphs += t.glyphs; continue; }
                failing++;
                failingGlyphs += t.glyphs;
                // No sample of the measured text. The summary this feeds
                // renders on a client's public report, and the run that proved
                // the point printed a sentence off a real document.
                findings.add(String.format(
                    "{\"fg\":\"%s\",\"bg\":\"%s\",\"large\":%b,\"ratio\":%.2f,\"required\":%.1f,"
                    + "\"glyphs\":%d,\"page\":%d}",
                    p.fg(), p.bg(), p.large(), t.ratio, need, t.glyphs, p.page()));
            }
            System.out.printf(
                "{\"pairs\":%d,\"passing\":%d,\"failing\":%d,\"failingGlyphs\":%d,"
                + "\"undetermined\":%d,\"undeterminedGlyphs\":%d,"
                + "\"decorative\":%d,\"decorativeGlyphs\":%d,\"findings\":[%s]}%n",
                c.tallies.size(), passing, failing, failingGlyphs,
                undetermined, undeterminedGlyphs, decorative, decorativeGlyphs,
                String.join(",", findings));
        }
    }
}
