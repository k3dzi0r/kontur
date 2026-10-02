import type { BinaryMask, MultiPoly, Ring } from '../types';
import { maskBounds } from '../image/morphology';
import { traceContours, ringPxToMm, type PxToMm } from './contours';
import { simplifyRing } from './simplify';
import { dropSmall, unionRings } from './clip';
import { mapMulti, multiBBox } from './polygon';

export interface VectorizeOptions {
  /** Który wymiar figury ma mieć `targetSize`. */
  sizeMode: 'height' | 'width';
  /** Docelowa wysokość lub szerokość figury (bez podstawy), mm. */
  targetSize: number;
  /** Tolerancja uproszczenia, mm. */
  simplify: number;
}

export interface VectorizeResult {
  polygons: MultiPoly;
  transform: PxToMm;
  width: number;
  height: number;
}

/**
 * Maska → kontury → mm → Douglas-Peucker → union (poprawne zagnieżdżenie
 * otworów). Wynik ma dół figury w y=0 i lewą krawędź w x=0.
 */
export function vectorizeMask(mask: BinaryMask, opts: VectorizeOptions): VectorizeResult | null {
  const b = maskBounds(mask);
  if (!b) return null;
  const pxW = b.x1 - b.x0;
  const pxH = b.y1 - b.y0;
  const scale = opts.sizeMode === 'width' ? opts.targetSize / pxW : opts.targetSize / pxH;
  const transform: PxToMm = { scale, ox: b.x0, oy: b.y1 };

  const rings: Ring[] = [];
  for (const r of traceContours(mask)) {
    const mm = ringPxToMm(r, transform);
    const s = simplifyRing(mm, opts.simplify);
    if (s) rings.push(s);
  }
  // pomijamy okruchy mniejsze niż ~ćwierć piksela
  let polygons = dropSmall(unionRings(rings, 'positive'), Math.max(1e-4, 0.25 * scale * scale));
  if (polygons.length === 0) return null;

  // dokładne wyrównanie do osi: dół = 0, lewo = 0
  const bb = multiBBox(polygons);
  const dx = bb.minX;
  const dy = bb.minY;
  polygons = mapMulti(polygons, ([x, y]) => [x - dx, y - dy]);
  transform.ox += dx / scale;
  transform.oy -= dy / scale;
  return { polygons, transform, width: bb.maxX - bb.minX, height: bb.maxY - bb.minY };
}
