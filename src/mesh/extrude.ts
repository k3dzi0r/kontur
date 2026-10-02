import type { BaseInfo, MeshData, MultiPoly, ReliefParams, SlotInfo } from '../types';
import type { ManifoldToplevel } from './manifold';
import { union } from '../geometry/clip';

export interface SolidOptions {
  thickness: number;
  base: (BaseInfo & { cornerRadius: number }) | null;
}

export interface SolidResult {
  mesh: MeshData;
  status: string;
  genus: number;
  volume: number;
  components: number;
}

type Manifold = InstanceType<ManifoldToplevel['Manifold']>;

/** Mesh + statystyki z gotowej bryły manifold. */
function extractSolid(final: Manifold): SolidResult {
  const status = final.status();
  const parts = final.decompose();
  const components = parts.length;
  parts.forEach((p) => p.delete());
  const m = final.getMesh();
  const positions = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) {
    positions[i * 3] = m.vertProperties[i * m.numProp];
    positions[i * 3 + 1] = m.vertProperties[i * m.numProp + 1];
    positions[i * 3 + 2] = m.vertProperties[i * m.numProp + 2];
  }
  return {
    mesh: { positions, indices: new Uint32Array(m.triVerts) },
    status,
    genus: final.genus(),
    volume: final.volume(),
    components,
  };
}

function contours(mp: MultiPoly) {
  return mp.flatMap((p) => [p.outer, ...p.holes]);
}

/**
 * Relief leżący płasko: płytka (z = 0..grubość) + wzór wypukły (zachodzi
 * 0,2 mm w płytkę, by union był pewny) albo wklęsły (odjęty od płytki).
 * Ramka jest zawsze wypukła. Wynik wyśrodkowany w XY.
 */
export function buildReliefSolid(
  wasm: ManifoldToplevel,
  plate: MultiPoly,
  figurePart: MultiPoly,
  frame: MultiPoly,
  p: ReliefParams,
): SolidResult {
  const { CrossSection, Manifold } = wasm;
  const garbage: Array<{ delete(): void }> = [];
  const keep = <T extends { delete(): void }>(o: T): T => {
    garbage.push(o);
    return o;
  };
  const overlap = 0.2;
  const extrudeAt = (mp: MultiPoly, z0: number, h: number) =>
    keep(keep(Manifold.extrude(keep(new CrossSection(contours(mp), 'EvenOdd')), h)).translate([0, 0, z0]));
  try {
    const pt = p.plateThickness;
    let solid = extrudeAt(plate, 0, pt);
    // scalenie w 2D — wzór i ramka mogą na siebie nachodzić (EvenOdd zrobiłby z tego dziurę)
    const raised = p.engrave ? frame : union(figurePart, frame);
    if (raised.length > 0) {
      solid = keep(Manifold.union(solid, extrudeAt(raised, pt - overlap, p.reliefHeight + overlap)));
    }
    if (p.engrave && figurePart.length > 0) {
      const depth = Math.max(0.2, Math.min(p.reliefHeight, pt - 0.6));
      solid = keep(Manifold.difference(solid, extrudeAt(figurePart, pt - depth, depth + 1)));
    }
    const bb = solid.boundingBox();
    const final = keep(solid.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, -bb.min[2]]));
    return extractSolid(final);
  } finally {
    for (const g of garbage) g.delete();
  }
}

/**
 * Figura 2D (mm, Y w górę) → bryła stojąca pionowo:
 *   X = szerokość, Y = grubość (wyśrodkowana), Z = wysokość (dół cokołu = 0).
 * Ekstruzja i boolean union z cokołem w manifold-3d (wynik zawsze manifold).
 */
export function buildCutoutSolid(wasm: ManifoldToplevel, figure: MultiPoly, opts: SolidOptions): SolidResult {
  const { CrossSection, Manifold } = wasm;
  const garbage: Array<{ delete(): void }> = [];
  const keep = <T extends { delete(): void }>(o: T): T => {
    garbage.push(o);
    return o;
  };
  try {
    const cs = keep(new CrossSection(contours(figure), 'EvenOdd'));
    const t = opts.thickness;
    // extrude wzdłuż +Z, obrót o 90° wokół X: (x, y, z) → (x, -z, y)
    let solid = keep(keep(Manifold.extrude(cs, t)).rotate([90, 0, 0])).translate([0, t / 2, 0]);
    keep(solid);
    let zShift = 0;
    let xCenter = 0;
    if (opts.base) {
      const b = opts.base;
      const W = b.x1 - b.x0;
      const r = Math.max(0, Math.min(b.cornerRadius, W / 2 - 0.01, b.depth / 2 - 0.01));
      let foot = keep(CrossSection.square([W - 2 * r, b.depth - 2 * r], true));
      if (r > 0) foot = keep(foot.offset(r, 'Round'));
      const block = keep(keep(Manifold.extrude(foot, b.height)).translate([(b.x0 + b.x1) / 2, 0, -b.height]));
      solid = keep(Manifold.union(solid, block));
      zShift = b.height;
      xCenter = (b.x0 + b.x1) / 2;
    } else {
      const bb = solid.boundingBox();
      zShift = -bb.min[2];
      xCenter = (bb.min[0] + bb.max[0]) / 2;
    }
    const final = keep(solid.translate([-xCenter, 0, zShift]));
    return extractSolid(final);
  } finally {
    for (const g of garbage) g.delete();
  }
}

