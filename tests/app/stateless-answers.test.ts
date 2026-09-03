import { describe, expect, it } from 'vitest';
import type { Ask } from '../../src/domain/document-answers';
import { declaredAnswersFrom, figureContextLine } from '../../src/app/platform/lib/stateless-answers';

/**
 * What the one-off remediation screen posts as the `answers` part.
 *
 * The route's rule is exact: a description is accepted only when its target
 * equals the reading's figure, so the browser copies `asks[i].target`
 * verbatim and adds `alt`. A repeated image is one description that lands on
 * every figure drawing it; a language is declared only where the reading
 * asked for one; and nothing declared means no part at all — the file is
 * posted bare, which the route treats as "run without answers".
 */

const SHA = 'a'.repeat(64);

const figure = (ordinal: number, over: Partial<Extract<Ask['target'], { ordinal: number }>> = {}): Ask => ({
  id: `figure:${ordinal}`,
  kind: 'figure',
  criterion: '1.1.1',
  answerable: 'operator',
  target: { ordinal, type: 'Figure', page: ordinal + 1, prior: 'absent', ...over },
});

const LANGUAGE: Ask = { id: 'language', kind: 'language', criterion: '3.1.1', answerable: 'operator' };

describe('declaredAnswersFrom', () => {
  it('copies each answered figure target verbatim and adds the description', () => {
    const summary = { asks: [figure(0, { page: null, imageDigest: 'd1' })] };

    expect(declaredAnswersFrom(summary, SHA, { 'figure:0': 'A map' }, null)).toEqual({
      inputSha256: SHA,
      figures: [{ ordinal: 0, type: 'Figure', page: null, prior: 'absent', imageDigest: 'd1', alt: 'A map' }],
    });
  });

  it('lands one description on every figure drawing the same image', () => {
    const summary = {
      asks: [figure(0, { imageDigest: 'logo' }), figure(3, { imageDigest: 'logo' }), figure(5)],
    };

    const answers = declaredAnswersFrom(summary, SHA, { 'figure:0': 'The town seal', 'figure:5': 'A chart' }, null);

    expect(answers?.figures.map((entry) => [entry.ordinal, entry.alt])).toEqual([
      [0, 'The town seal'],
      [3, 'The town seal'],
      [5, 'A chart'],
    ]);
  });

  it('declares a language only where the reading asked for one', () => {
    expect(declaredAnswersFrom({ asks: [LANGUAGE] }, SHA, {}, 'cy-GB')).toEqual({
      inputSha256: SHA,
      language: 'cy-GB',
      figures: [],
    });
    // Sending one against a document that declares its own is a whole-run
    // refusal, so a chosen language is dropped when there is no ask for it.
    expect(declaredAnswersFrom({ asks: [figure(0)] }, SHA, {}, 'en')).toBeNull();
  });

  it('ignores blank descriptions and cleans the rest', () => {
    const summary = { asks: [figure(0), figure(1)] };

    const answers = declaredAnswersFrom(summary, SHA, { 'figure:0': '   ', 'figure:1': '  A map  ' }, null);

    expect(answers?.figures).toEqual([{ ordinal: 1, type: 'Figure', page: 2, prior: 'absent', alt: 'A map' }]);
  });

  it('is null when nothing was declared, so no part is posted', () => {
    expect(declaredAnswersFrom({ asks: [figure(0), LANGUAGE] }, SHA, {}, null)).toBeNull();
    expect(declaredAnswersFrom({ asks: [] }, SHA, { 'figure:9': 'orphan' }, 'en')).toBeNull();
  });
});

describe('figureContextLine', () => {
  it('says where the figure sits, in the order a reader meets it', () => {
    const line = figureContextLine({ caption: 'Fig. 2', heading: 'Budget', before: 'As shown', after: 'Next' });

    expect(line).toBe('Caption: “Fig. 2”. Under “Budget”. Before it: “As shown”. After it: “Next”.');
  });

  it('does not repeat the caption as the text after', () => {
    expect(figureContextLine({ caption: 'Fig. 2', after: 'Fig. 2' })).toBe('Caption: “Fig. 2”.');
  });

  it('is empty when there is no context', () => {
    expect(figureContextLine({})).toBe('');
  });
});
