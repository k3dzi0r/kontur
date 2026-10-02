/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { BinaryMask, GrayImage, ImageParams } from '../types';
import { initManifold } from '../mesh/manifold';
import { setGeometryKernel } from '../geometry/clip';
import { buildMask } from '../image/process';
import { otsuThreshold, gaussianBlur } from '../image/threshold';
import { runJob } from '../pipeline';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const ready = initManifold(wasmUrl).then((k) => {
  setGeometryKernel(k);
  return k;
});

let gray: GrayImage | null = null;
let cachedMask: { key: string; mask: BinaryMask } | null = null;

function maskFor(p: ImageParams): BinaryMask {
  if (!gray) throw new Error('Brak obrazu');
  const key = JSON.stringify([p.threshold, p.blur, p.noiseArea, p.closeGaps, p.invert]);
  if (cachedMask?.key !== key) cachedMask = { key, mask: buildMask(gray, p) };
  return cachedMask.mask;
}

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'setImage') {
      gray = req.gray;
      cachedMask = null;
      post({ type: 'ack', id: req.id });
    } else if (req.type === 'mask') {
      const t = performance.now();
      const mask = maskFor(req.imageParams);
      const otsu = otsuThreshold(gaussianBlur(gray!, req.imageParams.blur));
      const copy = mask.data.slice();
      post(
        { type: 'mask', id: req.id, mask: { ...mask, data: copy }, otsu, ms: performance.now() - t },
        [copy.buffer],
      );
    } else if (req.type === 'generate') {
      const kernel = await ready;
      const t = performance.now();
      const ip = req.imageParams;
      const output = runJob(kernel, { mask: () => maskFor(ip), gray: () => gaussianBlur(gray!, ip.blur) }, req.job);
      const transfer: Transferable[] = output ? [output.mesh.positions.buffer, output.mesh.indices.buffer] : [];
      post({ type: 'generate', id: req.id, output, ms: performance.now() - t }, transfer);
    }
  } catch (e) {
    console.error('[pipeline.worker]', e instanceof Error ? e.stack : e);
    post({ type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
};
