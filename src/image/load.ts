import type { RasterImage } from './process';

/** Bitmapa → RGBA, dłuższy bok przeskalowany do `maxSize` (bez powiększania). */
export function rasterize(source: ImageBitmap, maxSize: number): RasterImage {
  const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Brak kontekstu 2D canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, rgba: data };
}
