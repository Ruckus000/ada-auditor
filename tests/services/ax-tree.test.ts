import { describe, expect, it } from 'vitest';
import { pruneAxTree } from '../../src/services/ax-tree';

/**
 * Node shapes below follow CDP's `Accessibility.getFullAXTree`, where every
 * field is wrapped as `{ value }`.
 */
function node(overrides: Record<string, unknown> = {}) {
  return {
    ignored: false,
    role: { value: 'button' },
    name: { value: 'Submit' },
    ...overrides,
  };
}

describe('pruneAxTree', () => {
  it('keeps role and accessible name', () => {
    expect(pruneAxTree([node()])).toEqual([{ role: 'button', name: 'Submit' }]);
  });

  it('drops ignored nodes, which a screen reader never announces', () => {
    expect(pruneAxTree([node({ ignored: true })])).toEqual([]);
  });

  it('drops roles that carry no semantics', () => {
    const nodes = ['none', 'presentation', 'generic', 'InlineTextBox', 'LineBreak'].map((role) =>
      node({ role: { value: role } }),
    );

    expect(pruneAxTree(nodes)).toEqual([]);
  });

  it('keeps heading level, which is what makes structure judgeable', () => {
    const pruned = pruneAxTree([
      node({
        role: { value: 'heading' },
        name: { value: 'Section' },
        properties: [{ name: 'level', value: { value: 3 } }],
      }),
    ]);

    expect(pruned).toEqual([{ role: 'heading', name: 'Section', level: 3 }]);
  });

  it('keeps states that change meaning', () => {
    const pruned = pruneAxTree([
      node({
        properties: [
          { name: 'required', value: { value: true } },
          { name: 'invalid', value: { value: 'spelling' } },
        ],
      }),
    ]);

    expect(pruned[0].states).toEqual(['required', 'invalid=spelling']);
  });

  it('omits default states rather than spending tokens on them', () => {
    const pruned = pruneAxTree([
      node({
        properties: [
          { name: 'disabled', value: { value: false } },
          { name: 'required', value: { value: false } },
        ],
      }),
    ]);

    expect(pruned[0].states).toBeUndefined();
  });

  it('ignores bookkeeping properties the advisory cannot use', () => {
    const pruned = pruneAxTree([
      node({ properties: [{ name: 'focusable', value: { value: true } }] }),
    ]);

    expect(pruned[0].states).toBeUndefined();
  });

  it('truncates a very long accessible name', () => {
    const pruned = pruneAxTree([node({ name: { value: 'x'.repeat(500) } })]);

    expect(pruned[0].name?.length).toBeLessThanOrEqual(201);
    expect(pruned[0].name?.endsWith('…')).toBe(true);
  });

  it('caps the tree so one long page cannot dominate the request', () => {
    const pruned = pruneAxTree(Array.from({ length: 5000 }, () => node()));

    expect(pruned).toHaveLength(400);
  });

  it('survives a malformed or absent tree', () => {
    expect(pruneAxTree(undefined)).toEqual([]);
    expect(pruneAxTree(null)).toEqual([]);
    expect(pruneAxTree('nope')).toEqual([]);
    expect(pruneAxTree([null, undefined, {}, { role: {} }])).toEqual([]);
  });

  it('drops nodes with no usable role', () => {
    expect(pruneAxTree([node({ role: undefined })])).toEqual([]);
  });

  it('reduces a realistic tree to something small enough to send', () => {
    const raw = [
      node({ role: { value: 'RootWebArea' }, name: { value: 'Dashboard' } }),
      node({ role: { value: 'generic' }, name: { value: '' } }),
      node({ role: { value: 'InlineTextBox' }, name: { value: 'Welcome back.' } }),
      node({ role: { value: 'heading' }, properties: [{ name: 'level', value: { value: 1 } }] }),
      node({ ignored: true, role: { value: 'img' } }),
    ];

    const pruned = pruneAxTree(raw);

    expect(pruned.map((n) => n.role)).toEqual(['RootWebArea', 'heading']);
    expect(JSON.stringify(pruned).length).toBeLessThan(JSON.stringify(raw).length);
  });
});
