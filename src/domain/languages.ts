/**
 * The languages a municipal document is most often written in, as the two
 * screens offer them and as the hint names them. Anything else is typed as a
 * BCP-47 tag in the free field beside the select.
 *
 * In `domain` rather than the client component that first held it, because
 * the language hint scores against the same vocabulary and must not import a
 * `'use client'` module to learn it.
 */
export const LANGUAGES: ReadonlyArray<readonly [tag: string, name: string]> = [
  ['en', 'English'],
  ['en-US', 'English (US)'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['pt', 'Portuguese'],
  ['zh', 'Chinese'],
  ['vi', 'Vietnamese'],
  ['ko', 'Korean'],
  ['tl', 'Tagalog'],
  ['ar', 'Arabic'],
];

/** The name the vocabulary gives a tag, or the tag itself when it has none. */
export function languageName(tag: string): string {
  return LANGUAGES.find(([candidate]) => candidate === tag)?.[1] ?? tag;
}
