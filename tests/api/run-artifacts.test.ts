import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactRead } from '../../src/domain/artifacts';

const { authorizePrincipal } = vi.hoisted(() => ({ authorizePrincipal: vi.fn() }));
vi.mock('../../src/app/api/_lib/authorize', () => ({ authorizePrincipal }));

const { getArtifactStore } = vi.hoisted(() => ({ getArtifactStore: vi.fn() }));
vi.mock('../../src/integrations/artifacts/blob-store', () => ({ getArtifactStore }));

const { GET } = await import(
  '../../src/app/api/audit/runs/[requestId]/artifacts/[position]/[kind]/route'
);
const { MemoryRunStore, resetRunStore, setRunStore } = await import(
  '../../src/integrations/persistence'
);

const OPERATOR = { kind: 'operator' as const, id: 'op-1', name: 'Alex Reed', email: 'a@b.c' };
const SCREENSHOT_URL = 'https://blob.test/runs/req-1/01-home/page-abc123.png';

let runs: InstanceType<typeof MemoryRunStore>;
let read: ReturnType<typeof vi.fn>;

function params(requestId: string, position: string, kind: string) {
  return { params: Promise.resolve({ requestId, position, kind }) };
}

function request() {
  return new Request('http://localhost/api/audit/runs/req-1/artifacts/0/screenshot');
}

function ok(contentType = 'image/png'): ArtifactRead {
  return {
    status: 'ok',
    contentType,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
  };
}

describe('GET /api/audit/runs/[requestId]/artifacts/[position]/[kind]', () => {
  beforeEach(async () => {
    authorizePrincipal.mockReset();
    authorizePrincipal.mockResolvedValue(OPERATOR);

    read = vi.fn().mockResolvedValue(ok());
    getArtifactStore.mockReturnValue({ read, upload: vi.fn() });

    runs = new MemoryRunStore();
    setRunStore(runs);
    await runs.saveRun({
      requestId: 'req-1',
      journeyId: 'demo',
      environment: 'staging',
      platform: 'generic',
      evidenceStatus: 'complete',
      ciStatus: 'pass',
      findings: [],
      durationMs: 10,
      createdAt: new Date().toISOString(),
      status: 'complete',
      pages: [
        {
          url: 'https://acme.test/',
          route: '/',
          title: 'Home',
          evidenceStatus: 'complete',
          artifacts: {
            screenshotUrl: SCREENSHOT_URL,
            domSnapshotUrl: 'https://blob.test/runs/req-1/01-home/page-abc123.html',
          },
        },
      ],
    });
  });

  afterEach(() => {
    resetRunStore();
  });

  it('streams the artifact to an authenticated caller', async () => {
    const response = await GET(request(), params('req-1', '0', 'screenshot'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('refuses an unauthenticated caller', async () => {
    authorizePrincipal.mockResolvedValue(null);

    expect((await GET(request(), params('req-1', '0', 'screenshot'))).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  /**
   * The security property of this route.
   *
   * `upload` uses `addRandomSuffix`, so the stored URL is the only handle that
   * exists — the route has to look it up. That means no caller-supplied string
   * ever reaches the fetch, and there is no request-forgery surface.
   */
  it('reads the URL from the run record, never from the caller', async () => {
    await GET(
      new Request(
        'http://localhost/api/audit/runs/req-1/artifacts/0/screenshot?url=https://evil.example/x',
      ),
      params('req-1', '0', 'screenshot'),
    );

    expect(read).toHaveBeenCalledWith(SCREENSHOT_URL);
  });

  /**
   * A DOM snapshot is markup captured from someone else's site. Served inline
   * from our origin it would execute there — stored XSS on the auditor, using
   * the client's own page as the payload.
   */
  it('serves a DOM snapshot as an attachment, sandboxed and nosniff', async () => {
    read.mockResolvedValue(ok('text/html'));

    const response = await GET(request(), params('req-1', '0', 'dom'));

    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe('sandbox');
  });

  it('serves a screenshot inline', async () => {
    const response = await GET(request(), params('req-1', '0', 'screenshot'));

    expect(response.headers.get('content-disposition')).toBe('inline');
  });

  /**
   * 410, not 404. Evidence is deleted on a retention schedule, so a blob that
   * is gone after thirty days is the system working — reporting "not found"
   * would send an operator hunting a bug that is not there.
   */
  it('reports pruned evidence as gone, not as missing', async () => {
    read.mockResolvedValue({ status: 'pruned' });

    const response = await GET(request(), params('req-1', '0', 'screenshot'));

    expect(response.status).toBe(410);
    expect((await response.json()).error).toBe('evidence_pruned');
  });

  it('404s an artifact the run never captured', async () => {
    const response = await GET(request(), params('req-1', '0', 'axtree'));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('artifact_not_captured');
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown run', 'req-nope', '0', 'screenshot'],
    ['a page beyond the run', 'req-1', '4', 'screenshot'],
    ['a negative position', 'req-1', '-1', 'screenshot'],
    ['a non-numeric position', 'req-1', 'first', 'screenshot'],
    ['an unknown kind', 'req-1', '0', 'everything'],
  ])('404s %s', async (_label, requestId, position, kind) => {
    const response = await GET(request(), params(requestId, position, kind));

    expect(response.status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
});
