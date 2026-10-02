import type { CutoutParams, ImageParams, ReliefParams } from './types';

export const DEFAULT_IMAGE_PARAMS: ImageParams = {
  maxResolution: 1000,
  threshold: 128,
  blur: 1,
  noiseArea: 12,
  closeGaps: 0,
  invert: false,
};

export const DEFAULT_CUTOUT_PARAMS: CutoutParams = {
  sizeMode: 'totalHeight',
  targetSize: 150,
  thickness: 3,
  simplify: 0.08,
  minFeatureWidth: 0.8,
  bridgeWidth: 1.0,
  autoBridges: true,
  symmetricBridges: true,
  preferVertical: true,
  bridgeEdits: [],
  thicken: 'none',
  base: {
    enabled: true,
    type: 'fused',
    clearance: 0.3,
    slotDepth: 5,
    tongueWidth: 0,
    height: 5,
    depth: 20,
    margin: 5,
    groundSnap: 2,
    embed: 1,
    cornerRadius: 2,
  },
};

export const DEFAULT_RELIEF_PARAMS: ReliefParams = {
  sizeMode: 'width',
  targetSize: 100,
  simplify: 0.06,
  minFeatureWidth: 0.8,
  thicken: 'none',
  plateShape: 'rounded',
  margin: 5,
  cornerRadius: 4,
  plateThickness: 2,
  reliefHeight: 1.2,
  engrave: false,
  frameWidth: 0,
  hangHole: 0,
};

export interface PrinterPreset {
  id: string;
  label: string;
  apply: (p: CutoutParams) => CutoutParams;
  /** Minimalna szerokość detalu dla trybów z płytką (relief). */
  minFeatureWidth: number;
}

export const PRINTER_PRESETS: PrinterPreset[] = [
  {
    id: 'bambu-a1-04',
    label: 'Bambu Lab A1 / dysza 0,4 mm',
    minFeatureWidth: 0.8,
    apply: (p) => ({
      ...p,
      minFeatureWidth: 0.8,
      bridgeWidth: 1.0,
      thickness: 3,
      base: { ...p.base, enabled: true, height: 5, depth: 20 },
    }),
  },
  {
    id: 'generic-02',
    label: 'Dysza 0,2 mm (detale)',
    minFeatureWidth: 0.4,
    apply: (p) => ({ ...p, minFeatureWidth: 0.4, bridgeWidth: 0.6 }),
  },
  {
    id: 'generic-06',
    label: 'Dysza 0,6 mm',
    minFeatureWidth: 1.2,
    apply: (p) => ({ ...p, minFeatureWidth: 1.2, bridgeWidth: 1.5 }),
  },
];
