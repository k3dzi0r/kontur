import type { BinaryMask, Bridge, CutoutParams, CutoutResult2D, MultiPoly, Pt, SlotInfo } from '../types';
import { edtSquared } from '../image/morphology';
import { vectorizeMask } from '../geometry/vectorize';
import { mmToPx, type PxToMm } from '../geometry/contours';
import { analyzeIslands } from '../geometry/islands';
import { bridgeShapes, DEFAULT_WEIGHTS, isBlocked, planBridges, type BridgeOptions } from '../geometry/bridges';
import { mirrorBridge, mirrorScore, pairIslands } from '../geometry/symmetry';
import { thicknessPass } from '../geometry/thickness';
import { analyzeStability, computeBase, effectiveBaseHeight, groundConnectors, makeTongue } from '../geometry/base';
import { difference, union } from '../geometry/clip';
import { multiCentroid, ringBBox } from '../geometry/polygon';

/** Powyżej tej liczby wysp mostki (Prim, O(n²)) byłyby zbyt wolne — to zwykle szum. */
export const MAX_AUTO_BRIDGE_ISLANDS = 400;
/** Minimalne IoU maski z odbiciem, by uznać grafikę za symetryczną. */
export const SYMMETRY_MIN_IOU = 0.9;

export interface Cutout2DOutput {
  result: CutoutResult2D;
  minDetectedWidth: number | null;
  allConnected: boolean;
  finalComponents: number;
  warnings: string[];
}

/** Funkcja odległości od materiału (mm) na podstawie EDT tła maski. */
export function makeMaterialDistance(mask: BinaryMask, t: PxToMm): (p: Pt) => number {
  const d2 = edtSquared(mask, 1);
  const { width: w, height: h } = mask;
  return (p: Pt) => {
    const [px, py] = mmToPx(p, t);
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) {
      // poza obrazem: przybliżenie odległością do krawędzi obrazu (tam jest tło)
      const ox = Math.max(0, -px, px - w);
      const oy = Math.max(0, -py, py - h);
      const cx = Math.min(w - 1, Math.max(0, ix));
      const cy = Math.min(h - 1, Math.max(0, iy));
      return (Math.sqrt(d2[cy * w + cx]) + Math.hypot(ox, oy)) * t.scale;
    }
    return Math.sqrt(d2[iy * w + ix]) * t.scale;
  };
}

