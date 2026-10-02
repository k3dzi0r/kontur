# Wycinanka 3D — plan implementacji (MVP)

Cel: obraz PNG/JPG → wycinanka 3D (płyta + cokół) → STL/3MF. 100% client-side, klasyczne algorytmy.

## Biblioteki
- **manifold-3d CrossSection (C++ Clipper2 w WASM; clipper2-js odrzucone — bug w PolyTree)** — booleany i offsety 2D (union, difference, offset, PolyTree → komponenty z otworami).
- **manifold-3d** (WASM) — ekstruzja CrossSection, union 3D płyty z cokołem; gwarantuje manifold.
- **three** — podgląd 3D (OrbitControls, grid, auto-fit kamery).
- **fflate** — ZIP dla 3MF. STL binarny pisany ręcznie.
- **zustand** — stan UI. **vite-plugin-pwa** — PWA / offline.

## Pipeline (src/pipeline/cutout.ts, uruchamiany w Web Workerze)
1. `image/threshold.ts` — grayscale (alfa → białe tło), blur (separable gaussian), Otsu, threshold, invert.
2. `image/morphology.ts` — EDT (Felzenszwalb), dylatacja/erozja dyskiem, domykanie przerw, usuwanie plamek i małych dziur (etykietowanie komponentów).
3. `geometry/contours.ts` — marching squares (siodła rozdzielone → brak styków w punkcie), łączenie w pierścienie.
4. px → mm (skala z bbox i docelowego wymiaru, oś Y w górę, dół figury = 0).
5. `geometry/simplify.ts` — Douglas-Peucker dla zamkniętych pierścieni.
6. `geometry/clip.ts` — union EvenOdd → PolyTree → `Poly{outer, holes}[]`.
7. `geometry/islands.ts` — komponenty, główna bryła (największe pole), komponenty „uziemione” (dotykają pasa przy podstawie), wyspy.
8. `geometry/bridges.ts` — algorytm Prima: wyspa ↔ zbiór już połączony (+ górna krawędź cokołu). Koszt = długość + kara kątowa (odchylenie od normalnych) + kara „widoczności” (średnia odległość od materiału z EDT tła, przecinanie materiału). Mostek = kapsuła, union z geometrią, iteracja aż 1 komponent.
9. `geometry/thickness.ts` — otwarcie morfologiczne (offset −r, +r); różnica = zbyt cienkie miejsca; wyszukiwanie binarne min. szerokości; opcjonalne pogrubienie lokalne/globalne.
10. `geometry/base.ts` — łączniki z cokołem (przeciągnięcie dolnego pasa figury w dół o snap+zagłębienie), prostokąt cokołu, środek ciężkości, kąty przewrócenia.
11. `mesh/extrude.ts` — CrossSection → extrude → obrót do pionu → union z cokołem (zaokrąglony prostokąt) → mesh.
12. `mesh/validate.ts` — niezależna walidacja (krawędzie ×2, orientacja, komponenty, objętość, bbox, genus).
13. `mesh/exportStl.ts`, `mesh/export3mf.ts`.

## Architektura trybów
`src/modes/` — rejestr trybów (`cutout` aktywny; `relief`, `lithophane`, `slotBase` zarezerwowane, nieaktywne w UI).

## Testy (vitest)
prostokąt → 1 komponent; prostokąt + kropka → wyspa; mostek → 1 komponent; otwór zostaje otworem; cokół dotyka modelu; mesh zamknięty/manifold; STL/3MF poprawne.
