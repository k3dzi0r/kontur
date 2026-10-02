import type { Pt, Ring } from '../types';

function perpDist2(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
  const cross = (p[0] - a[0]) * dy - (p[1] - a[1]) * dx;
  return (cross * cross) / len2;
}

/** Douglas-Peucker dla otwartej łamanej (iteracyjnie, bez rekurencji). */
export function simplifyPolyline(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length <= 2 || epsilon <= 0) return pts.slice();
  const eps2 = epsilon * epsilon;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist2(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > eps2) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Douglas-Peucker dla zamkniętego pierścienia. Pierścień dzielimy w dwóch
 * odległych punktach i upraszczamy obie połowy. Zwraca null gdy pierścień
 * degeneruje się (<3 punkty).
 */
export function simplifyRing(r: Ring, epsilon: number): Ring | null {
  if (r.length < 3) return null;
  if (epsilon <= 0 || r.length <= 4) return r.slice();
  // punkt najdalszy od r[0]
  let far = 0;
  let farD = -1;
  for (let i = 1; i < r.length; i++) {
    const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const first = simplifyPolyline(r.slice(0, far + 1), epsilon);
  const second = simplifyPolyline([...r.slice(far), r[0]], epsilon);
  const out = [...first.slice(0, -1), ...second.slice(0, -1)];
  return out.length >= 3 ? out : null;
}
