import { create } from 'zustand';
import type { BinaryMask, BridgeEdit, CutoutParams, ImageParams, LithophaneParams, ModeId, ReliefParams } from '../types';
import type { GenerateJob, ModeOutput } from '../pipeline';
import {
  DEFAULT_CUTOUT_PARAMS,
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_LITHOPHANE_PARAMS,
  DEFAULT_RELIEF_PARAMS,
  PRINTER_PRESETS,
} from '../presets';
import { PipelineClient } from '../worker/client';
import { rasterize } from '../image/load';
import { rasterToGray } from '../image/process';
import { exportStl } from '../mesh/exportStl';
import { export3mf } from '../mesh/export3mf';

export type Status = 'idle' | 'loading' | 'masking' | 'generating' | 'ready' | 'error';

interface SourceImage {
  name: string;
  url: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

interface State {
  mode: ModeId;
  source: SourceImage | null;
  analysisSize: { width: number; height: number } | null;
  imageParams: ImageParams;
  cutoutParams: CutoutParams;
  reliefParams: ReliefParams;
  lithophaneParams: LithophaneParams;
  presetId: string;
  mask: BinaryMask | null;
  otsu: number | null;
  output: ModeOutput | null;
  /** Parametry zmieniły się od ostatniego „Generuj”. */
  stale: boolean;
  status: Status;
  error: string | null;
  lastGenerateMs: number | null;

  loadFile: (file: File) => Promise<void>;
  setImageParams: (p: Partial<ImageParams>) => void;
  setCutoutParams: (p: Partial<CutoutParams>) => void;
  setBaseParams: (p: Partial<CutoutParams['base']>) => void;
  setReliefParams: (p: Partial<ReliefParams>) => void;
  setLithophaneParams: (p: Partial<LithophaneParams>) => void;
  setMode: (mode: ModeId) => void;
  applyPreset: (id: string) => void;
  generate: () => Promise<void>;
  fixIslands: () => Promise<void>;
  addBridgeEdit: (e: BridgeEdit) => Promise<void>;
  undoBridgeEdit: () => Promise<void>;
  removeBridgeEdit: (index: number) => Promise<void>;
  clearBridgeEdits: () => Promise<void>;
  exportFile: (format: 'stl' | '3mf') => void;
  exportClearanceSample: () => Promise<void>;
}

const client = new PipelineClient();
let maskTimer: ReturnType<typeof setTimeout> | null = null;
let maskSeq = 0;

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'wycinanka';
}

