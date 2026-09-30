/**
 * A classic-xref PDF from its numbered objects, object 1 being the catalog.
 *
 * The one copy of the offset/xref/trailer arithmetic the hand-built fixtures
 * share. Offsets are counted in bytes, not string length, so an object may be
 * a `Buffer` carrying binary stream data; strings are written as latin1.
 */
export function pdfFromObjects(objects: ReadonlyArray<string | Buffer>): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    length += chunk.length;
  });
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(tail, 'latin1'));
  return Buffer.concat(parts);
}
