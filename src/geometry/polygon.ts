import type { MultiPoly, Poly, Pt, Ring } from '../types';

/** Pole ze znakiem (dodatnie = CCW przy osi Y w górę). */
export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  }
  return a / 2;
}

export function polyArea(p: Poly): number {
  let a = Math.abs(ringArea(p.outer));
  for (const h of p.holes) a -= Math.abs(ringArea(h));
  return a;
}

export function multiArea(mp: MultiPoly): number {
  return mp.reduce((s, p) => s + polyArea(p), 0);
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function ringBBox(r: Ring): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function multiBBox(mp: MultiPoly): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of mp) {
    const r = ringBBox(p.outer);
    b.minX = Math.min(b.minX, r.minX);
    b.minY = Math.min(b.minY, r.minY);
    b.maxX = Math.max(b.maxX, r.maxX);
    b.maxY = Math.max(b.maxY, r.maxY);
  }
  return b;
}

export function bboxDistance(a: BBox, b: BBox): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

/** Środek ciężkości powierzchni (z uwzględnieniem otworów). */
export function multiCentroid(mp: MultiPoly): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const addRing = (r: Ring, sign: number) => {
    // normalizujemy orientację: zewnętrzne dodatnio, otwory ujemnie
    const ra = ringArea(r);
    const s = sign * Math.sign(ra || 1);
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const cross = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += (s * cross) / 2;
      cx += (s * (r[j][0] + r[i][0]) * cross) / 6;
      cy += (s * (r[j][1] + r[i][1]) * cross) / 6;
    }
  };
  for (const p of mp) {
    addRing(p.outer, 1);
    for (const h of p.holes) addRing(h, -1);
  }
  if (Math.abs(a) < 1e-12) return [0, 0];
  return [cx / a, cy / a];
}

export function ringPerimeter(r: Ring): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    s += Math.hypot(r[i][0] - r[j][0], r[i][1] - r[j][1]);
  }
  return s;
}

/** Punkt w pierścieniu (ray casting, even-odd). */
export function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPoly(p: Pt, poly: Poly): boolean {
  if (!pointInRing(p, poly.outer)) return false;
  for (const h of poly.holes) if (pointInRing(p, h)) return false;
  return true;
}

/** Najbliższy punkt odcinka ab do p. Zwraca [punkt, kwadrat odległości, t]. */
export function closestOnSegment(p: Pt, a: Pt, b: Pt): [Pt, number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q: Pt = [a[0] + t * dx, a[1] + t * dy];
  const ex = p[0] - q[0];
  const ey = p[1] - q[1];
  return [q, ex * ex + ey * ey, t];
}

/** Punkty rozmieszczone równomiernie wzdłuż pierścienia co ~`spacing`. */
export function resampleRing(r: Ring, spacing: number): { pts: Pt[]; seg: number[] } {
  const pts: Pt[] = [];
  const seg: number[] = [];
  let carry = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = carry;
    while (d < len) {
      const t = d / len;
      pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      seg.push(i);
      d += spacing;
    }
    carry = d - len;
  }
  return { pts, seg };
}

/** Kapsuła (odcinek z półokrągłymi końcami) jako pierścień CCW. */
export function capsule(a: Pt, b: Pt, width: number, segmentsPerHalf = 12): Ring {
  const r = width / 2;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ring: Ring = [];
  // półokrąg przy b: od -90° do +90° względem kierunku
  for (let i = 0; i <= segmentsPerHalf; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / segmentsPerHalf;
    ring.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]);
  }
  for (let i = 0; i <= segmentsPerHalf; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / segmentsPerHalf;
    ring.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
  }
  return ring;
}

export function rect(x0: number, y0: number, x1: number, y1: number): Ring {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

export function mapMulti(mp: MultiPoly, f: (p: Pt) => Pt): MultiPoly {
  return mp.map((p) => ({ outer: p.outer.map(f), holes: p.holes.map((h) => h.map(f)) }));
}

export function countVertices(mp: MultiPoly): number {
  return mp.reduce((s, p) => s + p.outer.length + p.holes.reduce((t, h) => t + h.length, 0), 0);
}
