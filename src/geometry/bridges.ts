import type { Bridge, MultiPoly, Poly, Pt } from '../types';
import { bboxDistance, capsule, ringBBox, ringPerimeter, resampleRing, type BBox } from './polygon';

// Automatyczne mostki — algorytm Prima na grafie komponentów.
// Zbiór połączony startuje od komponentów „uziemionych” (lub głównego),
// a w każdym kroku dołączamy wyspę o najmniejszym koszcie:
//   koszt = długość + kara kątowa + kara widoczności + kara za odchylenie od pionu
//           (+ kara za przecięcie materiału)
// Strefy zablokowane (edycja użytkownika) wykluczają kandydatów, którzy przez nie przechodzą.

export interface BridgeOptions {
  width: number;
  /** Górna krawędź cokołu jako cel mostków (y = 0), null = brak cokołu. */
  ground: { x0: number; x1: number; embed: number } | null;
  /** Odległość punktu (mm) od najbliższego materiału, mm. 0 = w materiale. */
  materialDistance?: (p: Pt) => number;
  /** Rozdzielczość rastra użytego w materialDistance (mm/px) — margines przy końcach mostka. */
  rasterScale?: number;
  weights?: Partial<BridgeWeights>;
  /** Strefy, przez które mostek nie może przechodzić (mm). */
  blocked?: Array<{ p: Pt; r: number }>;
}

export interface BridgeWeights {
  angle: number;
  visibility: number;
  crossing: number;
  /** Kara za składową poziomą: waga · |dx| (mm). Pionowe mostki wyglądają jak „zawieszenie”. */
  vertical: number;
}

export const DEFAULT_WEIGHTS: BridgeWeights = { angle: 0.5, visibility: 0.6, crossing: 25, vertical: 0.25 };
const MAX_SAMPLES = 220;
const TOP_K = 12;

interface Sample {
  p: Pt;
  n: Pt; // normalna na zewnątrz materiału
}

interface Target {
  /** odcinki: x1,y1,x2,y2 */
  segs: Float64Array;
  bbox: BBox;
}

interface Candidate {
  a: Pt;
  b: Pt;
  to: number;
  length: number;
  cost: number;
  crosses: boolean;
}

function outwardNormal(a: Pt, b: Pt): Pt {
  // pierścienie mają materiał po lewej (zewn. CCW, otwory CW) → normalna na prawo
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

function islandSamples(poly: Poly): Sample[] {
  const r = poly.outer;
  const per = ringPerimeter(r);
  const spacing = Math.max(0.2, per / MAX_SAMPLES);
  const { pts, seg } = resampleRing(r, spacing);
  return pts.map((p, i) => ({ p, n: outwardNormal(r[seg[i]], r[(seg[i] + 1) % r.length]) }));
}

function buildTarget(poly: Poly): Target {
  const rings = [poly.outer, ...poly.holes];
  const n = rings.reduce((s, r) => s + r.length, 0);
  const segs = new Float64Array(n * 4);
  let k = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      segs[k++] = a[0];
      segs[k++] = a[1];
      segs[k++] = b[0];
      segs[k++] = b[1];
    }
  }
  return { segs, bbox: ringBBox(poly.outer) };
}

/** Najbliższy punkt na odcinkach celu. */
function nearestOnTarget(p: Pt, t: Target): { q: Pt; d2: number; n: Pt } {
  let best = Infinity;
  let qx = 0;
  let qy = 0;
  let si = 0;
  const s = t.segs;
  for (let i = 0; i < s.length; i += 4) {
    const ax = s[i];
    const ay = s[i + 1];
    const dx = s[i + 2] - ax;
    const dy = s[i + 3] - ay;
    const len2 = dx * dx + dy * dy;
    let u = len2 > 0 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const x = ax + u * dx;
    const y = ay + u * dy;
    const d2 = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d2 < best) {
      best = d2;
      qx = x;
      qy = y;
      si = i;
    }
  }
  return { q: [qx, qy], d2: best, n: outwardNormal([s[si], s[si + 1]], [s[si + 2], s[si + 3]]) };
}

