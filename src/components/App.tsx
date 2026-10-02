import { useState } from 'react';
import { useStore } from '../store/useStore';
import { MODES } from '../modes';
import { Toolbar } from './Toolbar';
import { SettingsPanel } from './SettingsPanel';
import { ImagePanel } from './ImagePanel';
import { Preview2D } from './Preview2D';
import { Preview3D } from './Preview3D';
import { ValidationPanel } from './ValidationPanel';

export function App() {
  const mode = useStore((s) => s.mode);
  const error = useStore((s) => s.error);
  const loadFile = useStore((s) => s.loadFile);
  const setMode = useStore((s) => s.setMode);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) loadFile(f);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <img src="icon.svg" alt="" width={22} height={22} />
          <strong>Wycinanka 3D</strong>
          <span className="tag">offline · bez AI</span>
        </div>
        <nav className="modes">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={m.id === mode ? 'on' : ''}
              disabled={!m.available}
              title={m.description}
              onClick={() => setMode(m.id)}
            >
              {m.label}
              {!m.available && <small>wkrótce</small>}
            </button>
          ))}
        </nav>
        <Toolbar />
      </header>

      {error && <div className="banner-error">{error}</div>}

      <main className="grid">
        <aside className="col col-settings">
          <SettingsPanel />
        </aside>
        <section className="col col-2d">
          <div className="col-head">
            <h2>Podgląd 2D</h2>
          </div>
          <ImagePanel />
          <Preview2D />
        </section>
        <section className="col col-3d">
          <div className="col-head">
            <h2>Podgląd 3D</h2>
          </div>
          <Preview3D />
          <ValidationPanel />
        </section>
      </main>
      {dragging && <div className="dropzone">Upuść obraz PNG / JPG</div>}
    </div>
  );
}
