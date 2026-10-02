import Module from 'manifold-3d';

export type ManifoldToplevel = Awaited<ReturnType<typeof Module>>;

let instance: Promise<ManifoldToplevel> | null = null;

/**
 * Inicjalizacja WASM manifold-3d (singleton). W przeglądarce trzeba podać
 * URL pliku .wasm (Vite: `manifold-3d/manifold.wasm?url`); w Node (testy)
 * moduł znajduje go sam.
 */
export function initManifold(wasmUrl?: string): Promise<ManifoldToplevel> {
  if (!instance) {
    instance = Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((m) => {
      m.setup();
      return m;
    });
  }
  return instance;
}
