import type { GrayImage, ImageParams } from '../types';
import type { GenerateJob } from '../pipeline';
import type { ClearanceSampleOptions } from '../mesh/calibration';
import type { WorkerRequest, WorkerResponse } from './protocol';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

/** Klient Web Workera z pipeline'em (Promise na każde żądanie). */
export class PipelineClient {
  private worker = new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.type === 'error') p.reject(new Error(ev.data.message));
      else p.resolve(ev.data);
    };
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new Error(ev.message || 'Błąd workera'));
      this.pending.clear();
    };
  }

  private send<T extends WorkerResponse['type']>(
    req: WorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<Extract<WorkerResponse, { type: T }>> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve: resolve as (r: WorkerResponse) => void, reject });
      this.worker.postMessage(req, transfer);
    });
  }

  setImage(gray: GrayImage) {
    const copy = gray.data.slice();
    return this.send<'ack'>({ type: 'setImage', id: this.nextId++, gray: { ...gray, data: copy } }, [copy.buffer]);
  }

  mask(imageParams: ImageParams) {
    return this.send<'mask'>({ type: 'mask', id: this.nextId++, imageParams });
  }

  calibration(options: ClearanceSampleOptions) {
    return this.send<'calibration'>({ type: 'calibration', id: this.nextId++, options });
  }

  generate(imageParams: ImageParams, job: GenerateJob) {
    return this.send<'generate'>({ type: 'generate', id: this.nextId++, imageParams, job });
  }
}