function segmentPointDist(a: Pt, b: Pt, p: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

export function isBlocked(a: Pt, b: Pt, blocked: BridgeOptions['blocked']): boolean {
  if (!blocked) return false;
  for (const z of blocked) if (segmentPointDist(a, b, z.p) < z.r) return true;
  return false;
}

export function bridgeCost(
  p: Pt,
  np: Pt,
  q: Pt,
  nq: Pt,
  opts: BridgeOptions,
): { cost: number; length: number; crosses: boolean } {
  const w = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (L < 1e-9) return { cost: 0, length: 0, crosses: false };
  const d: Pt = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
  const cosA = np[0] * d[0] + np[1] * d[1];
  const cosB = -(nq[0] * d[0] + nq[1] * d[1]);
  const angle = 1 - Math.max(0, cosA) + (1 - Math.max(0, cosB));
  const anglePenalty = w.angle * angle * (L + opts.width);
  const verticalPenalty = w.vertical * Math.abs(q[0] - p[0]);

  let visPenalty = 0;
  let crosses = false;
  if (opts.materialDistance) {
    const margin = opts.width / 2 + 2 * (opts.rasterScale ?? 0.2);
    const step = Math.max(0.25, (opts.rasterScale ?? 0.2) * 1.5);
    let sum = 0;
    let n = 0;
    for (let s = margin; s <= L - margin; s += step) {
      const pt: Pt = [p[0] + d[0] * s, p[1] + d[1] * s];
      const md = opts.materialDistance(pt);
      if (md <= 0) crosses = true;
      sum += md;
      n++;
    }
    if (n > 0) visPenalty = w.visibility * (sum / n);
  }
  const crossPenalty = crosses ? w.crossing + 2 * L : 0;
  return { cost: L + anglePenalty + verticalPenalty + visPenalty + crossPenalty, length: L, crosses };
}

/** Pierwsze TOP_K kandydatów (posortowanych wg długości), którzy nie wchodzą w strefy zablokowane. */
function firstUnblocked<T extends { s: Sample; q: Pt }>(sorted: T[], opts: BridgeOptions): T[] {
  if (!opts.blocked?.length) return sorted.slice(0, TOP_K);
  const out: T[] = [];
  for (const c of sorted) {
    if (isBlocked(c.s.p, c.q, opts.blocked)) continue;
    out.push(c);
    if (out.length >= TOP_K) break;
  }
  return out;
}

/**
 * Planuje mostki tak, by wszystkie `toConnect` dołączyły do zbioru
 * `connected` (lub do cokołu). Zwraca listę mostków w kolejności dołączania.
 */
export function planBridges(
  components: MultiPoly,
  connected: number[],
  toConnect: number[],
  opts: BridgeOptions,
): Bridge[] {
  if (toConnect.length === 0) return [];
  const targets = new Map<number, Target>();
  const getTarget = (i: number) => {
    let t = targets.get(i);
    if (!t) {
      t = buildTarget(components[i]);
      targets.set(i, t);
    }
    return t;
  };
  const samples = new Map<number, Sample[]>();
  for (const i of toConnect) samples.set(i, islandSamples(components[i]));
  const bboxes = components.map((p) => ringBBox(p.outer));

  const evaluate = (island: number, target: number, bound: number): Candidate | null => {
    const smp = samples.get(island)!;
    if (target >= 0) {
      if (bboxDistance(bboxes[island], bboxes[target]) > bound) return null;
      const t = getTarget(target);
      const near = smp.map((s) => ({ s, ...nearestOnTarget(s.p, t) }));
      near.sort((x, y) => x.d2 - y.d2);
      let best: Candidate | null = null;
      for (const c of firstUnblocked(near, opts)) {
        const r = bridgeCost(c.s.p, c.s.n, c.q, c.n, opts);
        if (!best || r.cost < best.cost) {
          best = { a: c.s.p, b: c.q, to: target, length: r.length, cost: r.cost, crosses: r.crosses };
        }
      }
      return best;
    }
    // cel = górna krawędź cokołu (y = 0)
    const g = opts.ground!;
    if (bboxes[island].minY > bound) return null;
    const lo = g.x0 + opts.width;
    const hi = g.x1 - opts.width;
    const near = smp
      .map((s) => {
        const q: Pt = [Math.min(hi, Math.max(lo, s.p[0])), 0];
        return { s, q, d2: (s.p[0] - q[0]) ** 2 + s.p[1] ** 2 };
      })
      .sort((x, y) => x.d2 - y.d2);
    let best: Candidate | null = null;
    for (const c of firstUnblocked(near, opts)) {
      const r = bridgeCost(c.s.p, c.s.n, c.q, [0, 1], opts);
      if (!best || r.cost < best.cost) {
        best = { a: c.s.p, b: c.q, to: -1, length: r.length, cost: r.cost, crosses: r.crosses };
      }
    }
    return best;
  };

  const best = new Map<number, Candidate>();
  const pending = new Set(toConnect);
  const consider = (island: number, target: number) => {
    const cur = best.get(island);
    const c = evaluate(island, target, cur ? cur.cost : Infinity);
    if (c && (!cur || c.cost < cur.cost)) best.set(island, c);
  };
  for (const i of pending) {
    for (const t of connected) consider(i, t);
    if (opts.ground) consider(i, -1);
  }

  const bridges: Bridge[] = [];
  while (pending.size > 0) {
    let pick = -1;
    let pickCost = Infinity;
    for (const i of pending) {
      const c = best.get(i);
      if (c && c.cost < pickCost) {
        pickCost = c.cost;
        pick = i;
      }
    }
    if (pick < 0) {
      // nic nie jest osiągalne (np. brak celów) — dołącz do najbliższej innej wyspy
      const [first] = pending;
      for (const other of pending) if (other !== first) consider(first, other);
      if (!best.get(first)) break;
      continue;
    }
    const c = best.get(pick)!;
    bridges.push({
      a: c.a,
      b: c.b,
      width: opts.width,
      from: pick,
      to: c.to,
      length: c.length,
      cost: c.cost,
      crossesMaterial: c.crosses,
    });
    pending.delete(pick);
    for (const j of pending) consider(j, pick);
  }
  return bridges;
}

/** Kształty mostków (kapsuły) z końcami wpuszczonymi w materiał. */
export function bridgeShapes(bridges: Bridge[], ground: { embed: number } | null): MultiPoly {
  return bridges.map((b) => {
    const L = Math.max(1e-6, b.length);
    const d: Pt = [(b.b[0] - b.a[0]) / L, (b.b[1] - b.a[1]) / L];
    const ext = b.width / 2 + 0.25;
    const a: Pt = [b.a[0] - d[0] * ext, b.a[1] - d[1] * ext];
    let end: Pt = [b.b[0] + d[0] * ext, b.b[1] + d[1] * ext];
    if (b.to === -1 && ground) end = [b.b[0], -ground.embed];
    return { outer: capsule(a, end, b.width), holes: [] };
  });
}
