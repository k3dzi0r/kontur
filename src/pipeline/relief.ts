import type { BinaryMask, MeshData, MultiPoly, Pt, ReliefParams, ReliefResult2D, Ring, ValidationSummary } from '../types';
import type { ManifoldToplevel } from '../mesh/manifold';
import { vectorizeMask } from '../geometry/vectorize';
import { difference, hull, intersection, offset, union } from '../geometry/clip';
import { multiArea, multiBBox, rect } from '../geometry/polygon';
import { thicknessPass } from '../geometry/thickness';
import { buildReliefSolid } from '../mesh/extrude';
import { validateMesh } from '../mesh/validate';

// Tryb „Relief”: płytka bazowa + wzór wypukły (lub wklęsły), model leży płasko.
// Wszystkie elementy wzoru stoją na płytce, więc wyspy nie wymagają mostków.

export interface Relief2DOutput {
  result: ReliefResult2D;
  /** Część wzoru z obrazu (bez ramki) — grawerowana lub wypukła. */
  figurePart: MultiPoly;
  /** Ramka — zawsze wypukła. */
  frame: MultiPoly;
  minDetectedWidth: number | null;
  warnings: string[];
}

/** Odsunięcie ścian wzoru od ścian płytki, mm (poniżej rozdzielczości druku). */
const WALL_GAP = 0.05;

function ellipse(cx: number, cy: number, a: number, b: number, n = 128): Ring {
  const r: Ring = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    r.push([cx + a * Math.cos(t), cy + b * Math.sin(t)]);
  }
  return r;
}

export function platePolygon(figure: MultiPoly, W: number, H: number, p: ReliefParams): MultiPoly {
  const m = p.margin;
  switch (p.plateShape) {
    case 'rect':
      return [{ outer: rect(-m, -m, W + m, H + m), holes: [] }];
    case 'rounded': {
      const r = Math.max(0, Math.min(p.cornerRadius, (W + 2 * m) / 2 - 0.01, (H + 2 * m) / 2 - 0.01));
      if (r <= 0) return [{ outer: rect(-m, -m, W + m, H + m), holes: [] }];
      return offset([{ outer: rect(-m + r, -m + r, W + m - r, H + m - r), holes: [] }], r);
    }
    case 'ellipse':
      // elipsa opisana na prostokącie wzoru (półosie ×√2) + margines
      return [{ outer: ellipse(W / 2, H / 2, (W / 2) * Math.SQRT2 + m, (H / 2) * Math.SQRT2 + m), holes: [] }];
    case 'outline': {
      // Obrys wzoru odsunięty o margines, bez otworów. Odległe elementy łączymy
      // zamknięciem morfologicznym o rosnącym promieniu (gładki „lukier”),
      // a gdy to nie wystarcza — otoczką wypukłą.
      const fill = (mp: MultiPoly) => union(mp.map((q) => ({ outer: q.outer, holes: [] })));
      const base = Math.max(0.5, m);
      for (const g of [0, 2, 5, 10, 20, 40]) {
        const closed = fill(g > 0 ? offset(offset(figure, base + g), -g) : offset(figure, base));
        if (closed.length === 1) return closed;
      }
      return offset(hull(figure), base);
    }
  }
}

