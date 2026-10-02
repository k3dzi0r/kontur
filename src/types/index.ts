// Wspólne typy. Wszystkie wymiary geometrii w milimetrach, oś Y w górę.

export type Pt = [number, number];
/** Zamknięty pierścień (ostatni punkt NIE powtarza pierwszego). */
export type Ring = Pt[];

/** Wielokąt z otworami — jeden spójny komponent materiału. */
export interface Poly {
  outer: Ring;
  holes: Ring[];
}
export type MultiPoly = Poly[];

/** Maska binarna: 1 = materiał, 0 = pusto. */
export interface BinaryMask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Obraz w skali szarości 0..255 (0 = czarny). */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export type ModeId = 'cutout' | 'relief' | 'lithophane' | 'slotBase';

export interface ImageParams {
  /** Maks. dłuższy bok obrazu do analizy (px). */
  maxResolution: number;
  /** 0..255; piksel jaśniejszy niż próg = tło. */
  threshold: number;
  /** Promień rozmycia gaussowskiego (px). */
  blur: number;
  /** Usuwanie plamek i dziur mniejszych niż N px². */
  noiseArea: number;
  /** Domykanie przerw — promień zamknięcia morfologicznego (px). */
  closeGaps: number;
  invert: boolean;
}

export type SizeMode = 'totalHeight' | 'width';
export type ThickenMode = 'none' | 'local' | 'global';

export interface CutoutParams {
  sizeMode: SizeMode;
  /** Wysokość całej dekoracji (z podstawą) albo szerokość figury, mm. */
  targetSize: number;
  /** Grubość wycinanki (ekstruzja), mm. */
  thickness: number;
  /** Tolerancja Douglas-Peucker, mm. */
  simplify: number;
  /** Minimalna szerokość elementu, mm. */
  minFeatureWidth: number;
  /** Szerokość mostka, mm. */
  bridgeWidth: number;
  autoBridges: boolean;
  /** Dla symetrycznej grafiki: mostki lewej połowy odbijane na prawą. */
  symmetricBridges: boolean;
  /** Kara za poziome mostki — preferuj pionowe „zawieszenia”. */
  preferVertical: boolean;
  /** Ręczne poprawki mostków (współrzędne znormalizowane do bbox figury). */
  bridgeEdits: BridgeEdit[];
  thicken: ThickenMode;
  base: BaseParams;
}

export type BaseType = 'fused' | 'slot';

export interface BaseParams {
  enabled: boolean;
  /** 'fused' — cokół zespolony z figurą; 'slot' — osobny cokół ze slotem, figurka z językiem. */
  type: BaseType;
  /** Luz między językiem a slotem (na stronę), mm. */
  clearance: number;
  /** Głębokość slotu / długość języka, mm. */
  slotDepth: number;
  /** Szerokość języka, mm (0 = automatycznie). */
  tongueWidth: number;
  height: number;
  depth: number;
  /** Margines po bokach figury, mm. */
  margin: number;
  /** Fragmenty figury do tej wysokości nad dołem są dociągane do cokołu, mm. */
  groundSnap: number;
  /** Zagłębienie figury w cokole, mm. */
  embed: number;
  /** Promień zaokrąglenia narożników cokołu (w rzucie z góry), mm. */
  cornerRadius: number;
}

/**
 * Edycja mostków. Współrzędne znormalizowane: u = x / szerokość figury,
 * v = y / wysokość figury — edycje przeżywają zmianę rozmiaru i rozdzielczości.
 */
export type BridgeEdit =
  | { kind: 'block'; p: Pt; r: number }
  | { kind: 'manual'; a: Pt; b: Pt };

export interface Bridge {
  a: Pt;
  b: Pt;
  width: number;
  /** Indeks wyspy (w liście komponentów wejściowych). */
  from: number;
  /** Indeks celu; -1 = cokół, -2 = nieznany (mostek odbity lustrzanie / ręczny). */
  to: number;
  length: number;
  cost: number;
  crossesMaterial: boolean;
  manual?: boolean;
  /** Indeks w CutoutParams.bridgeEdits (dla mostków ręcznych). */
  editIndex?: number;
  mirrored?: boolean;
}

export interface BaseInfo {
  x0: number;
  x1: number;
  height: number;
  depth: number;
}

export interface SlotInfo {
  /** Zakres języka w osi X (mm, układ figury). */
  x0: number;
  x1: number;
  depth: number;
  clearance: number;
  /** Wymiary slotu w cokole: szerokość × grubość × głębokość, mm. */
  slotSize: [number, number, number];
  tongueSize: [number, number, number];
}

export interface MeshPart {
  name: string;
  mesh: MeshData;
  report: MeshReport;
}

