import type { BinaryMask, Bridge, MultiPoly, Pt } from '../types';
import { maskBounds } from '../image/morphology';
import { multiCentroid, polyArea } from './polygon';

// Symetria lustrzana względem pionowej osi — wiele ornamentów i postaci jest
// symetrycznych, a zachłanny algorytm mostków łamie symetrię (kolejność, remisy).
// Dla symetrycznej grafiki planujemy mostki tylko dla lewej połowy i odbijamy je.

/**
 * IoU maski z jej odbiciem względem pionowej osi przez środek bbox materiału.
 * Zwraca też oś w pikselach (współrzędna x krawędzi pikseli).
 */
export function mirrorScore(mask: BinaryMask): { score: number; axisPx: number } {
  const b = maskBounds(mask);
  if (!b) return { score: 0, axisPx: 0 };
  const { width: w, data } = mask;
  let area = 0;
  let inter = 0;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      if (!data[y * w + x]) continue;
      area++;
      const mx = b.x0 + b.x1 - 1 - x;
      if (data[y * w + mx]) inter++;
    }
  }
  const union = 2 * area - inter;
  return { score: union > 0 ? inter / union : 0, axisPx: (b.x0 + b.x1) / 2 };
}

export interface IslandSides {
  /** wyspy planowane normalnie: lewe, środkowe i prawe bez pary */
  plan: number[];
  /** prawa wyspa → lewa wyspa (lustrzana para) */
  pairs: Map<number, number>;
}

/** Dzieli wyspy na strony osi i paruje prawe z lustrzanymi lewymi (centroid + pole). */
export function pairIslands(components: MultiPoly, islands: number[], axis: number, tol: number): IslandSides {
  const info = islands.map((i) => ({ i, c: multiCentroid([components[i]]), a: polyArea(components[i]) }));
  const left = info.filter((x) => x.c[0] < axis - tol);
  const right = info.filter((x) => x.c[0] > axis + tol);
  const center = info.filter((x) => Math.abs(x.c[0] - axis) <= tol);
  const pairs = new Map<number, number>();
  const usedLeft = new Set<number>();
  for (const r of right) {
    const mirrored: Pt = [2 * axis - r.c[0], r.c[1]];
    let best = -1;
    let bestD = Infinity;
    for (const l of left) {
      if (usedLeft.has(l.i)) continue;
      const d = Math.hypot(l.c[0] - mirrored[0], l.c[1] - mirrored[1]);
      const areaOk = Math.abs(l.a - r.a) <= 0.25 * Math.max(l.a, r.a);
      if (areaOk && d < bestD) {
        bestD = d;
        best = l.i;
      }
    }
    if (best >= 0 && bestD <= Math.max(2 * tol, 1.5)) {
      pairs.set(r.i, best);
      usedLeft.add(best);
    }
  }
  const plan = [...left.map((x) => x.i), ...center.map((x) => x.i), ...right.filter((x) => !pairs.has(x.i)).map((x) => x.i)];
  return { plan, pairs };
}

export function mirrorBridge(b: Bridge, axis: number, from: number): Bridge {
  return {
    ...b,
    a: [2 * axis - b.a[0], b.a[1]],
    b: [2 * axis - b.b[0], b.b[1]],
    from,
    to: b.to === -1 ? -1 : -2,
    mirrored: true,
  };
}
