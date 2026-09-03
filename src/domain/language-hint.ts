import type { DocumentStructure } from './document-structure';

/**
 * A suggestion about the language a document is written in, read from the
 * text the structure already carries — never a claim, never written anywhere.
 *
 * The `language` punch item fires when a document declares no usable `/Lang`,
 * and `[V]` 7 of the 52 real PDFs in the blind corpus raise it. The person who
 * answers it has the document's title on the screen and nothing else. This
 * gives them the document's own words, read the cheapest honest way: the
 * commonest function words of each Latin-script language in the vocabulary,
 * and the script itself for Chinese, Korean and Arabic. No dependency, no
 * model, no network — nine languages, a few hundred words, pure.
 *
 * What it is NOT: `sourceLanguage`. The hint travels on the ask's `target`
 * (stripped from the response header, the logs and the public report along
 * with every other ask), the select stays on "Choose…", and whether the
 * person took the suggestion is derived afterwards from the value they chose
 * against `target.suggested`. The blind harness scores any `sourceLanguage`
 * on a document that declares none as a fatal invented claim; that guard is
 * what keeps this a suggestion.
 *
 * It abstains rather than guesses. Under the floor, inside the margin, or on
 * a script the vocabulary cannot name (kana), it returns `null` and the ask
 * carries nothing — a weak suggestion is still a suggestion.
 */

export type LanguageHint = { suggested: string; evidence: number };

/** The fewest matching tokens a suggestion may rest on. */
export const HINT_FLOOR = 8;

/** The winner must reach this multiple of the runner-up, or it is a tie. */
export const HINT_MARGIN = 2;

/**
 * About twenty of the commonest function words per language. Overlaps
 * between the Romance lists (`de`, `que`, `a`, `para`) are deliberate — the
 * words ARE that common in each — and the margin is what separates them:
 * a Spanish document feeds Portuguese through the shared words and Spanish
 * through those plus its own, and wins by the second set.
 */
const STOPWORDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  en: ['the', 'and', 'of', 'to', 'in', 'a', 'is', 'for', 'that', 'on', 'with', 'as', 'by', 'this', 'be', 'are', 'or', 'from', 'at', 'it', 'an', 'will', 'not', 'which', 'was'],
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una', 'para', 'con', 'que', 'por', 'se', 'no', 'es', 'al', 'como', 'más', 'su', 'sus', 'lo', 'a', 'este'],
  fr: ['le', 'la', 'les', 'de', 'des', 'du', 'et', 'en', 'un', 'une', 'pour', 'avec', 'que', 'qui', 'par', 'ne', 'pas', 'est', 'au', 'aux', 'sur', 'dans', 'ce', 'cette', 'il'],
  pt: ['o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'um', 'uma', 'para', 'com', 'não', 'que', 'por', 'se', 'no', 'na', 'mais', 'como', 'ao', 'à'],
  vi: ['và', 'của', 'các', 'là', 'có', 'được', 'trong', 'không', 'cho', 'này', 'những', 'người', 'để', 'với', 'một', 'về', 'theo', 'tại', 'đã', 'sẽ'],
  tl: ['ang', 'ng', 'sa', 'mga', 'na', 'ay', 'at', 'para', 'ito', 'hindi', 'kung', 'niya', 'kanyang', 'naman', 'din', 'rin', 'lamang', 'upang', 'dahil', 'ngunit'],
};

/**
 * Scripts that name a language on their own. Each character is a token.
 * Kana is scored under `ja` so that Japanese — Han characters with kana
 * between them — competes with `zh` and loses it the margin, or wins and is
 * refused below because the vocabulary has no name for it. Either way a
 * Japanese document is not read as Chinese.
 */
const SCRIPTS: ReadonlyArray<readonly [tag: string, script: RegExp]> = [
  ['zh', /\p{Script=Han}/u],
  ['ko', /\p{Script=Hangul}/u],
  ['ar', /\p{Script=Arabic}/u],
  ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
];

/** Which vocabulary tags each stopword counts for, built once. */
const WORD_TO_TAGS: ReadonlyMap<string, ReadonlyArray<string>> = (() => {
  const map = new Map<string, string[]>();
  for (const [tag, words] of Object.entries(STOPWORDS)) {
    for (const word of words) {
      const held = map.get(word);
      if (held) held.push(tag);
      else map.set(word, [tag]);
    }
  }
  return map;
})();

/** The tags a hint may suggest: everything scored except the kana competitor. */
const HINTABLE = new Set([...Object.keys(STOPWORDS), 'zh', 'ko', 'ar']);

export type LanguageScore = { tag: string; count: number };

/** The text a reading carries, in the order it carries it. Nothing is added. */
function textsOf(structure: Pick<DocumentStructure, 'title' | 'headingTexts' | 'order'>): string[] {
  const texts: string[] = [];
  if (structure.title !== null) texts.push(structure.title);
  for (const heading of structure.headingTexts) if (heading.text !== null) texts.push(heading.text);
  for (const entry of structure.order) if (entry.text !== null) texts.push(entry.text);
  return texts;
}

/**
 * Every language's matching-token count, highest first. Exposed so a
 * measurement can check the abstention rule against the numbers rather than
 * take the null on trust; the product reads only `languageHint`.
 */
export function scoreLanguages(
  structure: Pick<DocumentStructure, 'title' | 'headingTexts' | 'order'>,
): LanguageScore[] {
  const counts = new Map<string, number>();
  const bump = (tag: string, by = 1) => counts.set(tag, (counts.get(tag) ?? 0) + by);

  for (const text of textsOf(structure)) {
    for (const token of text.normalize('NFC').toLowerCase().match(/\p{L}+/gu) ?? []) {
      let scripted = false;
      for (const char of token) {
        for (const [tag, script] of SCRIPTS) {
          if (script.test(char)) {
            bump(tag);
            scripted = true;
            break;
          }
        }
      }
      if (scripted) continue;
      for (const tag of WORD_TO_TAGS.get(token) ?? []) bump(tag);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The suggestion, or `null` where the text does not support one: under
 * `HINT_FLOOR` matches, short of `HINT_MARGIN` times the runner-up, or a
 * winner the vocabulary cannot name. Always a primary subtag — `en`, never
 * `en-US` — because the text says which language, not which region.
 */
export function languageHint(
  structure: Pick<DocumentStructure, 'title' | 'headingTexts' | 'order'>,
): LanguageHint | null {
  const [winner, runnerUp] = scoreLanguages(structure);
  if (winner === undefined || winner.count < HINT_FLOOR) return null;
  if (runnerUp !== undefined && winner.count < HINT_MARGIN * runnerUp.count) return null;
  if (!HINTABLE.has(winner.tag)) return null;
  return { suggested: winner.tag, evidence: winner.count };
}
