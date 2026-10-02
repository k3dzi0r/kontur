import type { MeshPart, Ring } from '../types';
import type { ManifoldToplevel } from './manifold';
import { slotPocket } from './extrude';
import { validateMesh } from './validate';

// Próbka kalibracji luzu dla podstawki wsuwanej: mały cokół z kilkoma slotami
// o różnym luzie + kupon języka o tej samej grubości co figurka. Drukuje się
// w kilka minut; użytkownik wybiera luz, przy którym język wchodzi pewnie.
// Sloty oznaczone liczbą wgłębień przed slotem (1 = najciaśniejszy).

export interface ClearanceSampleOptions {
  thickness: number;
  slotDepth: number;
  clearances: number[];
  tongueWidth?: number;
}

export function buildClearanceSample(wasm: ManifoldToplevel, o: ClearanceSampleOptions): MeshPart[] {
  const { CrossSection, Manifold } = wasm;
  const garbage: Array<{ delete(): void }> = [];
  const keep = <T extends { delete(): void }>(m: T): T => {
    garbage.push(m);
    return m;
  };
  try {
    const tw = o.tongueWidth ?? 12;
    const cmax = Math.max(...o.clearances);
    const gap = 6;
    const pitch = tw + 2 * cmax + gap;
    const W = o.clearances.length * pitch + gap;
    const D = Math.max(16, o.thickness + 2 * cmax + 10);
    const H = o.slotDepth + cmax + 1.2;

    let base = keep(keep(Manifold.cube([W, D, H])).translate([-W / 2, -D / 2, 0]));
    o.clearances.forEach((c, i) => {
      const cx = -W / 2 + gap + pitch * i + pitch / 2 - gap / 2;
      const pocket = keep(slotPocket(wasm, tw + 2 * c, o.thickness + 2 * c, o.slotDepth + c, H, cx));
      base = keep(Manifold.difference(base, pocket));
      // oznaczenie: i+1 wgłębień na górze, przed slotem
      for (let k = 0; k <= i; k++) {
        const dimple = keep(
          keep(Manifold.cylinder(1, 0.8, 0.8, 24)).translate([cx + (k - i / 2) * 2.4, -D / 2 + 2.5, H - 0.6]),
        );
        base = keep(Manifold.difference(base, dimple));
      }
    });

    // kupon: język (fazowane dolne narożniki) + uchwyt, leży płasko
    const d = o.slotDepth;
    const ch = Math.min(0.6, tw / 4, d / 4);
    const handleW = tw + 10;
    const handleH = 12;
    const outline: Ring = [
      [-tw / 2 + ch, 0],
      [tw / 2 - ch, 0],
      [tw / 2, ch],
      [tw / 2, d],
      [handleW / 2, d],
      [handleW / 2, d + handleH],
      [-handleW / 2, d + handleH],
      [-handleW / 2, d],
      [-tw / 2, d],
      [-tw / 2, ch],
    ];
    const coupon = keep(keep(Manifold.extrude(keep(new CrossSection([outline])), o.thickness)).translate([0, D / 2 + 6, 0]));

    const toPart = (name: string, m: InstanceType<ManifoldToplevel['Manifold']>): MeshPart => {
      const g = m.getMesh();
      const positions = new Float32Array(g.numVert * 3);
      for (let i = 0; i < g.numVert; i++) {
        for (let k = 0; k < 3; k++) positions[i * 3 + k] = g.vertProperties[i * g.numProp + k];
      }
      const mesh = { positions, indices: new Uint32Array(g.triVerts) };
      return { name, mesh, report: validateMesh(mesh) };
    };
    return [toPart('probka-cokol', base), toPart('probka-jezyk', coupon)];
  } finally {
    for (const g of garbage) g.delete();
  }
}
