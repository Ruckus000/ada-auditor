# Heading-judge protocol v2 (one chunk)

You receive: a chunk file `CHUNK` (JSON array of cards) and an output path `OUT`. Each card has `n`, `id`, `text`, `prev`, `next`, `font_pt`, `weight`, `page` (0-based), `repeats_on_pages`, `in_table_box`, `image` (absolute path to a PNG of the page with this card's box drawn in magenta).

For EVERY card, in order:
1. Read the image with the Read tool. Find the magenta box. The card is the text inside it; `text` is the extractor's reading and may be garbled, merged, or a fragment — trust the image over the text.
2. Decide the ISO type of the boxed text using the definition:
   - `H` — a heading: it labels a section of the document's own content that follows it (a title, section, subsection, form-section label, slide title, column/panel heading in a brochure). Give `level`: 1 for the document/page title tier, deeper for nested sections; judge from the visible ladder on the page.
   - `P` — body text, sentence fragment, subtitle/date/contact line under a title, form field label, signature line, pull quote.
   - `TH` — a table header cell or table group/row header.
   - `Caption` — a figure/table/chart title or caption.
   - `TOCI` — a table-of-contents entry.
   - `Lbl` — a list marker, bullet glyph, or bare number/letter with no words.
   - `Artifact` — running header/footer, page number, form-number, copy-distribution line, scanner noise.
   - `Other` — a list item body, a checklist item, a diagram node label, anything that is content but none of the above.
   - `Unsure` — ONLY when the box is on handwriting, a stray mark, or an unreadable scan such that no type can be judged. Do not use Unsure to avoid a hard call.
   Rules: typography alone never decides (bold ≠ heading); a bold lead-in ending in a colon followed by a list on the same line is `P`; a box that covers only an enumerator (`A.`, `II.`, `3.`) is `Lbl`, whatever it enumerates — the heading is the card that carries the words; a card that carries an enumerator and heading words on one short line is `H`; a head card split from a list item (id ending in `h`) is judged on its own line only, and its body card is judged as body text unless it is itself a heading; a heading merged with its first sentence is still `H`; `in_table_box` is geometric — a heading sitting above a table is still `H`.
3. Append ONE line to `OUT` (JSONL): `{"n": <n>, "id": "<id>", "type": "<type>", "level": <int or null>, "note": "<≤12 words>"}`. `level` is an integer only when type is `H`, else null.

Do not read any file other than the chunk and the images. Do not look for or use model predictions, other judges' files, or existing label files. When every card in the chunk has a line in `OUT`, run `wc -l OUT` and confirm it equals the chunk length, then reply with exactly: `done <chunk> <count>`.
