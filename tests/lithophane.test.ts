import { describe, expect, it } from 'vitest';
import { runLithophane, thicknessGrid, lithophaneMesh } from '../src/pipeline/lithophane';
import { DEFAULT_LITHOPHANE_PARAMS } from '../src/presets';
import type { GrayImage } from '../src/types';

// gradient poziomy: lewo czarne, prawo białe
function gradient(w: number, h: number): GrayImage {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = (x / (w - 1)) * 255;
  return { width: w, height: h, data };
}

describe('lithophane', () => {
  it('ciemne = grube, jasne = cienkie; ramka ma maks. grubość', () => {
    const g = thicknessGrid(gradient(50, 40), { ...DEFAULT_LITHOPHANE_PARAMS, frameWidth: 3, targetSize: 50, resolution: 0.5 });
    const row = Math.floor(g.ny / 2);
    const left = g.thickness[row * g.nx + Math.round(3 / 0.5) + 1];
    const right = g.thickness[row * g.nx + g.nx - Math.round(3 / 0.5) - 2];
    expect(left).toBeGreaterThan(2.8);
    expect(right).toBeLessThan(1.0);
    expect(g.thickness[0]).toBeCloseTo(3, 6);
    expect(g.width).toBeCloseTo(56, 6);
  });

  it('siatka zamknięta, manifold, jedna bryła, wymiary w mm', () => {
    const out = runLithophane(gradient(80, 60), { ...DEFAULT_LITHOPHANE_PARAMS, targetSize: 80, resolution: 0.5 });
    const m = out.validation.mesh!;
    expect(out.validation.errors).toEqual([]);
    expect(m.closed && m.manifold && m.consistentOrientation).toBe(true);
    expect(m.components).toBe(1);
    expect(m.genus).toBe(0);
    expect(m.degenerateTriangles).toBe(0);
    expect(m.bbox.min[2]).toBeCloseTo(0, 6);
    expect(m.bbox.max[2]).toBeCloseTo(3, 4);
    expect(m.bbox.max[0] - m.bbox.min[0]).toBeCloseTo(86, 4);
    expect(m.volume).toBeGreaterThan(0);
  });

  it('limit próbek zmniejsza rozdzielczość z ostrzeżeniem', () => {
    const warnings: string[] = [];
    const g = thicknessGrid(gradient(20, 20), { ...DEFAULT_LITHOPHANE_PARAMS, targetSize: 240, resolution: 0.05 }, warnings);
    expect(g.nx * g.ny).toBeLessThanOrEqual(1_500_000 * 1.01);
    expect(warnings.length).toBe(1);
    expect(lithophaneMesh(g).indices.length % 3).toBe(0);
  });
});

describe('wydajność walidacji', () => {
  it('~900 tys. trójkątów waliduje się szybko', () => {
    const data = new Float32Array(300 * 300).map((_, i) => (i * 37) % 255);
    const g = thicknessGrid({ width: 300, height: 300, data }, { ...DEFAULT_LITHOPHANE_PARAMS, targetSize: 150, resolution: 0.22 });
    const mesh = lithophaneMesh(g);
    const t = performance.now();
    const out = runLithophane({ width: 300, height: 300, data }, { ...DEFAULT_LITHOPHANE_PARAMS, targetSize: 150, resolution: 0.22 });
    const ms = performance.now() - t;
    expect(mesh.indices.length / 3).toBeGreaterThan(800_000);
    expect(out.validation.mesh!.manifold).toBe(true);
    expect(ms).toBeLessThan(5000);
  });
});
