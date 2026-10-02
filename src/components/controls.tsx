import type { ReactNode } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: string;
  digits?: number;
  onChange: (v: number) => void;
}

/** Suwak + pole liczbowe (dokładne wpisanie wartości). */
export function Slider({ label, value, min, max, step, unit, hint, digits, onChange }: SliderProps) {
  const d = digits ?? (step < 0.1 ? 2 : step < 1 ? 1 : 0);
  return (
    <label className="field" title={hint}>
      <span className="field-label">
        {label}
        {hint && <span className="hint">?</span>}
      </span>
      <div className="field-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="num">
          <input
            type="number"
            min={min}
            step={step}
            value={Number(value.toFixed(d))}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange(v);
            }}
          />
          {unit && <em>{unit}</em>}
        </span>
      </div>
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}
