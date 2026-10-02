import type { ModeId } from '../types';

// Rejestr trybów generatora. Każdy tryb dostaje maskę / obraz w skali szarości
// i parametry, a zwraca bryłę + raport walidacji (wspólny eksport STL/3MF).
// Tryby: „cutout”, „relief”, „slotBase” (cutout z cokołem typu slot), „lithophane”.

export interface ModeInfo {
  id: ModeId;
  label: string;
  description: string;
  available: boolean;
}

export const MODES: ModeInfo[] = [
  {
    id: 'cutout',
    label: 'Wycinanka',
    description: 'Sylwetka wycięta z płyty, z automatycznymi mostkami i cokołem.',
    available: true,
  },
  {
    id: 'relief',
    label: 'Relief',
    description: 'Płytka bazowa + wypukły (lub wklęsły) wzór, leży płasko na stole.',
    available: true,
  },
  {
    id: 'lithophane',
    label: 'Lithophane',
    description: 'Grubość zależna od jasności pikseli — obraz widoczny pod światło.',
    available: true,
  },
  {
    id: 'slotBase',
    label: 'Podstawka wsuwana',
    description: 'Figurka z językiem (drukowana na płasko) + osobny cokół ze slotem, z luzem.',
    available: true,
  },
];
