import type { BinaryMask, CutoutParams, CutoutResult2D, MeshData, MeshPart, ValidationSummary } from '../types';
import type { ManifoldToplevel } from '../mesh/manifold';
import { buildCutoutSolid, buildSlotParts, mergeMeshes, type SolidResult } from '../mesh/extrude';
import { validateMesh } from '../mesh/validate';
import { runCutout2D } from './cutout';

export interface CutoutOutput {
  result2D: CutoutResult2D;
  mesh: MeshData;
  /** Osobne obiekty (podstawka wsuwana: figurka + cokół) — eksport 3MF jako wiele obiektów. */
  parts?: MeshPart[];
  /** Podgląd złożenia (podstawka wsuwana). */
  assembled?: MeshData;
  validation: ValidationSummary;
  timings: Record<string, number>;
}

/** Cały tryb „Wycinanka”: maska → 2D → bryła → walidacja. */
export function runCutout(wasm: ManifoldToplevel, mask: BinaryMask, params: CutoutParams): CutoutOutput | null {
  const t0 = performance.now();
  const out2d = runCutout2D(mask, params);
  if (!out2d) return null;
  const t1 = performance.now();
  const r = out2d.result;
  let solid: SolidResult;
  let parts: MeshPart[] | undefined;
  let assembled: MeshData | undefined;
  let partProblems: string[] = [];
  if (r.slot && r.base) {
    const sp = buildSlotParts(wasm, r.figure, { ...r.base, cornerRadius: params.base.cornerRadius }, r.slot, params.thickness);
    parts = [
      { name: 'figurka', mesh: sp.figure.mesh, report: validateMesh(sp.figure.mesh) },
      { name: 'podstawka', mesh: sp.base.mesh, report: validateMesh(sp.base.mesh) },
    ];
    assembled = sp.assembled;
    partProblems = parts.flatMap((p) => {
      const out: string[] = [];
      if (p.report.components !== 1) out.push(`${p.name}: ${p.report.components} osobnych brył`);
      if (!p.report.closed || !p.report.manifold) out.push(`${p.name}: siatka nie jest zamknięta / manifold`);
      return out;
    });
    const status = sp.figure.status !== 'NoError' ? sp.figure.status : sp.base.status;
    solid = {
      mesh: mergeMeshes([sp.figure.mesh, sp.base.mesh]),
      status,
      genus: 0,
      volume: sp.figure.volume + sp.base.volume,
      // każda część osobno ma być jedną bryłą — liczba „logiczna” = 1, gdy obie OK
      components: sp.figure.components === 1 && sp.base.components === 1 ? 1 : sp.figure.components + sp.base.components,
    };
  } else {
    solid = buildCutoutSolid(wasm, r.figure, {
      thickness: params.thickness,
      base: r.base ? { ...r.base, cornerRadius: params.base.cornerRadius } : null,
    });
  }
  const t2 = performance.now();
  const report = validateMesh(solid.mesh);
  const t3 = performance.now();

  const errors: string[] = [];
  const warnings = [...out2d.warnings];
  if (!out2d.allConnected || solid.components !== 1) {
    errors.push(
      `Model nie jest spójny: ${solid.components} osobnych brył w 3D.` +
        (params.autoBridges ? '' : ' Włącz „Napraw wyspy”.'),
    );
  }
  if (solid.status !== 'NoError') errors.push(`manifold-3d: ${solid.status}`);
  errors.push(...partProblems);
  if (!report.closed || !report.manifold) errors.push('Siatka nie jest zamknięta / manifold.');
  if (!report.consistentOrientation) errors.push('Niespójna orientacja trójkątów.');
  if (report.volume <= 0) errors.push('Objętość ≤ 0 (odwrócone normalne).');
  if (r.thinRegions.length > 0) {
    warnings.push(
      `${r.thinRegions.length} miejsc węższych niż ${params.minFeatureWidth} mm (zaznaczone na fioletowo).`,
    );
  }
  const crossing = r.bridges.filter((b) => b.crossesMaterial).length;
  if (crossing > 0) warnings.push(`${crossing} mostków przecina inne elementy rysunku.`);

  const validation: ValidationSummary = {
    islandsDetected: r.islandIndices.length,
    islandsBridged:
      out2d.allConnected && solid.components === 1
        ? r.islandIndices.length
        : new Set(r.bridges.filter((b) => b.from >= 0).map((b) => b.from)).size,
    allConnected: out2d.allConnected && solid.components === 1,
    minDetectedWidth: out2d.minDetectedWidth,
    thinRegionCount: r.thinRegions.length,
    mesh: report,
    manifoldStatus: solid.status,
    errors,
    warnings,
  };
  return {
    result2D: r,
    mesh: solid.mesh,
    parts,
    assembled,
    validation,
    timings: { geometry2D: t1 - t0, solid3D: t2 - t1, validate: t3 - t2 },
  };
}
