// Operacje boolowskie i offsety 2D na MultiPoly (mm).
// Silnik: CrossSection z manifold-3d (C++ Clipper2 skompilowany do WASM).
// Kernel trzeba raz zainicjalizować: `setGeometryKernel(await initManifold())`.
import type { MultiPoly, Poly, Ring } from '../types';
import type { ManifoldToplevel } from '../mesh/manifold';
import { pointInRing, ringArea, ringBBox, type BBox } from './polygon';

type CrossSection = InstanceType<ManifoldToplevel['CrossSection']>;

let kernel: ManifoldToplevel | null = null;

export function setGeometryKernel(k: ManifoldToplevel): void {
  kernel = k;
}

function K(): ManifoldToplevel {
  if (!kernel) throw new Error('Kernel geometrii niezainicjalizowany (setGeometryKernel).');
  return kernel;
}

function contoursOf(mp: MultiPoly): Ring[] {
  const out: Ring[] = [];
  for (const p of mp) {
    if (p.outer.length >= 3) out.push(p.outer);
    for (const h of p.holes) if (h.length >= 3) out.push(h);
  }
  return out;
}

function toCS(mp: MultiPoly): CrossSection {
  return new (K().CrossSection)(contoursOf(mp), 'Positive');
}

/**
 * Rozkład na spójne komponenty: każdy = jeden pierścień zewnętrzny + jego otwory.
 * Nie używamy CrossSection.decompose() — przy dziesiątkach tysięcy konturów
 * (np. grafika rytownicza) wywraca się w WASM. Zamiast tego: toPolygons(),
 * podział po znaku pola i przypisanie otworu do NAJMNIEJSZEGO pierścienia
 * zewnętrznego, który go zawiera (siatka kubełkowa po bbox).
 */
function fromCS(cs: CrossSection): MultiPoly {
  return assembleRings(cs.toPolygons() as Ring[]);
}

