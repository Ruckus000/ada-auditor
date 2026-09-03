import {
  cleanOperatorText,
  figureGroups,
  type Ask,
  type DeclaredAnswers,
} from '../../../domain/document-answers';
import type { DocumentExcerpt } from '../../../domain/document-remediation';

/**
 * What the one-off remediation screen posts as the `answers` part.
 *
 * The route's rule is exact — `applyDeclarations` accepts a description only
 * when its target equals the reading's figure in type, page, prior and
 * image — so the browser copies `asks[i].target` verbatim and adds `alt`.
 * A repeated image is one description that lands on every figure drawing
 * it, the grouping `figureGroups` already defines for the workbench. A
 * language is declared only where the reading asked for one: sent against a
 * document that declares its own, it refuses the whole run.
 *
 * `null` when nothing was declared, so the caller posts the file bare and
 * the route runs it without answers — rather than an empty part that says
 * "a person answered" and names nothing.
 *
 * Pure, so it is tested in Node; the byte hash it takes is computed by the
 * screen, with WebCrypto, over the same bytes it uploads.
 */
export function declaredAnswersFrom(
  summary: { asks?: Ask[] },
  inputSha256: string,
  descriptions: Record<string, string>,
  language: string | null,
): DeclaredAnswers | null {
  const asks = summary.asks ?? [];
  const figures: DeclaredAnswers['figures'] = [];

  for (const group of figureGroups(asks.filter((ask) => ask.kind === 'figure'))) {
    const lead = group[0];
    if (lead === undefined) continue;
    const alt = cleanOperatorText(descriptions[lead.id] ?? '');
    if (alt === '') continue;
    for (const member of group) {
      const target = member.target;
      if (target === undefined || !('ordinal' in target)) continue;
      figures.push({ ...target, alt });
    }
  }

  const chosen = language?.trim() ?? '';
  const declaresLanguage = chosen !== '' && asks.some((ask) => ask.id === 'language');

  if (figures.length === 0 && !declaresLanguage) return null;

  return {
    inputSha256,
    ...(declaresLanguage ? { language: chosen } : {}),
    figures,
  };
}

/**
 * Where a figure sits, in the order a reader meets it — the sentence the
 * workbench prints under each open figure, shared with the one-off screen.
 * The caption is not repeated as the text after it.
 */
export function figureContextLine(context: DocumentExcerpt['figures'][number]['context']): string {
  const parts: string[] = [];
  if (context.caption) parts.push(`Caption: “${context.caption}”.`);
  if (context.heading) parts.push(`Under “${context.heading}”.`);
  if (context.before) parts.push(`Before it: “${context.before}”.`);
  if (context.after && context.after !== context.caption) parts.push(`After it: “${context.after}”.`);
  return parts.join(' ');
}
