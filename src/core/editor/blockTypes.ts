/**
 * blockTypes — the one list of insertable block types, shared by the ⌘K palette and the inline
 * `/` menu (core, no Vue). `convertible` = can be reached by typing `/` in an existing text block
 * (turns this block into that type). Non-convertible types would be insert-only via ⌘K.
 *
 * Every type is currently convertible: `convertBlock` resets the block's props to the type's
 * defaults, so turning a paragraph into a table/image/video is well-defined, and users expect the
 * full menu from `/` (Notion-style) rather than a subset.
 */
export interface BlockTypeDef {
  type: string;
  label: string;
  glyph: string;
  convertible: boolean;
  defaults: () => Record<string, unknown>;
}

export const BLOCK_TYPES: BlockTypeDef[] = [
  { type: 'task', label: 'Task', glyph: '☑', convertible: true, defaults: () => ({}) },
  { type: 'heading', label: 'Heading', glyph: 'H', convertible: true, defaults: () => ({ level: 2 }) },
  { type: 'paragraph', label: 'Text', glyph: '¶', convertible: true, defaults: () => ({}) },
  { type: 'quote', label: 'Quote', glyph: '"', convertible: true, defaults: () => ({}) },
  { type: 'callout', label: 'Callout', glyph: '!', convertible: true, defaults: () => ({ tone: 'warn' }) },
  { type: 'divider', label: 'Divider', glyph: '—', convertible: true, defaults: () => ({}) },
  { type: 'bulleted', label: 'Bulleted list', glyph: '•', convertible: true, defaults: () => ({ items: ['New item'] }) },
  { type: 'numbered', label: 'Numbered list', glyph: '1.', convertible: true, defaults: () => ({ items: ['New item'] }) },
  // Sits next to Text on purpose: the difference between them is what Enter does, and someone
  // scanning the menu for "a place to type several lines" should find the two side by side.
  { type: 'textarea', label: 'Text area', glyph: '¶+', convertible: true, defaults: () => ({}) },
  { type: 'code', label: 'Code', glyph: '</>', convertible: true, defaults: () => ({ language: 'text', filename: 'snippet', code: '// code' }) },
  { type: 'table', label: 'Table', glyph: '▦', convertible: true, defaults: () => ({ headers: ['A', 'B'], rows: [['', '']] }) },
  { type: 'toggle', label: 'Toggle list', glyph: '▸', convertible: true, defaults: () => ({ items: [''] }) },
  { type: 'image', label: 'Image', glyph: '▣', convertible: true, defaults: () => ({ caption: '' }) },
  { type: 'video', label: 'Video', glyph: '▶', convertible: true, defaults: () => ({ caption: '' }) },
];

export const CONVERTIBLE_TYPES = BLOCK_TYPES.filter((d) => d.convertible);
export const defForType = (type: string) => BLOCK_TYPES.find((d) => d.type === type);
