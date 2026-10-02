import type { BinaryMask, Pt, Ring } from '../types';
import { ringArea } from './polygon';

// Marching squares na siatce środków pikseli. Maska jest otoczona ramką tła,
// więc każdy kontur jest zamknięty. Przypadki siodłowe rozstrzygamy jako
// ROZDZIELONE — piksele stykające się tylko narożnikiem nie tworzą połączenia
// o zerowej szerokości (które dałoby nie-manifoldowy mesh).

// Krawędzie komórki: 0=góra, 1=prawo, 2=dół, 3=lewo. Narożniki: 0=tl,1=tr,2=br,3=bl.
const EDGE_MID: Pt[] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];
const CORNER: Pt[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Dla każdego z 16 przypadków: lista [krawędźA, krawędźB, narożnik materiału]. */
function buildTable(): Array<Array<[number, number, number]>> {
  const table: Array<Array<[number, number, number]>> = [];
  for (let c = 0; c < 16; c++) {
    const v = [(c >> 3) & 1, (c >> 2) & 1, (c >> 1) & 1, c & 1]; // tl,tr,br,bl
    const segs: Array<[number, number, number]> = [];
    if (c === 0b1010) {
      // tl i br materiał — rozdzielone
      segs.push([3, 0, 0], [1, 2, 2]);
    } else if (c === 0b0101) {
      segs.push([0, 1, 1], [2, 3, 3]);
    } else if (c !== 0 && c !== 15) {
      const edges: number[] = [];
      for (let e = 0; e < 4; e++) if (v[e] !== v[(e + 1) % 4]) edges.push(e);
      // narożnik odniesienia: środek ciężkości narożników materiału (kodujemy jako -1)
      segs.push([edges[0], edges[1], -1]);
    }
    table.push(segs);
  }
  return table;
}
const TABLE = buildTable();

/**
 * Śledzi wszystkie kontury maski. Współrzędne w pikselach obrazu
 * (x w prawo, y w dół; piksel (i,j) zajmuje [i,i+1]×[j,j+1]).
 * Zwraca pierścienie zorientowane tak, że zewnętrzne granice mają pole > 0
 * w układzie z osią Y w GÓRĘ (po odbiciu y → -y), a otwory < 0.
 */
export function traceContours(mask: BinaryMask): Ring[] {
  const { width: w, height: h, data } = mask;
  const val = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : data[j * w + i]);
  const stride = 2 * w + 8;
  const keyOf = (x: number, y: number) => (Math.round(2 * y) + 4) * stride + (Math.round(2 * x) + 4);

  const ax: number[] = [];
  const ay: number[] = [];
  const bx: number[] = [];
  const by: number[] = [];
  const next = new Map<number, number>();

  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const tl = val(i, j);
      const tr = val(i + 1, j);
      const br = val(i + 1, j + 1);
      const bl = val(i, j + 1);
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;
      const vals = [tl, tr, br, bl];
      for (const [ea, eb, corner] of TABLE[c]) {
        // punkty w układzie środków pikseli: środek piksela (i,j) = (i+0.5, j+0.5)
        let pa: Pt = [i + 0.5 + EDGE_MID[ea][0], j + 0.5 + EDGE_MID[ea][1]];
        let pb: Pt = [i + 0.5 + EDGE_MID[eb][0], j + 0.5 + EDGE_MID[eb][1]];
        let ref: Pt;
        if (corner >= 0) {
          ref = [i + 0.5 + CORNER[corner][0], j + 0.5 + CORNER[corner][1]];
        } else {
          let sx = 0;
          let sy = 0;
          let n = 0;
          for (let k = 0; k < 4; k++) {
            if (vals[k]) {
              sx += CORNER[k][0];
              sy += CORNER[k][1];
              n++;
            }
          }
          ref = [i + 0.5 + sx / n, j + 0.5 + sy / n];
        }
        // materiał ma leżeć po stronie dodatniego iloczynu wektorowego (w układzie y-dół)
        const cross = (pb[0] - pa[0]) * (ref[1] - pa[1]) - (pb[1] - pa[1]) * (ref[0] - pa[0]);
        if (cross < 0) [pa, pb] = [pb, pa];
        const idx = ax.length;
        ax.push(pa[0]);
        ay.push(pa[1]);
        bx.push(pb[0]);
        by.push(pb[1]);
        next.set(keyOf(pa[0], pa[1]), idx);
      }
    }
  }

  const used = new Uint8Array(ax.length);
  const rings: Ring[] = [];
  for (let s = 0; s < ax.length; s++) {
    if (used[s]) continue;
    const ring: Ring = [];
    let cur = s;
    while (cur !== undefined && !used[cur]) {
      used[cur] = 1;
      ring.push([ax[cur], ay[cur]]);
      cur = next.get(keyOf(bx[cur], by[cur]))!;
    }
    if (ring.length >= 3) rings.push(removeCollinear(ring));
  }

  // Orientacja: materiał po prawej w układzie y-dół ⇔ ... ustalamy empirycznie
  // na największym pierścieniu (zawsze zewnętrzny) i normalizujemy wszystkie.
  if (rings.length > 0) {
    let largest = 0;
    let largestAbs = 0;
    for (let k = 0; k < rings.length; k++) {
      const a = Math.abs(ringArea(rings[k]));
      if (a > largestAbs) {
        largestAbs = a;
        largest = k;
      }
    }
    // pole liczone w y-dół; po odbiciu osi Y znak się odwraca
    const outerSignYDown = Math.sign(ringArea(rings[largest]));
    if (outerSignYDown > 0) for (const r of rings) r.reverse();
  }
  return rings;
}

/** Usuwa punkty współliniowe (schodki marching squares zostają, proste odcinki się skracają). */
export function removeCollinear(r: Ring): Ring {
  if (r.length < 4) return r;
  const out: Ring = [];
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const p = r[(i + n - 1) % n];
    const c = r[i];
    const q = r[(i + 1) % n];
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (Math.abs(cross) > 1e-9) out.push(c);
  }
  return out.length >= 3 ? out : r;
}

export interface PxToMm {
  /** mm na piksel */
  scale: number;
  /** x_mm = (x_px - ox) * scale */
  ox: number;
  /** y_mm = (oy - y_px) * scale */
  oy: number;
}

export function ringPxToMm(r: Ring, t: PxToMm): Ring {
  return r.map(([x, y]) => [(x - t.ox) * t.scale, (t.oy - y) * t.scale]);
}

export function mmToPx(p: Pt, t: PxToMm): Pt {
  return [p[0] / t.scale + t.ox, t.oy - p[1] / t.scale];
}
