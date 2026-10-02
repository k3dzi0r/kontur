import { useStore } from '../store/useStore';
import { PRINTER_PRESETS } from '../presets';
import { Section, Select, Slider, Toggle } from './controls';
import type { PlateShape, SizeMode, ThickenMode } from '../types';

export function SettingsPanel() {
  const ip = useStore((s) => s.imageParams);
  const cp = useStore((s) => s.cutoutParams);
  const otsu = useStore((s) => s.otsu);
  const presetId = useStore((s) => s.presetId);
  const analysisSize = useStore((s) => s.analysisSize);
  const setI = useStore((s) => s.setImageParams);
  const setC = useStore((s) => s.setCutoutParams);
  const setB = useStore((s) => s.setBaseParams);
  const applyPreset = useStore((s) => s.applyPreset);
  const mode = useStore((s) => s.mode);
  const rp = useStore((s) => s.reliefParams);
  const setR = useStore((s) => s.setReliefParams);
  const lp = useStore((s) => s.lithophaneParams);
  const setL = useStore((s) => s.setLithophaneParams);
  const litho = mode === 'lithophane';
  const exportClearanceSample = useStore((s) => s.exportClearanceSample);

  return (
    <div className="settings">
      <Section title="Drukarka">
        <Select
          label="Preset"
          value={presetId}
          options={PRINTER_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          onChange={applyPreset}
        />
      </Section>

      <Section
        title={litho ? 'Obraz' : 'Binaryzacja'}
        aside={
          !litho && otsu !== null && (
            <button className="btn btn-ghost btn-sm" onClick={() => setI({ threshold: Math.round(otsu) })} title="Automatyczny próg metodą Otsu">
              Auto ({Math.round(otsu)})
            </button>
          )
        }
      >
        {!litho && <Slider label="Próg" value={ip.threshold} min={1} max={254} step={1} onChange={(v) => setI({ threshold: v })} hint="Piksele ciemniejsze niż próg stają się materiałem." />}
        <Slider label="Wygładzanie (blur)" value={ip.blur} min={0} max={8} step={0.5} unit="px" onChange={(v) => setI({ blur: v })} />
        {!litho && (
          <>
        <Slider label="Usuwanie szumu" value={ip.noiseArea} min={0} max={500} step={1} unit="px²" onChange={(v) => setI({ noiseArea: v })} hint="Usuwa plamki i wypełnia dziurki mniejsze niż podane pole." />
        <Slider label="Domykanie przerw" value={ip.closeGaps} min={0} max={10} step={0.5} unit="px" onChange={(v) => setI({ closeGaps: v })} hint="Zamknięcie morfologiczne — skleja kreski oddzielone wąską szczeliną." />
        <Toggle label="Odwróć (biały = materiał)" checked={ip.invert} onChange={(v) => setI({ invert: v })} />
          </>
        )}
        <Slider
          label="Rozdzielczość analizy"
          value={ip.maxResolution}
          min={300}
          max={2500}
          step={50}
          unit="px"
          onChange={(v) => setI({ maxResolution: v })}
          hint={analysisSize ? `Aktualnie ${analysisSize.width}×${analysisSize.height} px` : 'Dłuższy bok obrazu po przeskalowaniu.'}
        />
      </Section>

      {litho ? (
        <>
          <Section title="Wymiary">
            <Select<'width' | 'height'>
              label="Skaluj według"
              value={lp.sizeMode}
              options={[
                { value: 'width', label: 'Szerokość obrazu' },
                { value: 'height', label: 'Wysokość obrazu' },
              ]}
              onChange={(v) => setL({ sizeMode: v })}
            />
            <Slider label={lp.sizeMode === 'width' ? 'Szerokość obrazu' : 'Wysokość obrazu'} value={lp.targetSize} min={30} max={240} step={1} unit="mm" onChange={(v) => setL({ targetSize: v })} />
            <Slider label="Ramka" value={lp.frameWidth} min={0} max={15} step={0.5} unit="mm" onChange={(v) => setL({ frameWidth: v })} hint="Ramka o maksymalnej grubości — usztywnia płytkę." />
          </Section>
          <Section title="Grubość">
            <Slider label="Min. (najjaśniejsze)" value={lp.minThickness} min={0.4} max={3} step={0.05} unit="mm" onChange={(v) => setL({ minThickness: v })} />
            <Slider label="Maks. (najciemniejsze)" value={lp.maxThickness} min={1} max={8} step={0.1} unit="mm" onChange={(v) => setL({ maxThickness: v })} />
            <Slider label="Gamma" value={lp.gamma} min={0.3} max={3} step={0.05} onChange={(v) => setL({ gamma: v })} hint="<1 rozjaśnia półtony, >1 przyciemnia." />
            <Toggle label="Negatyw" checked={lp.invert} onChange={(v) => setL({ invert: v })} />
            <Slider label="Odstęp próbek" value={lp.resolution} min={0.1} max={1} step={0.05} unit="mm" onChange={(v) => setL({ resolution: v })} hint="Mniejszy = więcej detali i większy plik. 0,2–0,3 mm dla dyszy 0,4." />
          </Section>
        </>
      ) : mode === 'relief' ? (
        <>
      <Section title="Wymiary wzoru">
        <Select<'width' | 'height'>
          label="Skaluj według"
          value={rp.sizeMode}
          options={[
            { value: 'width', label: 'Szerokość wzoru' },
            { value: 'height', label: 'Wysokość wzoru' },
          ]}
          onChange={(v) => setR({ sizeMode: v })}
        />
        <Slider label={rp.sizeMode === 'width' ? 'Szerokość wzoru' : 'Wysokość wzoru'} value={rp.targetSize} min={20} max={250} step={1} unit="mm" onChange={(v) => setR({ targetSize: v })} />
        <Slider label="Uproszczenie konturu" value={rp.simplify} min={0} max={0.5} step={0.01} unit="mm" onChange={(v) => setR({ simplify: v })} />
      </Section>

      <Section title="Płytka">
        <Select<PlateShape>
          label="Kształt"
          value={rp.plateShape}
          options={[
            { value: 'rounded', label: 'Prostokąt zaokrąglony' },
            { value: 'rect', label: 'Prostokąt' },
            { value: 'ellipse', label: 'Elipsa' },
            { value: 'outline', label: 'Obrys wzoru' },
          ]}
          onChange={(v) => setR({ plateShape: v })}
        />
        <Slider label="Margines" value={rp.margin} min={0} max={30} step={0.5} unit="mm" onChange={(v) => setR({ margin: v })} />
        {rp.plateShape === 'rounded' && (
          <Slider label="Promień narożników" value={rp.cornerRadius} min={0} max={30} step={0.5} unit="mm" onChange={(v) => setR({ cornerRadius: v })} />
        )}
        <Slider label="Grubość płytki" value={rp.plateThickness} min={0.8} max={8} step={0.1} unit="mm" onChange={(v) => setR({ plateThickness: v })} />
        <Slider label={rp.engrave ? 'Głębokość graweru' : 'Wysokość wzoru'} value={rp.reliefHeight} min={0.2} max={6} step={0.1} unit="mm" onChange={(v) => setR({ reliefHeight: v })} />
        <Toggle label="Wzór wklęsły (grawer)" checked={rp.engrave} onChange={(v) => setR({ engrave: v })} />
        <Slider label="Ramka" value={rp.frameWidth} min={0} max={10} step={0.5} unit="mm" onChange={(v) => setR({ frameWidth: v })} hint="0 = bez ramki. Ramka jest zawsze wypukła." />
        <Slider label="Otwór do zawieszenia" value={rp.hangHole} min={0} max={10} step={0.5} unit="mm" onChange={(v) => setR({ hangHole: v })} hint="Średnica; 0 = bez otworu." />
      </Section>

      <Section title="Detale">
        <Slider label="Min. szerokość elementu" value={rp.minFeatureWidth} min={0.3} max={3} step={0.05} unit="mm" onChange={(v) => setR({ minFeatureWidth: v })} />
        <Select<ThickenMode>
          label="Zbyt cienkie miejsca"
          value={rp.thicken}
          options={[
            { value: 'none', label: 'Tylko zaznacz' },
            { value: 'local', label: 'Pogrub lokalnie' },
            { value: 'global', label: 'Pogrub cały kontur' },
          ]}
          onChange={(v) => setR({ thicken: v })}
        />
      </Section>
        </>
      ) : (
        <>
      <Section title="Wymiary">
        <Select<SizeMode>
          label="Skaluj według"
          value={cp.sizeMode}
          options={[
            { value: 'totalHeight', label: 'Wysokość całości (z podstawką)' },
            { value: 'width', label: 'Szerokość figury' },
          ]}
          onChange={(v) => setC({ sizeMode: v })}
        />
        <Slider label={cp.sizeMode === 'width' ? 'Szerokość modelu' : 'Wysokość dekoracji'} value={cp.targetSize} min={20} max={300} step={1} unit="mm" onChange={(v) => setC({ targetSize: v })} />
        <Slider label="Grubość wycinanki" value={cp.thickness} min={1} max={10} step={0.2} unit="mm" onChange={(v) => setC({ thickness: v })} />
        <Slider label="Uproszczenie konturu" value={cp.simplify} min={0} max={0.5} step={0.01} unit="mm" onChange={(v) => setC({ simplify: v })} hint="Tolerancja Douglas-Peucker — maks. odchyłka uproszczonego konturu." />
      </Section>

      <Section title="Detale i mostki">
        <Slider label="Min. szerokość elementu" value={cp.minFeatureWidth} min={0.3} max={3} step={0.05} unit="mm" onChange={(v) => setC({ minFeatureWidth: v })} hint="Zwykle 2× średnica dyszy." />
        <Select<ThickenMode>
          label="Zbyt cienkie miejsca"
          value={cp.thicken}
          options={[
            { value: 'none', label: 'Tylko zaznacz' },
            { value: 'local', label: 'Pogrub lokalnie' },
            { value: 'global', label: 'Pogrub cały kontur' },
          ]}
          onChange={(v) => setC({ thicken: v })}
        />
        <Toggle label="Automatyczne mostki" checked={cp.autoBridges} onChange={(v) => setC({ autoBridges: v })} />
        <Toggle label="Symetryczne mostki (gdy obraz symetryczny)" checked={cp.symmetricBridges} onChange={(v) => setC({ symmetricBridges: v })} hint="Mostki lewej połowy odbijane lustrzanie na prawą." />
        <Toggle label="Preferuj pionowe mostki" checked={cp.preferVertical} onChange={(v) => setC({ preferVertical: v })} />
        <Slider label="Min. szerokość mostka" value={cp.bridgeWidth} min={0.4} max={3} step={0.05} unit="mm" onChange={(v) => setC({ bridgeWidth: v })} />
      </Section>

      <Section title={mode === 'slotBase' ? 'Podstawka wsuwana' : 'Podstawka'}>
        {mode !== 'slotBase' && <Toggle label="Generuj cokół" checked={cp.base.enabled} onChange={(v) => setB({ enabled: v })} />}
        {(cp.base.enabled || mode === 'slotBase') && (
          <>
            <Slider label="Wysokość" value={cp.base.height} min={2} max={20} step={0.5} unit="mm" onChange={(v) => setB({ height: v })} />
            <Slider label="Głębokość" value={cp.base.depth} min={8} max={60} step={1} unit="mm" onChange={(v) => setB({ depth: v })} />
            <Slider label="Margines boczny" value={cp.base.margin} min={0} max={30} step={0.5} unit="mm" onChange={(v) => setB({ margin: v })} />
            <Slider label="Dociąganie do cokołu" value={cp.base.groundSnap} min={0.2} max={10} step={0.1} unit="mm" onChange={(v) => setB({ groundSnap: v })} hint="Fragmenty kończące się do tej wysokości nad dołem są przedłużane w dół (płaska stopa)." />
            {mode === 'slotBase' ? (
              <>
                <Slider label="Luz (na stronę)" value={cp.base.clearance} min={0.1} max={0.6} step={0.05} unit="mm" onChange={(v) => setB({ clearance: v })} hint="0,2 mm = ciasno, 0,3 mm = typowo dla A1, 0,4 mm = luźno." />
                <Slider label="Głębokość slotu" value={cp.base.slotDepth} min={2} max={15} step={0.5} unit="mm" onChange={(v) => setB({ slotDepth: v })} hint="Cokół zostanie podniesiony, jeśli slot się nie zmieści." />
                <Slider label="Szerokość języka" value={cp.base.tongueWidth} min={0} max={60} step={1} unit="mm" onChange={(v) => setB({ tongueWidth: v })} hint="0 = automatycznie (70% najszerszej stopy, 6–40 mm)." />
                <button
                  className="btn btn-sm"
                  onClick={exportClearanceSample}
                  title="Mały cokół z 3 slotami (luz −0,1 / bieżący / +0,1 mm, oznaczone 1–3 wgłębieniami) + kupon języka. Drukuje się kilka minut."
                >
                  Pobierz próbkę luzu (3MF)
                </button>
                <p className="note">
                  Sloty: {[cp.base.clearance - 0.1, cp.base.clearance, cp.base.clearance + 0.1].map((x) => Math.max(0.05, x).toFixed(2)).join(' / ')} mm
                  — oznaczone 1, 2, 3 wgłębieniami. Wybierz luz, przy którym język wchodzi pewnie, bez siły.
                </p>
              </>
            ) : (
              <Slider label="Zagłębienie w cokole" value={cp.base.embed} min={0.2} max={Math.max(0.5, cp.base.height - 0.5)} step={0.1} unit="mm" onChange={(v) => setB({ embed: v })} />
            )}
            <Slider label="Zaokrąglenie narożników" value={cp.base.cornerRadius} min={0} max={10} step={0.5} unit="mm" onChange={(v) => setB({ cornerRadius: v })} />
          </>
        )}
      </Section>
        </>
      )}
    </div>
  );
}
