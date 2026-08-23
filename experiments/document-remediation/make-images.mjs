// Generates the corpus PNGs. Hand-encoded rather than pulled from a package:
// PNG is four chunks and zlib is in the standard library, so a dependency here
// would cost more than it saves. Deterministic — same bytes every run.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** px(x, y) returns [r, g, b] */
function png(width, height, px) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = px(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('corpus/img', { recursive: true });

// A stand-in photograph: smooth gradients plus a deterministic pseudo-noise
// term, so it compresses like a photo rather than like a flat graphic.
const noise = (x, y) => ((x * 73856093) ^ (y * 19349663)) % 24;
writeFileSync('corpus/img/photo-quay.png', png(360, 240, (x, y) => [
  60 + Math.round(120 * (y / 240)) + noise(x, y),
  90 + Math.round(90 * (y / 240)) + noise(y, x),
  120 + Math.round(60 * (1 - x / 360)) + noise(x + 7, y),
]));

writeFileSync('corpus/img/photo-depot.png', png(360, 200, (x, y) => [
  140 - Math.round(70 * (x / 360)) + noise(x, y),
  130 - Math.round(40 * (y / 200)) + noise(x, y + 3),
  110 + noise(y, x),
]));

// Corporate logo: flat blocks of colour, high contrast, small.
writeFileSync('corpus/img/logo-northwind.png', png(120, 40, (x, y) => {
  const bar = Math.floor(x / 30);
  if (y < 6 || y > 33) return [255, 255, 255];
  return [[32, 64, 128], [48, 96, 160], [80, 128, 190], [120, 160, 210]][bar];
}));

// Purely decorative: a soft horizontal rule with a gradient. Carries no
// information and must end up marked as an artifact, not given alt text.
writeFileSync('corpus/img/rule-divider.png', png(400, 8, (x) => {
  const t = Math.abs(x - 200) / 200;
  const v = Math.round(210 - 90 * (1 - t));
  return [v, v, v + 10];
}));

console.log('corpus images written');
