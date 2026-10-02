// Generuje public/icon-192.png i icon-512.png (bez zależności — zlib + ręczny PNG).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
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
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function render(size) {
  const s = size / 64;
  const px = Buffer.alloc(size * (size * 4 + 1));
  const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let j = 0; j < size; j++) {
    px[j * (size * 4 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      let cov = 0;
      // 4×4 supersampling
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const x = (i + (sx + 0.5) / 4) / s;
        const y = (j + (sy + 0.5) / 4) / s;
        let c = null;
        if (inRoundRect(x, y, 0, 0, 64, 64, 14)) c = [0x1d, 0x21, 0x28];
        if (inRoundRect(x, y, 10, 48, 54, 55, 2)) c = [0xf5, 0x9e, 0x0b];
        const head = (x - 32) ** 2 + (y - 18) ** 2 <= 81 && (x - 32) ** 2 + (y - 18) ** 2 > 9;
        const t = (y - 31) / 17;
        const body = y >= 31 && y <= 48 && x >= 19 + 4 * t && x <= 45 - 4 * t;
        if (head || body) c = [0xe8, 0xe3, 0xd9];
        if (c) { acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 1; }
      }
      cov = acc[3];
      if (cov) { r = acc[0] / cov; g = acc[1] / cov; b = acc[2] / cov; a = (cov / 16) * 255; }
      const o = j * (size * 4 + 1) + 1 + i * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(px)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), render(size));
console.log('ok');
