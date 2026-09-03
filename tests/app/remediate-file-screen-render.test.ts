import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Summary } from '../../src/app/platform/components/client/document-shared';

/**
 * The one-off remediation screen, rendered without a browser.
 *
 * What it must show is decided by the reading: a description field per group
 * of figures, one language choice where the reading asked for one, and the
 * items it cannot answer listed rather than hidden — the punch list is whole
 * or it is not shown. Without a toolchain there is nothing to upload to.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const { RemediateFileScreen, StatelessAnswersForm } = await import(
  '../../src/app/platform/components/remediate-file-screen'
);

function reading(asks: Summary['asks'], needs: NonNullable<Summary['needs']>): Summary {
  return {
    title: 'already-titled',
    titleText: 'Permit Conditions',
    sourceLanguage: null,
    tagged: true,
    pages: 3,
    headings: 2,
    tables: 0,
    lists: 0,
    figures: 3,
    gaps: [],
    needs,
    asks,
    excerpt: { figures: [{ ordinal: 0, context: { heading: 'Site plan', caption: 'Figure 1' } }] },
  };
}

const FIGURES = reading(
  [
    { id: 'language', kind: 'language', criterion: '3.1.1', answerable: 'operator' },
    { id: 'figure:0', kind: 'figure', criterion: '1.1.1', answerable: 'operator', target: { ordinal: 0, type: 'Figure', page: 1, prior: 'absent', imageDigest: 'seal' } },
    { id: 'figure:1', kind: 'figure', criterion: '1.1.1', answerable: 'operator', target: { ordinal: 1, type: 'Figure', page: 2, prior: 'absent', imageDigest: 'seal' } },
    { id: 'figure:2', kind: 'figure', criterion: '1.1.1', answerable: 'operator', target: { ordinal: 2, type: 'Figure', page: 3, prior: 'placeholder' } },
    { id: 'fonts:not-embedded', kind: 'fonts', criterion: 'PDF/UA 7.21', answerable: 'client' },
  ],
  [
    { criterion: '3.1.1', item: 'the source declares no language' },
    { criterion: '1.1.1', item: 'Figure 1 (page 1): no description' },
    { criterion: '1.1.1', item: 'Figure 2 (page 2): no description' },
    { criterion: '1.1.1', item: 'Figure 3 (page 3): placeholder description' },
    { criterion: 'PDF/UA 7.21', item: 'fonts are not embedded' },
  ],
);

function form(summary: Summary): string {
  return renderToStaticMarkup(
    createElement(StatelessAnswersForm, {
      summary,
      descriptions: {},
      language: '',
      onDescription: () => {},
      onLanguage: () => {},
      onSubmit: () => {},
      busy: false,
    }),
  );
}

describe('StatelessAnswersForm', () => {
  it('asks for one description per group of figures, and the language once', () => {
    const html = form(FIGURES);

    expect(html.match(/<textarea/g)).toHaveLength(2);
    expect(html).toContain('2 figures draw the same image');
    expect(html.match(/<select/g)).toHaveLength(1);
    expect(html).toContain('Under “Site plan”');
    // The selection starts empty: a language is never guessed.
    expect(html).toMatch(/<option[^>]*value=""[^>]*>Choose/);
  });

  it('shows the hint as a sentence beside the empty select, and selects nothing', () => {
    const hinted = reading(
      [{ id: 'language', kind: 'language', criterion: '3.1.1', answerable: 'operator', target: { suggested: 'es', evidence: 41 } }],
      [{ criterion: '3.1.1', item: 'the source declares no language' }],
    );
    const html = form(hinted);

    expect(html).toContain('Its text reads as Spanish (41 matches). A suggestion — nothing is chosen for you.');
    // The one selected option is the empty one; the suggested language's is not.
    expect(html).toMatch(/<option value="" selected="">Choose/);
    expect(html.match(/selected=""/g)).toHaveLength(1);
    expect(html).toMatch(/<option value="es">Spanish/);
    // The title's evidence still sits beside it.
    expect(html).toContain('The document calls itself “Permit Conditions”.');
  });

  it('lists what this screen cannot answer rather than hiding it', () => {
    const html = form(FIGURES);

    expect(html).toContain('Not answerable on this screen');
    expect(html).toContain('fonts are not embedded');
  });

  it('offers nothing to write when the reading has only client items', () => {
    const html = form(
      reading(
        [{ id: 'repair:signed', kind: 'repair', criterion: 'repair', answerable: 'client' }],
        [{ criterion: 'repair', item: 'this PDF carries a digital signature' }],
      ),
    );

    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<select');
    expect(html).toContain('digital signature');
  });
});

describe('RemediateFileScreen', () => {
  it('offers no upload when the host has no toolchain, and says why', () => {
    const html = renderToStaticMarkup(
      createElement(RemediateFileScreen, {
        toolchain: { available: false, reason: 'no Java runtime found' },
        converter: false,
      }),
    );

    expect(html).not.toContain('type="file"');
    expect(html).toContain('no Java runtime found');
  });

  it('takes a file and says nothing is recorded', () => {
    const html = renderToStaticMarkup(
      createElement(RemediateFileScreen, { toolchain: { available: true }, converter: true }),
    );

    expect(html).toContain('type="file"');
    expect(html).toMatch(/nothing is recorded/i);
  });
});
