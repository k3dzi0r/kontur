# Wycinanka 3D

Lokalna aplikacja webowa / PWA: obraz PNG/JPG → drukowalna wycinanka 3D z cokołem → STL / 3MF.
Całość działa w przeglądarce, klasycznymi algorytmami — bez AI, bez API, bez backendu.

## Uruchomienie

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (geometria, mesh, eksport)
npm run build      # typecheck + build produkcyjny z service workerem (PWA, offline)
```

Przykładowe obrazy: `public/sample-*.png` (dostępne też z pustego podglądu 2D).
Regeneracja ikon i przykładów: `npm run gen:assets`.

## Pipeline trybu „Wycinanka”

| Etap | Moduł | Metoda |
|---|---|---|
| grayscale, blur, próg, Otsu | `src/image/threshold.ts` | luminancja Rec.709 (alfa na białym), gauss separowalny |
| czyszczenie maski | `src/image/morphology.ts` | EDT Felzenszwalba → dylatacja/erozja dyskiem, etykietowanie komponentów |
| kontury | `src/geometry/contours.ts` | marching squares, siodła rozdzielone (brak styków w punkcie) |
| uproszczenie | `src/geometry/simplify.ts` | Douglas-Peucker dla pierścieni |
| polygony z otworami | `src/geometry/clip.ts` | CrossSection z manifold-3d (Clipper2, C++/WASM) |
| wyspy | `src/geometry/islands.ts` | komponenty; „uziemione” = dotykają pasa nad cokołem |
| mostki | `src/geometry/bridges.ts` | Prim; koszt = długość + kara kątowa + odległość od materiału (EDT) + kara za przecięcie |
| min. szerokość | `src/geometry/thickness.ts` | otwarcie morfologiczne (offset −r/+r), skan + bisekcja |
| cokół, stabilność | `src/geometry/base.ts` | przeciągnięcie dolnego pasa figury w cokół (suma Minkowskiego z odcinkiem), środek masy, kąty przewrócenia |
| bryła | `src/mesh/extrude.ts` | extrude + obrót do pionu + union z cokołem (manifold-3d — wynik zawsze manifold) |
| walidacja | `src/mesh/validate.ts` | niezależna: krawędzie ×2, orientacja, komponenty, genus, objętość, bbox |
| eksport | `src/mesh/exportStl.ts`, `export3mf.ts` | binarny STL; 3MF (XML + ZIP/fflate), mm |

Orkiestracja: `src/pipeline/cutout.ts` (2D) i `src/pipeline/full.ts` (2D → 3D → walidacja),
uruchamiane w Web Workerze (`src/worker/`). UI: React + zustand (`src/store`), Three.js (`src/components/Viewer3D.ts`).

Układ współrzędnych eksportu: Z w górę, X = szerokość, Y = grubość (wyśrodkowana), dół cokołu na Z = 0, jednostki mm.

## Tryby

Rejestr w `src/modes/index.ts`, uruchamianie przez `src/pipeline/index.ts` (`runJob`).

- **Wycinanka** — opisana wyżej. Mostki: symetryczne (gdy IoU maski z odbiciem ≥ 0,9 — `geometry/symmetry.ts`),
  z preferencją pionu; edycja ręczna w podglądzie 2D („Edytuj mostki”: klik = zablokuj trasę, przeciągnięcie = własny mostek,
  Cofnij / Wyczyść). Edycje są zapisane we współrzędnych znormalizowanych, więc przeżywają zmianę rozmiaru.
- **Relief** (`pipeline/relief.ts`) — płytka (prostokąt / zaokrąglony / elipsa / obrys) + wzór wypukły lub grawer,
  ramka, otwór do zawieszenia (gdy wypada na wzorze — automatyczne „ucho”). Leży płasko, mostki niepotrzebne.
- **Podstawka wsuwana** — Wycinanka z cokołem typu `slot`: figurka musi być jednym kawałkiem (mostki do głównej bryły),
  płaska stopa, język pod najszerszą stopą, slot = język + 2·luz. Eksport: 2 obiekty (figurka na płasko + cokół),
  3MF z dwoma obiektami; podgląd „Złożenie”.
- **Lithophane** — zarezerwowany (TODO: heightmap z jasności → siatka).
