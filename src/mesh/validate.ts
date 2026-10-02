import type { MeshData, MeshReport } from '../types';

/**
 * Niezależna (od manifold-3d) walidacja siatki trójkątów:
 * - scalanie wierzchołków po pozycji (tak jak robi to slicer czytający STL),
 * - zamkniętość: każda krawędź należy do dokładnie 2 trójkątów,
 * - spójna orientacja: każda krawędź skierowana występuje raz, a jej odwrotność raz,
 * - komponenty spójne (union-find po wspólnych krawędziach),
 * - objętość ze znakiem, genus z charakterystyki Eulera, bbox.
 */
export function validateMesh(mesh: MeshData, weldTolerance = 1e-4): MeshReport {
  const { positions, indices } = mesh;
  const nv = positions.length / 3;
  const nt = indices.length / 3;

  // scalanie wierzchołków
  const inv = 1 / weldTolerance;
  const map = new Map<string, number>();
  const remap = new Int32Array(nv);
  let welded = 0;
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(positions[i * 3] * inv)},${Math.round(positions[i * 3 + 1] * inv)},${Math.round(positions[i * 3 + 2] * inv)}`;
    let id = map.get(k);
    if (id === undefined) {
      id = welded++;
      map.set(k, id);
    }
    remap[i] = id;
  }

  const directed = new Map<number, number>(); // klucz krawędzi skierowanej → licznik
  const undirected = new Map<number, number[]>(); // krawędź → trójkąty
  const ekey = (a: number, b: number) => a * welded + b;
  let degenerate = 0;
  let volume = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }

  for (let t = 0; t < nt; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    const v = [remap[ia], remap[ib], remap[ic]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) {
      degenerate++;
      continue;
    }
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const dk = ekey(a, b);
      directed.set(dk, (directed.get(dk) ?? 0) + 1);
      const uk = a < b ? ekey(a, b) : ekey(b, a);
      const list = undirected.get(uk);
      if (list) list.push(t);
      else undirected.set(uk, [t]);
    }
  }

  let closed = true;
  let manifold = true;
  for (const tris of undirected.values()) {
    if (tris.length < 2) closed = false;
    if (tris.length !== 2) manifold = false;
  }
  let consistent = true;
  for (const [k, c] of directed) {
    if (c !== 1) {
      consistent = false;
      break;
    }
    const a = Math.floor(k / welded);
    const b = k - a * welded;
    if (directed.get(ekey(b, a)) !== 1) {
      consistent = false;
      break;
    }
  }

  // komponenty
  const parent = new Int32Array(nt);
  for (let i = 0; i < nt; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const tris of undirected.values()) {
    for (let i = 1; i < tris.length; i++) {
      const ra = find(tris[0]);
      const rb = find(tris[i]);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  const roots = new Set<number>();
  for (let t = 0; t < nt; t++) {
    const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
    if (remap[ia] === remap[ib] || remap[ib] === remap[ic] || remap[ia] === remap[ic]) continue;
    roots.add(find(t));
  }
  const components = roots.size;

  // Euler: V - E + F = 2(C - g)
  const usedVerts = new Set<number>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) usedVerts.add(remap[indices[t * 3 + k]]);
  const V = usedVerts.size;
  const E = undirected.size;
  const F = nt - degenerate;
  const genus = closed && manifold ? Math.round(components - (V - E + F) / 2) : -1;

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
