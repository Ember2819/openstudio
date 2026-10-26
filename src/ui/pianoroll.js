import { h, clamp, isBlackKey, noteName, shade, rgba } from '../util.js';
import { icon } from './icons.js';
import { showMenuBelow } from './menu.js';
import { createSnapSelect } from './snapselect.js';
import { snapSize, snapRound, snapFloor } from './snap.js';
import { sizeCanvas, roundRect } from './draw.js';
import { STEPS_PER_BAR, STEPS_PER_BEAT } from '../state.js';
import { kitKeyNames, isKitChannel } from '../audio/catalog.js';

const KEYS_W = 84;
const RULER_H = 22;
const VEL_H = 86;
const PITCHES = 120; // C0..B9
const MIN_LEN = 0.0625;

const TOOLS = [
  ['draw', 'pencil', 'Draw — click to add notes, drag to move or resize, right-click to delete'],
  ['select', 'select', 'Select — drag a box to select notes (hold Ctrl for a temporary select tool)'],
  ['delete', 'eraser', 'Delete — click or drag over notes to remove them'],
  ['mute', 'mute', 'Mute — click notes to mute or unmute them'],
  ['slice', 'slice', 'Slice — click a note to cut it in two'],
];

const SCALES = {
  'Major': [0, 2, 4, 5, 7, 9, 11], 'Natural minor': [0, 2, 3, 5, 7, 8, 10], 'Harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'Dorian': [0, 2, 3, 5, 7, 9, 10], 'Phrygian': [0, 1, 3, 5, 7, 8, 10], 'Lydian': [0, 2, 4, 6, 7, 9, 11], 'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Major pentatonic': [0, 2, 4, 7, 9], 'Minor pentatonic': [0, 3, 5, 7, 10], 'Blues': [0, 3, 5, 6, 7, 10],
};
const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// chord stamps (intervals above the clicked key), like FL Studio's stamp tool
const CHORDS = {
  'Major': [0, 4, 7], 'Minor': [0, 3, 7], 'Power': [0, 7, 12], 'Sus2': [0, 2, 7], 'Sus4': [0, 5, 7],
  'Diminished': [0, 3, 6], 'Augmented': [0, 4, 8], 'Major 7': [0, 4, 7, 11], 'Minor 7': [0, 3, 7, 10],
  'Dominant 7': [0, 4, 7, 10], 'Minor 9': [0, 3, 7, 10, 14], 'Major 9': [0, 4, 7, 11, 14], 'Add 9': [0, 4, 7, 14],
};

