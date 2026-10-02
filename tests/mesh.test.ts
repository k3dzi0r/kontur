import { beforeAll, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { makeMask, inRect, inCircle, params } from './helpers';
import { initManifold, type ManifoldToplevel } from '../src/mesh/manifold';
import { runCutout } from '../src/pipeline/full';
import { exportStl, parseStl } from '../src/mesh/exportStl';
import { export3mf } from '../src/mesh/export3mf';
import { validateMesh } from '../src/mesh/validate';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await initManifold();
});

const face = makeMask(160, 200, (x, y) => {
  const head = inCircle(x, y, 80, 80, 70) && !inCircle(x, y, 80, 80, 60);
  const eyes = inCircle(x, y, 55, 65, 7) || inCircle(x, y, 105, 65, 7);
  const mouth = inRect(x, y, 55, 105, 105, 112);
  const neck = inRect(x, y, 70, 145, 90, 200);
  return head || eyes || mouth || neck;
});

describe('mesh 3D', () => {
  it('6. eksportowany mesh jest zamknięty / manifold i spójny', () => {
    const out = runCutout(wasm, face, params())!;
    expect(out.validation.islandsDetected).toBe(3);
    expect(out.validation.allConnected).toBe(true);
    expect(out.validation.manifoldStatus).toBe('NoError');
    const rep = out.validation.mesh!;
    expect(rep.closed).toBe(true);
    expect(rep.manifold).toBe(true);
    expect(rep.consistentOrientation).toBe(true);
    expect(rep.components).toBe(1);
    expect(rep.volume).toBeGreaterThan(0);
    // wymiary: wysokość całości 150 mm, grubość płyty 3 mm, głębokość cokołu 20 mm
    expect(rep.bbox.min[2]).toBeCloseTo(0, 3);
    expect(rep.bbox.max[2]).toBeCloseTo(150, 0);
    expect(rep.bbox.max[1] - rep.bbox.min[1]).toBeCloseTo(20, 3);
    expect(out.validation.errors).toEqual([]);
  });

  it('STL round-trip zachowuje zamkniętość (po zespawaniu wierzchołków)', () => {
    const out = runCutout(wasm, face, params())!;
    const stl = exportStl(out.mesh);
    expect(stl.byteLength).toBe(84 + 50 * (out.mesh.indices.length / 3));
    const rep = validateMesh(parseStl(stl), 1e-3);
    expect(rep.closed).toBe(true);
    expect(rep.manifold).toBe(true);
    expect(rep.components).toBe(1);
  });

  it('3MF zawiera model w milimetrach', () => {
    const out = runCutout(wasm, face, params())!;
    const zip = unzipSync(export3mf(out.mesh, 'test'));
    expect(Object.keys(zip)).toContain('3D/3dmodel.model');
    expect(Object.keys(zip)).toContain('[Content_Types].xml');
    const xml = strFromU8(zip['3D/3dmodel.model']);
    expect(xml).toContain('unit="millimeter"');
    expect((xml.match(/<triangle /g) ?? []).length).toBe(out.mesh.indices.length / 3);
  });

  it('otwór przelotowy daje genus 1 (bez cokołu)', () => {
    const m = makeMask(80, 80, (x, y) => inRect(x, y, 10, 10, 70, 70) && !inRect(x, y, 30, 30, 50, 50));
    const out = runCutout(wasm, m, params({}, { enabled: false }))!;
    expect(out.validation.mesh!.genus).toBe(1);
    expect(out.validation.mesh!.components).toBe(1);
  });

  it('bez mostków wyspa daje błąd walidacji', () => {
    const m = makeMask(100, 100, (x, y) => inRect(x, y, 10, 50, 90, 90) || inCircle(x, y, 50, 25, 6));
    const out = runCutout(wasm, m, params({ autoBridges: false }))!;
    expect(out.validation.allConnected).toBe(false);
    expect(out.validation.errors.length).toBeGreaterThan(0);
  });
});
