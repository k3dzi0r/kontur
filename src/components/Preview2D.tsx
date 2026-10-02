import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BinaryMask, Bridge, CutoutResult2D, LithophaneResult2D, MultiPoly, Pt, ReliefResult2D, Result2D } from '../types';
import { useStore } from '../store/useStore';
import { multiBBox } from '../geometry/polygon';

export const COLORS = {
  figure: '#d9dde3',
  island: '#ef4444',
  bridge: '#f59e0b',
  connector: '#22b8cf',
  thin: '#d946ef',
  base: '#4b5563',
  plate: '#5b6470',
  tongue: '#a78bfa',
  pattern: '#e8e3d9',
  grid: '#262b33',
  gridMajor: '#323844',
  bg: '#14171c',
};

interface View {
  scale: number; // px na mm
  tx: number;
  ty: number;
}

function polyPath(ctx: CanvasRenderingContext2D, mp: MultiPoly, v: View) {
  ctx.beginPath();
  for (const p of mp) {
    for (const r of [p.outer, ...p.holes]) {
      r.forEach(([x, y], i) => {
        const sx = v.tx + x * v.scale;
        const sy = v.ty - y * v.scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
    }
  }
}

function fill(ctx: CanvasRenderingContext2D, mp: MultiPoly, v: View, color: string, stroke?: string) {
  if (mp.length === 0) return;
  polyPath(ctx, mp, v);
  ctx.fillStyle = color;
  ctx.fill('evenodd');
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function sceneBounds(r: Result2D) {
  if (r.kind === 'relief') return multiBBox(r.plate);
  if (r.kind === 'lithophane') return { minX: -r.width / 2, minY: -r.height / 2, maxX: r.width / 2, maxY: r.height / 2 };
  const b = multiBBox(r.figure);
  if (r.base) {
    b.minX = Math.min(b.minX, r.base.x0);
    b.maxX = Math.max(b.maxX, r.base.x1);
    b.minY = Math.min(b.minY, -r.base.height);
  }
  return b;
}

interface EditUI {
  hover: number;
  drawing: [Pt, Pt] | null;
  editing: boolean;
}

function drawGrid(ctx: CanvasRenderingContext2D, v: View, w: number, h: number) {
  // siatka mm
  const step = v.scale > 6 ? 5 : v.scale > 2 ? 10 : 50;
  const x0 = Math.floor(-v.tx / v.scale / step) * step;
  const x1 = (w - v.tx) / v.scale;
  const yTop = v.ty / v.scale;
  const y0 = Math.floor((v.ty - h) / v.scale / step) * step;
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x += step) {
    ctx.strokeStyle = Math.abs(x % (step * 5)) < 1e-6 ? COLORS.gridMajor : COLORS.grid;
    const sx = Math.round(v.tx + x * v.scale) + 0.5;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (let y = y0; y <= yTop; y += step) {
    ctx.strokeStyle = Math.abs(y % (step * 5)) < 1e-6 ? COLORS.gridMajor : COLORS.grid;
    const sy = Math.round(v.ty - y * v.scale) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }

}

function drawThin(ctx: CanvasRenderingContext2D, thin: MultiPoly, thickened: MultiPoly, v: View) {
  fill(ctx, thin, v, COLORS.thin, COLORS.thin);
  if (thickened.length > 0) {
    polyPath(ctx, thickened, v);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = COLORS.thin;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // kółka — żeby małe obszary były widoczne
  ctx.strokeStyle = COLORS.thin;
  ctx.lineWidth = 1.5;
  for (const t of thin) {
    const bb = multiBBox([t]);
    const cx = v.tx + ((bb.minX + bb.maxX) / 2) * v.scale;
    const cy = v.ty - ((bb.minY + bb.maxY) / 2) * v.scale;
    const rad = Math.max(6, (Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) / 2) * v.scale + 4);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * Symulacja podświetlenia: przepuszczalność ~ exp(-α·t), α ≈ 1,2 / mm
 * (biały PLA), znormalizowana do zakresu grubości.
 */
function lithoBitmap(r: LithophaneResult2D): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.nx;
  c.height = r.ny;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(r.nx, r.ny);
  const a = 1.2;
  const tMax = Math.exp(-a * r.minThickness);
  const tMin = Math.exp(-a * r.maxThickness);
  for (let i = 0; i < r.thickness.length; i++) {
    const b = (Math.exp(-a * r.thickness[i]) - tMin) / (tMax - tMin || 1);
    img.data[i * 4] = 255 * b;
    img.data[i * 4 + 1] = 236 * b;
    img.data[i * 4 + 2] = 200 * b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function drawLitho(ctx: CanvasRenderingContext2D, r: LithophaneResult2D, bmp: HTMLCanvasElement, v: View, w: number, h: number) {
  drawGrid(ctx, v, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bmp, v.tx - (r.width / 2) * v.scale, v.ty - (r.height / 2) * v.scale, r.width * v.scale, r.height * v.scale);
}

function drawRelief(ctx: CanvasRenderingContext2D, r: ReliefResult2D, v: View, w: number, h: number) {
  drawGrid(ctx, v, w, h);
  fill(ctx, r.plate, v, COLORS.plate, '#9aa3ae');
  fill(ctx, r.pattern, v, COLORS.pattern);
  drawThin(ctx, r.thinRegions, r.thickenedRegions, v);
}

function drawGeometry(ctx: CanvasRenderingContext2D, r: CutoutResult2D, v: View, w: number, h: number, ui: EditUI) {
  drawGrid(ctx, v, w, h);

  if (r.base) {
    const b = r.base;
    ctx.fillStyle = COLORS.base;
    ctx.fillRect(v.tx + b.x0 * v.scale, v.ty, (b.x1 - b.x0) * v.scale, b.height * v.scale);
  }
  fill(ctx, r.figure, v, COLORS.figure);
  fill(ctx, r.groundConnectors, v, COLORS.connector + 'cc');
  fill(ctx, r.tongue, v, COLORS.tongue);
  if (r.slot) {
    // obrys slotu w cokole (z luzem)
    const c = r.slot.clearance;
    ctx.strokeStyle = COLORS.tongue;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(
      v.tx + (r.slot.x0 - c) * v.scale,
      v.ty,
      (r.slot.x1 - r.slot.x0 + 2 * c) * v.scale,
      (r.slot.depth + c) * v.scale,
    );
    ctx.setLineDash([]);
  }
  fill(ctx, r.islandIndices.map((i) => r.components[i]), v, COLORS.island);
  fill(ctx, r.bridgeShapes, v, COLORS.bridge);
  const sx = (p: Pt) => v.tx + p[0] * v.scale;
  const sy = (p: Pt) => v.ty - p[1] * v.scale;
  // mostki ręczne: biała przerywana linia osi
  ctx.lineWidth = 1.5;
  for (const b of r.bridges) {
    if (!b.manual) continue;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(sx(b.a), sy(b.a));
    ctx.lineTo(sx(b.b), sy(b.b));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // strefy zablokowane
  for (const z of r.blockedZones) {
    const cx = sx(z.p);
    const cy = sy(z.p);
    const rad = Math.max(5, z.r * v.scale);
    ctx.strokeStyle = COLORS.island;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const k = Math.min(rad * 0.5, 6);
    ctx.beginPath();
    ctx.moveTo(cx - k, cy - k);
    ctx.lineTo(cx + k, cy + k);
    ctx.moveTo(cx + k, cy - k);
    ctx.lineTo(cx - k, cy + k);
    ctx.stroke();
  }
  if (ui.editing && r.symmetryAxis !== null) {
    const ax = v.tx + r.symmetryAxis * v.scale;
    ctx.strokeStyle = '#60a5fa88';
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (ui.hover >= 0 && r.bridges[ui.hover]) {
    const b = r.bridges[ui.hover];
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(3, b.width * v.scale + 4);
    ctx.globalAlpha = 0.45;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx(b.a), sy(b.a));
    ctx.lineTo(sx(b.b), sy(b.b));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }
  if (ui.drawing) {
    const [a, b] = ui.drawing;
    ctx.strokeStyle = COLORS.bridge;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sx(a), sy(a));
    ctx.lineTo(sx(b), sy(b));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawThin(ctx, r.thinRegions, r.thickenedRegions, v);

  if (r.stability) {
    const [cx, cy] = r.stability.centroid;
    const sx = v.tx + cx * v.scale;
    const sy = v.ty - cy * v.scale;
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.moveTo(sx - 9, sy);
    ctx.lineTo(sx + 9, sy);
    ctx.moveTo(sx, sy - 9);
    ctx.lineTo(sx, sy + 9);
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, v.ty);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function maskToBitmap(mask: BinaryMask): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) {
    const v = mask.data[i] ? 20 : 235;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const SAMPLES = [
  { file: 'sample-twarz.png', label: 'twarz' },
  { file: 'sample-ornament.png', label: 'ornament' },
];

function EmptyState() {
  const loadFile = useStore((s) => s.loadFile);
  const load = async (file: string) => {
    const blob = await fetch(file).then((r) => r.blob());
    loadFile(new File([blob], file.replace('sample-', ''), { type: 'image/png' }));
  };
  return (
    <div className="viewport-empty">
      <div>
        <p>Przeciągnij tutaj obraz PNG/JPG albo użyj „Wczytaj obraz”.</p>
        <p className="samples">
          Przykłady:{' '}
          {SAMPLES.map((s, i) => (
            <span key={s.file}>
              {i > 0 && ' · '}
              <button className="link" onClick={() => load(s.file)}>
                {s.label}
              </button>
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

/** Indeks mostka pod kursorem (mm) lub -1. */
function hitBridge(bridges: Bridge[], p: Pt, v: View): number {
  let best = -1;
  let bestD = Infinity;
  bridges.forEach((b, i) => {
    const dx = b.b[0] - b.a[0];
    const dy = b.b[1] - b.a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p[0] - b.a[0]) * dx + (p[1] - b.a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(b.a[0] + t * dx - p[0], b.a[1] + t * dy - p[1]);
    if (d < b.width / 2 + 5 / v.scale && d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export function Preview2D() {
  const output = useStore((s) => s.output);
  const mask = useStore((s) => s.mask);
  const stale = useStore((s) => s.stale);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View | null>(null);
  const drag = useRef<{ x: number; y: number; sx: number; sy: number; mode: 'pan' | 'draw' } | null>(null);
  const hover = useRef(-1);
  const drawing = useRef<[Pt, Pt] | null>(null);
  const [editing, setEditing] = useState(false);
  const status = useStore((s) => s.status);
  const edits = useStore((s) => s.cutoutParams.bridgeEdits);
  const addBridgeEdit = useStore((s) => s.addBridgeEdit);
  const removeBridgeEdit = useStore((s) => s.removeBridgeEdit);
  const undoBridgeEdit = useStore((s) => s.undoBridgeEdit);
  const clearBridgeEdits = useStore((s) => s.clearBridgeEdits);
  const [, force] = useState(0);
  const [showGeometry, setShowGeometry] = useState(true);
  const r = output?.result2D ?? null;
  const geometryMode = showGeometry && !!r;
  const cut = r?.kind === 'cutout' ? r : null;
  const canEdit = editing && !!cut;
  const maskBmp = useMemo(() => (mask ? maskToBitmap(mask) : null), [mask]);
  const lithoBmp = useMemo(() => (r?.kind === 'lithophane' ? lithoBitmap(r) : null), [r]);

  const fitView = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !r) return;
    const b = sceneBounds(r);
    const w = el.clientWidth;
    const h = el.clientHeight;
    const pad = 24;
    const scale = Math.min((w - 2 * pad) / (b.maxX - b.minX), (h - 2 * pad) / (b.maxY - b.minY));
    view.current = {
      scale,
      tx: (w - (b.maxX - b.minX) * scale) / 2 - b.minX * scale,
      ty: (h + (b.maxY - b.minY) * scale) / 2 + b.minY * scale,
    };
    force((n) => n + 1);
  }, [r]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  const draw = useCallback(() => {
    const el = wrapRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    if (geometryMode && r) {
      if (!view.current) fitView();
      if (view.current) {
        if (r.kind === 'relief') drawRelief(ctx, r, view.current, w, h);
        else if (r.kind === 'lithophane') drawLitho(ctx, r, lithoBmp!, view.current, w, h);
        else drawGeometry(ctx, r, view.current, w, h, { hover: hover.current, drawing: drawing.current, editing: canEdit });
      }
    } else if (mask && maskBmp) {
      const bmp = maskBmp;
      const s = Math.min((w - 24) / mask.width, (h - 24) / mask.height);
      ctx.imageSmoothingEnabled = s < 1;
      ctx.drawImage(bmp, (w - mask.width * s) / 2, (h - mask.height * s) / 2, mask.width * s, mask.height * s);
    }
  }, [geometryMode, r, mask, maskBmp, lithoBmp, fitView, canEdit]);

  useEffect(() => {
    draw();
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      fitView();
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView, draw]);

  const toMm = (e: { clientX: number; clientY: number }): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = view.current!;
    return [(e.clientX - rect.left - v.tx) / v.scale, (v.ty - (e.clientY - rect.top)) / v.scale];
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!geometryMode || !view.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const v = view.current;
    v.tx = mx - (mx - v.tx) * k;
    v.ty = my - (my - v.ty) * k;
    v.scale *= k;
    draw();
  };

  return (
    <div className="viewport">
      <div
        ref={wrapRef}
        className={`viewport-canvas ${canEdit && geometryMode ? 'editing' : ''}`}
        onWheel={onWheel}
        onPointerDown={(e) => {
          const draw_ = canEdit && geometryMode && !e.shiftKey && e.button === 0 && status !== 'generating';
          drag.current = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: draw_ ? 'draw' : 'pan' };
          try {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* zdarzenia syntetyczne / brak aktywnego wskaźnika */
          }
        }}
        onPointerMove={(e) => {
          if (!view.current) return;
          const d = drag.current;
          if (!d) {
            if (canEdit && geometryMode && cut) {
              const h = hitBridge(cut.bridges, toMm(e), view.current);
              if (h !== hover.current) {
                hover.current = h;
                draw();
              }
            }
            return;
          }
          if (d.mode === 'pan') {
            view.current.tx += e.clientX - d.x;
            view.current.ty += e.clientY - d.y;
          } else if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
            drawing.current = [toMm({ clientX: d.sx, clientY: d.sy }), toMm(e)];
          }
          d.x = e.clientX;
          d.y = e.clientY;
          draw();
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.mode !== 'draw' || !cut) return;
          const line = drawing.current;
          drawing.current = null;
          const W = cut.figureWidth;
          const H = cut.figureHeight;
          const norm = (p: Pt): Pt => [p[0] / W, p[1] / H];
          if (line) {
            addBridgeEdit({ kind: 'manual', a: norm(line[0]), b: norm(line[1]) });
          } else {
            const hit = view.current ? hitBridge(cut.bridges, toMm(e), view.current) : -1;
            if (hit >= 0) {
              const b = cut.bridges[hit];
              hover.current = -1;
              if (b.manual && b.editIndex !== undefined) removeBridgeEdit(b.editIndex);
              else {
                const mid: Pt = [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2];
                const rad = Math.max(1.5, Math.min(b.length / 2, 6) + b.width);
                addBridgeEdit({ kind: 'block', p: norm(mid), r: rad / H });
              }
            }
          }
          draw();
        }}
        onDoubleClick={fitView}
      >
        <canvas ref={canvasRef} />
      </div>
      <div className="viewport-overlay">
        {r && r.kind !== 'lithophane' && (
          <div className="seg">
            <button className={showGeometry ? 'on' : ''} onClick={() => setShowGeometry(true)}>
              Geometria
            </button>
            <button className={!showGeometry ? 'on' : ''} onClick={() => setShowGeometry(false)}>
              Maska
            </button>
          </div>
        )}
        {cut && showGeometry && (
          <button className={`btn btn-sm ${editing ? 'btn-primary' : ''}`} onClick={() => setEditing((x) => !x)}>
            {editing ? 'Zakończ edycję' : 'Edytuj mostki'}
          </button>
        )}
        {canEdit && geometryMode && (
          <>
            <button className="btn btn-sm" onClick={undoBridgeEdit} disabled={edits.length === 0 || status === 'generating'}>
              Cofnij
            </button>
            <button className="btn btn-sm" onClick={clearBridgeEdits} disabled={edits.length === 0 || status === 'generating'}>
              Wyczyść ({edits.length})
            </button>
          </>
        )}
        {stale && r && <span className="chip chip-warn">Parametry zmienione — kliknij „Generuj”</span>}
      </div>
      {canEdit && geometryMode && (
        <div className="edit-hint">
          Klik na mostek: usuń (zablokuj trasę) · Przeciągnij: nowy mostek · Shift + przeciągnij: przesuń widok
        </div>
      )}
      {geometryMode && r?.kind === 'relief' && (
        <div className="legend">
          <span><i style={{ background: COLORS.plate }} />płytka</span>
          <span><i style={{ background: COLORS.pattern }} />wzór {r.pattern.length ? '' : '(brak)'}</span>
          <span><i style={{ background: COLORS.thin }} />za cienkie</span>
          <span>płytka {r.plateWidth.toFixed(1)} × {r.plateHeight.toFixed(1)} mm</span>
        </div>
      )}
      {geometryMode && r?.kind === 'lithophane' && (
        <div className="legend">
          <span>Symulacja podświetlenia</span>
          <span>{r.width.toFixed(1)} × {r.height.toFixed(1)} mm</span>
          <span>grubość {r.minThickness}–{r.maxThickness} mm</span>
          <span>siatka {r.nx}×{r.ny}</span>
        </div>
      )}
      {geometryMode && cut && (
        <div className="legend">
          <span><i style={{ background: COLORS.figure }} />model</span>
          <span><i style={{ background: COLORS.island }} />wyspy</span>
          <span><i style={{ background: COLORS.bridge }} />mostki{edits.length ? ` (${edits.length} edycji)` : ''}</span>
          <span><i style={{ background: COLORS.connector }} />{cut.slot ? 'stopa' : 'łączniki z cokołem'}</span>
          {cut.slot && <span><i style={{ background: COLORS.tongue }} />język / slot</span>}
          <span><i style={{ background: COLORS.thin }} />za cienkie{cut.thickenedRegions.length ? ' / pogrubione (przerywane)' : ''}</span>
          <span><i style={{ background: COLORS.base }} />cokół</span>
        </div>
      )}
      {!mask && !r && <EmptyState />}
    </div>
  );
}