export interface StabilityInfo {
  centroid: Pt;
  /** Wysokość środka masy nad stołem (figura + cokół), mm. */
  comHeight: number;
  /** Kąt przechyłu na bok, przy którym model się przewróci (°). */
  tipAngleSide: number;
  /** Kąt przechyłu przód/tył (°). */
  tipAngleFrontBack: number;
  /** Przesunięcie środka masy względem środka cokołu, mm. */
  centroidOffset: number;
  warnings: string[];
}

export interface MeshData {
  /** xyz, mm */
  positions: Float32Array;
  indices: Uint32Array;
}

export interface MeshReport {
  triangles: number;
  vertices: number;
  closed: boolean;
  manifold: boolean;
  consistentOrientation: boolean;
  components: number;
  volume: number;
  genus: number;
  degenerateTriangles: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

export interface ValidationSummary {
  /** Ile odseparowanych elementów (wysp) wykryto przed naprawą. */
  islandsDetected: number;
  /** Ile wysp zostało dołączonych mostkami. */
  islandsBridged: number;
  allConnected: boolean;
  /** Minimalna wykryta szerokość elementu w figurze, mm (null gdy nie wyznaczono). */
  minDetectedWidth: number | null;
  thinRegionCount: number;
  mesh: MeshReport | null;
  manifoldStatus: string;
  errors: string[];
  warnings: string[];
}

export type PlateShape = 'rect' | 'rounded' | 'ellipse' | 'outline';

export interface ReliefParams {
  /** 'width' / 'height' — wymiar samego wzoru, mm. */
  sizeMode: 'width' | 'height';
  targetSize: number;
  simplify: number;
  minFeatureWidth: number;
  thicken: ThickenMode;
  plateShape: PlateShape;
  /** Margines płytki wokół wzoru, mm. */
  margin: number;
  cornerRadius: number;
  plateThickness: number;
  /** Wysokość wypukłości (lub głębokość grawerunku), mm. */
  reliefHeight: number;
  /** Wzór wklęsły zamiast wypukłego. */
  engrave: boolean;
  /** Szerokość ramki (0 = brak), mm. */
  frameWidth: number;
  /** Średnica otworu do zawieszenia (0 = brak), mm. */
  hangHole: number;
}

export interface ReliefResult2D {
  kind: 'relief';
  plate: MultiPoly;
  /** Wzór (wypukły lub grawerowany) przycięty do płytki, z ramką. */
  pattern: MultiPoly;
  hole: MultiPoly;
  thinRegions: MultiPoly;
  thickenedRegions: MultiPoly;
  figureWidth: number;
  figureHeight: number;
  plateWidth: number;
  plateHeight: number;
  scale: number;
}

export interface LithophaneParams {
  sizeMode: 'width' | 'height';
  targetSize: number;
  /** Grubość w najjaśniejszych miejscach, mm. */
  minThickness: number;
  /** Grubość w najciemniejszych miejscach, mm. */
  maxThickness: number;
  /** Odstęp próbek siatki, mm (mniejszy = więcej detali i większy plik). */
  resolution: number;
  /** Ramka o maksymalnej grubości wokół obrazu, mm (0 = brak). */
  frameWidth: number;
  /** Krzywa tonalna: t = (1 - jasność)^gamma. */
  gamma: number;
  /** Negatyw (jasne = grube). */
  invert: boolean;
}

export interface LithophaneResult2D {
  kind: 'lithophane';
  /** Siatka grubości (wiersze od góry obrazu), mm. */
  thickness: Float32Array;
  nx: number;
  ny: number;
  width: number;
  height: number;
  minThickness: number;
  maxThickness: number;
}

export type Result2D = CutoutResult2D | ReliefResult2D | LithophaneResult2D;

export interface CutoutResult2D {
  kind: 'cutout';
  /** Figura przed mostkami (podział na komponenty). */
  components: MultiPoly;
  /** Indeks głównej bryły w `components`. */
  mainIndex: number;
  /** Indeksy komponentów połączonych przez cokół. */
  groundedIndices: number[];
  /** Indeksy wysp (komponenty bez połączenia). */
  islandIndices: number[];
  bridges: Bridge[];
  bridgeShapes: MultiPoly;
  /** Strefy zablokowane przez użytkownika (mm). */
  blockedZones: Array<{ p: Pt; r: number }>;
  /** Oś symetrii (mm), gdy mostki planowano symetrycznie. */
  symmetryAxis: number | null;
  groundConnectors: MultiPoly;
  /** Język figurki (tylko podstawka wsuwana). */
  tongue: MultiPoly;
  slot: SlotInfo | null;
  thinRegions: MultiPoly;
  /** Miejsca, które zostały pogrubione (gdy włączono pogrubianie). */
  thickenedRegions: MultiPoly;
  /** Ostateczna figura 2D (to, co jest ekstrudowane). */
  figure: MultiPoly;
  base: BaseInfo | null;
  stability: StabilityInfo | null;
  /** mm na piksel maski. */
  scale: number;
  figureWidth: number;
  figureHeight: number;
}
