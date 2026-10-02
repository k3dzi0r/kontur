import type { MultiPoly, ThickenMode } from '../types';
import { offset, thinResidue, union } from './clip';
import { polyArea } from './polygon';

// Kontrola minimalnej szerokości przez otwarcie morfologiczne:
// open(P, r) = offset(offset(P, -r), +r) usuwa wszystko węższe niż 2r.
// P \ open(P, r) = miejsca zbyt cienkie. Ostre narożniki dają drobne
// „okruchy” o polu ~r²·(1-π/4) — odfiltrowujemy je progiem pola.

const SLIVER_FACTOR = 1.0; // próg pola = max(SLIVER_FACTOR · r², MIN_SLIVER_AREA)
const MIN_SLIVER_AREA = 0.01; // mm² — okruchy na ostrych narożnikach przy małym r

export function findThinRegions(figure: MultiPoly, minWidth: number): MultiPoly {
  if (minWidth <= 0 || figure.length === 0) return [];
  const r = minWidth / 2;
  const thin = thinResidue(figure, r * 0.98);
  const minArea = Math.max(SLIVER_FACTOR * r * r, MIN_SLIVER_AREA);
  return thin.filter((p) => polyArea(p) > minArea);
}

/**
 * Minimalna wykryta szerokość elementu (mm) — najmniejsze w, przy którym
 * pojawia się istotny obszar zbyt cienki. Kryterium pola nie jest ściśle
 * monotoniczne, więc skanujemy rosnąco (krok ×1,3) i zawężamy bisekcją.
 * `clearAt` — szerokość, dla której wiadomo, że nic nie jest flagowane:
 * wtedy wynik jest ≥ clearAt (spójny z oznaczeniami w podglądzie).
 * Zwraca `hi`, gdy figura jest wszędzie grubsza niż hi; `lo`, gdy cieńsza niż lo.
 */
export function estimateMinWidth(figure: MultiPoly, clearAt?: number, lo = 0.1, hi = 5, refine = 5): number {
  if (figure.length === 0) return 0;
  const start = clearAt !== undefined ? Math.max(lo, clearAt) : lo;
  if (clearAt === undefined && findThinRegions(figure, lo).length > 0) return lo;
  let prev = start;
  let w = start;
  while (w < hi) {
    w = Math.min(hi, w * 1.3);
    if (findThinRegions(figure, w).length > 0) {
      let a = prev;
      let b = w;
      for (let i = 0; i < refine; i++) {
        const mid = (a + b) / 2;
        if (findThinRegions(figure, mid).length > 0) b = mid;
        else a = mid;
      }
      return (a + b) / 2;
    }
    prev = w;
  }
  return hi;
}

/** Lokalne pogrubienie: zbyt cienkie miejsca dylatowane o minWidth/2. */
export function thickenLocal(figure: MultiPoly, thin: MultiPoly, minWidth: number): MultiPoly {
  if (thin.length === 0) return figure;
  return union(figure, offset(thin, minWidth / 2));
}

/** Globalne pogrubienie całej figury tak, by najcieńsze miejsce osiągnęło minWidth. */
export function thickenGlobal(figure: MultiPoly, minDetected: number, minWidth: number): MultiPoly {
  const delta = Math.max(0, (minWidth - minDetected) / 2);
  return delta > 0 ? offset(figure, delta + 0.005) : figure;
}

export interface ThicknessPass {
  figure: MultiPoly;
  thinRegions: MultiPoly;
  thickenedRegions: MultiPoly;
  minDetectedWidth: number | null;
}

/**
 * Wspólna polityka kontroli grubości dla wszystkich trybów: wykrycie,
 * opcjonalne pogrubienie, ponowny pomiar. Kontrola jest diagnostyczna —
 * jej awaria (np. limit stosu WASM przy bardzo złożonej geometrii) zwraca
 * figurę bez zmian i ostrzeżenie zamiast przerywać generowanie.
 */
export function thicknessPass(figure: MultiPoly, minWidth: number, mode: ThickenMode, warnings: string[]): ThicknessPass {
  try {
    let thinRegions = findThinRegions(figure, minWidth);
    let minDetectedWidth = estimateMinWidth(figure, thinRegions.length === 0 ? minWidth : undefined);
    const thickenedRegions = mode !== 'none' ? thinRegions : [];
    let out = figure;
    if (mode === 'local' && thinRegions.length > 0) out = thickenLocal(figure, thinRegions, minWidth);
    else if (mode === 'global' && minDetectedWidth < minWidth) out = thickenGlobal(figure, minDetectedWidth, minWidth);
    if (mode !== 'none') {
      thinRegions = findThinRegions(out, minWidth);
      minDetectedWidth = estimateMinWidth(out, thinRegions.length === 0 ? minWidth : undefined);
      if (thinRegions.length > 0) {
        warnings.push(`Po pogrubieniu nadal ${thinRegions.length} zbyt cienkich miejsc (zwykle ostre końcówki).`);
      }
    }
    return { figure: out, thinRegions, thickenedRegions, minDetectedWidth };
  } catch (e) {
    warnings.push(
      `Nie udało się sprawdzić minimalnej szerokości (${e instanceof Error ? e.message : e}). ` +
        'Model wygenerowano bez tej kontroli — zwiększ „Uproszczenie konturu” lub sprawdź detale ręcznie.',
    );
    return { figure, thinRegions: [], thickenedRegions: [], minDetectedWidth: null };
  }
}
