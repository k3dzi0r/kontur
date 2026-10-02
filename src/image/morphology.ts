import type { BinaryMask } from '../types';

const INF = 1e20;

/** 1D kwadratowa transformata odległości (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Kwadrat euklidesowej odległości (px²) każdego piksela do najbliższego
 * piksela o wartości `feature`. Piksele cechy mają 0.
 */
export function edtSquared(mask: BinaryMask, feature: 0 | 1 = 1): Float64Array {
  const { width: w, height: h, data } = mask;
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = data[i] === feature ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

function pad(mask: BinaryMask, p: number): BinaryMask {
  const w = mask.width + 2 * p;
  const h = mask.height + 2 * p;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < mask.height; y++) {
    data.set(mask.data.subarray(y * mask.width, (y + 1) * mask.width), (y + p) * w + p);
  }
  return { width: w, height: h, data };
}

function crop(mask: BinaryMask, p: number, width: number, height: number): BinaryMask {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const start = (y + p) * mask.width + p;
    data.set(mask.data.subarray(start, start + width), y * width);
  }
  return { width, height, data };
}

/** Dylatacja elementem kołowym o promieniu r (px). */
export function dilate(mask: BinaryMask, r: number): BinaryMask {
  if (r <= 0) return mask;
  const d2 = edtSquared(mask, 1);
  const r2 = r * r;
  const data = new Uint8Array(d2.length);
  for (let i = 0; i < d2.length; i++) data[i] = d2[i] <= r2 ? 1 : 0;
  return { width: mask.width, height: mask.height, data };
}

/** Erozja elementem kołowym o promieniu r (px). Poza obrazem = tło. */
export function erode(mask: BinaryMask, r: number): BinaryMask {
  if (r <= 0) return mask;
  const d2 = edtSquared(mask, 0);
  const r2 = r * r;
  const data = new Uint8Array(d2.length);
  for (let i = 0; i < d2.length; i++) data[i] = d2[i] > r2 ? 1 : 0;
  return { width: mask.width, height: mask.height, data };
}

/** Domknięcie (dylatacja → erozja) — łączy przerwy węższe niż ~2r. */
export function close(mask: BinaryMask, r: number): BinaryMask {
  if (r <= 0) return mask;
  const p = Math.ceil(r) + 1;
  const padded = pad(mask, p);
  return crop(erode(dilate(padded, r), r), p, mask.width, mask.height);
}

/** Otwarcie (erozja → dylatacja) — usuwa elementy węższe niż ~2r. */
export function open(mask: BinaryMask, r: number): BinaryMask {
  if (r <= 0) return mask;
  const p = Math.ceil(r) + 1;
  const padded = pad(mask, p);
  return crop(dilate(erode(padded, r), r), p, mask.width, mask.height);
}

export interface Labeling {
  labels: Int32Array;
  /** areas[label] — liczba pikseli; etykiety od 1. */
  areas: number[];
  /** Czy komponent dotyka brzegu obrazu. */
  touchesBorder: boolean[];
  count: number;
}

/**
 * Etykietowanie spójnych składowych pikseli o wartości `value`.
 * Etykieta 0 = piksel o innej wartości.
 */
export function labelComponents(mask: BinaryMask, value: 0 | 1, connectivity: 4 | 8): Labeling {
  const { width: w, height: h, data } = mask;
  const labels = new Int32Array(w * h);
  const areas: number[] = [0];
  const touchesBorder: boolean[] = [false];
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let start = 0; start < w * h; start++) {
    if (data[start] !== value || labels[start] !== 0) continue;
    count++;
    let area = 0;
    let border = false;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = count;
    while (sp > 0) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (connectivity === 4 && dx !== 0 && dy !== 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (data[j] === value && labels[j] === 0) {
            labels[j] = count;
            stack[sp++] = j;
          }
        }
      }
    }
    areas.push(area);
    touchesBorder.push(border);
  }
  return { labels, areas, touchesBorder, count };
}

/**
 * Usuwa plamki materiału mniejsze niż `minArea` px oraz wypełnia dziury
 * (tło niedotykające brzegu) mniejsze niż `minArea` px.
 */
export function removeNoise(mask: BinaryMask, minArea: number): BinaryMask {
  if (minArea <= 0) return mask;
  const data = mask.data.slice();
  const fg = labelComponents(mask, 1, 8);
  for (let i = 0; i < data.length; i++) {
    const l = fg.labels[i];
    if (l && fg.areas[l] < minArea) data[i] = 0;
  }
  const cleaned: BinaryMask = { width: mask.width, height: mask.height, data };
  const bg = labelComponents(cleaned, 0, 4);
  for (let i = 0; i < data.length; i++) {
    const l = bg.labels[i];
    if (l && !bg.touchesBorder[l] && bg.areas[l] < minArea) data[i] = 1;
  }
  return cleaned;
}

/** Bounding box pikseli materiału; null gdy maska pusta. */
export function maskBounds(mask: BinaryMask): { x0: number; y0: number; x1: number; y1: number } | null {
  const { width: w, height: h, data } = mask;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