/** Część 2D pipeline'u trybu „Wycinanka”: maska → figura gotowa do ekstruzji. */
export function runCutout2D(mask: BinaryMask, params: CutoutParams): Cutout2DOutput | null {
  const warnings: string[] = [];
  const base = params.base;
  // Podstawka wsuwana: figurka musi być jednym kawałkiem sama w sobie —
  // cokół nie łączy elementów, więc mostki dołączają wszystko do głównej bryły.
  const slotMode = base.enabled && base.type === 'slot';
  const baseHeight = base.enabled ? effectiveBaseHeight(base) : 0;
  const figureTarget = params.sizeMode === 'totalHeight' ? params.targetSize - baseHeight : params.targetSize;
  if (figureTarget <= 1) throw new Error('Docelowy rozmiar jest zbyt mały względem wysokości podstawki.');

  const vec = vectorizeMask(mask, {
    sizeMode: params.sizeMode === 'width' ? 'width' : 'height',
    targetSize: figureTarget,
    simplify: params.simplify,
  });
  if (!vec) return null;
  const groundSnap = base.enabled && !slotMode ? base.groundSnap : null;
  const groundTarget = base.enabled && !slotMode
    ? { x0: -base.margin, x1: vec.width + base.margin, embed: base.embed }
    : null;
  const width = params.bridgeWidth;

  // Edycje użytkownika (współrzędne znormalizowane → mm)
  const W = vec.width;
  const H = vec.height;
  const denorm = (p: Pt): Pt => [p[0] * W, p[1] * H];
  const blockedZones: Array<{ p: Pt; r: number }> = [];
  const manualBridges: Bridge[] = [];
  for (const [editIndex, e] of params.bridgeEdits.entries()) {
    if (e.kind === 'block') blockedZones.push({ p: denorm(e.p), r: e.r * H });
    else {
      const a = denorm(e.a);
      const b = denorm(e.b);
      manualBridges.push({
        a,
        b,
        width,
        from: -2,
        to: base.enabled && b[1] <= 0.1 ? -1 : -2,
        length: Math.hypot(b[0] - a[0], b[1] - a[1]),
        cost: 0,
        crossesMaterial: false,
        manual: true,
        editIndex,
      });
    }
  }
  const manualShapes = bridgeShapes(manualBridges, groundTarget);
  // Ręczne mostki scalamy przed analizą — wyspy przez nie połączone przestają być wyspami.
  const components = manualShapes.length > 0 ? union(vec.polygons, manualShapes) : vec.polygons;
  const isl = analyzeIslands(components, groundSnap);

  // Mostki automatyczne
  let bridges: Bridge[] = [...manualBridges];
  let bridgePolys: MultiPoly = [...manualShapes];
  let figure: MultiPoly = components;
  let symmetryAxis: number | null = null;
  const tooManyIslands = isl.islandIndices.length > MAX_AUTO_BRIDGE_ISLANDS;
  if (tooManyIslands) {
    warnings.push(
      `Wykryto ${isl.islandIndices.length} wysp — za dużo na automatyczne mostki (limit ${MAX_AUTO_BRIDGE_ISLANDS}). ` +
        'Zwiększ „Usuwanie szumu”, „Wygładzanie” lub „Domykanie przerw”.',
    );
  }
  if (params.autoBridges && isl.islandIndices.length > 0 && !tooManyIslands) {
    const materialDistance = makeMaterialDistance(mask, vec.transform);
    const opts: BridgeOptions = {
      width,
      ground: groundTarget,
      materialDistance,
      rasterScale: vec.transform.scale,
      blocked: blockedZones,
      weights: { vertical: params.preferVertical ? DEFAULT_WEIGHTS.vertical : 0 },
    };

    // Symetria: planujemy lewą połowę (+ środek, + prawe bez pary) i odbijamy.
    let planList = isl.islandIndices;
    let pairs = new Map<number, number>();
    let axis = 0;
    if (params.symmetricBridges) {
      const ms = mirrorScore(mask);
      if (ms.score >= SYMMETRY_MIN_IOU) {
        axis = (ms.axisPx - vec.transform.ox) * vec.transform.scale;
        const sides = pairIslands(components, isl.islandIndices, axis, Math.max(0.5, 2 * vec.transform.scale));
        if (sides.pairs.size > 0) {
          planList = sides.plan;
          pairs = sides.pairs;
          symmetryAxis = axis;
        }
      }
    }
    const auto = planBridges(components, isl.connectedIndices, planList, opts);
    const mirrored: Bridge[] = [];
    const endTol = 2 * vec.transform.scale + 0.15;
    for (const [right, left] of pairs) {
      for (const b of auto) {
        if (b.from !== left) continue;
        const m = mirrorBridge(b, axis, right);
        const endOk = materialDistance(m.a) <= endTol && (m.to === -1 || materialDistance(m.b) <= endTol);
        if (endOk && !isBlocked(m.a, m.b, blockedZones)) mirrored.push(m);
      }
    }
    const autoAll = auto.concat(mirrored);
    const shapes = bridgeShapes(autoAll, groundTarget);
    bridges = bridges.concat(autoAll);
    bridgePolys = bridgePolys.concat(shapes);
    figure = union(components, shapes);
    if (params.bridgeWidth < params.minFeatureWidth) {
      warnings.push('Szerokość mostka jest mniejsza niż minimalna szerokość elementu.');
    }
    // Domknięcie: wyspy, których odbity mostek był niepoprawny, oraz rzadkie
    // przypadki numeryczne — kolejna runda na nowym podziale.
    for (let round = 0; round < 2; round++) {
      const again = analyzeIslands(figure, groundSnap);
      if (again.islandIndices.length === 0) break;
      const more = planBridges(figure, again.connectedIndices, again.islandIndices, opts);
      const moreShapes = bridgeShapes(more, groundTarget);
      bridges = bridges.concat(more.map((b) => ({ ...b, from: -2 })));
      bridgePolys = bridgePolys.concat(moreShapes);
      figure = union(figure, moreShapes);
    }
  }

  // Minimalna szerokość
  const tp = thicknessPass(figure, params.minFeatureWidth, params.thicken, warnings);
  figure = tp.figure;
  const { thinRegions, thickenedRegions, minDetectedWidth } = tp;

  // Podstawka + łączniki
  let groundConn: MultiPoly = [];
  let baseInfo = null;
  let stability = null;
  let tongue: MultiPoly = [];
  let slot: SlotInfo | null = null;
  if (base.enabled) {
    // przy slocie stopa jest płaska na y = 0 (stoi NA cokole), język wchodzi w slot
    groundConn = groundConnectors(figure, base.groundSnap, slotMode ? 0 : base.embed);
    figure = union(figure, groundConn);
    if (slotMode) {
      const t = makeTongue(figure, multiCentroid(figure)[0], base, params.thickness);
      tongue = t.tongue;
      slot = t.slot;
      figure = union(figure, tongue);
    }
    baseInfo = computeBase(figure, { ...base, height: baseHeight });
    stability = analyzeStability(figure.length ? difference(figure, tongue) : figure, baseInfo, params.thickness);
    warnings.push(...stability.warnings);
    if (slotMode && baseHeight > base.height + 1e-6) {
      warnings.push(`Cokół podniesiony do ${baseHeight.toFixed(1)} mm, by zmieścić slot ${base.slotDepth} mm.`);
    }
  }

  // Spójność końcowa: bez cokołu lub ze slotem — figura to 1 kawałek;
  // z cokołem zespolonym — każdy komponent sięga w cokół.
  const finalComponents = figure.length;
  const allConnected =
    base.enabled && !slotMode ? figure.every((p) => ringBBox(p.outer).minY < -1e-6) : finalComponents === 1;

  return {
    result: {
      kind: 'cutout',
      components,
      mainIndex: isl.mainIndex,
      groundedIndices: isl.groundedIndices,
      islandIndices: isl.islandIndices,
      bridges,
      bridgeShapes: bridgePolys,
      blockedZones,
      symmetryAxis,
      groundConnectors: groundConn,
      tongue,
      slot,
      thinRegions,
      thickenedRegions,
      figure,
      base: baseInfo,
      stability,
      scale: vec.transform.scale,
      figureWidth: vec.width,
      figureHeight: vec.height,
    },
    minDetectedWidth,
    allConnected,
    finalComponents,
    warnings,
  };
}
