# The language hint — predictions, registered before measurement

**Date:** 2026-09-03. **Change:** `domain/language-hint.ts` — a pure
reading of the text the structure already carries (`title`,
`headingTexts[].text`, `order[].text`), scored against ~20 stopwords per
Latin-script language in the vocabulary (`en`, `es`, `fr`, `pt`, `vi`, `tl`)
and character ranges for the three scripts (`zh`, `ko`, `ar`). The result
rides on the `language` ask's `target` as `{ suggested, evidence }`, and
nowhere else. Nothing writes; nothing preselects; `sourceLanguage` is not
touched.

**What it exists for.** The `language` ask fires when a document declares
no usable `/Lang`, and `[V]` 7 of the 52 real PDFs in the blind corpus raise
it — 13 %, past the "handful" the deferral was priced on. The person
answering has, today, the document's title and nothing else on the screen.
The hint gives them the document's own text, read the cheapest honest way,
as a *suggestion beside the empty select*. It is never a claim: the ask
stays open, the select stays on "Choose…", and whether the person took the
suggestion is derived later from `row.value === row.target.suggested`,
never written down as prose.

**The floor and the margin, named.** A token is a lowercased maximal run
of letters (`\p{L}`, NFC); a script character (`zh`, `ko`, `ar`) is a token
on its own. The hint abstains — returns `null` — when the winning language
has fewer than **8** matching tokens (the floor), or when it does not reach
**twice** the runner-up's count (the margin). Kana is counted as an
internal competitor the vocabulary cannot name, so Japanese text abstains
rather than reading as Chinese. Below the floor or inside the margin there
is no suggestion at all, because a weak suggestion is still a suggestion.

**What the corpus can and cannot say.** There is no ground truth for the
language a real document is *written* in: `expected.language` in every key
is the tag the document *declares*, authored by qpdf. The pre-registered
proxy is therefore the real PDFs whose `/Lang` is usable: the hint is run
on each and compared with the declared tag on primary subtags (`en-US` →
`en`, `EN-US` → `en`). Every usable tag in the real PDFs is English, so
the proxy exercises one detector on real text; the other eight are held to
unit fixtures with invented sentences. That is stated here so the agreement
number is read for what it is.

## Registered predictions (over `experiments/document-remediation/blind-corpus/real/*.pdf`, the 52 real PDFs)

1. **Agreement** — where the hint fires on a document with a usable
   `/Lang`, it agrees with the declared primary subtag on **≥ 90 %**.
   Falsified below 80 %. An abstention is neither agreement nor
   disagreement and is counted on its own line.
2. **Coverage on the floor documents** — the hint fires (does not abstain)
   on **≥ 5 of the 7** documents that raise the ask: n05, n22, n23, n30,
   r06, r10, r14. Four of the seven have zero headings, so the reading-order
   entries (each cut at 90 characters by `Inspect`) carry the evidence.
   Falsified at 3 or fewer.
3. **Abstention, not guessing** — every document on which the hint
   returns `null` has a winning count under 8 or a runner-up above half of
   it. No document with a null hint has evidence past both bars. This is a
   property of the code, checked over the corpus run rather than assumed.
4. **Zero change** across the whole blind corpus (planted and real, the
   `run` + `score` harness): `sourceLanguage`, `gaps`, `needs`, the
   conformance verdict and the delivered bytes are identical to the
   previous run's — fatal 0, invented 0, silent 0, drift 0, and in
   particular zero `invented-language`, which is the scorer's guard that
   the hint never reaches `sourceLanguage`.
5. **`INSTRUMENT_VERSION` stays 12.** No criterion enters or leaves
   `gapsIn` or `needsIn`; a hint on an ask's target is not new vocabulary
   the regression comparator can see, because `asks` are stripped before
   anything is compared or stored as a baseline.
6. **The trigger** — 7 of 52 real PDFs raise the ask (**13 %**). Recorded
   here as the number that replaces "a handful" in the deferral.

Results follow in `language-hint-results.md`, with the per-document
coverage table (fired / abstained, no text) and any correction to these
predictions logged by kind.
