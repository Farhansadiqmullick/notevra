// useTheme.ts — apply and persist the active palette + mode.
// Spec: FRONTEND_WORKFLOW.md §1.4.
//
// Two persistence layers, on purpose:
//   - localStorage — synchronous, read by the no-flash boot script in index.html BEFORE Vue, so
//     the first paint is already themed. This is the fast path.
//   - db.meta['theme'] — the DURABLE copy: it rides along in export/import and is ready to sync as
//     device meta later. Written on every apply; reconciled into the refs on boot (e.g. after an
//     import brought a different theme).

import { ref, readonly } from 'vue';
import { db } from '@/core/db/schema';
import { PALETTES, DEFAULT_PALETTE, isPaletteId, type PaletteId, type Mode } from '@/theme/presets';

const STORAGE_KEY = 'theme';
const META_KEY = 'theme';

const palette = ref<PaletteId>(DEFAULT_PALETTE);

/** the UI typeface (fonts.css maps each id to --font-ui); all open-source and self-hosted */
export const FONTS = [
  { id: 'jakarta', label: 'Plus Jakarta Sans', sample: "'Plus Jakarta Sans', sans-serif" },
  { id: 'inter', label: 'Inter', sample: "'Inter', sans-serif" },
  { id: 'lora', label: 'Lora (serif)', sample: "'Lora', serif" },
  { id: 'mono', label: 'JetBrains Mono', sample: "'JetBrains Mono', monospace" },
] as const;
export type FontId = (typeof FONTS)[number]['id'];
const isFontId = (v: unknown): v is FontId => FONTS.some((f) => f.id === v);
const font = ref<FontId>('jakarta');
const mode = ref<Mode>('light');

function systemMode(): Mode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Read the persisted choice (or system default) and stamp the DOM. Call once at boot. */
function init(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    palette.value = isPaletteId(saved.palette) ? saved.palette : DEFAULT_PALETTE;
    mode.value = saved.mode === 'dark' || saved.mode === 'light' ? saved.mode : systemMode();
    font.value = isFontId(saved.font) ? saved.font : 'jakarta';
  } catch {
    palette.value = DEFAULT_PALETTE;
    mode.value = systemMode();
  }
  stamp();
  void hydrateFromMeta(); // reconcile with the durable copy (e.g. after an import)
}

/** Pull the durable theme from db.meta and apply it if it differs (async, post-first-paint). */
async function hydrateFromMeta(): Promise<void> {
  try {
    const row = await db.meta.get(META_KEY);
    const v = row?.value as { palette?: unknown; mode?: unknown; font?: unknown } | undefined;
    if (!v) return;
    let changed = false;
    if (isPaletteId(v.palette) && v.palette !== palette.value) { palette.value = v.palette; changed = true; }
    if ((v.mode === 'dark' || v.mode === 'light') && v.mode !== mode.value) { mode.value = v.mode; changed = true; }
    if (isFontId(v.font) && v.font !== font.value) { font.value = v.font; changed = true; }
    if (changed) {
      stamp();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted()));
    }
  } catch {
    /* db not ready / no meta — the localStorage stamp already applied */
  }
}

/**
 * The browser chrome around the app: Android's status bar in a standalone window, and the tab/title
 * bar in some desktop browsers. The manifest's `theme_color` is baked in at install time and cannot
 * follow a runtime choice, so the meta tag is the only thing that can — without this, an installed
 * app in dark mode keeps a light status bar forever.
 *
 * Values are --page from tokens.css §1/§4. Read from the DOM rather than hardcoded a second time,
 * so a palette edit in the stylesheet can't drift out of sync with this.
 */
function stampThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
  if (page) meta.setAttribute('content', page);
}

function stamp(): void {
  const el = document.documentElement;
  el.dataset.theme = palette.value;
  el.dataset.mode = mode.value;
  el.dataset.font = font.value;
  stampThemeColor();
}

const persisted = () => ({ palette: palette.value, mode: mode.value, font: font.value });

function apply(next: { palette?: PaletteId; mode?: Mode; font?: FontId }): void {
  if (next.palette) palette.value = next.palette;
  if (next.mode) mode.value = next.mode;
  if (next.font) font.value = next.font;
  stamp();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted()));
  void db.meta.put({ key: META_KEY, value: persisted() }).catch(() => {});
}

export function useTheme() {
  return {
    palettes: PALETTES,
    palette: readonly(palette),
    mode: readonly(mode),
    font: readonly(font),
    fonts: FONTS,
    init,
    apply,
  };
}
