import { afterEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  createAiAdvisoryFinding,
  isAiAdvisoryConfigured,
  requestAiAdvisory,
} from '../../src/services/ai-advisory';
import type { AxeScanResult } from '../../src/services/deterministic-audit';

const EMPTY_AXE: AxeScanResult = { violations: [], incomplete: [] };

const PAGE = { url: 'https://app.example.com/dashboard', title: 'Dashboard' };

/** Minimal stand-in for the SDK: only `messages.create` is ever called. */
function stubClient(response: unknown): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue(response);
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

function toolUseResponse(findings: Array<{ issue: string; confidence: number }>) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'report_findings', id: 'tu_1', input: { findings } }],
  };
}

function advisoryInput(overrides: Partial<Parameters<typeof requestAiAdvisory>[0]> = {}) {
  return {
    page: PAGE,
    axTree: [{ role: 'heading', name: 'Dashboard', level: 1 }],
    axe: EMPTY_AXE,
    minConfidence: 0.7,
    ...overrides,
  };
}

describe('isAiAdvisoryConfigured', () => {
  const original = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('is off without an API key', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiAdvisoryConfigured()).toBe(false);
  });

  it('is on with one', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(isAiAdvisoryConfigured()).toBe(true);
  });
});

describe('requestAiAdvisory', () => {
  const original = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('returns findings above the contract confidence threshold', async () => {
    const { client } = stubClient(
      toolUseResponse([
        { issue: 'Alt text "image1" does not describe the image.', confidence: 0.9 },
      ]),
    );

    const findings = await requestAiAdvisory(advisoryInput({ client }));

    expect(findings).toEqual([
      {
        code: 'ai-advisory',
        severity: 'advisory',
        source: 'ai-advisory',
        gateable: false,
        message: 'Alt text "image1" does not describe the image.',
        confidence: 0.9,
      },
    ]);
  });

  it('applies minReport as a live gate', async () => {
    // This threshold used to compare two constants, so its result was fixed
    // when it was written. It now filters real, varying confidences.
    const { client } = stubClient(
      toolUseResponse([
        { issue: 'Certain issue.', confidence: 0.95 },
        { issue: 'Borderline issue.', confidence: 0.5 },
      ]),
    );

    const findings = await requestAiAdvisory(advisoryInput({ client, minConfidence: 0.7 }));

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('Certain issue.');
  });

  it('never gates a run', async () => {
    const { client } = stubClient(toolUseResponse([{ issue: 'Something.', confidence: 1 }]));

    const findings = await requestAiAdvisory(advisoryInput({ client }));

    expect(findings.every((f) => f.gateable === false)).toBe(true);
    expect(findings.every((f) => f.severity === 'advisory')).toBe(true);
  });

  it('returns nothing when no API key is configured and no client is injected', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(await requestAiAdvisory(advisoryInput())).toEqual([]);
  });

  it('degrades to no advisory when the API errors, rather than failing the run', async () => {
    const create = vi.fn().mockRejectedValue(new Error('503 overloaded'));
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(requestAiAdvisory(advisoryInput({ client }))).resolves.toEqual([]);
  });

  it('handles a refusal without reading the content array', async () => {
    // On a refusal `content` can be empty; indexing it blindly would throw and
    // turn a soft outcome into a failed audit.
    const { client } = stubClient({ stop_reason: 'refusal', content: [] });

    await expect(requestAiAdvisory(advisoryInput({ client }))).resolves.toEqual([]);
  });

  it('handles a response that called no tool', async () => {
    const { client } = stubClient({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Nothing to report.' }],
    });

    await expect(requestAiAdvisory(advisoryInput({ client }))).resolves.toEqual([]);
  });

  it('accepts an empty findings list as a valid answer', async () => {
    const { client } = stubClient(toolUseResponse([]));

    await expect(requestAiAdvisory(advisoryInput({ client }))).resolves.toEqual([]);
  });

  it('constrains the model to the findings tool and a fixed schema', async () => {
    const { client, create } = stubClient(toolUseResponse([]));

    await requestAiAdvisory(advisoryInput({ client }));

    const request = create.mock.calls[0][0];
    expect(request.model).toBe('claude-opus-5');
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'report_findings' });
    expect(request.tools[0].strict).toBe(true);
    expect(request.tools[0].input_schema.additionalProperties).toBe(false);
  });

  it('sends the page evidence and marks it as untrusted data', async () => {
    const { client, create } = stubClient(toolUseResponse([]));

    await requestAiAdvisory(
      advisoryInput({
        client,
        axe: {
          violations: [],
          incomplete: [
            {
              id: 'color-contrast',
              impact: 'serious',
              tags: ['wcag2aa', 'wcag143'],
              help: 'Elements must meet contrast ratio thresholds',
              helpUrl: 'https://example.test/color-contrast',
              nodes: [{ html: '<p id="x">text</p>', target: ['#x'] }],
            },
          ],
        },
      }),
    );

    const request = create.mock.calls[0][0];
    const content = request.messages[0].content as string;

    expect(content).toContain('<accessibility_tree>');
    expect(content).toContain('<checks_needing_review>');
    expect(content).toContain('color-contrast');
    // The page is third-party content, so the system prompt must frame it as
    // data rather than instructions.
    expect(request.system).toContain('untrusted');
  });
});

describe('createAiAdvisoryFinding', () => {
  it('shapes a finding as non-gating advisory', () => {
    expect(createAiAdvisoryFinding({ message: 'x', confidence: 0.8 })).toEqual({
      code: 'ai-advisory',
      severity: 'advisory',
      source: 'ai-advisory',
      gateable: false,
      message: 'x',
      confidence: 0.8,
    });
  });
});
