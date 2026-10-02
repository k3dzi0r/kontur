import { describe, expect, it } from 'vitest';
import { makeMask, inCircle, params } from './helpers';
import { initManifold } from '../src/mesh/manifold';
import { runCutout } from '../src/pipeline/full';

describe('obciążenie', () => {
  it('ornament z ~80 wyspami (1000 px) generuje się spójnie w rozsądnym czasie', async () => {
    const wasm = await initManifold();
    const N = 1000;
    const m = makeMask(N, N, (x, y) => {
      const r = Math.hypot(x - 500, y - 500);
      const ring = r > 430 && r < 460;
      const ang = Math.atan2(y - 500, x - 500);
      // pierścień kropek wewnątrz (wyspy)
      let dots = false;
      for (const rr of [380, 300, 220]) {
        const k = Math.round(rr / 12);
        const a = Math.round((ang / (2 * Math.PI)) * k) * ((2 * Math.PI) / k);
        if (inCircle(x, y, 500 + rr * Math.cos(a), 500 + rr * Math.sin(a), 10)) dots = true;
      }
      const star = r < 120 && Math.abs(Math.sin(ang * 5)) * 120 > r - 20;
      const stand = x > 470 && x < 530 && y > 940;
      return ring || dots || star || stand;
    });
    const t = performance.now();
    const out = runCutout(wasm, m, params())!;
    const ms = performance.now() - t;
    console.log('islands', out.validation.islandsDetected, 'ms', Math.round(ms), out.timings);
    expect(out.validation.islandsDetected).toBeGreaterThan(60);
    expect(out.validation.allConnected).toBe(true);
    expect(out.validation.mesh!.manifold).toBe(true);
    expect(out.validation.mesh!.components).toBe(1);
    expect(ms).toBeLessThan(20000);
  });
});
