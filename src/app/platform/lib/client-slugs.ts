import { SITE_SEEDS } from './data';
import { clientSlug } from './params';

/**
 * Maps between a client's URL slug and its fixture index.
 *
 * The prototype identified a client by its position in `SITE_SEEDS`, so
 * `state.client = 2` was the entire address of a screen. Indexes cannot go in
 * a URL — they change when the list does, and a bookmark would silently start
 * pointing at a different client.
 *
 * This module is the seam where that goes away: it is the only place that
 * knows an index exists, so when the screens read real clients the slug
 * becomes the id and this file is deleted rather than edited.
 */

const SLUGS: string[] = SITE_SEEDS.map((seed) => clientSlug(seed.name));

export function slugForIndex(index: number): string | null {
  return SLUGS[index] ?? null;
}

/**
 * Falls back to the first client rather than throwing.
 *
 * An unknown slug reaching a layout would take the whole shell down with it.
 * The routes render "not found" for a client that does not exist; this only
 * has to keep the provider total while that happens.
 */
export function indexForSlug(slug: string | null): number {
  if (!slug) return 0;
  const index = SLUGS.indexOf(slug);
  return index === -1 ? 0 : index;
}

export function knownSlug(slug: string): boolean {
  return SLUGS.includes(slug);
}

export function allClientSlugs(): string[] {
  return [...SLUGS];
}
