import React from 'react';

/** Line icons on a 24×24 grid (shapes after Lucide, ISC). Strings are paths; objects are other SVG elements. */
const ICONS = {
  plus: ['M5 12h14', 'M12 5v14'],
  minus: ['M5 12h14'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronLeft: ['m15 18-6-6 6-6'],
  chevronRight: ['m9 18 6-6-6-6'],
  arrowUp: ['m5 12 7-7 7 7', 'M12 19V5'],
  image: [{ rect: { x: 3, y: 3, width: 18, height: 18, rx: 2 } }, { circle: { cx: 9, cy: 9, r: 2 } }, 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'],
  video: ['m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5', { rect: { x: 2, y: 6, width: 14, height: 12, rx: 2 } }],
  script: ['M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z', 'm6.2 5.3 3.1 3.9', 'm12.4 3.4 3.1 4', 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
  text: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
  frame: ['M22 6H2', 'M22 18H2', 'M6 2v20', 'M18 2v20'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  hand: ['M18 11V6a2 2 0 0 0-4 0', 'M14 10V4a2 2 0 0 0-4 0v2', 'M10 10.5V6a2 2 0 0 0-4 0v8', 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'],
  pointer: ['M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z'],
  map: ['M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z', 'M15 5.764v15', 'M9 3.236v15'],
  edges: [{ circle: { cx: 19, cy: 5, r: 2 } }, { circle: { cx: 5, cy: 19, r: 2 } }, 'M5 17A12 12 0 0 1 17 5'],
  grid: [{ rect: { x: 3, y: 3, width: 18, height: 18, rx: 2 } }, 'M3 9h18', 'M3 15h18', 'M9 3v18', 'M15 3v18'],
  fit: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2'],
  maximize: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  settings: ['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'],
  paperclip: ['m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48'],
  sun: [{ circle: { cx: 12, cy: 12, r: 4 } }, 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  sparkles: ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'],
  rotate: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  keyboard: [{ rect: { x: 2, y: 4, width: 20, height: 16, rx: 2 } }, 'M6 8h.01', 'M10 8h.01', 'M14 8h.01', 'M18 8h.01', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01', 'M7 16h10'],
  play: ['M6 3 20 12 6 21Z'],
  target: [{ circle: { cx: 12, cy: 12, r: 10 } }, { circle: { cx: 12, cy: 12, r: 3 } }],
  palette: ['M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z', { circle: { cx: 13.5, cy: 6.5, r: 0.5 } }, { circle: { cx: 17.5, cy: 10.5, r: 0.5 } }, { circle: { cx: 6.5, cy: 12.5, r: 0.5 } }, { circle: { cx: 8.5, cy: 7.5, r: 0.5 } }],
  library: ['m16 6 4 14', 'M12 6v14', 'M8 8v12', 'M4 4v16'],
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  search: [{ circle: { cx: 11, cy: 11, r: 8 } }, 'm21 21-4.3-4.3'],
  wand: ['m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72', 'm14 7 3 3', 'M5 6v4', 'M19 14v4', 'M10 2v2', 'M7 8H3', 'M21 16h-4', 'M11 3H9'],
  grip: [{ circle: { cx: 9, cy: 12, r: 1.2 } }, { circle: { cx: 9, cy: 5, r: 1.2 } }, { circle: { cx: 9, cy: 19, r: 1.2 } }, { circle: { cx: 15, cy: 12, r: 1.2 } }, { circle: { cx: 15, cy: 5, r: 1.2 } }, { circle: { cx: 15, cy: 19, r: 1.2 } }],
};

export function Icon({ name, size = 16, className, strokeWidth = 1.75 }) {
  const parts = ICONS[name];
  if (parts === undefined) return null;
  return (
    <svg className={'dshc-icon' + (className ? ' ' + className : '')} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {parts.map((part, index) => (typeof part === 'string'
        ? <path key={index} d={part} />
        : React.createElement(Object.keys(part)[0], { key: index, ...Object.values(part)[0] })))}
    </svg>
  );
}

/** Icon of each node kind, shared by the add menu, node titles and the empty-canvas guide. */
export const KIND_ICON = { image: 'image', video: 'video', script: 'script', text: 'text', frame: 'frame', generator: 'wand', import: 'upload', link: 'link', library: 'library' };
