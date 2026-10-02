import type { BinaryMask, CutoutParams, ReliefParams } from '../types';
import type { ManifoldToplevel } from '../mesh/manifold';
import { runCutout, type CutoutOutput } from './full';
import { runRelief, type ReliefOutput } from './relief';

/** Zadanie generowania — tryb + jego parametry. */
export type GenerateJob = { mode: 'cutout'; params: CutoutParams } | { mode: 'relief'; params: ReliefParams };

/** Wynik dowolnego trybu; `result2D.kind` rozróżnia tryby. */
export type ModeOutput = CutoutOutput | ReliefOutput;

export function runJob(wasm: ManifoldToplevel, mask: BinaryMask, job: GenerateJob): ModeOutput | null {
  switch (job.mode) {
    case 'cutout':
      return runCutout(wasm, mask, job.params);
    case 'relief':
      return runRelief(wasm, mask, job.params);
  }
}