export function runRelief2D(mask: BinaryMask, p: ReliefParams): Relief2DOutput | null {
  const warnings: string[] = [];
  const vec = vectorizeMask(mask, { sizeMode: p.sizeMode, targetSize: p.targetSize, simplify: p.simplify });
  if (!vec) return null;
  const W = vec.width;
  const H = vec.height;

  const tp = thicknessPass(vec.polygons, p.minFeatureWidth, p.thicken, warnings);
  let plate = platePolygon(tp.figure, W, H, p);

  // Otwór do zawieszenia: u góry, na osi płytki. Jeśli wypada na wzorze,
  // dokładamy „ucho” nad wzorem (jak w breloku) i tam wiercimy otwór.
  let hole: MultiPoly = [];
  if (p.hangHole > 0) {
    const r = p.hangHole / 2;
    const clearance = 0.8;
    let pb = multiBBox(plate);
    const cx = (pb.minX + pb.maxX) / 2;
    let c: Pt = [cx, pb.maxY - Math.max(r + 1.2, p.margin / 2)];
    const circle = (center: Pt, rad: number, n = 48): MultiPoly => [{ outer: ellipse(center[0], center[1], rad, rad, n), holes: [] }];
    if (intersection(tp.figure, circle(c, r + clearance)).length > 0) {
      const R = r + 2.5; // ścianka ucha 2,5 mm
      const figTop = multiBBox(tp.figure).maxY;
      c = [cx, figTop + clearance + r];
      const neck: MultiPoly = [{ outer: rect(cx - R, Math.min(c[1], pb.maxY - 1), cx + R, c[1]), holes: [] }];
      plate = union(plate, circle(c, R, 64), neck);
      pb = multiBBox(plate);
      warnings.push('Otwór nachodził na wzór — dodano ucho do zawieszenia nad wzorem.');
    }
    hole = circle(c, r);
    if (intersection(tp.figure, circle(c, r + clearance)).length > 0) {
      warnings.push('Otwór do zawieszenia nachodzi na wzór — zwiększ margines albo zmniejsz otwór.');
    }
    plate = difference(plate, hole);
  }

  // Wzór i ramkę przycinamy do płytki cofniętej o WALL_GAP: wspólne pionowe
  // ściany (krawędź płytki, otwór) po unii w 3D dają zdegenerowane trójkąty,
  // które po zespawaniu wierzchołków w slicerze psują manifold.
  const inner = offset(plate, -WALL_GAP);
  const frame = p.frameWidth > 0 ? difference(inner, offset(plate, -p.frameWidth)) : [];
  const figurePart = intersection(tp.figure, inner);
  const pattern = union(figurePart, frame);
  if (multiArea(figurePart) < 0.98 * multiArea(tp.figure) && p.plateShape !== 'outline') {
    warnings.push('Część wzoru wychodzi poza płytkę i została przycięta.');
  }
  if (p.engrave && p.reliefHeight > p.plateThickness - 0.6) {
    warnings.push(`Grawer przycięty do ${(p.plateThickness - 0.6).toFixed(1)} mm, by zostawić min. 0,6 mm dna.`);
  }

  const pb = multiBBox(plate);
  return {
    result: {
      kind: 'relief',
      plate,
      pattern,
      hole,
      thinRegions: tp.thinRegions,
      thickenedRegions: tp.thickenedRegions,
      figureWidth: W,
      figureHeight: H,
      plateWidth: pb.maxX - pb.minX,
      plateHeight: pb.maxY - pb.minY,
      scale: vec.transform.scale,
    },
    figurePart,
    frame,
    minDetectedWidth: tp.minDetectedWidth,
    warnings,
  };
}

export interface ReliefOutput {
  result2D: ReliefResult2D;
  mesh: MeshData;
  validation: ValidationSummary;
  timings: Record<string, number>;
}

export function runRelief(wasm: ManifoldToplevel, mask: BinaryMask, p: ReliefParams): ReliefOutput | null {
  const t0 = performance.now();
  const out = runRelief2D(mask, p);
  if (!out) return null;
  const t1 = performance.now();
  const r = out.result;
  const solid = buildReliefSolid(wasm, r.plate, out.figurePart, out.frame, p);
  const t2 = performance.now();
  const report = validateMesh(solid.mesh);
  const t3 = performance.now();

  const errors: string[] = [];
  if (solid.components !== 1) errors.push(`Model ma ${solid.components} osobnych brył.`);
  if (solid.status !== 'NoError') errors.push(`manifold-3d: ${solid.status}`);
  if (!report.closed || !report.manifold) errors.push('Siatka nie jest zamknięta / manifold.');
  if (report.volume <= 0) errors.push('Objętość ≤ 0 (odwrócone normalne).');
  const warnings = [...out.warnings];
  if (r.thinRegions.length > 0) {
    warnings.push(`${r.thinRegions.length} miejsc wzoru węższych niż ${p.minFeatureWidth} mm (zaznaczone na fioletowo).`);
  }
  return {
    result2D: r,
    mesh: solid.mesh,
    validation: {
      islandsDetected: 0,
      islandsBridged: 0,
      allConnected: solid.components === 1,
      minDetectedWidth: out.minDetectedWidth,
      thinRegionCount: r.thinRegions.length,
      mesh: report,
      manifoldStatus: solid.status,
      errors,
      warnings,
    },
    timings: { geometry2D: t1 - t0, solid3D: t2 - t1, validate: t3 - t2 },
  };
}
