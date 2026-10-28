// One consistent icon family: 16px grid, 1.5px round strokes (transport glyphs are solid).
const L = (body) => `<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

const ICONS = {
  // transport (solid)
  play: '<path d="M4.5 2.8v10.4a.5.5 0 0 0 .76.43l8.3-5.2a.5.5 0 0 0 0-.86l-8.3-5.2a.5.5 0 0 0-.76.43z"/>',
  pause: '<rect x="3.5" y="2.5" width="3" height="11" rx="1"/><rect x="9.5" y="2.5" width="3" height="11" rx="1"/>',
  stop: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/>',
  record: '<circle cx="8" cy="8" r="4.5"/>',
  restart: '<rect x="2.6" y="3" width="2" height="10" rx=".8"/><path d="M13.4 3.6v8.8a.5.5 0 0 1-.78.41L6.5 8.41a.5.5 0 0 1 0-.82l6.12-4.4a.5.5 0 0 1 .78.41z"/>',

  // tools
  metronome: L('<path d="M5.4 14h5.2l1.1-9.5a1 1 0 0 0-.2-.7L8.9 1.6a1.2 1.2 0 0 0-1.8 0L4.5 3.8a1 1 0 0 0-.2.7z"/><path d="m8 10 3-5.5"/>'),
  loop: L('<path d="M3 7.5V7a3 3 0 0 1 3-3h6.5"/><path d="m10.5 1.8 2 2.2-2 2.2"/><path d="M13 8.5V9a3 3 0 0 1-3 3H3.5"/><path d="m5.5 14.2-2-2.2 2-2.2"/>'),
  magnet: L('<path d="M3 8.5V3h3v5.5a2 2 0 0 0 4 0V3h3v5.5a5 5 0 0 1-10 0z"/><path d="M3 5.5h3M10 5.5h3"/>'),
  pencil: L('<path d="M2.5 13.5 3.4 10 10.8 2.6a1.4 1.4 0 0 1 2 0l.6.6a1.4 1.4 0 0 1 0 2L6 12.6z"/><path d="m9.5 3.9 2.6 2.6"/>'),
  eraser: L('<path d="m6.8 13.5 6.2-6.2a1.4 1.4 0 0 0 0-2l-2.3-2.3a1.4 1.4 0 0 0-2 0L2.5 9a1.4 1.4 0 0 0 0 2l2.3 2.3a1.4 1.4 0 0 0 1 .4H13"/><path d="m5.5 5.7 4.8 4.8"/>'),
  mute: L('<path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="m10.5 6 3 4M13.5 6l-3 4"/>'),
  slice: L('<circle cx="4" cy="4" r="1.8"/><circle cx="4" cy="12" r="1.8"/><path d="m5.5 5.2 8 6.3M5.5 10.8l8-6.3"/>'),
  select: L('<path d="M2.5 5.5v-2a1 1 0 0 1 1-1h2M10.5 2.5h2a1 1 0 0 1 1 1v2M13.5 10.5v2a1 1 0 0 1-1 1h-2M5.5 13.5h-2a1 1 0 0 1-1-1v-2"/>'),
  zoom: L('<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.5 3.5"/>'),
  speaker: L('<path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5"/>'),

  // ui
  plus: L('<path d="M8 3v10M3 8h10"/>'),
  minus: L('<path d="M3 8h10"/>'),
  close: L('<path d="m4 4 8 8M12 4l-8 8"/>'),
  minimize: L('<path d="M4 11.5h8"/>'),
  maximize: L('<rect x="3.5" y="3.5" width="9" height="9" rx="1"/>'),
  chevronRight: L('<path d="m6 3.5 4.5 4.5L6 12.5"/>'),
  chevronDown: L('<path d="m3.5 6 4.5 4.5L12.5 6"/>'),
  undo: L('<path d="M3.5 6.5h5.8a3.2 3.2 0 0 1 0 6.4H6"/><path d="M6 3.5 3 6.5l3 3"/>'),
  redo: L('<path d="M12.5 6.5H6.7a3.2 3.2 0 0 0 0 6.4H10"/><path d="m10 3.5 3 3-3 3"/>'),
  save: L('<path d="M3 3.5A1 1 0 0 1 4 2.5h6.4L13 5.1V12.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M5.5 2.5v3h4v-3M5.5 13.5v-4h5v4"/>'),
  open: L('<path d="M2 12.5V4a1 1 0 0 1 1-1h3l1.5 1.5H12a1 1 0 0 1 1 1V7"/><path d="m2 12.5 1.4-4.2a1 1 0 0 1 1-.7H14l-1.5 4.4a1 1 0 0 1-1 .7z"/>'),
  folder: L('<path d="M2 12V4a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>'),
  file: L('<path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13z"/><path d="M9 2.5v3h3"/>'),
  wave: L('<path d="M1.5 8h1.5l1.3-4 1.7 8 1.7-9 1.4 7 1.2-4h2.2"/>'),
  note: L('<path d="M6 11.5V3.5l7-1.5v8"/><circle cx="4.3" cy="11.7" r="1.8"/><circle cx="11.3" cy="10" r="1.8"/>'),
  keys: L('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5.3 13V9M8 13V9M10.7 13V9M5.3 3v4M10.7 3v4"/>'),
  channelrack: L('<rect x="2" y="2.5" width="3" height="3" rx=".7"/><rect x="6.5" y="2.5" width="3" height="3" rx=".7"/><rect x="11" y="2.5" width="3" height="3" rx=".7"/><rect x="2" y="6.5" width="3" height="3" rx=".7"/><rect x="6.5" y="6.5" width="3" height="3" rx=".7"/><rect x="11" y="6.5" width="3" height="3" rx=".7"/><rect x="2" y="10.5" width="3" height="3" rx=".7"/><rect x="6.5" y="10.5" width="3" height="3" rx=".7"/><rect x="11" y="10.5" width="3" height="3" rx=".7"/>'),
  pianoroll: L('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M6 2v12"/><path d="M8.5 5.5h3M7.5 8.5h4.5M8.5 11.5h2.5"/>'),
  playlist: L('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M2 10h12M6 6v8"/>'),
  mixer: L('<path d="M4 2.5v11M8 2.5v11M12 2.5v11"/><rect x="2.5" y="9" width="3" height="2.2" rx=".6" fill="currentColor"/><rect x="6.5" y="4.3" width="3" height="2.2" rx=".6" fill="currentColor"/><rect x="10.5" y="7" width="3" height="2.2" rx=".6" fill="currentColor"/>'),
  browser: L('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/>'),
  fx: L('<path d="M2 11.5c1.5-6 2.7-6 3.7 0s2.2-6 3.7 0 2.2-6 3.1-2.4"/>'),
  gear: L('<circle cx="8" cy="8" r="2.2"/><path d="M6.9 1.8h2.2l.4 1.7 1.2.7 1.7-.5 1.1 1.9-1.3 1.2v1.4l1.3 1.2-1.1 1.9-1.7-.5-1.2.7-.4 1.7H6.9l-.4-1.7-1.2-.7-1.7.5-1.1-1.9 1.3-1.2V7.3L2.5 6.1l1.1-1.9 1.7.5 1.2-.7z"/>'),
  settings: L('<path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/>'),
  cpu: L('<rect x="4" y="4" width="8" height="8" rx="1"/><path d="M6.5 1.5v2.5M9.5 1.5v2.5M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5"/>'),
  help: L('<circle cx="8" cy="8" r="5.8"/><path d="M6.3 6.3a1.8 1.8 0 1 1 2.5 1.7c-.6.3-.8.7-.8 1.2"/><path d="M8 11.4h.01"/>'),
  export: L('<path d="M8 2.5v7.5M5 7l3 3 3-3"/><path d="M2.5 11v2a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-2"/>'),
  pattern: L('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h3.5"/>'),
  arrowRight: L('<path d="M2.5 8h10M9 4.5 12.5 8 9 11.5"/>'),
  piano: L('<rect x="2" y="2.5" width="12" height="11" rx="1.2"/><path d="M5.3 13.5v-4.5M8 13.5v-4.5M10.7 13.5v-4.5"/><path d="M4.5 2.5v6.5h1.6V2.5zM9.9 2.5v6.5h1.6V2.5z" fill="currentColor"/>'),
  sampler: L('<path d="M1.5 8h1.4l1.2-3.6 1.6 7.2 1.5-8.4 1.4 6.2 1-1.4h4.9"/>'),
  synth: L('<path d="M1.5 10.5c1.4-5.5 2.6-5.5 4 0s2.6-5.5 4 0 2.4-3.5 5-2.5"/>'),
  drum: L('<ellipse cx="8" cy="5.5" rx="5.5" ry="2.3"/><path d="M2.5 5.5v5c0 1.3 2.5 2.3 5.5 2.3s5.5-1 5.5-2.3v-5"/><path d="m3.8 2.2 2 2.2M12.2 2.2l-2 2.2"/>'),
};

export function icon(name, cls = '') {
  const body = ICONS[name];
  if (!body) throw new Error(`Unknown icon: ${name}`);
  const span = document.createElement('span');
  span.innerHTML = `<svg class="ico ${cls}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${body}</svg>`;
  return span.firstElementChild;
}

export const iconSvg = (name, cls = '') => icon(name, cls).outerHTML;
