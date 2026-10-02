import { useRef } from 'react';
import { useStore } from '../store/useStore';

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const source = useStore((s) => s.source);
  const output = useStore((s) => s.output);
  const status = useStore((s) => s.status);
  const stale = useStore((s) => s.stale);
  const loadFile = useStore((s) => s.loadFile);
  const generate = useStore((s) => s.generate);
  const fixIslands = useStore((s) => s.fixIslands);
  const exportFile = useStore((s) => s.exportFile);
  const mode = useStore((s) => s.mode);
  const busy = status === 'generating' || status === 'loading';
  const unfixed = !!output && !output.validation.allConnected;

  return (
    <div className="toolbar">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = '';
        }}
      />
      <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
        Wczytaj obraz
      </button>
      <button className={`btn btn-primary ${stale ? 'pulse' : ''}`} onClick={generate} disabled={!source || busy}>
        {status === 'generating' ? 'Generuję…' : 'Generuj'}
      </button>
      {mode !== 'relief' && (
      <button className={`btn ${unfixed ? 'btn-danger' : ''}`} onClick={fixIslands} disabled={!source || busy || !unfixed} title="Dodaj automatyczne mostki do odseparowanych wysp">
        Napraw wyspy
      </button>
      )}
      <span className="toolbar-sep" />
      <button className="btn" onClick={() => exportFile('stl')} disabled={!output || busy}>
        Eksport STL
      </button>
      <button className="btn" onClick={() => exportFile('3mf')} disabled={!output || busy}>
        Eksport 3MF
      </button>
    </div>
  );
}
