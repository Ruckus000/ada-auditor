import { describe, expect, it } from 'vitest';
import { pruneAxTree, redactSecrets, REDACTED_SECRET } from '../../src/services/ax-tree';

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

describe('redactSecrets', () => {
  it('removes a credential that landed as a node value', () => {
    // The measured shape: Chromium puts a text input's value straight into the
    // node, and that file is uploaded to blob storage.
    const nodes = [
      { role: { value: 'textbox' }, name: { value: 'Username' }, value: { type: 'string', value: 'hunter2' } },
    ];

    const safe = redactSecrets(nodes, ['hunter2']);

    expect(JSON.stringify(safe)).not.toContain('hunter2');
    expect(JSON.stringify(safe)).toContain(REDACTED_SECRET);
    // Everything else survives — this removes a value, it does not blank a tree.
    expect(JSON.stringify(safe)).toContain('Username');
  });

  it('reaches a secret at any depth, whatever key it sits under', () => {
    // Keyed on the value, not on a field name: `logger.ts` can redact by key
    // because it knows its own shapes, and this walks a structure Chromium
    // defines and may extend.
    const safe = redactSecrets({ a: [{ b: { c: 'sekret' } }] }, ['sekret']);

    expect(JSON.stringify(safe)).not.toContain('sekret');
  });

  /**
   * The deliberate limit, pinned so nobody "fixes" it into substring matching.
   *
   * A client named `acme` with an operator account named `acme` would have the
   * word struck out of every label and URL in their own report. Corrupting
   * evidence to hide a name the site displays anyway is the worse failure.
   */
  it('leaves a longer string that merely contains the secret alone', () => {
    const safe = redactSecrets({ label: 'Signed in as acme' }, ['acme']);

    expect((safe as { label: string }).label).toBe('Signed in as acme');
  });

  it('ignores an empty or one-character secret rather than redacting everything', () => {
    // A misconfigured credential resolving to '' would otherwise match every
    // empty string in the tree and destroy the artifact.
    const tree = { a: '', b: 'x', c: 'kept' };

    expect(redactSecrets(tree, ['', 'x'])).toEqual(tree);
  });

  it('returns the input untouched when no secrets were resolved', () => {
    const tree = { a: 'one', b: ['two'] };

    expect(redactSecrets(tree, [])).toEqual(tree);
  });
});
