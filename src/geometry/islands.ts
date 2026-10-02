import type { MultiPoly } from '../types';
import { polyArea, ringBBox } from './polygon';
import { union } from './clip';

export interface IslandAnalysis {
  /** Największy komponent. */
  mainIndex: number;
  /** Komponenty dotykające pasa przy podstawie (połączone przez cokół). */
  groundedIndices: number[];
  /** Komponenty, które od początku należą do spójnego modelu. */
  connectedIndices: number[];
  /** Odseparowane wyspy (wymagają mostka). Może zawierać mainIndex, gdy główna bryła wisi nad cokołem. */
  islandIndices: number[];
  areas: number[];
}

/**
 * Klasyfikacja komponentów. `groundSnap` = null → brak cokołu: spójny jest
 * tylko główny komponent. W przeciwnym razie komponenty, których dół leży
 * w pasie [0, groundSnap], są połączone przez cokół.
 */
export function analyzeIslands(components: MultiPoly, groundSnap: number | null): IslandAnalysis {
  const areas = components.map(polyArea);
  let mainIndex = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[mainIndex]) mainIndex = i;

  const groundedIndices: number[] = [];
  if (groundSnap !== null) {
    components.forEach((p, i) => {
      if (ringBBox(p.outer).minY <= groundSnap + 1e-9) groundedIndices.push(i);
    });
  }
  const connected = new Set<number>(groundSnap !== null ? groundedIndices : [mainIndex]);
  const islandIndices = components.map((_, i) => i).filter((i) => !connected.has(i));
  return {
    mainIndex,
    groundedIndices,
    connectedIndices: [...connected],
    islandIndices,
    areas,
  };
}

/** Liczba spójnych komponentów MultiPoly (po scaleniu nakładających się). */
export function countComponents(mp: MultiPoly): number {
  return union(mp).length;
}
