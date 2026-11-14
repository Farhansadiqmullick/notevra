// ⌘ exists only on Apple keyboards; everyone else presses Ctrl
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** a shortcut as this keyboard spells it, e.g. `shortcut('K')` → "⌘K" or "Ctrl K" */
export const shortcut = (key: string): string => (IS_MAC ? `⌘${key}` : `Ctrl ${key}`);
