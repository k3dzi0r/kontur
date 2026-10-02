import type { BinaryMask, GrayImage, ImageParams } from '../types';
import { gaussianBlur, thresholdImage, toGrayscale } from './threshold';
import { close, removeNoise } from './morphology';

export interface RasterImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** Skala szarości (bez rozmycia) — liczona raz po wczytaniu obrazu. */
export function rasterToGray(img: RasterImage): GrayImage {
  return toGrayscale(img.rgba, img.width, img.height);
}

/** Pełna obróbka: rozmycie → próg → domykanie przerw → usuwanie szumu. */
export function buildMask(gray: GrayImage, p: ImageParams): BinaryMask {
  const blurred = gaussianBlur(gray, p.blur);
  let mask = thresholdImage(blurred, p.threshold, p.invert);
  mask = close(mask, p.closeGaps);
  mask = removeNoise(mask, p.noiseArea);
  return mask;
}
