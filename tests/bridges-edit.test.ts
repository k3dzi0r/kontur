import { describe, expect, it } from 'vitest';
import { makeMask, inRect, inCircle, params } from './helpers';
import { runCutout2D } from '../src/pipeline/cutout';
import { isBlocked } from '../src/geometry/bridges';

// rama u dołu + dwie symetryczne kropki + kropka na osi
const sym = makeMask(200, 160, (x, y) =>
  inRect(x, y, 20, 120, 180, 150) || inCircle(x, y, 60, 60, 8) || inCircle(x, y, 140, 60, 8) || inCircle(x, y, 100, 40, 6),
);
// prostokąt + kropka nad nim
const dot = makeMask(100, 100, (x, y) => inRect(x, y, 10, 50, 90, 90) || inCircle(x, y, 50, 25, 6));

describe('mostki: symetria', () => {
  it('mostek prawej wyspy jest lustrzanym odbiciem lewej', () => {
    const out = runCutout2D(sym, params({ targetSize: 80 }))!;
    const r = out.result;
    expect(out.allConnected).toBe(true);
    expect(r.symmetryAxis).not.toBeNull();
    const mirrored = r.bridges.filter((b) => b.mirrored);
    expect(mirrored).toHaveLength(1);
    const m = mirrored[0];
    const axis = r.symmetryAxis!;
    const twin = r.bridges.find(
      (b) => !b.mirrored && Math.abs(2 * axis - b.a[0] - m.a[0]) < 1e-6 && Math.abs(b.a[1] - m.a[1]) < 1e-6,
    );
    expect(twin).toBeDefined();
  });

  it('bez symetrii — mostki planowane niezależnie', () => {
    const out = runCutout2D(sym, params({ targetSize: 80, symmetricBridges: false }))!;
    expect(out.result.symmetryAxis).toBeNull();
    expect(out.result.bridges.some((b) => b.mirrored)).toBe(false);
    expect(out.allConnected).toBe(true);
  });
});

describe('mostki: edycja ręczna', () => {
  it('strefa zablokowana wymusza inną trasę', () => {
    const first = runCutout2D(dot, params({ targetSize: 60 }, { enabled: false }))!;
    const b0 = first.result.bridges[0];
    const W = first.result.figureWidth;
    const H = first.result.figureHeight;
    const mid: [number, number] = [(b0.a[0] + b0.b[0]) / 2, (b0.a[1] + b0.b[1]) / 2];
    const second = runCutout2D(
      dot,
      params({ targetSize: 60, bridgeEdits: [{ kind: 'block', p: [mid[0] / W, mid[1] / H], r: 2 / H }] }, { enabled: false }),
    )!;
    expect(second.allConnected).toBe(true);
    const auto = second.result.bridges.filter((b) => !b.manual);
    expect(auto.length).toBeGreaterThan(0);
    for (const b of auto) expect(isBlocked(b.a, b.b, second.result.blockedZones)).toBe(false);
  });

  it('ręczny mostek łączy wyspę — bez mostków automatycznych', () => {
    const probe = runCutout2D(dot, params({ targetSize: 60 }, { enabled: false }))!;
    const W = probe.result.figureWidth;
    const H = probe.result.figureHeight;
    const island = probe.result.components[probe.result.islandIndices[0]];
    const cx = island.outer.reduce((s, p) => s + p[0], 0) / island.outer.length;
    const cy = island.outer.reduce((s, p) => s + p[1], 0) / island.outer.length;
    // z kropki ukośnie w dół do prostokąta
    const out = runCutout2D(
      dot,
      params({ targetSize: 60, bridgeEdits: [{ kind: 'manual', a: [cx / W, cy / H], b: [(cx + 15) / W, 20 / H] }] }, { enabled: false }),
    )!;
    expect(out.allConnected).toBe(true);
    expect(out.result.islandIndices).toHaveLength(0);
    expect(out.result.bridges.every((b) => b.manual)).toBe(true);
  });
});
