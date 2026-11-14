// presets.ts — the registry of selectable palettes. See FRONTEND_WORKFLOW.md §1.4.
// The hex values themselves live in tokens.css under [data-theme='…'];
// this file only lists what exists so the Settings UI can render swatches.

export type PaletteId = 'indigo' | 'violet' | 'ocean' | 'sky' | 'grape' | 'graphite';
export type Mode = 'light' | 'dark';

export interface PalettePreset {
  id: PaletteId;
  label: string;
  swatch: string; // the accent hex, for the Settings swatch only
}

export const PALETTES: PalettePreset[] = [
  { id: 'indigo', label: 'Indigo', swatch: '#5b6cf0' },
  { id: 'violet', label: 'Violet', swatch: '#7c5cf5' },
  { id: 'ocean', label: 'Ocean', swatch: '#3b82f6' },
  { id: 'sky', label: 'Sky', swatch: '#0ea5c9' },
  { id: 'grape', label: 'Grape', swatch: '#b44de0' },
  { id: 'graphite', label: 'Graphite', swatch: '#4b5366' },
];

export const DEFAULT_PALETTE: PaletteId = 'indigo';

export function isPaletteId(v: unknown): v is PaletteId {
  return typeof v === 'string' && PALETTES.some((p) => p.id === v);
}
