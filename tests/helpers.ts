import type { BinaryMask, CutoutParams } from '../src/types';
import { DEFAULT_CUTOUT_PARAMS } from '../src/presets';

/** Maska W×H z materiałem tam, gdzie fn(x, y) = true (współrzędne pikseli). */
export function makeMask(w: number, h: number, fn: (x: number, y: number) => boolean): BinaryMask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y) ? 1 : 0;
  return { width: w, height: h, data };
}

export const inRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x < x1 && y >= y0 && y < y1;

export const inCircle = (x: number, y: number, cx: number, cy: number, r: number) =>
  (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;

export function params(over: Partial<CutoutParams> = {}, base: Partial<CutoutParams['base']> = {}): CutoutParams {
  return {
    ...DEFAULT_CUTOUT_PARAMS,
    ...over,
    base: { ...DEFAULT_CUTOUT_PARAMS.base, ...(over.base ?? {}), ...base },
  };
}
