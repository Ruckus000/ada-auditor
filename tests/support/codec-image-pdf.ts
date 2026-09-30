import { inflateSync } from 'node:zlib';

import { pdfFromObjects } from './pdf-objects';

/**
 * One-page PDFs whose page is a single image in a codec PDFBox cannot decode
 * on its own — and a reader for the PNG `Preview` hands back.
 *
 * PDFBox 3.0.8 decodes `JBIG2Decode` and `JPXDecode` only through ImageIO
 * plugins it does not ship. Without them `PDFRenderer` logs a warning and
 * paints NOTHING where the image was, so the page renders white and every
 * stage that samples the render — `Preview`'s page image, `Contrast`'s
 * background — reads a page that does not exist. `[V]` Found 2026-09-29: every
 * blank judging sheet in the cohort-8 look came from two documents whose pages
 * are JBIG2/JPX scans.
 *
 * Both images are a 16×16 solid black square — no content anyone owns, built
 * for this file rather than cut out of a corpus document. Black because it is
 * as far from the white a failed decode paints as a colour can be.
 */

/**
 * JPEG 2000 codestream (raw `.j2k`, which `JPXDecode` accepts as readily as a
 * JP2 file): 16×16, one 8-bit grey component, every sample 0. Produced by
 * `opj_compress -n 1` from an all-zero PGM and checked by decoding it back.
 * The codestream carries OpenJPEG's own `COM` marker; it is inert.
 */
const JPX_BLACK_16 = Buffer.from(
  '/0//UQApAAAAAAAQAAAAEAAAAAAAAAAAAAAAEAAAABAAAAAAAAAAAAABBwEB/1IADAAAAAEAAAQEAAH/XAAEQED/ZAAl'
  + 'AAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAAAYAAH/k9+AOBFQVK/0yH//2Q==',
  'base64',
);

/**
 * The T.6 (MMR) coding of a 16×16 bitmap whose every bit is 1, which JBIG2
 * reads as black. Hand-checkable, which is why MMR rather than the arithmetic
 * coder: `001` horizontal mode, white run 0 (`00110101`), black run 16
 * (`0000010111`) for the first row against the imaginary white reference;
 * then `1 1` (V0, V0) for each of the fifteen rows below it; then EOFB
 * (`000000000001` twice) and zero padding. Matches libtiff's Group 4 output
 * for the same bitmap byte for byte.
 */
const MMR_ONES_16 = Buffer.from('26a0bfffffffe0020020', 'hex');

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
}

/**
 * A JBIG2 segment header (T.88 §7.2) for a segment on page 1 that refers to no
 * other segment, followed by its data.
 */
function segment(number: number, type: number, data: Buffer): Buffer {
  return Buffer.concat([
    u32(number),
    Buffer.from([type & 0x3f]), // flags: type; 1-byte page association
    Buffer.from([0x00]), // no referred-to segments
    Buffer.from([0x01]), // page 1
    u32(data.length),
    data,
  ]);
}

/**
 * A JBIG2 stream in the embedded organisation PDF uses (ISO 32000 §7.4.7: no
 * file header, no end-of-page or end-of-file segment): a page-information
 * segment and one immediate lossless generic region carrying the MMR data.
 */
function jbig2Black16(): Buffer {
  const pageInfo = Buffer.concat([
    u32(16), u32(16), // width, height
    u32(0), u32(0), // resolution unknown
    Buffer.from([0x00]), // default pixel 0 (white), OR combination
    Buffer.from([0x00, 0x00]), // no striping
  ]);
  const region = Buffer.concat([
    u32(16), u32(16), u32(0), u32(0), // region width, height, x, y
    Buffer.from([0x00]), // OR onto the page
    Buffer.from([0x01]), // generic region flags: MMR
    MMR_ONES_16,
  ]);
  return Buffer.concat([segment(0, 48, pageInfo), segment(1, 39, region)]);
}

/**
 * The image dictionary shapes the fixtures cover. JPX appears twice because
 * PDFBox fails it on two different branches without a decoder: with no
 * `/ColorSpace` (optional for JPX, and common) it cannot determine the colour
 * space; with one declared it reaches the reader lookup and throws
 * MissingImageReaderException. Both paint nothing, and both must render.
 */
export type ImageCodec = 'JBIG2Decode' | 'JPXDecode' | 'JPXDecode with /ColorSpace';

function imageObject(codec: ImageCodec): Buffer {
  const [filter, dict, data] = codec === 'JBIG2Decode'
    ? ['JBIG2Decode', '/ColorSpace /DeviceGray /BitsPerComponent 1', jbig2Black16()]
    : codec === 'JPXDecode'
      ? ['JPXDecode', '', JPX_BLACK_16]
      : ['JPXDecode', '/ColorSpace /DeviceGray', JPX_BLACK_16];
  return Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width 16 /Height 16 ${dict} /Filter /${filter} /Length ${data.length} >>\nstream\n`,
      'latin1',
    ),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

/** Every shape, for `it.each`. */
export const IMAGE_CODECS: readonly ImageCodec[] = ['JBIG2Decode', 'JPXDecode', 'JPXDecode with /ColorSpace'];

/** Page size in points. `Preview` renders it at 2× — 400×400 pixels. */
export const CODEC_PAGE_SIZE = 200;

/**
 * A 200×200pt page with the black image stretched over all of it, and
 * optionally a line of Helvetica drawn on top in the given colour operator.
 */
export function codecImagePdf(codec: ImageCodec, text?: { colour: string; size: number }): Buffer {
  const draw = `q ${CODEC_PAGE_SIZE} 0 0 ${CODEC_PAGE_SIZE} 0 0 cm /Im0 Do Q`
    + (text ? ` ${text.colour} BT /F1 ${text.size} Tf 20 90 Td (Sample text) Tj ET` : '');
  return pdfFromObjects([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${CODEC_PAGE_SIZE} ${CODEC_PAGE_SIZE}] /Contents 4 0 R`
      + ' /Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >> >>',
    `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`,
    imageObject(codec),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/**
 * The share of a PNG's pixels that are near-black (every channel under 64).
 *
 * Reads only what `Preview` writes — 8-bit truecolour, non-interlaced, the
 * shape `ImageIO` gives an `ImageType.RGB` raster — and throws on anything
 * else rather than guessing at it.
 */
export function darkPixelShare(png: Buffer): number {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const [depth, colourType, , , interlace] = png.subarray(24, 29);
  if (depth !== 8 || colourType !== 2 || interlace !== 0) {
    throw new Error(`unexpected PNG: depth ${depth}, colour type ${colourType}, interlace ${interlace}`);
  }

  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));

  const stride = width * 3;
  const previous = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  let dark = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? row[i - 3]! : 0;
      const b = previous[i]!;
      const c = i >= 3 ? previous[i - 3]! : 0;
      let predictor: number;
      switch (filter) {
        case 0: predictor = 0; break;
        case 1: predictor = a; break;
        case 2: predictor = b; break;
        case 3: predictor = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      row[i] = (line[i]! + predictor) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      if (row[x * 3]! < 64 && row[x * 3 + 1]! < 64 && row[x * 3 + 2]! < 64) dark++;
    }
    row.copy(previous);
  }
  return dark / (width * height);
}
