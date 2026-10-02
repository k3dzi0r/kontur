import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { makeMask, inRect, inCircle, params } from './helpers';
import { initManifold } from '../src/mesh/manifold';
import { runCutout } from '../src/pipeline/full';
import { export3mf } from '../src/mesh/export3mf';

const slot = (over = {}) => params({}, { type: 'slot', clearance: 0.3, slotDepth: 5, ...over });
// postać: głowa (wyspa), tułów, dwie nogi
const person = makeMask(120, 200, (x, y) =>
  inCircle(x, y, 60, 30, 18) || inRect(x, y, 35, 55, 85, 140) || inRect(x, y, 38, 140, 52, 195) || inRect(x, y, 68, 140, 82, 195),
);

describe('podstawka wsuwana', () => {
  it('dwie osobne, zamknięte bryły; slot = język + 2·luz', async () => {
    const wasm = await initManifold();
    const out = runCutout(wasm, person, slot())!;
    expect(out.validation.errors).toEqual([]);
    expect(out.parts).toHaveLength(2);
    for (const p of out.parts!) {
      expect(p.report.components, p.name).toBe(1);
      expect(p.report.closed && p.report.manifold, p.name).toBe(true);
    }
    const s = out.result2D.slot!;
    expect(s.slotSize[0] - s.tongueSize[0]).toBeCloseTo(0.6, 6);
    expect(s.slotSize[1] - s.tongueSize[1]).toBeCloseTo(0.6, 6);
    expect(s.slotSize[2] - s.tongueSize[2]).toBeCloseTo(0.3, 6);
    // figurka leży płasko (wysokość = grubość), cokół mieści slot + dno
    const fig = out.parts![0].report.bbox;
    expect(fig.max[2] - fig.min[2]).toBeCloseTo(3, 4);
    const base = out.parts![1].report.bbox;
    expect(base.max[2] - base.min[2]).toBeGreaterThanOrEqual(5 + 0.3 + 1.2 - 1e-6);
    expect(out.assembled).toBeDefined();
  });

  it('elementy stojące obok siebie muszą zostać zmostkowane (cokół ich nie łączy)', async () => {
    const wasm = await initManifold();
    const letters = makeMask(100, 60, (x, y) => inRect(x, y, 5, 10, 25, 50) || inRect(x, y, 40, 10, 60, 50) || inRect(x, y, 75, 10, 95, 50));
    const fused = runCutout(wasm, letters, params())!;
    expect(fused.result2D.kind === 'cutout' && fused.result2D.bridges.length).toBe(0);
    const out = runCutout(wasm, letters, slot())!;
    expect(out.result2D.bridges.length).toBeGreaterThanOrEqual(2);
    expect(out.validation.allConnected).toBe(true);
    expect(out.parts![0].report.components).toBe(1);
  });

  it('3MF zawiera dwa obiekty', async () => {
    const wasm = await initManifold();
    const out = runCutout(wasm, person, slot())!;
    const zip = unzipSync(export3mf(out.parts!.map((p) => ({ name: p.name, mesh: p.mesh })), 'test'));
    const xml = strFromU8(zip['3D/3dmodel.model']);
    expect((xml.match(/<object /g) ?? []).length).toBe(2);
    expect((xml.match(/<item /g) ?? []).length).toBe(2);
  });
});
