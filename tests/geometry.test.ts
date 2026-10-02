import { describe, expect, it } from 'vitest';
import { makeMask, inRect, inCircle, params } from './helpers';
import { vectorizeMask } from '../src/geometry/vectorize';
import { analyzeIslands, countComponents } from '../src/geometry/islands';
import { bridgeShapes, planBridges } from '../src/geometry/bridges';
import { union } from '../src/geometry/clip';
import { polyArea, pointInPoly, ringArea } from '../src/geometry/polygon';
import { runCutout2D } from '../src/pipeline/cutout';
import { findThinRegions, estimateMinWidth } from '../src/geometry/thickness';
import { simplifyRing } from '../src/geometry/simplify';

const vec = (mask: ReturnType<typeof makeMask>, h = 100) =>
  vectorizeMask(mask, { sizeMode: 'height', targetSize: h, simplify: 0.05 })!;

describe('kontury i komponenty', () => {
  it('1. jeden prostokąt → jeden komponent', () => {
    const m = makeMask(60, 80, (x, y) => inRect(x, y, 10, 10, 50, 70));
    const v = vec(m, 60);
    expect(v.polygons).toHaveLength(1);
    expect(v.polygons[0].holes).toHaveLength(0);
    // 40×60 px → wysokość 60 mm → 1 mm/px → pole ≈ 2400 mm² (narożniki ścięte o pół piksela)
    expect(polyArea(v.polygons[0])).toBeGreaterThan(2390);
    expect(polyArea(v.polygons[0])).toBeLessThan(2401);
    expect(v.height).toBeCloseTo(60, 0);
    expect(ringArea(v.polygons[0].outer)).toBeGreaterThan(0); // CCW
  });

  it('2. prostokąt + osobna kropka → wykrycie wyspy', () => {
    const m = makeMask(100, 100, (x, y) => inRect(x, y, 10, 50, 90, 90) || inCircle(x, y, 50, 25, 6));
    const v = vec(m);
    expect(v.polygons).toHaveLength(2);
    const isl = analyzeIslands(v.polygons, 2); // z cokołem: prostokąt na dole jest uziemiony
    expect(isl.islandIndices).toHaveLength(1);
    expect(polyArea(v.polygons[isl.islandIndices[0]])).toBeLessThan(polyArea(v.polygons[isl.mainIndex]));
    const noBase = analyzeIslands(v.polygons, null);
    expect(noBase.islandIndices).toHaveLength(1);
    expect(noBase.islandIndices[0]).not.toBe(noBase.mainIndex);
  });

  it('3. po dodaniu mostka → jeden komponent', () => {
    const m = makeMask(100, 100, (x, y) => inRect(x, y, 10, 50, 90, 90) || inCircle(x, y, 50, 25, 6));
    const v = vec(m);
    const isl = analyzeIslands(v.polygons, null);
    const bridges = planBridges(v.polygons, isl.connectedIndices, isl.islandIndices, { width: 1, ground: null });
    expect(bridges).toHaveLength(1);
    // najkrótsza droga: pionowo w dół od kropki do prostokąta (19 px przerwy)
    const gap = 19 * v.transform.scale;
    expect(bridges[0].length).toBeGreaterThan(gap * 0.97);
    expect(bridges[0].length).toBeLessThan(gap * 1.05);
    expect(Math.abs(bridges[0].a[0] - bridges[0].b[0])).toBeLessThan(0.5); // pionowy
    const merged = union(v.polygons, bridgeShapes(bridges, null));
    expect(countComponents(merged)).toBe(1);
  });

  it('3b. wiele wysp, w tym wyspa w otworze → wszystko połączone', () => {
    const m = makeMask(120, 120, (x, y) => {
      const ring = inCircle(x, y, 60, 60, 50) && !inCircle(x, y, 60, 60, 40);
      const mouth = inRect(x, y, 45, 70, 75, 76);
      const eyeL = inCircle(x, y, 45, 45, 4);
      const eyeR = inCircle(x, y, 75, 45, 4);
      return ring || mouth || eyeL || eyeR;
    });
    const v = vec(m);
    expect(v.polygons).toHaveLength(4);
    const isl = analyzeIslands(v.polygons, null);
    expect(isl.islandIndices).toHaveLength(3);
    const bridges = planBridges(v.polygons, isl.connectedIndices, isl.islandIndices, { width: 1, ground: null });
    expect(bridges).toHaveLength(3);
    const merged = union(v.polygons, bridgeShapes(bridges, null));
    expect(countComponents(merged)).toBe(1);
  });

  it('4. kształt z otworem → otwór pozostaje otworem', () => {
    const m = makeMask(80, 80, (x, y) => inRect(x, y, 10, 10, 70, 70) && !inRect(x, y, 30, 30, 50, 50));
    const v = vec(m, 60);
    expect(v.polygons).toHaveLength(1);
    expect(v.polygons[0].holes).toHaveLength(1);
    expect(ringArea(v.polygons[0].holes[0])).toBeLessThan(0);
    const center: [number, number] = [30, 30];
    expect(pointInPoly(center, v.polygons[0])).toBe(false);
    expect(pointInPoly([5, 5], v.polygons[0])).toBe(true);
    // cała ścieżka 2D też zostawia otwór
    const out = runCutout2D(m, params({ targetSize: 65 }))!;
    expect(out.result.figure).toHaveLength(1);
    expect(out.result.figure[0].holes).toHaveLength(1);
  });

  it('piksele stykające się narożnikiem nie tworzą połączenia o zerowej szerokości', () => {
    const m = makeMask(20, 20, (x, y) => inRect(x, y, 2, 2, 10, 10) || inRect(x, y, 10, 10, 18, 18));
    const v = vec(m, 16);
    expect(v.polygons).toHaveLength(2);
  });

  it('Douglas-Peucker redukuje punkty okręgu', () => {
    const ring: [number, number][] = [];
    for (let i = 0; i < 1000; i++) ring.push([Math.cos((i / 1000) * 2 * Math.PI) * 50, Math.sin((i / 1000) * 2 * Math.PI) * 50]);
    const s = simplifyRing(ring, 0.1)!;
    expect(s.length).toBeLessThan(80);
    expect(s.length).toBeGreaterThan(20);
  });
});

