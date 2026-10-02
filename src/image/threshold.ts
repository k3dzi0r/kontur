import type { BinaryMask, GrayImage } from '../types';

/**
 * RGBA → skala szarości (luminancja Rec. 709). Przezroczystość komponowana
 * na białym tle — nie zakładamy przezroczystego tła, ale je obsługujemy.
 */
export function toGrayscale(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const n = width * height;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    data[i] = lum * a + 255 * (1 - a);
  }
  return { width, height, data };
}

/** Rozmycie gaussowskie (separowalne). sigma ≈ radius / 2. */
export function gaussianBlur(img: GrayImage, radius: number): GrayImage {
  if (radius <= 0) return img;
  const { width: w, height: h } = img;
  const r = Math.max(1, Math.ceil(radius));
  const sigma = Math.max(0.5, radius / 2);
  const kernel = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  // poziomo (krawędzie: clamp)
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        acc += img.data[row + xx] * kernel[k + r];
      }
      tmp[row + x] = acc;
    }
  }
  // pionowo
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[yy * w + x] * kernel[k + r];
      }
      out[y * w + x] = acc;
    }
  }
  return { width: w, height: h, data: out };
}

/** Próg Otsu — automatyczna sugestia progu binaryzacji. */
export function otsuThreshold(img: GrayImage): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < img.data.length; i++) {
    hist[Math.min(255, Math.max(0, Math.round(img.data[i])))]++;
  }
  const total = img.data.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT + 0.5;
}

/** Binaryzacja: ciemniejsze niż próg = materiał (1). `invert` odwraca. */
export function thresholdImage(img: GrayImage, threshold: number, invert = false): BinaryMask {
  const data = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i++) {
    const dark = img.data[i] < threshold;
    data[i] = dark !== invert ? 1 : 0;
  }
  return { width: img.width, height: img.height, data };
}