export function assembleRings(rings: Ring[]): MultiPoly {
  const outers: Array<{ ring: Ring; area: number; bb: BBox; poly: Poly }> = [];
  const holes: Ring[] = [];
  for (const r of rings) {
    if (r.length < 3) continue;
    const a = ringArea(r);
    if (a > 0) outers.push({ ring: r, area: a, bb: ringBBox(r), poly: { outer: r, holes: [] } });
    else if (a < 0) holes.push(r);
  }
  if (holes.length > 0 && outers.length > 0) {
    // siatka kubełkowa: każda komórka zna pierścienie zewnętrzne, których bbox ją przecina
    const all = outers.reduce(
      (b, o) => ({
        minX: Math.min(b.minX, o.bb.minX),
        minY: Math.min(b.minY, o.bb.minY),
        maxX: Math.max(b.maxX, o.bb.maxX),
        maxY: Math.max(b.maxY, o.bb.maxY),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const n = Math.max(1, Math.min(128, Math.ceil(Math.sqrt(outers.length))));
    const cw = (all.maxX - all.minX) / n || 1;
    const ch = (all.maxY - all.minY) / n || 1;
    const cell = (v: number, min: number, size: number) => Math.min(n - 1, Math.max(0, Math.floor((v - min) / size)));
    const grid: number[][] = Array.from({ length: n * n }, () => []);
    const order = outers.map((_, i) => i).sort((a, b) => outers[a].area - outers[b].area);
    for (const i of order) {
      const bb = outers[i].bb;
      for (let gy = cell(bb.minY, all.minY, ch); gy <= cell(bb.maxY, all.minY, ch); gy++) {
        for (let gx = cell(bb.minX, all.minX, cw); gx <= cell(bb.maxX, all.minX, cw); gx++) grid[gy * n + gx].push(i);
      }
    }
    for (const h of holes) {
      const hb = ringBBox(h);
      const p = h[0];
      const candidates = grid[cell(p[1], all.minY, ch) * n + cell(p[0], all.minX, cw)];
      let parent = -1;
      for (const i of candidates) {
        const o = outers[i];
        if (o.area <= -ringArea(h)) continue;
        if (hb.minX < o.bb.minX || hb.maxX > o.bb.maxX || hb.minY < o.bb.minY || hb.maxY > o.bb.maxY) continue;
        // głosowanie na 3 wierzchołkach — odporne na wierzchołek leżący na krawędzi rodzica
        let votes = 0;
        const k = Math.min(3, h.length);
        for (let j = 0; j < k; j++) if (pointInRing(h[Math.floor((j * h.length) / k)], o.ring)) votes++;
        if (votes * 2 > k) {
          parent = i;
          break; // kandydaci posortowani rosnąco po polu → pierwszy = najmniejszy
        }
      }
      if (parent >= 0) outers[parent].poly.holes.push(h);
    }
  }
  return outers.map((o) => o.poly);
}

function withCS<T>(mps: MultiPoly[], fn: (cs: CrossSection[]) => CrossSection, post: (r: CrossSection) => T): T {
  const inputs = mps.map(toCS);
  let result: CrossSection | null = null;
  try {
    result = fn(inputs);
    return post(result);
  } finally {
    inputs.forEach((c) => c.delete());
    if (result && !inputs.includes(result)) result.delete();
  }
}

/**
 * Union surowych pierścieni. 'positive' — zewnętrzne CCW, otwory CW (kontury
 * z marching squares po normalizacji); 'evenodd' — orientacja dowolna.
 */
export function unionRings(rings: Ring[], fill: 'positive' | 'evenodd' = 'positive'): MultiPoly {
  const valid = rings.filter((r) => r.length >= 3);
  // manifold-3d nie przyjmuje pustej listy konturów
  if (valid.length === 0) return [];
  const cs = new (K().CrossSection)(valid, fill === 'positive' ? 'Positive' : 'EvenOdd');
  try {
    return fromCS(cs);
  } finally {
    cs.delete();
  }
}

/** Union dowolnej liczby MultiPoly (z poprawną orientacją, jak wszystko z tego modułu). */
export function union(...inputs: MultiPoly[]): MultiPoly {
  return unionRings(inputs.flatMap(contoursOf), 'positive');
}

export function difference(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0) return [];
  if (b.length === 0) return a;
  return withCS([a, b], ([x, y]) => x.subtract(y), fromCS);
}

export function intersection(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0 || b.length === 0) return [];
  return withCS([a, b], ([x, y]) => x.intersect(y), fromCS);
}

/** Liczba segmentów okręgu dla promienia r — krawędź łuku ~0,05 mm, 16..96. */
function circularSegments(r: number): number {
  return Math.max(16, Math.min(96, Math.ceil((2 * Math.PI * Math.abs(r)) / 0.05)));
}

/** Offset (dodatni = pogrubienie). Narożniki zaokrąglone. */
export function offset(mp: MultiPoly, delta: number, join: 'round' | 'miter' = 'round'): MultiPoly {
  if (mp.length === 0) return [];
  if (delta === 0) return mp;
  return withCS(
    [mp],
    ([x]) => x.offset(delta, join === 'round' ? 'Round' : 'Miter', 2, circularSegments(delta)),
    fromCS,
  );
}

/** Otwarcie morfologiczne: usuwa części węższe niż 2r. */
export function opening(mp: MultiPoly, r: number): MultiPoly {
  if (mp.length === 0) return [];
  return withCS(
    [mp],
    ([x]) => {
      const inner = x.offset(-r, 'Round', 2, circularSegments(r));
      try {
        return inner.offset(r, 'Round', 2, circularSegments(r));
      } finally {
        inner.delete();
      }
    },
    fromCS,
  );
}

/**
 * Części węższe niż 2r: P − (open(P, r) ⊕ eps), liczone w całości w WASM.
 * Dodatkowe `eps` jest kluczowe: P i open(P) mają tysiące wspólnych krawędzi,
 * a różnica dwóch niemal identycznych wielokątów generuje w Clipper2 masę
 * „splitów” rozwiązywanych rekurencyjnie — w Web Workerze kończy się to
 * przepełnieniem stosu. Z eps krawędzie się nie pokrywają.
 */
export function thinResidue(mp: MultiPoly, r: number, eps = 0.02): MultiPoly {
  if (mp.length === 0) return [];
  const segs = Math.min(32, circularSegments(r));
  return withCS(
    [mp],
    ([x]) => {
      const inner = x.offset(-r, 'Round', 2, segs);
      const opened = inner.offset(r + eps, 'Round', 2, segs);
      try {
        return x.subtract(opened);
      } finally {
        inner.delete();
        opened.delete();
      }
    },
    fromCS,
  );
}

/** Otoczka wypukła. */
export function hull(mp: MultiPoly): MultiPoly {
  if (mp.length === 0) return [];
  return withCS([mp], ([x]) => x.hull(), fromCS);
}

/** Usuwa wielokąty i otwory o polu mniejszym niż minArea (mm²). */
export function dropSmall(mp: MultiPoly, minArea: number): MultiPoly {
  return mp
    .filter((p) => Math.abs(ringArea(p.outer)) >= minArea)
    .map((p) => ({ outer: p.outer, holes: p.holes.filter((h) => Math.abs(ringArea(h)) >= minArea) }));
}
