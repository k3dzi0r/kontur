import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { Viewer3D } from './Viewer3D';

export function Preview3D() {
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer3D | null>(null);
  const output = useStore((s) => s.output);
  const status = useStore((s) => s.status);
  const [assembledView, setAssembledView] = useState(false);
  const assembled = output && 'assembled' in output ? output.assembled : undefined;

  useEffect(() => {
    if (!ref.current) return;
    viewer.current = new Viewer3D(ref.current);
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    viewer.current?.setMesh((assembledView && assembled) || output?.mesh || null);
  }, [output, assembled, assembledView]);

  const bb = output?.validation.mesh?.bbox;
  return (
    <div className="viewport">
      <div ref={ref} className="viewport-canvas" />
      <div className="viewport-overlay">
        {bb && (
          <span className="chip">
            {(bb.max[0] - bb.min[0]).toFixed(1)} × {(bb.max[1] - bb.min[1]).toFixed(1)} × {(bb.max[2] - bb.min[2]).toFixed(1)} mm
          </span>
        )}
        {status === 'generating' && <span className="chip chip-busy">Generowanie…</span>}
        {assembled && (
          <div className="seg">
            <button className={!assembledView ? 'on' : ''} onClick={() => setAssembledView(false)}>
              Do druku
            </button>
            <button className={assembledView ? 'on' : ''} onClick={() => setAssembledView(true)}>
              Złożenie
            </button>
          </div>
        )}
        {output && (
          <button className="btn btn-ghost btn-sm" onClick={() => viewer.current?.fit()}>
            Dopasuj widok
          </button>
        )}
      </div>
      {!output && <div className="viewport-empty">Podgląd 3D pojawi się po „Generuj”.</div>}
    </div>
  );
}
