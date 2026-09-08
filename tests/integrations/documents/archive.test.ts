import { describe, expect, it, vi } from 'vitest';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createDeliveryArchive, MAX_DELIVERY_BYTES } from '../../../src/integrations/documents/archive';

const runtime = { available: true as const, javaBin: '/not/java', classpath: 'unused', source: 'bundled' as const };
describe('delivery archive boundary', () => {
  it('refuses unsafe paths and duplicate names before invoking Java', async () => {
    const executor = vi.fn();
    for (const names of [['../secret.pdf'], ['/secret.pdf'], ['a.pdf', 'a.pdf'], ['a\\b.pdf']]) {
      await expect(createDeliveryArchive(names.map(name => ({ name, bytes: Buffer.from('x') })), { runtime, executor })).rejects.toThrow('delivery_archive_name');
    }
    expect(executor).not.toHaveBeenCalled();
  });
  it('bounds PDF count and total content before staging', async () => {
    await expect(createDeliveryArchive(Array.from({ length: 101 }, (_, i) => ({ name: `${i}.pdf`, bytes: new Uint8Array() })))).rejects.toThrow('delivery_archive_limit');
    await expect(createDeliveryArchive([{ name: 'one.pdf', bytes: new Uint8Array(MAX_DELIVERY_BYTES + 1) }])).rejects.toThrow('delivery_archive_limit');
  });
  it('stages exact content sequentially and cleans up after success', async () => {
    let staged = '';
    const output = await createDeliveryArchive([{ name: 'documents/one.pdf', bytes: Buffer.from('exact') }], {
      runtime,
      executor: async (_bin, args) => {
        const at = args.indexOf('Archive');
        staged = args[at + 1]!;
        expect(await readFile(args[at + 2]!, 'utf8')).toBe('exact');
        expect(args[at + 3]).toBe('documents/one.pdf');
        await writeFile(staged, 'archive');
        return { stdout: '{"ok":true}', stderr: '' };
      },
    });
    expect(output.toString()).toBe('archive');
    await expect(access(staged)).rejects.toThrow();
  });
  it('cleans temporary inputs when the JVM fails', async () => {
    let staged = '';
    await expect(createDeliveryArchive([{ name: 'one.pdf', bytes: Buffer.from('exact') }], {
      runtime,
      executor: async (_bin, args) => { staged = args[args.indexOf('Archive') + 2]!; throw new Error('failure'); },
    })).rejects.toThrow('delivery_archive_failed');
    await expect(access(staged)).rejects.toThrow();
  });
});
