// Per-block text size (`props.size`) and colours (`props.color` / `props.bg`, ids map to --hue-* in tokens.css).
import { blockService } from '@/services/block.service';
import type { BlockRow } from '@/core/db/schema';

// headings already have their own sizes
export const SIZEABLE = ['paragraph', 'quote', 'callout', 'textarea', 'task'];
export const SIZES = [
  { id: 'sm', label: 'Small' },
  { id: 'normal', label: 'Normal' },
  { id: 'lg', label: 'Large' },
] as const;
export type SizeId = (typeof SIZES)[number]['id'];
export const sizeOf = (b: BlockRow): SizeId => (b.props?.size === 'sm' || b.props?.size === 'lg' ? b.props.size : 'normal');

export async function setSize(b: BlockRow, size: SizeId) {
  const { size: _old, ...rest } = b.props ?? {};
  await blockService.updateBlock(b.id, { props: size === 'normal' ? rest : { ...rest, size } });
}

export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export type ColorId = (typeof COLORS)[number];
export type ColorKey = 'color' | 'bg';

export const colorOf = (b: BlockRow, key: ColorKey): ColorId | null =>
  (COLORS as readonly string[]).includes(b.props?.[key] as string) ? (b.props![key] as ColorId) : null;

// opaque, mixed into the page colour: a see-through tint painted twice where blocks overlap showed a stripe
export const tint = (c: ColorId) => `color-mix(in srgb, var(--hue-${c}) var(--hue-bg-mix), var(--surface))`;

export function colorStyle(b: BlockRow) {
  const fg = colorOf(b, 'color');
  const bg = colorOf(b, 'bg');
  return { ...(fg ? { '--blk-fg': `var(--hue-${fg})` } : {}), ...(bg ? { '--blk-bg': tint(bg) } : {}) };
}

export async function setColor(b: BlockRow, key: ColorKey, value: ColorId | null) {
  const { [key]: _old, ...rest } = b.props ?? {};
  await blockService.updateBlock(b.id, { props: value ? { ...rest, [key]: value } : rest });
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