function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const useStore = create<State>((set, get) => {
  /** Przelicza maskę (z opóźnieniem — suwaki aktualizują podgląd na żywo). */
  const scheduleMask = (delay = 60) => {
    if (maskTimer) clearTimeout(maskTimer);
    maskTimer = setTimeout(async () => {
      if (!get().source) return;
      const seq = ++maskSeq;
      set({ status: 'masking' });
      try {
        const r = await client.mask(get().imageParams);
        if (seq !== maskSeq) return;
        set({ mask: r.mask, otsu: r.otsu, status: get().output ? 'ready' : 'idle' });
      } catch (e) {
        set({ status: 'error', error: (e as Error).message });
      }
    }, delay);
  };

  const sendRaster = async () => {
    const src = get().source;
    if (!src) return;
    const raster = rasterize(src.bitmap, get().imageParams.maxResolution);
    await client.setImage(rasterToGray(raster));
    set({ analysisSize: { width: raster.width, height: raster.height } });
  };

  return {
    mode: 'cutout',
    source: null,
    analysisSize: null,
    imageParams: DEFAULT_IMAGE_PARAMS,
    cutoutParams: DEFAULT_CUTOUT_PARAMS,
    reliefParams: DEFAULT_RELIEF_PARAMS,
    lithophaneParams: DEFAULT_LITHOPHANE_PARAMS,
    presetId: PRINTER_PRESETS[0].id,
    mask: null,
    otsu: null,
    output: null,
    stale: false,
    status: 'idle',
    error: null,
    lastGenerateMs: null,

    async loadFile(file) {
      if (!/^image\/(png|jpe?g)$/.test(file.type) && !/\.(png|jpe?g)$/i.test(file.name)) {
        set({ error: 'Obsługiwane formaty: PNG, JPG.', status: 'error' });
        return;
      }
      set({ status: 'loading', error: null });
      try {
        const bitmap = await createImageBitmap(file);
        const prev = get().source;
        if (prev) URL.revokeObjectURL(prev.url);
        set({
          source: {
            name: file.name,
            url: URL.createObjectURL(file),
            bitmap,
            width: bitmap.width,
            height: bitmap.height,
          },
          output: null,
          mask: null,
          stale: false,
          cutoutParams: { ...get().cutoutParams, bridgeEdits: [] },
        });
        await sendRaster();
        // pierwsza maska: próg Otsu jako punkt startowy
        const r = await client.mask(get().imageParams);
        set({ imageParams: { ...get().imageParams, threshold: Math.round(r.otsu) } });
        scheduleMask(0);
      } catch (e) {
        set({ status: 'error', error: `Nie udało się wczytać obrazu: ${(e as Error).message}` });
      }
    },

    setImageParams(p) {
      const resChanged = p.maxResolution !== undefined && p.maxResolution !== get().imageParams.maxResolution;
      set({ imageParams: { ...get().imageParams, ...p }, stale: !!get().output });
      if (resChanged) {
        sendRaster().then(() => scheduleMask(0));
      } else {
        scheduleMask();
      }
    },

    setCutoutParams(p) {
      set({ cutoutParams: { ...get().cutoutParams, ...p }, stale: !!get().output });
    },

    setBaseParams(p) {
      const c = get().cutoutParams;
      set({ cutoutParams: { ...c, base: { ...c.base, ...p } }, stale: !!get().output });
    },

    setReliefParams(p) {
      set({ reliefParams: { ...get().reliefParams, ...p }, stale: !!get().output });
    },

    setLithophaneParams(p) {
      set({ lithophaneParams: { ...get().lithophaneParams, ...p }, stale: !!get().output });
    },

    setMode(mode) {
      if (mode === get().mode) return;
      set({ mode, output: null, stale: false, error: null });
      if (get().source) get().generate();
    },

    applyPreset(id) {
      const preset = PRINTER_PRESETS.find((x) => x.id === id);
      if (!preset) return;
      set({
        presetId: id,
        cutoutParams: preset.apply(get().cutoutParams),
        reliefParams: { ...get().reliefParams, minFeatureWidth: preset.minFeatureWidth },
        stale: !!get().output,
      });
    },

    async generate() {
      if (!get().source) return;
      set({ status: 'generating', error: null });
      try {
        const { mode, cutoutParams, reliefParams, lithophaneParams } = get();
        // „Podstawka wsuwana” = Wycinanka z cokołem typu slot (wspólne parametry i edycje mostków)
        const baseType = mode === 'slotBase' ? 'slot' : 'fused';
        const job: GenerateJob =
          mode === 'relief'
            ? { mode: 'relief', params: reliefParams }
            : mode === 'lithophane'
              ? { mode: 'lithophane', params: lithophaneParams }
              : {
                mode: 'cutout',
                params: {
                  ...cutoutParams,
                  base: { ...cutoutParams.base, type: baseType, enabled: baseType === 'slot' ? true : cutoutParams.base.enabled },
                },
              };
        const r = await client.generate(get().imageParams, job);
        if (get().mode !== mode) return; // tryb zmieniony w trakcie
        if (!r.output) {
          set({ status: 'error', error: 'Maska jest pusta — zmień próg lub odwróć kolory.', output: null });
          return;
        }
        set({ output: r.output, status: 'ready', stale: false, lastGenerateMs: r.ms });
      } catch (e) {
        set({ status: 'error', error: (e as Error).message });
      }
    },

    async fixIslands() {
      set({ cutoutParams: { ...get().cutoutParams, autoBridges: true } });
      await get().generate();
    },

    async addBridgeEdit(e) {
      const c = get().cutoutParams;
      set({ cutoutParams: { ...c, autoBridges: true, bridgeEdits: [...c.bridgeEdits, e] } });
      await get().generate();
    },

    async undoBridgeEdit() {
      const c = get().cutoutParams;
      if (c.bridgeEdits.length === 0) return;
      set({ cutoutParams: { ...c, bridgeEdits: c.bridgeEdits.slice(0, -1) } });
      await get().generate();
    },

    async removeBridgeEdit(index) {
      const c = get().cutoutParams;
      set({ cutoutParams: { ...c, bridgeEdits: c.bridgeEdits.filter((_, i) => i !== index) } });
      await get().generate();
    },

    async clearBridgeEdits() {
      const c = get().cutoutParams;
      if (c.bridgeEdits.length === 0) return;
      set({ cutoutParams: { ...c, bridgeEdits: [] } });
      await get().generate();
    },

    async exportClearanceSample() {
      const { cutoutParams: c } = get();
      const mid = c.base.clearance;
      const clearances = [mid - 0.1, mid, mid + 0.1].map((x) => Math.round(Math.max(0.05, x) * 100) / 100);
      try {
        const r = await client.calibration({ thickness: c.thickness, slotDepth: c.base.slotDepth, clearances });
        const label = clearances.map((x) => x.toFixed(2).replace('0.', '')).join('-');
        download(
          export3mf(r.parts.map((p) => ({ name: p.name, mesh: p.mesh })), 'probka-luzu') as BlobPart,
          `probka-luzu-${label}.3mf`,
          'model/3mf',
        );
      } catch (e) {
        set({ error: `Próbka luzu: ${(e as Error).message}` });
      }
    },

    exportFile(format) {
      const { output, source } = get();
      if (!output) return;
      const v = output.validation;
      if (v.errors.length > 0) {
        const ok = window.confirm(
          `Walidacja zgłasza problemy:\n\n• ${v.errors.join('\n• ')}\n\nEksportować mimo to?`,
        );
        if (!ok) return;
      }
      const kind = output.result2D.kind;
      const suffix = kind === 'relief' ? '-relief' : kind === 'lithophane' ? '-lithophane' : get().mode === 'slotBase' ? '-wsuwana' : '';
      const name = baseName(source?.name ?? 'wycinanka') + suffix;
      if (format === 'stl') download(exportStl(output.mesh, name), `${name}.stl`, 'model/stl');
      else {
        const objects = 'parts' in output && output.parts ? output.parts.map((p) => ({ name: `${name}-${p.name}`, mesh: p.mesh })) : output.mesh;
        download(export3mf(objects, name) as BlobPart, `${name}.3mf`, 'model/3mf');
      }
    },
  };
});
