import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { runStage, type StageOptions } from './stage';

export type DeliveryArchiveEntry = { name: string; bytes: Uint8Array };
export const MAX_DELIVERY_BYTES = 100 * 1024 * 1024;

/** Only generated paths enter ZIP metadata. Validated again inside the JVM. */
export async function createDeliveryArchive(entries: DeliveryArchiveEntry[], options: StageOptions = {}): Promise<Buffer> {
  const names = new Set<string>();
  let total = 0;
  let pdfs = 0;
  if (entries.length === 0 || entries.length > 500) throw new Error('delivery_archive_limit');
  for (const entry of entries) {
    if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.[A-Za-z0-9]+)?$/.test(entry.name) || names.has(entry.name)) {
      throw new Error('delivery_archive_name');
    }
    names.add(entry.name);
    total += entry.bytes.byteLength;
    if (entry.name.toLowerCase().endsWith('.pdf')) pdfs++;
  }
  if (total > MAX_DELIVERY_BYTES || pdfs > 100) throw new Error('delivery_archive_limit');
  const work = await mkdtemp(join(tmpdir(), 'auditor-delivery-'));
  try {
    const output = join(work, 'delivery.zip');
    const args = [output];
    for (const [index, entry] of entries.entries()) {
      const path = join(work, `entry-${index}`);
      await writeFile(path, entry.bytes);
      args.push(path, entry.name);
    }
    const result = await runStage('Archive', args, z.object({ ok: z.literal(true) }), options);
    if (!result.ok) throw new Error(`delivery_archive_${result.failure.kind}`);
    return await readFile(output);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
