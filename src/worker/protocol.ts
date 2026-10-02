import type { BinaryMask, GrayImage, ImageParams, MeshPart } from '../types';
import type { ClearanceSampleOptions } from '../mesh/calibration';
import type { GenerateJob, ModeOutput } from '../pipeline';

export type WorkerRequest =
  | { type: 'setImage'; id: number; gray: GrayImage }
  | { type: 'mask'; id: number; imageParams: ImageParams }
  | { type: 'generate'; id: number; imageParams: ImageParams; job: GenerateJob }
  | { type: 'calibration'; id: number; options: ClearanceSampleOptions };

export type WorkerResponse =
  | { type: 'ack'; id: number }
  | { type: 'mask'; id: number; mask: BinaryMask; otsu: number; ms: number }
  | { type: 'generate'; id: number; output: ModeOutput | null; ms: number }
  | { type: 'calibration'; id: number; parts: MeshPart[] }
  | { type: 'error'; id: number; message: string };
