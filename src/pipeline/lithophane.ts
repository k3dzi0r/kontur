import type { GrayImage, LithophaneParams, LithophaneResult2D, MeshData, ValidationSummary } from '../types';
import { validateMesh } from '../mesh/validate';

// Tryb „Lithophane”: grubość płytki zależy od jasności piksela — pod światło
// cienkie miejsca są jasne, grube ciemne. Siatkę budujemy bezpośrednio:
// powierzchnia z mapy wysokości + ściany boczne + płaskie dno (wachlarz ze
// środka — bez zdegenerowanych trójkątów na współliniowych krawędziach).
// Taka konstrukcja jest zamknięta i manifold z definicji (sprawdza validateMesh).

/** Limit próbek siatki — powyżej plik STL robi się niepraktycznie duży. */
export const MAX_SAMPLES = 1_500_000;

function sampleBilinear(g: GrayImage, u: number, v: number): number {
  const x = Math.min(g.width - 1, Math.max(0, u));
  const y = Math.min(g.height - 1, Math.max(0, v));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const d = g.data;
  const w = g.width;
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
  const bot = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

export function thicknessGrid(gray: GrayImage, p: LithophaneParams, warnings: string[] = []): LithophaneResult2D {
  const aspect = gray.height / gray.width;
  const imgW = p.sizeMode === 'width' ? p.targetSize : p.targetSize / aspect;
  const imgH = imgW * aspect;
  const f = Math.max(0, p.frameWidth);
  const W = imgW + 2 * f;
  const H = imgH + 2 * f;
  let res = Math.max(0.05, p.resolution);
  let nx = Math.round(W / res) + 1;
  let ny = Math.round(H / res) + 1;
  if (nx * ny > MAX_SAMPLES) {
    res = Math.sqrt((W * H) / MAX_SAMPLES);
    nx = Math.round(W / res) + 1;
    ny = Math.round(H / res) + 1;
    warnings.push(`Rozdzielczość zmniejszona do ${res.toFixed(2)} mm (limit ${MAX_SAMPLES.toLocaleString('pl-PL')} próbek).`);
  }
  const dx = W / (nx - 1);
  const dy = H / (ny - 1);
  const lo = Math.min(p.minThickness, p.maxThickness);
  const hi = Math.max(p.minThickness, p.maxThickness);
  const thickness = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = j * dy; // od góry
    for (let i = 0; i < nx; i++) {
      const x = i * dx;
      let t: number;
      if (x < f - 1e-9 || x > W - f + 1e-9 || y < f - 1e-9 || y > H - f + 1e-9) {
        t = hi; // ramka
      } else {
        const u = ((x - f) / imgW) * (gray.width - 1);
        const v = ((y - f) / imgH) * (gray.height - 1);
        const L = Math.min(1, Math.max(0, sampleBilinear(gray, u, v) / 255));
        const dark = p.invert ? L : 1 - L;
        t = lo + Math.pow(dark, Math.max(0.1, p.gamma)) * (hi - lo);
      }
      thickness[j * nx + i] = t;
    }
  }
  return { kind: 'lithophane', thickness, nx, ny, width: W, height: H, minThickness: lo, maxThickness: hi };
}

/** Siatka zamknięta: góra = mapa grubości, ściany, dno (wachlarz ze środka). Środek XY w (0,0), dno z = 0. */
export function lithophaneMesh(g: LithophaneResult2D): MeshData {
  const { nx, ny, width: W, height: H, thickness } = g;
  const dx = W / (nx - 1);
  const dy = H / (ny - 1);
  const loop: number[] = [];
  for (let i = 0; i < nx; i++) loop.push((ny - 1) * nx + i); // dolny wiersz (y min), x rośnie
  for (let j = ny - 2; j >= 0; j--) loop.push(j * nx + nx - 1); // prawa kolumna w górę
  for (let i = nx - 2; i >= 0; i--) loop.push(i); // górny wiersz, x maleje
  for (let j = 1; j < ny - 1; j++) loop.push(j * nx); // lewa kolumna w dół
  const nTop = nx * ny;
  const nB = loop.length;
  const positions = new Float32Array((nTop + nB + 1) * 3);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      positions[k] = i * dx - W / 2;
      positions[k + 1] = H / 2 - j * dy;
      positions[k + 2] = thickness[j * nx + i];
    }
  }
  for (let b = 0; b < nB; b++) {
    const k = (nTop + b) * 3;
    const s = loop[b] * 3;
    positions[k] = positions[s];
    positions[k + 1] = positions[s + 1];
    positions[k + 2] = 0;
  }
  const center = nTop + nB; // (0,0,0) — Float32Array już wyzerowana

  const nTri = 2 * (nx - 1) * (ny - 1) + 2 * nB + nB;
  const indices = new Uint32Array(nTri * 3);
  let o = 0;
  const tri = (a: number, b: number, c: number) => {
    indices[o++] = a;
    indices[o++] = b;
    indices[o++] = c;
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i; // lewy-górny (większe y)
      const b = a + 1;
      const c = a + nx + 1;
      const d = a + nx;
      tri(d, c, b);
      tri(d, b, a);
    }
  }
  for (let k = 0; k < nB; k++) {
    const p = loop[k];
    const q = loop[(k + 1) % nB];
    const pb = nTop + k;
    const qb = nTop + ((k + 1) % nB);
    tri(pb, qb, q);
    tri(pb, q, p);
    tri(center, qb, pb);
  }
  return { positions, indices };
}

export interface LithophaneOutput {
  result2D: LithophaneResult2D;
  mesh: MeshData;
  validation: ValidationSummary;
  timings: Record<string, number>;
}

export function runLithophane(gray: GrayImage, p: LithophaneParams): LithophaneOutput {
  const warnings: string[] = [];
  const t0 = performance.now();
  const grid = thicknessGrid(gray, p, warnings);
  const t1 = performance.now();
  const mesh = lithophaneMesh(grid);
  const t2 = performance.now();
  const report = validateMesh(mesh);
  const t3 = performance.now();
  const errors: string[] = [];
  if (!report.closed || !report.manifold) errors.push('Siatka nie jest zamknięta / manifold.');
  if (report.components !== 1) errors.push(`Model ma ${report.components} osobnych brył.`);
  if (report.volume <= 0) errors.push('Objętość ≤ 0 (odwrócone normalne).');
  if (grid.minThickness < 0.6) warnings.push('Minimalna grubość < 0,6 mm — najjaśniejsze miejsca mogą być dziurawe.');
  if (report.triangles > 1_000_000) warnings.push('Ponad milion trójkątów — rozważ większy odstęp próbek.');
  return {
    result2D: grid,
    mesh,
    validation: {
      islandsDetected: 0,
      islandsBridged: 0,
      allConnected: report.components === 1,
      minDetectedWidth: null,
      thinRegionCount: 0,
      mesh: report,
      manifoldStatus: 'n/d (siatka budowana bezpośrednio, sprawdzona przez validateMesh)',
      errors,
      warnings,
    },
    timings: { geometry2D: t1 - t0, solid3D: t2 - t1, validate: t3 - t2 },
  };
}
