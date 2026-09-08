import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Summary } from '../../src/app/platform/components/client/document-shared';

/**
 * The workbench's run control, rendered without a browser.
 *
 * The thing under test is what the control PROMISES before it is pressed. A
 * document added by upload has no address anyone can fetch — its `url` is the
 * filename it arrived under — so the run cannot go and get the bytes and has
 * to ask for them. Saying so beforehand is the difference between a file
 * dialog that makes sense and one that appears from nowhere; saying nothing is
 * how this screen spent the pilot posting a filename to a route that wanted a
 * URL and answering "reload the page and try again".
 *
 * A crawled document must keep the plain button, because promising to ask for
 * a file and then not asking is the same defect facing the other way.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const { DocumentWorkbench } = await import(
  '../../src/app/platform/components/client/document-workbench'
);

const SUMMARY: Summary = {
  title: 'already-titled',
  titleText: 'Planning Committee Agenda',
  sourceLanguage: 'en',
  tagged: true,
  pages: 2,
  headings: 1,
  tables: 0,
  lists: 0,
  figures: 1,
  gaps: [],
  needs: [{ criterion: '1.1.1', item: 'Figure 1 (page 1): no description' }],
  asks: [
    {
      id: 'figure:0',
      kind: 'figure',
      criterion: '1.1.1',
      answerable: 'operator',
      target: { ordinal: 0, type: 'Figure', page: 1, prior: 'absent' },
    },
  ],
};

function screen(document: {
  id: string;
  url: string;
  kind: 'pdf' | 'docx' | 'doc';
  source: 'crawl' | 'upload';
  sourceUrl?: string;
}): string {
  return renderToStaticMarkup(
    createElement(DocumentWorkbench, {
      clientId: 'acme',
      document,
      reading: {
        summary: SUMMARY,
        at: '2026-09-08T10:00:00.000Z',
        by: 'inspection',
        inputSha256: 'a'.repeat(64),
      },
      answers: [],
      standing: { state: 'needs-answers', open: ['figure:0'], waiting: [], expired: 0 },
      nextDocumentId: null,
    }),
  );
}

const UPLOADED = {
  id: 'doc-1',
  url: 'agenda.pdf',
  kind: 'pdf' as const,
  source: 'upload' as const,
};

const CRAWLED = {
  id: 'doc-2',
  url: 'https://town.example/minutes/agenda.pdf',
  kind: 'pdf' as const,
  source: 'crawl' as const,
};

describe('the workbench run control', () => {
  it('keeps its label whatever the document is', () => {
    // The person wants the same thing either way. Renaming the button for
    // uploads would make the inventory and the workbench disagree about what
    // running a document is called.
    expect(screen(UPLOADED)).toContain('Apply answers and run');
    expect(screen(CRAWLED)).toContain('Apply answers and run');
  });

  it('warns that an uploaded document will ask for its file, and names it', () => {
    // Named, because a person with a folder of documents needs to know which
    // one this row is. `pathOf` renders an upload's bare filename as itself.
    expect(screen(UPLOADED)).toContain('asks for agenda.pdf again');
  });

  it('says nothing of the sort for a document with an address', () => {
    // A crawled document is fetched by the server; a note promising a file
    // dialog would be a lie, and the noise would train people past it.
    expect(screen(CRAWLED)).not.toContain('asks for');
  });
});
