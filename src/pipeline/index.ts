import type { BinaryMask, CutoutParams, GrayImage, LithophaneParams, ReliefParams } from '../types';
import type { ManifoldToplevel } from '../mesh/manifold';
import { runCutout, type CutoutOutput } from './full';
import { runRelief, type ReliefOutput } from './relief';
import { runLithophane, type LithophaneOutput } from './lithophane';

/** Zadanie generowania — tryb + jego parametry. */
export type GenerateJob =
  | { mode: 'cutout'; params: CutoutParams }
  | { mode: 'relief'; params: ReliefParams }
  | { mode: 'lithophane'; params: LithophaneParams };

/** Wynik dowolnego trybu; `result2D.kind` rozróżnia tryby. */
export type ModeOutput = CutoutOutput | ReliefOutput | LithophaneOutput;

export interface JobInputs {
  /** Maska binarna (liczona leniwie — lithophane jej nie potrzebuje). */
  mask: () => BinaryMask;
  /** Skala szarości po rozmyciu. */
  gray: () => GrayImage;
}

export function runJob(wasm: ManifoldToplevel, inputs: JobInputs, job: GenerateJob): ModeOutput | null {
  switch (job.mode) {
    case 'cutout':
      return runCutout(wasm, inputs.mask(), job.params);
    case 'relief':
      return runRelief(wasm, inputs.mask(), job.params);
    case 'lithophane':
      return runLithophane(inputs.gray(), job.params);
  }
}