describe('minimalna szerokość', () => {
  it('wykrywa cienki łącznik', () => {
    // dwa bloki połączone paskiem 0.5 mm (1 px = 0.25 mm)
    const fig = [
      { outer: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][], holes: [] },
      { outer: [[20, 0], [30, 0], [30, 10], [20, 10]] as [number, number][], holes: [] },
      { outer: [[9, 4.75], [21, 4.75], [21, 5.25], [9, 5.25]] as [number, number][], holes: [] },
    ];
    const f = union(fig);
    expect(f).toHaveLength(1);
    const thin = findThinRegions(f, 0.8);
    expect(thin.length).toBeGreaterThan(0);
    const w = estimateMinWidth(f);
    expect(w).toBeGreaterThan(0.4);
    expect(w).toBeLessThan(0.6);
    expect(findThinRegions(f, 0.4)).toHaveLength(0);
  });
});

describe('podstawka', () => {
  it('5. wygenerowana podstawka dotyka modelu', () => {
    // okrąg: styka się z dołem tylko w jednym punkcie → łącznik musi go „posadzić”
    const m = makeMask(100, 100, (x, y) => inCircle(x, y, 50, 50, 40));
    const out = runCutout2D(m, params())!;
    const r = out.result;
    expect(r.base).not.toBeNull();
    expect(r.groundConnectors.length).toBeGreaterThan(0);
    expect(out.allConnected).toBe(true);
    // figura sięga w głąb cokołu na zadane zagłębienie
    const minY = Math.min(...r.figure.flatMap((p) => p.outer.map((q) => q[1])));
    expect(minY).toBeLessThanOrEqual(-r.base!.height * 0 - 0.99);
    // szerokość styku na wysokości y = 0 jest realna (nie punkt)
    const contact = r.groundConnectors.reduce((s, p) => s + polyArea(p), 0);
    expect(contact).toBeGreaterThan(5);
    // cokół obejmuje całą szerokość figury + margines
    expect(r.base!.x0).toBeLessThan(0);
    expect(r.base!.x1).toBeGreaterThan(r.figureWidth);
  });

  it('wiszący element jest dołączany mostkiem (do figury lub cokołu)', () => {
    const m = makeMask(100, 100, (x, y) => inRect(x, y, 10, 60, 40, 95) || inRect(x, y, 60, 10, 90, 30));
    const out = runCutout2D(m, params())!;
    expect(out.result.islandIndices).toHaveLength(1);
    expect(out.result.bridges).toHaveLength(1);
    expect(out.allConnected).toBe(true);
  });

  it('litery stojące obok siebie łączy cokół — bez mostków', () => {
    const m = makeMask(100, 60, (x, y) => inRect(x, y, 5, 10, 25, 50) || inRect(x, y, 40, 10, 60, 50) || inRect(x, y, 75, 10, 95, 50));
    const out = runCutout2D(m, params())!;
    expect(out.result.islandIndices).toHaveLength(0);
    expect(out.result.bridges).toHaveLength(0);
    expect(out.allConnected).toBe(true);
  });
});

describe('regresja: złożona grafika rytownicza', () => {
  it('gęste kreskowanie — kontrola grubości kończy się i flaguje cienkie kreski', () => {
    // ukośne kreski 2 px + gruba rama: dużo wspólnych krawędzi P i open(P)
    const m = makeMask(400, 400, (x, y) => {
      const frame = x < 20 || x >= 380 || y < 20 || y >= 380;
      const hatch = (x + y) % 7 < 2 && x > 20 && x < 380 && y > 20 && y < 380;
      return frame || hatch;
    });
    const out = runCutout2D(m, params({ targetSize: 100 }))!;
    expect(out.result.thinRegions.length).toBeGreaterThan(0);
    expect(out.minDetectedWidth).not.toBeNull();
    expect(out.minDetectedWidth!).toBeLessThan(0.8);
    expect(out.allConnected).toBe(true);
  });

  it('dziesiątki tysięcy konturów — rozkład na komponenty bez decompose() z WASM', () => {
    // pojedyncze piksele po przekątnej = osobne wyspy; tylko wektoryzacja + klasyfikacja
    const m = makeMask(300, 300, (x, y) => x < 10 || x >= 290 || y < 10 || y >= 290 || ((x + y) % 5 === 0 && x > 10 && x < 290 && y > 10 && y < 290));
    const v = vec(m);
    expect(v.polygons.length).toBeGreaterThan(5000);
    const frame = v.polygons.find((p) => p.holes.length === 1);
    expect(frame).toBeDefined();
  });
});
