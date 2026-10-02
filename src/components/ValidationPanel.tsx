import { useStore } from '../store/useStore';

function Row({ ok, label, value }: { ok: boolean | null; label: string; value: string }) {
  return (
    <li className={ok === null ? '' : ok ? 'ok' : 'bad'}>
      <span className="dot" />
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </li>
  );
}

export function ValidationPanel() {
  const output = useStore((s) => s.output);
  const minFeature = useStore((s) => (s.mode === 'relief' ? s.reliefParams.minFeatureWidth : s.cutoutParams.minFeatureWidth));
  const ms = useStore((s) => s.lastGenerateMs);
  if (!output) return null;
  const v = output.validation;
  const m = v.mesh;
  const r = output.result2D;
  const size = m ? [0, 1, 2].map((k) => (m.bbox.max[k] - m.bbox.min[k]).toFixed(1)) : null;
  const minW = v.minDetectedWidth;
  const grams = m ? (m.volume / 1000) * 1.24 : 0;

  return (
    <div className="validation">
      <h3>Walidacja przed eksportem</h3>
      <ul>
        {r.kind === 'cutout' && (
          <Row ok={v.islandsDetected === 0 || v.islandsBridged >= v.islandsDetected} label="Odseparowane elementy" value={`${v.islandsDetected} (połączono ${v.islandsBridged})`} />
        )}
        <Row ok={v.allConnected} label="Wszystko połączone" value={v.allConnected ? 'tak' : 'NIE'} />
        <Row
          ok={minW === null ? null : minW >= minFeature - 1e-3}
          label="Min. wykryta szerokość"
          value={minW === null ? 'nie wyznaczono' : minW >= 5 ? '≥ 5 mm' : minW <= 0.1 ? '≤ 0.10 mm' : `${minW.toFixed(2)} mm`}
        />
        <Row ok={v.thinRegionCount === 0} label={`Miejsca < ${minFeature} mm`} value={String(v.thinRegionCount)} />
        <Row ok={!!m && m.closed && m.manifold && m.consistentOrientation} label="Siatka zamknięta / manifold" value={m ? (m.closed && m.manifold ? 'tak' : 'NIE') : '—'} />
        <Row ok={null} label="Bounding box (X×Y×Z)" value={size ? `${size[0]} × ${size[1]} × ${size[2]} mm` : '—'} />
        <Row ok={null} label="Trójkąty / bryły" value={m ? `${m.triangles.toLocaleString('pl-PL')} / ${m.components}` : '—'} />
        <Row ok={null} label="Objętość · PLA" value={m ? `${(m.volume / 1000).toFixed(1)} cm³ · ~${grams.toFixed(0)} g` : '—'} />
        {r.kind === 'cutout' && r.slot && (
          <Row
            ok={null}
            label={`Język → slot (luz ${r.slot.clearance} mm)`}
            value={`${r.slot.tongueSize.map((x) => x.toFixed(1)).join('×')} → ${r.slot.slotSize.map((x) => x.toFixed(1)).join('×')}`}
          />
        )}
        {'parts' in output && output.parts && (
          <Row
            ok={output.parts.every((p) => p.report.components === 1 && p.report.closed && p.report.manifold)}
            label="Obiekty do druku"
            value={output.parts.map((p) => p.name).join(' + ')}
          />
        )}
        {r.kind === 'cutout' && r.stability && (
          <Row
            ok={r.stability.warnings.length === 0}
            label="Stabilność (kąt przewrócenia)"
            value={`bok ${r.stability.tipAngleSide.toFixed(0)}° · przód/tył ${r.stability.tipAngleFrontBack.toFixed(0)}°`}
          />
        )}
      </ul>
      {v.errors.length > 0 && (
        <div className="msgs err">
          {v.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      {v.warnings.length > 0 && (
        <div className="msgs warn">
          {v.warnings.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      {ms !== null && (
        <p className="timing">
          Wygenerowano w {(ms / 1000).toFixed(2)} s (2D {(output.timings.geometry2D / 1000).toFixed(2)} s · 3D{' '}
          {(output.timings.solid3D / 1000).toFixed(2)} s)
        </p>
      )}
    </div>
  );
}
