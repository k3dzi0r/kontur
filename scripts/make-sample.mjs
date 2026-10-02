// Przykładowe obrazy (public/sample-*.png): twarz (oczy, nos i usta jako wyspy)
// oraz ornament z kropkami. Czarny = materiał, nierówne jasne tło.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 800, H = 1000;
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };

const ell = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
function material(x, y) {
  const head = ell(x, y, 400, 330, 230, 260) && !ell(x, y, 400, 330, 200, 230);
  const eyeL = ell(x, y, 320, 280, 34, 22) && !ell(x, y, 326, 284, 12, 12);
  const eyeR = ell(x, y, 480, 280, 34, 22) && !ell(x, y, 474, 284, 12, 12);
  const nose = ell(x, y, 400, 350, 14, 40);
  const mouth = ell(x, y, 400, 440, 80, 26) && !ell(x, y, 400, 425, 80, 22);
  const brow = Math.abs(y - 225 + 0.004 * (x - 400) ** 2) < 6 && Math.abs(x - 400) < 150 && Math.abs(x - 400) > 30;
  const neck = x > 360 && x < 440 && y > 580 && y < 760;
  const shoulders = ell(x, y, 400, 900, 330, 160) && y < 960;
  const hairDot = (ell(x, y, 400, 110, 20, 20) || ell(x, y, 300, 135, 16, 16) || ell(x, y, 500, 135, 16, 16));
  const thinLine = Math.abs(x - 400) < 1.6 && y > 690 && y < 860 && false;
  const collar = Math.abs(y - 815 - 0.0016 * (x - 400) ** 2) < 1.4 && Math.abs(x - 400) < 260; // cienka linia (za cienka do druku)
  const button = ell(x, y, 400, 880, 18, 18) && !ell(x, y, 400, 880, 9, 9);
  return head || eyeL || eyeR || nose || mouth || brow || neck || (shoulders && !collar && !button) || hairDot || thinLine;
}

function ornament(x, y) {
  const r = Math.hypot(x - 500, y - 480);
  const ang = Math.atan2(y - 480, x - 500);
  const ring = r > 430 && r < 455;
  let dots = false;
  for (const rr of [370, 290, 210]) {
    const k = Math.round(rr / 14);
    const a = Math.round((ang / (2 * Math.PI)) * k) * ((2 * Math.PI) / k);
    if (Math.hypot(x - 500 - rr * Math.cos(a), y - 480 - rr * Math.sin(a)) < 11) dots = true;
  }
  const star = r < 130 && Math.abs(Math.sin(ang * 5)) * 130 > r - 25 && r > 18;
  const stand = x > 460 && x < 540 && y > 930;
  return ring || dots || star || stand;
}

function write(file, W, H, material) {
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    let cov = 0;
    for (let s = 0; s < 4; s++) cov += material(x + (s % 2) * 0.5 + 0.25, y + (s >> 1) * 0.5 + 0.25) ? 1 : 0;
    let v = 242 - (cov / 4) * 222 + 9 * Math.sin(x / 90) * Math.cos(y / 120); // nierówne „papierowe” tło
    v = Math.max(0, Math.min(255, v));
    const o = y * (W * 3 + 1) + 1 + x * 3;
    raw[o] = v; raw[o + 1] = v; raw[o + 2] = v * 0.97;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(new URL(`../public/sample-${file}`, import.meta.url), Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`public/sample-${file}`);
}

write('twarz.png', W, H, material);
write('ornament.png', 1000, 1000, ornament);
