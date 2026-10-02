import type { BinaryMask, GrayImage, ImageParams } from '../types';
import type { GenerateJob, ModeOutput } from '../pipeline';

export type WorkerRequest =
  | { type: 'setImage'; id: number; gray: GrayImage }
  | { type: 'mask'; id: number; imageParams: ImageParams }
  | { type: 'generate'; id: number; imageParams: ImageParams; job: GenerateJob };

export type WorkerResponse =
  | { type: 'ack'; id: number }
  | { type: 'mask'; id: number; mask: BinaryMask; otsu: number; ms: number }
  | { type: 'generate'; id: number; output: ModeOutput | null; ms: number }
  | { type: 'error'; id: number; message: string };