export interface SlotPartsResult {
  /** Do druku: figurka leżąca płasko + cokół obok (jedna siatka, dwa obiekty). */
  figure: SolidResult;
  base: SolidResult;
  /** Podgląd złożenia: figurka wsunięta w slot (tylko do wizualizacji). */
  assembled: MeshData;
}

function mergeMeshes(meshes: MeshData[]): MeshData {
  const nv = meshes.reduce((n, m) => n + m.positions.length, 0);
  const ni = meshes.reduce((n, m) => n + m.indices.length, 0);
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let pv = 0;
  let pi = 0;
  for (const m of meshes) {
    positions.set(m.positions, pv);
    const off = pv / 3;
    for (let i = 0; i < m.indices.length; i++) indices[pi + i] = m.indices[i] + off;
    pv += m.positions.length;
    pi += m.indices.length;
  }
  return { positions, indices };
}

export { mergeMeshes };

/**
 * Podstawka wsuwana — dwie osobne bryły:
 *  - figurka (z językiem) leżąca płasko na stole: z = 0..grubość,
 *  - cokół z zaokrąglonymi narożnikami i wybraniem (slot) od góry.
 * Ułożone obok siebie na stole, całość wyśrodkowana.
 */
export function buildSlotParts(
  wasm: ManifoldToplevel,
  figure: MultiPoly,
  base: BaseInfo & { cornerRadius: number },
  slot: SlotInfo,
  thickness: number,
): SlotPartsResult {
  const { CrossSection, Manifold } = wasm;
  const garbage: Array<{ delete(): void }> = [];
  const keep = <T extends { delete(): void }>(o: T): T => {
    garbage.push(o);
    return o;
  };
  try {
    const W = base.x1 - base.x0;
    const xc = (base.x0 + base.x1) / 2;
    const r = Math.max(0, Math.min(base.cornerRadius, W / 2 - 0.01, base.depth / 2 - 0.01));
    let foot = keep(CrossSection.square([W - 2 * r, base.depth - 2 * r], true));
    if (r > 0) foot = keep(foot.offset(r, 'Round'));
    const block = keep(Manifold.extrude(foot, base.height));
    const [sw, st, sd] = slot.slotSize;
    const pocket = keep(
      keep(Manifold.cube([sw, st, sd + 1])).translate([(slot.x0 + slot.x1) / 2 - xc - sw / 2, -st / 2, base.height - sd]),
    );
    const baseSolid = keep(Manifold.difference(block, pocket));

    const cs = keep(new CrossSection(figure.flatMap((p) => [p.outer, ...p.holes]), 'EvenOdd'));
    const flat = keep(Manifold.extrude(cs, thickness));
    const fb = flat.boundingBox();
    // układ na stole: cokół wyśrodkowany w (0,0), figurka nad nim w osi Y z odstępem 8 mm
    const gap = 8;
    const figY = base.depth / 2 + gap - fb.min[1];
    const figPlaced = keep(flat.translate([-xc, figY, 0]));
    const total = { minY: -base.depth / 2, maxY: figY + fb.max[1] };
    const shiftY = -(total.minY + total.maxY) / 2;
    const figFinal = keep(figPlaced.translate([0, shiftY, 0]));
    const baseFinal = keep(baseSolid.translate([0, shiftY, 0]));

    // złożenie: figurka pionowo (x, -z, y), y = 0 figury na górze cokołu
    const standing = keep(keep(keep(Manifold.extrude(cs, thickness)).rotate([90, 0, 0])).translate([-xc, thickness / 2, base.height]));
    const assembled = mergeMeshes([extractSolid(baseSolid).mesh, extractSolid(standing).mesh]);

    return { figure: extractSolid(figFinal), base: extractSolid(baseFinal), assembled };
  } finally {
    for (const g of garbage) g.delete();
  }
}
