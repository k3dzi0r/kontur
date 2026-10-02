import type { MeshData } from '../types';

/** Binarny STL (jednostki: mm — konwencja slicerów). */
export function exportStl(mesh: MeshData, name = 'wycinanka'): ArrayBuffer {
  const { positions: p, indices } = mesh;
  const nt = indices.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  const header = `Wycinanka 3D: ${name} (mm)`.slice(0, 80);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, nt, true);
  let o = 84;
  for (let t = 0; t < nt; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const idx of [a, b, c]) {
      dv.setFloat32(o, p[idx], true);
      dv.setFloat32(o + 4, p[idx + 1], true);
      dv.setFloat32(o + 8, p[idx + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** Parser binarnego STL — do testów (round-trip). */
export function parseStl(buf: ArrayBuffer): MeshData {
  const dv = new DataView(buf);
  const nt = dv.getUint32(80, true);
  const positions = new Float32Array(nt * 9);
  const indices = new Uint32Array(nt * 3);
  let o = 84;
  for (let t = 0; t < nt; t++) {
    o += 12;
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = dv.getFloat32(o + k * 4, true);
    o += 38;
    indices[t * 3] = t * 3;
    indices[t * 3 + 1] = t * 3 + 1;
    indices[t * 3 + 2] = t * 3 + 2;
  }
  return { positions, indices };
}
