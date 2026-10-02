import type { MeshData, MeshReport } from '../types';

// Niezależna (od manifold-3d) walidacja siatki trójkątów:
// - scalanie wierzchołków po pozycji (tak jak robi to slicer czytający STL),
// - zamkniętość: każda krawędź należy do dokładnie 2 trójkątów,
// - spójna orientacja: każda krawędź skierowana występuje raz, a jej odwrotność raz,
// - komponenty spójne (union-find po wspólnych krawędziach),
// - objętość ze znakiem, genus z charakterystyki Eulera, bbox.
// Hash tablice z adresowaniem otwartym na typed arrays — siatki lithophane
// mają ~10⁶ trójkątów, a Map z kluczami tekstowymi był o rząd wielkości wolniejszy.

/** Tablica (klucz: para liczb całkowitych zakodowana jako double) → int. */
class PairMap {
  private keys: Float64Array;
  private vals: Int32Array;
  private used: Uint8Array;
  private mask: number;
  size = 0;

  constructor(capacity: number) {
    let n = 16;
    while (n < capacity * 2) n <<= 1;
    this.keys = new Float64Array(n);
    this.vals = new Int32Array(n);
    this.used = new Uint8Array(n);
    this.mask = n - 1;
  }

  private slot(k: number): number {
    // mieszanie dwóch 32-bitowych połówek klucza
    const lo = k % 4294967296 | 0;
    const hi = (k / 4294967296) | 0;
    let h = Math.imul(lo ^ Math.imul(hi, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    let i = h & this.mask;
    while (this.used[i] && this.keys[i] !== k) i = (i + 1) & this.mask;
    return i;
  }

  get(k: number): number | undefined {
    const i = this.slot(k);
    return this.used[i] ? this.vals[i] : undefined;
  }

  set(k: number, v: number): void {
    const i = this.slot(k);
    if (!this.used[i]) {
      this.used[i] = 1;
      this.keys[i] = k;
      this.size++;
    }
    this.vals[i] = v;
  }

  /** Iteracja po (klucz, wartość). */
  forEach(fn: (k: number, v: number) => void): void {
    for (let i = 0; i < this.used.length; i++) if (this.used[i]) fn(this.keys[i], this.vals[i]);
  }
}

export function validateMesh(mesh: MeshData, weldTolerance = 1e-4): MeshReport {
  const { positions, indices } = mesh;
  const nv = positions.length / 3;
  const nt = indices.length / 3;

  // bbox
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }

  // scalanie wierzchołków: kwantyzacja do siatki weldTolerance, hash trójki liczb
  const inv = 1 / weldTolerance;
  const qx = new Int32Array(nv);
  const qy = new Int32Array(nv);
  const qz = new Int32Array(nv);
  let size = 16;
  while (size < nv * 2) size <<= 1;
  const tmask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const remap = new Int32Array(nv);
  let welded = 0;
  for (let i = 0; i < nv; i++) {
    const x = Math.round((positions[i * 3] - min[0]) * inv);
    const y = Math.round((positions[i * 3 + 1] - min[1]) * inv);
    const z = Math.round((positions[i * 3 + 2] - min[2]) * inv);
    qx[i] = x;
    qy[i] = y;
    qz[i] = z;
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & tmask;
    let found = -1;
    while (table[h] !== -1) {
      const j = table[h];
      if (qx[j] === x && qy[j] === y && qz[j] === z) {
        found = remap[j];
        break;
      }
      h = (h + 1) & tmask;
    }
    if (found >= 0) remap[i] = found;
    else {
      table[h] = i;
      remap[i] = welded++;
    }
  }

  const ekey = (a: number, b: number) => a * welded + b;
  // krawędź skierowana → liczba wystąpień oraz pierwszy trójkąt
  const count = new PairMap(nt * 3);
  const owner = new PairMap(nt * 3);
  let degenerate = 0;
  let volume = 0;
  const valid = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    const a = remap[ia];
    const b = remap[ib];
    const c = remap[ic];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    valid[t] = 1;
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const v = [a, b, c];
    for (let e = 0; e < 3; e++) {
      const k = ekey(v[e], v[(e + 1) % 3]);
      count.set(k, (count.get(k) ?? 0) + 1);
      if (owner.get(k) === undefined) owner.set(k, t);
    }
  }

  // zamkniętość / manifold / orientacja z liczników krawędzi skierowanych
  let closed = true;
  let manifold = true;
  let consistent = true;
  let undirectedEdges = 0;
  count.forEach((k, c) => {
    const a = Math.floor(k / welded);
    const b = k - a * welded;
    const rev = count.get(ekey(b, a)) ?? 0;
    if (a < b || rev === 0) undirectedEdges++;
    const total = c + rev;
    if (total < 2) closed = false;
    if (total !== 2) manifold = false;
    if (c !== 1 || rev !== 1) consistent = false;
  });

  // komponenty: union-find po trójkątach sąsiadujących przez krawędź
  const parent = new Int32Array(nt);
  for (let i = 0; i < nt; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (x: number, y: number) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };
  owner.forEach((k, t) => {
    const a = Math.floor(k / welded);
    const b = k - a * welded;
    const r = owner.get(ekey(b, a));
    if (r !== undefined) unite(t, r);
  });
  // ten sam kierunek w dwóch trójkątach (zła orientacja) — też sąsiedztwo
  for (let t = 0; t < nt; t++) {
    if (!valid[t]) continue;
    const v = [remap[indices[t * 3]], remap[indices[t * 3 + 1]], remap[indices[t * 3 + 2]]];
    for (let e = 0; e < 3; e++) {
      const o = owner.get(ekey(v[e], v[(e + 1) % 3]));
      if (o !== undefined && o !== t) unite(t, o);
    }
  }
  const roots = new Set<number>();
  const usedVerts = new Uint8Array(welded);
  let V = 0;
  for (let t = 0; t < nt; t++) {
    if (!valid[t]) continue;
    roots.add(find(t));
    for (let k = 0; k < 3; k++) {
      const w = remap[indices[t * 3 + k]];
      if (!usedVerts[w]) {
        usedVerts[w] = 1;
        V++;
      }
    }
  }
  const components = roots.size;
  const F = nt - degenerate;
  // Euler: V - E + F = 2(C - g)
  const genus = closed && manifold ? Math.round(components - (V - undirectedEdges + F) / 2) : -1;

  return {
    triangles: nt,
    vertices: welded,
    closed,
    manifold,
    consistentOrientation: consistent,
    components,
    volume,
    genus,
    degenerateTriangles: degenerate,
    bbox: { min, max },
  };
}
