import { describe, expect, it } from 'vitest';
import { makeMask, inRect, inCircle } from './helpers';
import { initManifold } from '../src/mesh/manifold';
import { runRelief } from '../src/pipeline/relief';
import { DEFAULT_RELIEF_PARAMS } from '../src/presets';
import type { ReliefParams } from '../src/types';

const p = (over: Partial<ReliefParams> = {}): ReliefParams => ({ ...DEFAULT_RELIEF_PARAMS, ...over });
// kwadrat + osobne kropki (w trybie relief nie potrzebują mostków)
const mask = makeMask(120, 120, (x, y) => inRect(x, y, 20, 20, 100, 60) || inCircle(x, y, 40, 90, 8) || inCircle(x, y, 80, 90, 8));

describe('relief', () => {
  it('płytka + wypukły wzór: jedna bryła, wymiary w mm', async () => {
    const wasm = await initManifold();
    const out = runRelief(wasm, mask, p({ plateShape: 'rect', targetSize: 80, margin: 5 }))!;
    const m = out.validation.mesh!;
    expect(out.validation.errors).toEqual([]);
    expect(m.closed && m.manifold).toBe(true);
    expect(m.components).toBe(1);
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(90, 1); // 80 + 2·5
    expect(m.bbox.min[2]).toBeCloseTo(0, 4);
    expect(m.bbox.max[2]).toBeCloseTo(2 + 1.2, 4);
  });

  it('grawer: wzór wklęsły, wysokość = grubość płytki, mniejsza objętość', async () => {
    const wasm = await initManifold();
    const flat = runRelief(wasm, mask, p({ plateShape: 'rect', reliefHeight: 0.0001 + 1, engrave: false }))!;
    const eng = runRelief(wasm, mask, p({ plateShape: 'rect', reliefHeight: 1, engrave: true }))!;
    expect(eng.validation.mesh!.bbox.max[2]).toBeCloseTo(2, 4);
    expect(eng.validation.mesh!.volume).toBeLessThan(flat.validation.mesh!.volume);
    expect(eng.validation.mesh!.manifold).toBe(true);
  });

  it('otwór do zawieszenia przechodzi na wylot (genus 1)', async () => {
    const wasm = await initManifold();
    const out = runRelief(wasm, mask, p({ hangHole: 4, margin: 8 }))!;
    expect(out.validation.mesh!.genus).toBe(1);
    expect(out.validation.mesh!.components).toBe(1);
  });

  it('kształty płytki: zaokrąglony, elipsa, obrys + ramka', async () => {
    const wasm = await initManifold();
    for (const plateShape of ['rounded', 'ellipse', 'outline'] as const) {
      const out = runRelief(wasm, mask, p({ plateShape, frameWidth: 2 }))!;
      expect(out.validation.errors, plateShape).toEqual([]);
      expect(out.validation.mesh!.components, plateShape).toBe(1);
    }
  });

  it('otwór na wzorze → ucho nad wzorem, otwór nie tnie wzoru', async () => {
    const wasm = await initManifold();
    // kropka dokładnie tam, gdzie wypada otwór do zawieszenia (góra, środek)
    const m2 = makeMask(120, 120, (x, y) => inRect(x, y, 20, 40, 100, 100) || inCircle(x, y, 60, 22, 9));
    const out = runRelief(wasm, m2, p({ hangHole: 6, frameWidth: 3, margin: 3 }))!;
    const rep = out.validation.mesh!;
    expect(out.validation.warnings.some((w) => w.includes('dodano ucho'))).toBe(true);
    expect(out.validation.warnings.some((w) => w.includes('nachodzi na wzór'))).toBe(false);
    // płytka wyższa niż wzór + 2 marginesy (ucho)
    expect(out.result2D.plateHeight).toBeGreaterThan(out.result2D.figureHeight + 2 * 3 + 3);
    expect(rep.closed && rep.manifold && rep.consistentOrientation).toBe(true);
    expect(rep.components).toBe(1);
    expect(rep.genus).toBe(1);
  });
});
