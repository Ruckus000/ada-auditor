import java.util.regex.Pattern;

/**
 * What a caption's opening looks like: "Figure 3:", "Fig. 2 —", "Plate 1",
 * "Figure 1 (a-c):".
 *
 * One definition, two callers with the same meaning. Captions uses it to decide
 * which line to lift into a figure's Alt; Headings uses it to demote a heading
 * that is really a caption. If those two disagreed about what a caption is, the
 * same line could be both a figure's description and a document heading.
 */
public final class CaptionPattern {
    private CaptionPattern() {}

    public static final Pattern OPENING = Pattern.compile(
        "^\\s*(figure|fig\\.?|plate|chart|diagram|illustration|exhibit|photo|image|table)\\s*"
        + "([0-9]+|[ivxlc]+)\\s*(\\([^)]*\\))?\\s*[:.\\u2013\\u2014-]",
        Pattern.CASE_INSENSITIVE);
}
