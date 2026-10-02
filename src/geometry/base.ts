import type { BaseInfo, BaseParams, MultiPoly, Poly, Pt, Ring, SlotInfo, StabilityInfo } from '../types';
import { intersection, union } from './clip';
import { multiArea, multiBBox, multiCentroid, rect, ringArea } from './polygon';

/**
 * Łączniki z cokołem: część figury w pasie [0, snap] nad dołem jest
 * „przeciągnięta” pionowo w dół aż do y = -embed (suma Minkowskiego
 * z odcinkiem pionowym). Dzięki temu najniższe fragmenty — także te
 * kończące się nieco wyżej niż reszta — fizycznie wchodzą w cokół.
 */
export function groundConnectors(figure: MultiPoly, snap: number, embed: number): MultiPoly {
  if (figure.length === 0) return [];
  const bb = multiBBox(figure);
  const band = intersection(figure, [{ outer: rect(bb.minX - 1, bb.minY - 1, bb.maxX + 1, bb.minY + snap), holes: [] }]);
  if (band.length === 0) return [];
  const D = snap + embed + 0.01;
  const pieces: MultiPoly = [...band];
  const down = (p: Pt): Pt => [p[0], p[1] - D];
  for (const poly of band) {
    pieces.push({ outer: poly.outer.map(down), holes: poly.holes.map((h) => h.map(down)) });
    for (const r of [poly.outer, ...poly.holes]) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        let quad: Ring = [a, b, down(b), down(a)];
        const ar = ringArea(quad);
        if (Math.abs(ar) < 1e-9) continue;
        if (ar < 0) quad = quad.reverse();
        pieces.push({ outer: quad, holes: [] });
      }
    }
  }
  const swept = union(pieces);
  return intersection(swept, [{ outer: rect(bb.minX - 1, bb.minY - embed, bb.maxX + 1, bb.minY + snap), holes: [] }]);
}

export function computeBase(figure: MultiPoly, p: BaseParams): BaseInfo {
  const bb = multiBBox(figure);
  return { x0: bb.minX - p.margin, x1: bb.maxX + p.margin, height: p.height, depth: p.depth };
}

/** Prostokąt cokołu w rzucie bocznym (2D, y ∈ [-h, 0]) — do podglądu. */
export function baseOutline(base: BaseInfo): Poly {
  return { outer: rect(base.x0, -base.height, base.x1, 0), holes: [] };
}

const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Prosta analiza statyczna: środek masy (figura + cokół, ta sama gęstość)
 * i kąty przechyłu, przy których rzut środka masy wychodzi poza podstawę.
 */
export function analyzeStability(figure: MultiPoly, base: BaseInfo, thickness: number): StabilityInfo {
  const A = multiArea(figure);
  const c = multiCentroid(figure);
  const W = base.x1 - base.x0;
  const vFig = A * thickness;
  const vBase = W * base.depth * base.height;
  const zFig = base.height + c[1];
  const zBase = base.height / 2;
  const comHeight = (vFig * zFig + vBase * zBase) / (vFig + vBase);
  const xFig = c[0];
  const xBase = (base.x0 + base.x1) / 2;
  const comX = (vFig * xFig + vBase * xBase) / (vFig + vBase);
  const sideArm = Math.min(comX - base.x0, base.x1 - comX);
  const tipSide = toDeg(Math.atan2(sideArm, comHeight));
  const tipFB = toDeg(Math.atan2(base.depth / 2, comHeight));
  const warnings: string[] = [];
  if (tipFB < 7) warnings.push(`Przewrócenie przód/tył już przy ${tipFB.toFixed(1)}° — rozważ głębszą lub wyższą podstawkę.`);
  if (tipSide < 10) warnings.push(`Przewrócenie na bok przy ${tipSide.toFixed(1)}° — środek masy blisko krawędzi podstawki.`);
  return {
    centroid: c,
    comHeight,
    tipAngleSide: tipSide,
    tipAngleFrontBack: tipFB,
    centroidOffset: xFig - xBase,
    warnings,
  };
}

/** Efektywna wysokość cokołu: dla slotu musi zmieścić slot + min. 1,2 mm dna. */
export function effectiveBaseHeight(p: BaseParams): number {
  return p.type === 'slot' ? Math.max(p.height, p.slotDepth + p.clearance + 1.2) : p.height;
}

/**
 * Język figurki dla podstawki wsuwanej. Szukamy przedziałów X, w których
 * figura (z płaską stopą na y = 0) dotyka podłoża; język stoi pod najszerszym
 * (przy remisie — najbliższym środka masy). Dolne narożniki ścięte 0,6 mm,
 * żeby łatwiej wchodził w slot.
 */
export function makeTongue(figure: MultiPoly, centroidX: number, p: BaseParams, thickness: number): { tongue: MultiPoly; slot: SlotInfo } {
  const bb = multiBBox(figure);
  const foot = intersection(figure, [{ outer: rect(bb.minX - 1, -0.01, bb.maxX + 1, 0.3), holes: [] }]);
  const intervals = foot.map((q) => {
    const b = multiBBox([q]);
    return [b.minX, b.maxX] as Pt;
  });
  let best: Pt = [bb.minX, bb.maxX];
  let bestScore = -Infinity;
  for (const iv of intervals) {
    const w = iv[1] - iv[0];
    const score = w - 0.05 * Math.abs((iv[0] + iv[1]) / 2 - centroidX);
    if (score > bestScore) {
      bestScore = score;
      best = iv;
    }
  }
  const footW = best[1] - best[0];
  const w = p.tongueWidth > 0 ? p.tongueWidth : Math.min(40, Math.max(6, footW * 0.7));
  const cx = (best[0] + best[1]) / 2;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const d = p.slotDepth;
  const ch = Math.min(0.6, w / 4, d / 4);
  const tongue: MultiPoly = [
    {
      outer: [
        [x0 + ch, -d],
        [x1 - ch, -d],
        [x1, -d + ch],
        [x1, 0.5],
        [x0, 0.5],
        [x0, -d + ch],
      ],
      holes: [],
    },
  ];
  const c = p.clearance;
  return {
    tongue,
    slot: {
      x0,
      x1,
      depth: d,
      clearance: c,
      tongueSize: [w, thickness, d],
      slotSize: [w + 2 * c, thickness + 2 * c, d + c],
    },
  };
}