export function createPianoRoll(app) {
  const { store, wm, transport, engine } = app;

  const win = wm.create({
    id: 'piano', title: 'Piano roll', icon: 'pianoroll', minW: 520, minH: 280,
    rect: (dw, dh) => ({ x: Math.max(20, dw * 0.04), y: Math.max(40, dh * 0.2), w: Math.min(1000, dw - 60), h: Math.min(540, dh - 80) }),
    visible: false,
  });

  const S = { tool: 'draw', px: 24, rowH: 16, selection: new Set(), lastLen: null, clipboard: [], ghosts: true, band: null, pressed: new Set(), scale: null /* {root, name} */, chord: null };

  // ---------------------------------------------------------------- layout
  const toolBtns = TOOLS.map(([id, ico, tip]) => {
    const b = h('button', { class: 'tbtn', 'data-hint': tip, onClick: () => { S.tool = id; refreshTools(); } }, icon(ico));
    b._id = id;
    return b;
  });
  const refreshTools = () => toolBtns.forEach((b) => b.classList.toggle('on', b._id === S.tool));
  refreshTools();

  const chanLabel = h('span', { class: 'pr-chan-name' }, '');
  const chanSwatch = h('span', { class: 'pat-swatch' });
  const chanBtn = h('button', { class: 'dd pr-chan', 'data-hint': 'Channel being edited — click to switch' }, chanSwatch, chanLabel, h('span', { class: 'caret' }, '▼'));
  chanBtn.addEventListener('click', () => {
    showMenuBelow(chanBtn, store.project.channels.map((c) => ({ label: c.name, swatch: c.color, checked: c.id === store.project.selected.channel, action: () => store.selectChannel(c.id) })));
  });
  const scaleLabel = h('span', {}, 'Scale: off');
  const scaleBtn = h('button', { class: 'dd', 'data-hint': 'Highlight the notes of a scale' }, scaleLabel, h('span', { class: 'caret' }, '▼'));
  scaleBtn.addEventListener('click', () => {
    const setScale = (sc) => { S.scale = sc; scaleLabel.textContent = sc ? `${ROOTS[sc.root]} ${sc.name}` : 'Scale: off'; invalidate(); };
    const root = S.scale?.root ?? 0;
    showMenuBelow(scaleBtn, [
      { label: 'No highlighting', checked: !S.scale, action: () => setScale(null) },
      { separator: true },
      { label: `Root: ${ROOTS[root]}`, submenu: ROOTS.map((r, i) => ({ label: r, checked: root === i, action: () => setScale({ root: i, name: S.scale?.name ?? 'Major' }) })) },
      { separator: true },
      ...Object.keys(SCALES).map((name) => ({ label: name, checked: S.scale?.name === name, action: () => setScale({ root, name }) })),
    ]);
  });
  const chordLabel = h('span', {}, 'Stamp: off');
  const chordBtn = h('button', { class: 'dd', 'data-hint': 'Stamp — draw whole chords with one click' }, chordLabel, h('span', { class: 'caret' }, '▼'));
  chordBtn.addEventListener('click', () => {
    const setChord = (c) => { S.chord = c; chordLabel.textContent = c ? `Stamp: ${c}` : 'Stamp: off'; };
    showMenuBelow(chordBtn, [
      { label: 'Off (single notes)', checked: !S.chord, action: () => setChord(null) },
      { separator: true },
      ...Object.keys(CHORDS).map((name) => ({ label: name, checked: S.chord === name, action: () => setChord(name) })),
    ]);
  });
  const toolsBtn = h('button', { class: 'dd', 'data-hint': 'Piano roll tools — act on the selection, or on every note when nothing is selected' }, h('span', {}, 'Tools'), h('span', { class: 'caret' }, '▼'));
  toolsBtn.addEventListener('click', () => {
    showMenuBelow(toolsBtn, [
      { label: 'Quick quantize', shortcut: 'Ctrl+Q', action: () => quantize() },
      { label: 'Quantize start times only', action: () => quantize(true) },
      { label: 'Quick legato', shortcut: 'Ctrl+L', action: () => legato() },
      { separator: true },
      { label: 'Duplicate', shortcut: 'Ctrl+B', action: () => duplicate() },
      { label: 'Transpose octave up', shortcut: 'Ctrl+↑', action: () => transpose(12) },
      { label: 'Transpose octave down', shortcut: 'Ctrl+↓', action: () => transpose(-12) },
      { label: 'Flip horizontally', action: () => flip() },
      { separator: true },
      { label: 'Randomize velocity', shortcut: 'Alt+R', action: () => randomize() },
      { label: 'Humanize timing', action: () => humanize() },
      { label: 'Scale velocity to 100%', action: () => edit((list) => { const max = Math.max(...list.map((n) => n.v)); for (const n of list) n.v = clamp(n.v / max, 0.02, 1); }) },
      { separator: true },
      { label: 'Select all', shortcut: 'Ctrl+A', action: () => { S.selection = new Set(notes()); invalidate(); } },
      { label: 'Deselect', shortcut: 'Ctrl+D', action: () => { S.selection.clear(); invalidate(); } },
    ]);
  });
  const ghostBtn = h('button', { class: 'tbtn on', 'data-hint': 'Show notes of other channels as ghosts', onClick: () => { S.ghosts = !S.ghosts; ghostBtn.classList.toggle('on', S.ghosts); invalidate(); } }, icon('note'));
  const zoomOut = h('button', { class: 'tbtn', 'data-hint': 'Zoom out (Ctrl+wheel)', onClick: () => zoom(1 / 1.25) }, '−');
  const zoomIn = h('button', { class: 'tbtn', 'data-hint': 'Zoom in (Ctrl+wheel)', onClick: () => zoom(1.25) }, '+');

  const toolbar = h('div', { class: 'pr-toolbar' },
    h('div', { class: 'tb-group' }, toolBtns),
    h('div', { class: 'pr-sep' }),
    createSnapSelect(app),
    h('div', { class: 'pr-sep' }),
    chanBtn,
    scaleBtn,
    chordBtn,
    toolsBtn,
    ghostBtn,
    h('div', { class: 'tb-flex' }),
    h('div', { class: 'tb-group' }, zoomOut, zoomIn));

  const cRuler = h('canvas', { class: 'pr-ruler' });
  const cKeys = h('canvas', { class: 'pr-keys' });
  const cGrid = h('canvas', { class: 'pr-grid' });
  const cVel = h('canvas', { class: 'pr-vel' });
  const spacer = h('div', { class: 'pr-spacer' });
  const scroller = h('div', { class: 'pr-scroller' }, spacer);
  const gridWrap = h('div', { class: 'pr-gridwrap' }, cGrid, scroller);
  const playhead = h('div', { class: 'pr-playhead' });
  const overlay = h('div', { class: 'pr-overlay' }, playhead);
  const velLabel = h('div', { class: 'pr-vel-label' }, 'Velocity');

  const main = h('div', { class: 'pr-main' },
    h('div', { class: 'pr-corner' }), cRuler,
    cKeys, gridWrap,
    velLabel, cVel,
    overlay);
  const root = h('div', { class: 'pr-root', tabIndex: 0 }, toolbar, main);
  win.body.append(root);

  const g2 = { grid: cGrid.getContext('2d'), ruler: cRuler.getContext('2d'), keys: cKeys.getContext('2d'), vel: cVel.getContext('2d') };
  const sizes = { gw: 0, gh: 0 };

  let firstLayout = true;
  function layout() {
    const gw = gridWrap.clientWidth;
    const gh = gridWrap.clientHeight;
    if (!gw || !gh) return;
    sizes.gw = gw; sizes.gh = gh;
    sizeCanvas(cGrid, g2.grid, gw, gh);
    sizeCanvas(cRuler, g2.ruler, gw, RULER_H);
    sizeCanvas(cKeys, g2.keys, KEYS_W, gh);
    sizeCanvas(cVel, g2.vel, gw, VEL_H);
    updateSpacer();
    if (firstLayout) { firstLayout = false; scroller.scrollTop = (PITCHES - 1 - 68) * S.rowH; }
    invalidate();
  }
  new ResizeObserver(layout).observe(gridWrap);

  const pat = () => store.currentPattern;
  const chan = () => store.selectedChannel;
  const notes = () => (chan() ? store.notesOf(pat(), chan().id) : []);
  /** Map(key -> name) when the channel is a full drum kit, else null (keys are labelled with drum names). */
  const kitNames = () => {
    const ch = chan();
    const cat = app.actions.catalog();
    return ch && cat && isKitChannel(ch) ? kitKeyNames(cat, ch.program) : null;
  };
  const totalSteps = () => store.patternSteps(pat()) + 2 * STEPS_PER_BAR;
  const snap = () => snapSize(app.ui.snap, S.px);

  function updateSpacer() {
    spacer.style.width = `${totalSteps() * S.px}px`;
    spacer.style.height = `${PITCHES * S.rowH}px`;
  }

  function zoom(f, anchorX = sizes.gw / 2) {
    const worldStep = (scroller.scrollLeft + anchorX) / S.px;
    S.px = clamp(S.px * f, 4, 140);
    updateSpacer();
    scroller.scrollLeft = worldStep * S.px - anchorX;
    invalidate();
  }

  // --------------------------------------------------------------- drawing
  let raf = 0;
  function invalidate() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (win.visible) draw(); });
  }

  function draw() {
    if (!sizes.gw) return;
    drawGrid();
    drawRuler();
    drawKeys();
    drawVelocity();
  }

  const BG_WHITE = '#33454c';
  const BG_BLACK = '#2a3a41';

  function drawGrid() {
    const ctx = g2.grid;
    const { gw, gh } = sizes;
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;
    const px = S.px;
    const rh = S.rowH;
    ctx.clearRect(0, 0, gw, gh);

    const kitForGrid = kitNames();
    const r0 = Math.max(0, Math.floor(sy / rh));
    const r1 = Math.min(PITCHES - 1, Math.ceil((sy + gh) / rh));
    for (let r = r0; r <= r1; r++) {
      const pitch = PITCHES - 1 - r;
      const y = r * rh - sy;
      const kitRow = kitForGrid;
      ctx.fillStyle = kitRow ? (kitRow.has(pitch) ? BG_WHITE : '#2a383f') : isBlackKey(pitch) ? BG_BLACK : BG_WHITE;
      ctx.fillRect(0, y, gw, rh);
      if (S.scale && !kitRow) {
        const inScale = SCALES[S.scale.name].includes(((pitch - S.scale.root) % 12 + 12) % 12);
        ctx.fillStyle = inScale ? 'rgba(146,200,80,.10)' : 'rgba(8,14,18,.22)';
        ctx.fillRect(0, y, gw, rh);
      }
    }
    // horizontal lines
    ctx.lineWidth = 1;
    for (let r = r0; r <= r1 + 1; r++) {
      const pitch = PITCHES - r;
      const y = Math.round(r * rh - sy) + 0.5;
      const octave = pitch % 12 === 0;
      const edge = [0, 5].includes(pitch % 12) && !isBlackKey(pitch); // C/F boundaries (between white keys)
      ctx.strokeStyle = octave ? '#1a272e' : edge ? '#233239' : '#2b3b42';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(gw, y); ctx.stroke();
    }

    // vertical lines
    const q0 = Math.floor(sx / px / 0.25);
    const q1 = Math.ceil((sx + gw) / px / 0.25);
    for (let q = q0; q <= q1; q++) {
      const step = q * 0.25;
      const x = Math.round(step * px - sx) + 0.5;
      let color = null;
      if (step % STEPS_PER_BAR === 0) color = '#101b21';
      else if (step % STEPS_PER_BEAT === 0) color = '#1a2a31';
      else if (Number.isInteger(step) && px >= 9) color = '#27383f';
      else if (step % 0.5 === 0 && px >= 36) color = '#2d3f46';
      else if (px >= 72) color = '#304349';
      if (!color) continue;
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gh); ctx.stroke();
    }

    // dim the area past the end of the pattern
    const endX = store.patternSteps(pat()) * px - sx;
    if (endX < gw) {
      ctx.fillStyle = 'rgba(8,14,18,.38)';
      ctx.fillRect(Math.max(0, endX), 0, gw, gh);
      ctx.strokeStyle = rgba('#ff9a1f', 0.55);
      ctx.beginPath(); ctx.moveTo(Math.round(endX) + 0.5, 0); ctx.lineTo(Math.round(endX) + 0.5, gh); ctx.stroke();
    }

    // ghost notes from other channels
    const cur = chan();
    if (S.ghosts) {
      for (const ch of store.project.channels) {
        if (ch === cur) continue;
        const list = pat().notes[ch.id];
        if (!list) continue;
        ctx.fillStyle = rgba(ch.color, 0.22);
        for (const n of list) {
          const x = n.s * px - sx;
          if (x > gw || x + n.l * px < 0) continue;
          const y = (PITCHES - 1 - n.p) * rh - sy;
          if (y < -rh || y > gh) continue;
          ctx.fillRect(x, y + 1, Math.max(2, n.l * px - 1), rh - 2);
        }
      }
    }

    // notes
    const kitLabels = kitNames();
    if (cur) {
      ctx.font = '10px "Noto Sans", sans-serif';
      ctx.textBaseline = 'middle';
      for (const n of notes()) {
        const x = n.s * px - sx;
        const w = Math.max(3, n.l * px - 1);
        if (x > gw || x + w < 0) continue;
        const y = (PITCHES - 1 - n.p) * rh - sy;
        if (y < -rh || y > gh) continue;
        const sel = S.selection.has(n);
        const base = n.m ? '#55626a' : sel ? shade(cur.color, 0.5) : shade(cur.color, -(1 - n.v) * 0.5);
        const grad = ctx.createLinearGradient(0, y, 0, y + rh);
        grad.addColorStop(0, n.m ? '#6a787f' : sel ? shade(cur.color, 0.7) : shade(cur.color, 0.18 - (1 - n.v) * 0.5));
        grad.addColorStop(1, base);
        ctx.fillStyle = grad;
        roundRect(ctx, x, y + 1, w, rh - 2, 2);
        ctx.fill();
        ctx.strokeStyle = sel ? '#ffffff' : 'rgba(0,0,0,.55)';
        ctx.lineWidth = sel ? 1.5 : 1;
        roundRect(ctx, x + 0.5, y + 1.5, w - 1, rh - 3, 2);
        ctx.stroke();
        if (w > 26 && rh >= 12) {
          ctx.fillStyle = sel ? '#14202a' : 'rgba(255,255,255,.85)';
          ctx.fillText(kitLabels?.get(n.p) ?? noteName(n.p), x + 4, y + rh / 2 + 0.5);
        }
      }
    }

    if (S.band) {
      const b = S.band;
      const x = Math.min(b.x0, b.x1) - sx;
      const y = Math.min(b.y0, b.y1) - sy;
      const w = Math.abs(b.x1 - b.x0);
      const hh = Math.abs(b.y1 - b.y0);
      ctx.fillStyle = 'rgba(255,154,31,.12)';
      ctx.fillRect(x, y, w, hh);
      ctx.strokeStyle = 'rgba(255,154,31,.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w, hh);
    }
  }

  function drawRuler() {
    const ctx = g2.ruler;
    const { gw } = sizes;
    const sx = scroller.scrollLeft;
    const px = S.px;
    const grad = ctx.createLinearGradient(0, 0, 0, RULER_H);
    grad.addColorStop(0, '#273840'); grad.addColorStop(1, '#1b2a31');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, gw, RULER_H);
    ctx.font = '10px "Noto Sans", sans-serif';
    ctx.textBaseline = 'middle';
    const s0 = Math.floor(sx / px);
    const s1 = Math.ceil((sx + gw) / px);
    for (let s = s0; s <= s1; s++) {
      const x = Math.round(s * px - sx) + 0.5;
      if (s % STEPS_PER_BAR === 0) {
        ctx.strokeStyle = '#8ea1aa';
        ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x, RULER_H); ctx.stroke();
        ctx.fillStyle = '#d3dde2';
        ctx.fillText(String(s / STEPS_PER_BAR + 1), x + 4, 8);
      } else if (s % STEPS_PER_BEAT === 0 && px * 4 >= 28) {
        ctx.strokeStyle = '#586a73';
        ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, RULER_H); ctx.stroke();
        if (px * 4 >= 64) { ctx.fillStyle = '#7f929b'; ctx.fillText(`${Math.floor(s / STEPS_PER_BAR) + 1}.${(s % STEPS_PER_BAR) / STEPS_PER_BEAT + 1}`, x + 3, 8); }
      } else if (px >= 14) {
        ctx.strokeStyle = '#3f525b';
        ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, RULER_H); ctx.stroke();
      }
    }
    ctx.strokeStyle = '#0c1519';
    ctx.beginPath(); ctx.moveTo(0, RULER_H - 0.5); ctx.lineTo(gw, RULER_H - 0.5); ctx.stroke();
  }

  function drawKeys() {
    const ctx = g2.keys;
    const { gh } = sizes;
    const sy = scroller.scrollTop;
    const rh = S.rowH;
    ctx.clearRect(0, 0, KEYS_W, gh);
    ctx.fillStyle = '#1a252b';
    ctx.fillRect(0, 0, KEYS_W, gh);
    const r0 = Math.max(0, Math.floor(sy / rh));
    const r1 = Math.min(PITCHES - 1, Math.ceil((sy + gh) / rh));
    ctx.font = '10px "Noto Sans", sans-serif';
    ctx.textBaseline = 'middle';
    const kit = kitNames();
    if (kit) { drawKitKeys(ctx, kit, r0, r1, sy, rh); return; }
    // white keys first
    for (let r = r0; r <= r1; r++) {
      const pitch = PITCHES - 1 - r;
      if (isBlackKey(pitch)) continue;
      const y = r * rh - sy;
      const down = S.pressed.has(pitch);
      const grad = ctx.createLinearGradient(0, 0, KEYS_W, 0);
      grad.addColorStop(0, down ? '#ffb55a' : '#e9eef1'); grad.addColorStop(1, down ? '#ff9a1f' : '#c3ccd1');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, KEYS_W, rh);
      ctx.strokeStyle = '#7d8b92';
      ctx.beginPath(); ctx.moveTo(0, Math.round(y + rh) - 0.5); ctx.lineTo(KEYS_W, Math.round(y + rh) - 0.5); ctx.stroke();
      if (kit) {
        const name = kit.get(pitch);
        if (name) { ctx.fillStyle = '#3b4a52'; ctx.fillText(name, 4, y + rh / 2 + 0.5); }
      } else if (pitch % 12 === 0) {
        ctx.fillStyle = '#3b4a52';
        ctx.fillText(noteName(pitch), KEYS_W - 24, y + rh / 2 + 0.5);
      }
    }
    for (let r = r0; r <= r1; r++) {
      const pitch = PITCHES - 1 - r;
      if (!isBlackKey(pitch)) continue;
      const y = r * rh - sy;
      const down = S.pressed.has(pitch);
      const grad = ctx.createLinearGradient(0, 0, KEYS_W * 0.62, 0);
      grad.addColorStop(0, down ? '#ff9a1f' : '#10171b'); grad.addColorStop(1, down ? '#ffb55a' : '#38464e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y + 1, KEYS_W * 0.62, rh - 1);
    }
    ctx.strokeStyle = '#0c1519';
    ctx.beginPath(); ctx.moveTo(KEYS_W - 0.5, 0); ctx.lineTo(KEYS_W - 0.5, gh); ctx.stroke();
  }

  function drawKitKeys(ctx, kit, r0, r1, sy, rh) {
    for (let r = r0; r <= r1; r++) {
      const pitch = PITCHES - 1 - r;
      const y = r * rh - sy;
      const name = kit.get(pitch);
      const down = S.pressed.has(pitch);
      ctx.fillStyle = down ? '#ff9a1f' : name ? '#c9d3d8' : '#26343b';
      ctx.fillRect(0, y, KEYS_W, rh);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(0, Math.round(y + rh) - 1, KEYS_W, 1);
      if (name) { ctx.fillStyle = '#26343b'; ctx.fillText(name, 6, y + rh / 2 + 0.5); }
    }
    ctx.strokeStyle = '#0c1519';
    ctx.beginPath(); ctx.moveTo(KEYS_W - 0.5, 0); ctx.lineTo(KEYS_W - 0.5, sizes.gh); ctx.stroke();
  }

  function drawVelocity() {
    const ctx = g2.vel;
    const { gw } = sizes;
    const sx = scroller.scrollLeft;
    const px = S.px;
    ctx.clearRect(0, 0, gw, VEL_H);
    ctx.fillStyle = '#26353c';
    ctx.fillRect(0, 0, gw, VEL_H);
    const q0 = Math.floor(sx / px);
    const q1 = Math.ceil((sx + gw) / px);
    for (let s = q0; s <= q1; s++) {
      const bar = s % STEPS_PER_BAR === 0;
      const beat = s % STEPS_PER_BEAT === 0;
      if (!bar && !beat && px < 9) continue;
      ctx.strokeStyle = bar ? '#101b21' : beat ? '#1a2a31' : '#2c3d44';
      const x = Math.round(s * px - sx) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VEL_H); ctx.stroke();
    }
    const endX = store.patternSteps(pat()) * px - sx;
    if (endX < gw) { ctx.fillStyle = 'rgba(8,14,18,.38)'; ctx.fillRect(Math.max(0, endX), 0, gw, VEL_H); }
    const cur = chan();
    if (!cur) return;
    for (const n of notes()) {
      const x = Math.round(n.s * px - sx) + 0.5;
      if (x < -4 || x > gw + 4) continue;
      const top = VEL_H - 8 - n.v * (VEL_H - 16);
      const sel = S.selection.has(n);
      ctx.strokeStyle = sel ? '#ffffff' : shade(cur.color, 0.1);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, VEL_H - 4); ctx.lineTo(x, top); ctx.stroke();
      ctx.fillStyle = sel ? '#ffffff' : shade(cur.color, 0.35);
      ctx.beginPath(); ctx.arc(x, top, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  // ---------------------------------------------------------- interaction
  const world = (e) => {
    const r = scroller.getBoundingClientRect();
    return { x: e.clientX - r.left + scroller.scrollLeft, y: e.clientY - r.top + scroller.scrollTop, vx: e.clientX - r.left, vy: e.clientY - r.top };
  };
  const onScrollbar = (e) => {
    const r = scroller.getBoundingClientRect();
    return e.clientX - r.left > scroller.clientWidth || e.clientY - r.top > scroller.clientHeight;
  };
  const pitchAt = (y) => clamp(PITCHES - 1 - Math.floor(y / S.rowH), 0, PITCHES - 1);

  function noteAt(x, y) {
    const list = notes();
    const row = pitchAt(y);
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.p !== row) continue;
      const x0 = n.s * S.px;
      const x1 = x0 + Math.max(n.l * S.px, 5);
      if (x >= x0 && x <= x1) return n;
    }
    return null;
  }
  const onRightEdge = (n, x) => {
    const x1 = (n.s + n.l) * S.px;
    return x1 - x <= 6 && n.l * S.px > 10;
  };

  let notesDirty = false;
  function emitNotes() {
    if (notesDirty) return;
    notesDirty = true;
    requestAnimationFrame(() => { notesDirty = false; store.emit('notes'); });
  }

  let drag = null;
  scroller.addEventListener('contextmenu', (e) => e.preventDefault());
  scroller.addEventListener('pointerdown', (e) => {
    if (onScrollbar(e)) return;
    root.focus({ preventScroll: true });
    const ch = chan();
    if (!ch) return;
    const w = world(e);
    const step = w.x / S.px;
    const pitch = pitchAt(w.y);
    const hit = noteAt(w.x, w.y);
    const sz = e.altKey ? 0 : snap();
    let tool = S.tool;
    if (e.button === 2) tool = 'erase';
    else if (e.ctrlKey || e.metaKey) tool = 'select';
    scroller.setPointerCapture(e.pointerId);

    if (tool === 'erase' || tool === 'delete') {
      store.checkpoint();
      drag = { type: 'erase' };
      eraseAt(w);
      return;
    }

    if (tool === 'mute') {
      store.checkpoint();
      drag = { type: 'mute', done: new Set() };
      if (hit) { hit.m = !hit.m; drag.done.add(hit); emitNotes(); invalidate(); }
      return;
    }
    if (tool === 'slice') {
      if (!hit) return;
      const at = snapRound(step, sz || 0.25);
      if (at <= hit.s + 0.01 || at >= hit.s + hit.l - 0.01) return;
      store.checkpoint();
      const tail = { ...hit, s: at, l: hit.s + hit.l - at };
      hit.l = at - hit.s;
      notes().push(tail);
      emitNotes(); invalidate();
      return;
    }

    if (hit) {
      if (!S.selection.has(hit)) { if (!e.shiftKey) S.selection.clear(); S.selection.add(hit); }
      else if (e.shiftKey) { S.selection.delete(hit); invalidate(); return; }
      store.checkpoint();
      const sel = [...S.selection];
      if (onRightEdge(hit, w.x)) {
        drag = { type: 'resize', anchor: step, orig: sel.map((n) => ({ n, l: n.l })), primary: hit };
      } else {
        drag = { type: 'move', anchor: step, anchorPitch: pitch, orig: sel.map((n) => ({ n, s: n.s, p: n.p })), primary: hit, lastPitch: pitch, moved: false };
        playPreview(ch, hit.p, hit.v);
      }
      invalidate();
      return;
    }

    if (tool === 'select') {
      if (!e.shiftKey) S.selection.clear();
      drag = { type: 'band', base: new Set(S.selection) };
      S.band = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      invalidate();
      return;
    }

    // draw: create a note
    S.selection.clear();
    store.checkpoint();
    const len = S.lastLen ?? (snap() || 1);
    const start = Math.max(0, snapFloor(step, sz));
    const pitches = (S.chord ? CHORDS[S.chord] : [0]).map((i) => pitch + i).filter((p) => p < PITCHES);
    const made = pitches.map((p) => store.addNote(pat(), ch.id, { p, s: start, l: len, v: 0.78 }));
    made.forEach((n) => S.selection.add(n));
    drag = { type: 'resize', anchor: step, orig: made.map((n) => ({ n, l: n.l })), primary: made[0], created: true };
    for (const p of pitches) playPreview(ch, p, 0.78, true);
    updateSpacer();
    emitNotes();
    invalidate();
  });

  scroller.addEventListener('pointermove', (e) => {
    const w = world(e);
    if (!drag) {
      // cursor hints
      const hit = onScrollbar(e) ? null : noteAt(w.x, w.y);
      scroller.style.cursor = hit && onRightEdge(hit, w.x) ? 'ew-resize' : hit ? 'grab' : S.tool === 'draw' ? 'crosshair' : 'default';
      return;
    }
    const step = w.x / S.px;
    const sz = e.altKey ? 0 : snap();
    if (drag.type === 'move') {
      let ds = snapRound(step - drag.anchor, sz);
      const dp = pitchAt(w.y) - drag.anchorPitch;
      const minS = Math.min(...drag.orig.map((o) => o.s));
      ds = Math.max(ds, -minS);
      const minP = Math.min(...drag.orig.map((o) => o.p));
      const maxP = Math.max(...drag.orig.map((o) => o.p));
      const dpc = clamp(dp, -minP, PITCHES - 1 - maxP);
      for (const o of drag.orig) { o.n.s = o.s + ds; o.n.p = o.p + dpc; }
      if (drag.primary.p !== drag.lastPitch) { drag.lastPitch = drag.primary.p; playPreview(chan(), drag.primary.p, drag.primary.v); }
      store.normalizePattern(pat());
      updateSpacer();
    } else if (drag.type === 'resize') {
      const delta = step - drag.anchor;
      for (const o of drag.orig) o.n.l = Math.max(sz || MIN_LEN, snapRound(o.l + delta, sz || 0.0625));
      S.lastLen = drag.primary.l;
      store.normalizePattern(pat());
      updateSpacer();
    } else if (drag.type === 'band') {
      S.band.x1 = w.x; S.band.y1 = w.y;
      const x0 = Math.min(S.band.x0, S.band.x1) / S.px, x1 = Math.max(S.band.x0, S.band.x1) / S.px;
      const p1 = pitchAt(Math.min(S.band.y0, S.band.y1)), p0 = pitchAt(Math.max(S.band.y0, S.band.y1));
      S.selection = new Set(drag.base);
      for (const n of notes()) if (n.s < x1 && n.s + n.l > x0 && n.p >= p0 && n.p <= p1) S.selection.add(n);
    } else if (drag.type === 'erase') {
      eraseAt(w);
    } else if (drag.type === 'mute') {
      const hit = noteAt(w.x, w.y);
      if (hit && !drag.done.has(hit)) { hit.m = !hit.m; drag.done.add(hit); }
    }
    emitNotes();
    invalidate();
  });

  const endDrag = () => {
    if (!drag) return;
    if (drag.type === 'move' || drag.type === 'resize') { store.dirty = true; }
    drag = null;
    S.band = null;
    invalidate();
    emitNotes();
  };
  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);

  function eraseAt(w) {
    const hit = noteAt(w.x, w.y);
    if (!hit) return;
    const list = notes();
    list.splice(list.indexOf(hit), 1);
    S.selection.delete(hit);
    emitNotes();
    invalidate();
  }

  let previewVoices = [];
  function playPreview(ch, pitch, vel, keepOthers = false) {
    if (!keepOthers) { for (const v of previewVoices) v?.release(engine.ctx.currentTime); previewVoices = []; }
    S.pressed.add(pitch);
    previewVoices.push(engine.preview(ch, pitch, vel, 0.35));
    setTimeout(() => { S.pressed.delete(pitch); invalidate(); }, 220);
  }

  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, world(e).vx);
    } else if (e.altKey) {
      e.preventDefault();
      S.rowH = clamp(S.rowH + (e.deltaY < 0 ? 2 : -2), 10, 28);
      updateSpacer();
      invalidate();
    }
  }, { passive: false });
  scroller.addEventListener('scroll', invalidate);

  // piano keys: click to audition
  let keyHeld = null;
  cKeys.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const ch = chan();
    if (!ch) return;
    root.focus({ preventScroll: true });
    cKeys.setPointerCapture(e.pointerId);
    const y = e.offsetY + scroller.scrollTop;
    const pitch = pitchAt(y);
    engine.ensure();
    keyHeld = { pitch, voice: engine.playNote(ch, pitch, 0.8, engine.ctx.currentTime, Infinity) };
    S.pressed.add(pitch);
    invalidate();
  });
  cKeys.addEventListener('pointermove', (e) => {
    if (!keyHeld) return;
    const pitch = pitchAt(e.offsetY + scroller.scrollTop);
    if (pitch === keyHeld.pitch) return;
    keyHeld.voice?.release(engine.ctx.currentTime);
    S.pressed.delete(keyHeld.pitch);
    keyHeld = { pitch, voice: engine.playNote(chan(), pitch, 0.8, engine.ctx.currentTime, Infinity) };
    S.pressed.add(pitch);
    invalidate();
  });
  const releaseKey = () => {
    if (!keyHeld) return;
    keyHeld.voice?.release(engine.ctx.currentTime);
    S.pressed.delete(keyHeld.pitch);
    keyHeld = null;
    invalidate();
  };
  cKeys.addEventListener('pointerup', releaseKey);
  cKeys.addEventListener('pointercancel', releaseKey);
  cKeys.addEventListener('wheel', (e) => { scroller.scrollTop += e.deltaY; }, { passive: true });

  // ruler: click to move the playhead
  const seekFromRuler = (e) => {
    const step = Math.max(0, (e.offsetX + scroller.scrollLeft) / S.px);
    transport.seek(snapRound(step, snap() || 0.25), { setStart: true });
  };
  let rulerDrag = false;
  cRuler.addEventListener('pointerdown', (e) => { cRuler.setPointerCapture(e.pointerId); rulerDrag = true; seekFromRuler(e); });
  cRuler.addEventListener('pointermove', (e) => { if (rulerDrag) seekFromRuler(e); });
  cRuler.addEventListener('pointerup', () => { rulerDrag = false; });

  // velocity lane
  let velDrag = null;
  const setVelFromPointer = (e) => {
    const r = cVel.getBoundingClientRect();
    const x = e.clientX - r.left + scroller.scrollLeft;
    const y = e.clientY - r.top;
    const v = clamp(1 - (y - 8) / (VEL_H - 16), 0.02, 1);
    let best = null, bd = 9;
    for (const n of notes()) {
      const d = Math.abs(n.s * S.px - x);
      if (d < bd) { bd = d; best = n; }
    }
    const targets = best && S.selection.has(best) && S.selection.size > 1 ? [...S.selection] : best ? [best] : [];
    const n = best || velDrag?.note;
    if (!n) return;
    velDrag = { note: n };
    if (targets.length > 1) { const delta = v - n.v; for (const t of targets) t.v = clamp(t.v + delta, 0.02, 1); }
    else n.v = v;
    emitNotes();
    invalidate();
  };
  cVel.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    root.focus({ preventScroll: true });
    cVel.setPointerCapture(e.pointerId);
    store.checkpoint();
    velDrag = {};
    setVelFromPointer(e);
  });
  cVel.addEventListener('pointermove', (e) => { if (velDrag) setVelFromPointer(e); });
  cVel.addEventListener('pointerup', () => { velDrag = null; });
  cVel.addEventListener('pointercancel', () => { velDrag = null; });

  // ------------------------------------------------------------ note tools
  /** Run `fn(list)` on the selected notes (or all notes) as one undo step. */
  function edit(fn) {
    const target = S.selection.size ? [...S.selection] : notes();
    if (!target.length || !chan()) return;
    store.checkpoint();
    fn(target);
    store.normalizePattern(pat());
    updateSpacer(); emitNotes(); invalidate();
  }
  function removeNotes(list) {
    const kill = new Set(list);
    const ch = chan();
    if (!ch) return;
    pat().notes[ch.id] = notes().filter((n) => !kill.has(n));
    for (const n of kill) S.selection.delete(n);
  }
  const quantize = (startsOnly = false) => edit((list) => {
    const q = snap() || 1;
    for (const n of list) { n.s = Math.max(0, snapRound(n.s, q)); if (!startsOnly) n.l = Math.max(q, snapRound(n.l, q)); }
  });
  // each note lasts until the next note start (chords share the same next start)
  const legato = () => edit((list) => {
    const starts = [...new Set(list.map((n) => n.s))].sort((a, b) => a - b);
    for (const n of list) {
      const next = starts.find((s0) => s0 > n.s + 1e-6);
      if (next != null) n.l = next - n.s;
    }
  });
  const transpose = (semis) => edit((list) => {
    const lo = Math.min(...list.map((n) => n.p)), hi = Math.max(...list.map((n) => n.p));
    const d = clamp(semis, -lo, PITCHES - 1 - hi);
    for (const n of list) n.p += d;
  });
  const flip = () => edit((list) => {
    const lo = Math.min(...list.map((n) => n.s)), hi = Math.max(...list.map((n) => n.s + n.l));
    for (const n of list) n.s = lo + hi - (n.s + n.l);
  });
  const randomize = () => edit((list) => { for (const n of list) n.v = clamp(n.v + (Math.random() * 2 - 1) * 0.15, 0.05, 1); });
  const humanize = () => edit((list) => { for (const n of list) n.s = Math.max(0, n.s + (Math.random() * 2 - 1) * 0.06); });
  function duplicate() {
    const sel = [...S.selection];
    if (!sel.length || !chan()) return;
    store.checkpoint();
    const min = Math.min(...sel.map((n) => n.s));
    const max = Math.max(...sel.map((n) => n.s + n.l));
    const q = snap() || 1;
    const span = Math.max(q, Math.ceil((max - min) / q - 1e-6) * q);
    S.selection.clear();
    for (const n of sel) S.selection.add(store.addNote(pat(), chan().id, { p: n.p, s: n.s + span, l: n.l, v: n.v }));
    updateSpacer(); emitNotes(); invalidate();
  }

  // ---------------------------------------------------------------- keyboard
  root.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const sel = [...S.selection];
    const key = e.key.toLowerCase();
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!sel.length) return;
      handled();
      store.checkpoint();
      removeNotes(sel);
      emitNotes(); invalidate();
    } else if (ctrl && key === 'a') {
      handled();
      S.selection = new Set(notes());
      invalidate();
    } else if (ctrl && key === 'd') {
      handled();
      S.selection.clear();
      invalidate();
    } else if (ctrl && (key === 'c' || key === 'x')) {
      if (!sel.length) return;
      handled();
      const min = Math.min(...sel.map((n) => n.s));
      S.clipboard = sel.map((n) => ({ ...n, s: n.s - min }));
      if (key === 'x') {
        store.checkpoint();
        removeNotes(sel);
        emitNotes(); invalidate();
      }
    } else if (ctrl && key === 'v') {
      if (!S.clipboard.length || !chan()) return;
      handled();
      store.checkpoint();
      const at = transport.playing ? transport.patternPosition() : scroller.scrollLeft / S.px;
      const start = snapFloor(at, snap() || 1);
      S.selection.clear();
      for (const c of S.clipboard) S.selection.add(store.addNote(pat(), chan().id, { p: c.p, s: c.s + start, l: c.l, v: c.v }));
      updateSpacer(); emitNotes(); invalidate();
    } else if (ctrl && key === 'b') {
      handled();
      duplicate();
    } else if (ctrl && key === 'q') {
      handled();
      quantize();
    } else if (ctrl && key === 'l') {
      handled();
      legato();
    } else if (e.altKey && key === 'r') {
      handled();
      randomize();
    } else if (e.key === 'Escape') {
      S.selection.clear(); invalidate();
    } else if (e.key.startsWith('Arrow') && sel.length) {
      handled();
      const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (vertical) { transpose((e.key === 'ArrowUp' ? 1 : -1) * (ctrl || e.shiftKey ? 12 : 1)); return; }
      store.checkpoint();
      const sz = snap() || 0.25;
      const minS = Math.min(...sel.map((n) => n.s));
      const d = e.key === 'ArrowLeft' ? -Math.min(sz, minS) : sz;
      for (const n of sel) n.s += d;
      store.normalizePattern(pat());
      updateSpacer(); emitNotes(); invalidate();
    }
  });

  // ---------------------------------------------------------------- wiring
  function refreshTitle() {
    const ch = chan();
    win.setTitle(`Piano roll${ch ? ` — ${ch.name}` : ''}`);
    chanLabel.textContent = ch ? ch.name : '(no channel)';
    chanSwatch.style.background = ch ? ch.color : 'transparent';
  }
  const onSelection = () => { S.selection.clear(); refreshTitle(); updateSpacer(); invalidate(); };
  store.on('selection', onSelection);
  store.on('project', onSelection);
  store.on('channels', () => { refreshTitle(); invalidate(); });
  store.on('notes', () => {
    // drop selected notes that no longer exist
    const live = new Set(notes());
    for (const n of S.selection) if (!live.has(n)) S.selection.delete(n);
    updateSpacer(); invalidate();
  });
  store.on('patterns', () => { refreshTitle(); updateSpacer(); invalidate(); });
  app.on('snap', invalidate);
  app.on('keyboardNote', ({ pitch, on }) => { on ? S.pressed.add(pitch) : S.pressed.delete(pitch); invalidate(); });
  win.on('show', () => { layout(); invalidate(); });
  refreshTitle();

  function update() {
    if (!win.visible) return;
    const show = transport.playing && transport.mode === 'pattern';
    playhead.style.display = show ? 'block' : 'none';
    if (!show) return;
    const pos = transport.patternPosition();
    const x = pos * S.px - scroller.scrollLeft;
    const vw = scroller.clientWidth;
    if (x > vw - 30 || x < 0) scroller.scrollLeft = Math.max(0, pos * S.px - 60);
    const vx = pos * S.px - scroller.scrollLeft;
    playhead.style.display = vx < 0 || vx > vw ? 'none' : 'block';
    playhead.style.transform = `translateX(${vx + KEYS_W}px)`;
  }

  return { win, update };
}
