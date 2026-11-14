// One line-icon set on a 24px grid, so icons share stroke, size and baseline across the app.
const dot = (x: number, y: number, r = 1.5) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

export const ICONS = {
  trash: { paths: ['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6'] },
  copy: { paths: ['M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'] },
  history: { paths: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'] },
  check: { paths: ['M20 6 9 17l-5-5'] },
  undo: { paths: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'] },
  redo: { paths: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'] },
  close: { paths: ['M18 6 6 18', 'M6 6l12 12'] },
  plus: { paths: ['M12 5v14', 'M5 12h14'] },
  'chevron-left': { paths: ['M15 18l-6-6 6-6'] },
  'chevron-right': { paths: ['M9 18l6-6-6-6'] },
  external: { paths: ['M7 17 17 7', 'M8 7h9v9'] },
  list: { paths: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3.5 6h.01', 'M3.5 12h.01', 'M3.5 18h.01'] },
  menu: { paths: ['M4 6h16', 'M4 12h16', 'M4 18h16'] },
  pin: {
    paths: [
      'M12 17v5',
      'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
    ],
  },
  more: { fill: true, paths: [dot(5, 12, 1.8), dot(12, 12, 1.8), dot(19, 12, 1.8)] },
  grip: { fill: true, paths: [dot(9, 6), dot(15, 6), dot(9, 12), dot(15, 12), dot(9, 18), dot(15, 18)] },
  play: { fill: true, paths: ['M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z'] },
} satisfies Record<string, { paths: string[]; fill?: boolean }>;

export type IconName = keyof typeof ICONS;
