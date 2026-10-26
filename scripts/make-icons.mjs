// Generates the PWA icons (brand square with a "W" mark) as PNG without any native dependency.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = [...Array(256)].map((_, n) => {
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
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, { bg = [24, 76, 155], fg = [255, 255, 255], pad = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++)
    (Buffer.from(bg).copy(px, i * 4, 0, 3), (px[i * 4 + 3] = 255));
  // A blocky "W" drawn as thick lines between four strokes.
  const m = pad ? size / 6 : size / 8; // maskable keeps the mark inside the safe zone
  const t = Math.max(6, size / 14);
  const pts = [
    [m * 1.4, m * 1.4],
    [size / 2 - m * 0.6, size - m * 1.4],
    [size / 2, size / 2],
    [size / 2 + m * 0.6, size - m * 1.4],
    [size - m * 1.4, m * 1.4],
  ];
  const line = ([x1, y1], [x2, y2]) => {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let s = 0; s <= steps; s++) {
      const x = x1 + ((x2 - x1) * s) / steps;
      const y = y1 + ((y2 - y1) * s) / steps;
      for (let dx = -t / 2; dx < t / 2; dx++)
        for (let dy = -t / 2; dy < t / 2; dy++) {
          const xi = Math.round(x + dx);
          const yi = Math.round(y + dy);
          if (xi >= 0 && yi >= 0 && xi < size && yi < size)
            Buffer.from(fg).copy(px, (yi * size + xi) * 4, 0, 3);
        }
    }
  };
  for (let i = 0; i + 1 < pts.length; i++) line(pts[i], pts[i + 1]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [file, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
])
  writeFileSync(join(out, file), png(size, { pad: maskable }));
console.log('icons written to', out);
