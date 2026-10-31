import { h, clamp, shade, rgba, COLORS } from '../util.js';
import { icon } from './icons.js';
import { showMenu } from './menu.js';
import { promptDialog, formDialog } from './dialog.js';
import { markers, addMarker, removeMarker, splitByChannel } from '../playlistops.js';
import { guessLoopBpm } from '../audio/stretch.js';
import { createSnapSelect } from './snapselect.js';
import { snapSize, snapRound, snapFloor } from './snap.js';
import { sizeCanvas, roundRect } from './draw.js';
import { overlayScrollbars, scrollingToolbar } from './scrollbars.js';
import { T, appearance } from '../theme.js';
import { drawWaveform } from './peaks.js';
import { curveAt, describeTarget } from '../automation.js';
import { PLAYLIST_TRACKS, barSteps, beatSteps } from '../state.js';

const TRACK_H = 58;
const HEAD_W = 118;
const PICKER_W = 132;
const RULER_H = 26;
const CLIP_HEAD = 15;
const TRACK_COLORS = ['#7d3672', '#6a7b8b', '#638a6d', '#547b78', '#7c5769', '#8e7068', '#6c4f85', '#628986', '#8b7464'];

const TOOLS = [
  ['draw', 'pencil', 'Draw — click to place the selected pattern, drag to move or resize, drag across to paint'],
  ['delete', 'eraser', 'Delete — click or drag over clips to remove them'],
  ['mute', 'mute', 'Mute — click a clip to mute it'],
  ['slice', 'slice', 'Slice — click a clip to cut it in two'],
  ['select', 'select', 'Select — drag a box around clips (Ctrl for a temporary select tool)'],
];

const mod = (a, n) => ((a % n) + n) % n;
const typeOf = (c) => c.type || 'pattern';

const ZOOM_STEPS = 16;

export function createPlaylist(app) {
  const { store, wm, transport, engine } = app;
  const BAR = () => barSteps(store.project); // steps per bar / beat in the project's time signature
  const BEAT = () => beatSteps(store.project);

  const win = wm.create({
    id: 'playlist', title: 'Playlist — Arrangement', icon: 'playlist', minW: 560, minH: 260,
    rect: (dw, dh) => ({ x: 730, y: 14, w: Math.max(560, dw - 744), h: Math.max(300, dh - 28) }),
    visible: true,
  });

  const S = { tool: 'draw', pxBar: 130, selection: new Set(), clipboard: [], band: null };
  const pxStep = () => S.pxBar / ZOOM_STEPS; // zoom is kept per 16 steps whatever the time signature

  // ---------------------------------------------------------------- layout
  const toolBtns = TOOLS.map(([id, ico, tip]) => {
    const b = h('button', { class: 'tbtn', 'data-hint': tip, onClick: () => { S.tool = id; refreshTools(); } }, icon(ico));
    b._id = id;
    return b;
  });
  const refreshTools = () => toolBtns.forEach((b) => b.classList.toggle('on', b._id === S.tool));
  refreshTools();
  const zoomOut = h('button', { class: 'tbtn', 'data-hint': 'Zoom out (Ctrl+wheel)', onClick: () => zoom(1 / 1.3) }, '−');
  const zoomIn = h('button', { class: 'tbtn', 'data-hint': 'Zoom in (Ctrl+wheel)', onClick: () => zoom(1.3) }, '+');
  const selPatLabel = h('span', {}, '');
  const selPat = h('div', { class: 'pl-selpat', 'data-hint': 'The selected pattern is placed when you click with the draw tool' }, icon('pattern'), selPatLabel);

  const toolbar = h('div', { class: 'pr-toolbar' },
    h('div', { class: 'tb-group' }, toolBtns),
    h('div', { class: 'pr-sep' }),
    createSnapSelect(app),
    h('div', { class: 'pr-sep' }),
    selPat,
    h('div', { class: 'tb-flex' }),
    h('div', { class: 'tb-group' }, zoomOut, zoomIn));

  const picker = h('div', { class: 'pl-picker' });
  const headsInner = h('div', { class: 'pl-heads-inner' });
  const heads = h('div', { class: 'pl-heads' }, headsInner);
  const cRuler = h('canvas', { class: 'pl-ruler' });
  const cGrid = h('canvas', { class: 'pl-grid' });
  const spacer = h('div', { class: 'pr-spacer' });
  const scroller = h('div', { class: 'pr-scroller', role: 'application', 'aria-label': 'Playlist arrangement' }, spacer);
  const gridWrap = h('div', { class: 'pr-gridwrap' }, cGrid, scroller);
  overlayScrollbars(scroller, { host: gridWrap });
  scrollingToolbar(toolbar);
  const playhead = h('div', { class: 'pr-playhead' });
  const overlay = h('div', { class: 'pl-overlay' }, playhead);
  const main = h('div', { class: 'pl-main' }, picker, h('div', { class: 'pl-corner' }), cRuler, heads, gridWrap, overlay);
  const root = h('div', { class: 'pr-root', tabIndex: 0 }, toolbar, main);
  win.body.append(root);
  main.style.gridTemplateColumns = `${PICKER_W}px ${HEAD_W}px 1fr`;
  main.style.gridTemplateRows = `${RULER_H}px 1fr`;

  const g = { grid: cGrid.getContext('2d'), ruler: cRuler.getContext('2d') };
  const sizes = { gw: 0, gh: 0 };

  function layout() {
    const gw = gridWrap.clientWidth;
    const gh = gridWrap.clientHeight;
    if (!gw || !gh) return;
    sizes.gw = gw; sizes.gh = gh;
    sizeCanvas(cGrid, g.grid, gw, gh);
    sizeCanvas(cRuler, g.ruler, gw, RULER_H);
    updateSpacer();
    invalidate();
  }
  new ResizeObserver(layout).observe(gridWrap);

  const clips = () => store.project.playlist.clips;
  const tracks = () => store.project.playlist.tracks;
  const snap = () => snapSize(app.ui.snap, pxStep(), BEAT(), BAR());
  const stepSeconds = () => 60 / store.project.bpm / 4;

  function totalSteps() {
    const end = Math.ceil(store.playlistEndStep() / BAR()) + 24;
    return Math.max(96, end) * BAR();
  }
  function updateSpacer() {
    spacer.style.width = `${totalSteps() * pxStep()}px`;
    spacer.style.height = `${PLAYLIST_TRACKS * TRACK_H}px`;
  }
  function zoom(f, anchorX = sizes.gw / 2) {
    const worldStep = (scroller.scrollLeft + anchorX) / pxStep();
    S.pxBar = clamp(S.pxBar * f, 28, 2400);
    updateSpacer();
    scroller.scrollLeft = worldStep * pxStep() - anchorX;
    invalidate();
  }

  // ------------------------------------------------------------ track heads
  const trackColor = (i) => tracks()[i].color || TRACK_COLORS[i % TRACK_COLORS.length];

  function buildHeads() {
    headsInner.replaceChildren();
    tracks().forEach((t, i) => {
      const led = h('button', { class: `led pl-head-led${t.mute ? '' : ' on'}`, 'data-hint': 'Track enabled — click to mute' });
      led.addEventListener('click', (e) => { e.stopPropagation(); store.checkpoint(); t.mute = !t.mute; led.classList.toggle('on', !t.mute); invalidate(); });
      const el = h('div', { class: 'pl-head', style: { height: `${TRACK_H}px` }, dataset: { track: i } },
        h('span', { class: 'pl-head-name' }, t.name), led);
      el.style.setProperty('--tc', trackColor(i));
      const rename = async () => {
        const v = await promptDialog('Rename track', t.name);
        if (v && v.trim()) { store.checkpoint(); t.name = v.trim(); buildHeads(); }
      };
      el.addEventListener('dblclick', rename);
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const routes = [{ label: 'Master', checked: !t.mixer, action: () => { store.checkpoint(); t.mixer = 0; } }];
        for (let m = 1; m <= 32; m++) routes.push({ label: store.project.mixer[m].name, checked: t.mixer === m, action: () => { store.checkpoint(); t.mixer = m; } });
        showMenu([
          { label: 'Rename…', action: rename },
          { label: 'Color', submenu: COLORS.concat(TRACK_COLORS).map((c) => ({ label: ' ', swatch: c, action: () => { store.checkpoint(); t.color = c; buildHeads(); invalidate(); } })) },
          { label: 'Audio output', submenu: routes },
          { label: t.mute ? 'Unmute' : 'Mute', action: () => { store.checkpoint(); t.mute = !t.mute; buildHeads(); invalidate(); } },
          { separator: true },
          { label: 'Clear track', action: () => { store.checkpoint(); store.project.playlist.clips = clips().filter((c) => c.track !== i); store.emit('playlist'); } },
        ], e.clientX, e.clientY);
      });
      headsInner.append(el);
    });
  }

  // ---------------------------------------------------------------- picker
  function buildPicker() {
    picker.replaceChildren(h('div', { class: 'pl-picker-title' }, 'Patterns'));
    const sel = store.project.selected.pattern;
    for (const p of store.project.patterns) {
      const item = h('div', { class: `pl-pat${p.id === sel ? ' selected' : ''}`, draggable: true, style: { '--pc': p.color }, 'data-hint': 'Click to select · drag onto the playlist · right-click for options' },
        h('span', { class: 'pl-pat-chip' }), h('span', { class: 'pl-pat-name' }, p.name));
      item.addEventListener('click', () => store.selectPattern(p.id));
      item.addEventListener('dblclick', () => app.actions.renamePattern(p.id));
      item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/openstudio-pattern', String(p.id)); e.dataTransfer.effectAllowed = 'copy'; });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu([
          { label: 'Rename…', action: () => app.actions.renamePattern(p.id) },
          { label: 'Color', submenu: COLORS.map((c) => ({ label: ' ', swatch: c, action: () => { store.checkpoint(); p.color = c; store.emit('patterns'); } })) },
          { label: 'Clone', action: () => store.clonePattern(p.id) },
          { label: 'Delete', disabled: store.project.patterns.length < 2, action: () => store.removePattern(p.id) },
        ], e.clientX, e.clientY);
      });
      picker.append(item);
    }
    picker.append(h('button', { class: 'pl-pat-add', 'data-hint': 'New pattern', onClick: () => store.addPattern() }, icon('plus')));
    const cur = store.currentPattern;
    selPatLabel.textContent = cur.name;
    selPat.style.setProperty('--pc', cur.color);
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
    headsInner.style.transform = `translateY(${-scroller.scrollTop}px)`;
  }

  function drawGrid() {
    const ctx = g.grid;
    const { gw, gh } = sizes;
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;
    const px = pxStep();
    ctx.clearRect(0, 0, gw, gh);

    const barPx = BAR() * px;
    const b0 = Math.floor(sx / barPx);
    const b1 = Math.ceil((sx + gw) / barPx);
    for (let b = b0; b <= b1; b++) {
      ctx.fillStyle = b % 2 === 0 ? T.gridA : T.gridB;
      ctx.fillRect(b * barPx - sx, 0, barPx, gh);
    }
    ctx.strokeStyle = T.gridLineEdge;
    ctx.lineWidth = 1;
    const t0 = Math.floor(sy / TRACK_H);
    const t1 = Math.min(PLAYLIST_TRACKS, Math.ceil((sy + gh) / TRACK_H));
    for (let t = t0; t <= t1; t++) {
      const y = Math.round(t * TRACK_H - sy) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(gw, y); ctx.stroke();
    }
    const s0 = Math.floor(sx / px);
    const s1 = Math.ceil((sx + gw) / px);
    for (let s = s0; s <= s1; s++) {
      let color = null;
      if (s % BAR() === 0) color = T.gridLineBar;
      else if (s % BEAT() === 0 && px * 4 >= 22) color = T.gridLineBeat;
      else if (px >= 14) color = T.gridLineStep;
      if (!color) continue;
      ctx.strokeStyle = color;
      const x = Math.round(s * px - sx) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gh); ctx.stroke();
    }
    tracks().forEach((t, i) => {
      if (!t.mute || i < t0 || i > t1) return;
      ctx.fillStyle = T.gridShade;
      ctx.fillRect(0, i * TRACK_H - sy, gw, TRACK_H);
    });

    const loop = store.project.loop;
    if (loop) {
      ctx.fillStyle = transport.loopEnabled ? T.loopFill : T.hover;
      ctx.fillRect(loop.start * px - sx, 0, (loop.end - loop.start) * px, gh);
    }

    for (const m of markers(store)) {
      const mx = Math.round(m.step * px - sx) + 0.5;
      if (mx < 0 || mx > gw) continue;
      ctx.strokeStyle = rgba(T.text, 0.25);
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, gh); ctx.stroke();
      ctx.setLineDash([]);
    }

    const patInfo = new Map();
    for (const c of clips()) {
      const x = c.start * px - sx;
      const w = c.len * px;
      const y = c.track * TRACK_H - sy;
      if (x > gw || x + w < 0 || y > gh || y + TRACK_H < 0) continue;
      drawClip(ctx, c, x, y + 1, w, TRACK_H - 2, px, patInfo, gw);
    }

    if (S.band) {
      const b = S.band;
      const x = Math.min(b.x0, b.x1) - sx, y = Math.min(b.y0, b.y1) - sy;
      ctx.fillStyle = T.selFill;
      ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeStyle = T.selLine;
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
  }

  function clipLook(c) {
    const type = typeOf(c);
    const muted = c.mute || tracks()[c.track]?.mute;
    if (type === 'pattern') {
      const pat = store.pattern(c.pat);
      return pat ? { color: pat.color, name: pat.name, muted, pat } : null;
    }
    if (type === 'audio') {
      const s = store.samples.get(c.sampleId);
      return { color: '#4f8a9c', name: s?.name ?? 'Audio', muted, sample: s };
    }
    const auto = store.automation(c.autoId);
    return auto ? { color: auto.color, name: describeTarget(store, auto.target), muted, auto } : null;
  }

  function drawClip(ctx, c, x, y, w, hh, px, patInfo, gw) {
    const look = clipLook(c);
    if (!look) return;
    const sel = S.selection.has(c.id);
    const color = look.muted ? T.clipMuted : look.color;
    const bodyY = y + CLIP_HEAD;
    const bodyH = hh - CLIP_HEAD;
    const type = typeOf(c);

    ctx.fillStyle = shade(color, look.muted ? -0.45 : -0.68);
    roundRect(ctx, x, y, Math.max(2, w), hh, 3);
    ctx.fill();
    ctx.save();
    roundRect(ctx, x, y, Math.max(2, w), hh, 3);
    ctx.clip();
    ctx.fillStyle = look.muted ? T.clipMuted : shade(color, -0.1);
    ctx.fillRect(x, y, Math.max(2, w), CLIP_HEAD);
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, bodyY, Math.max(2, w), bodyH, 2);
    ctx.clip();
    const ink = look.muted ? T.textDim : shade(color, 0.6);
    ctx.fillStyle = ink;
    if (type === 'pattern') drawMiniNotes(ctx, c, look.pat, x, bodyY, w, bodyH, px, patInfo, gw, ink);
    else if (type === 'audio') {
      if (look.sample?.buffer) {
        const sd = stepSeconds();
        if (c.reverse) {
          // mirror the waveform drawing: reversed audio reads right to left
          ctx.save();
          ctx.translate(2 * x + w, 0);
          ctx.scale(-1, 1);
        }
        // a tempo-following clip covers more (or less) of the sample than its length at the project tempo
        const k = c.stretch?.bpm > 0 ? store.project.bpm / c.stretch.bpm : 1;
        drawWaveform(ctx, look.sample.buffer, x, bodyY, w, bodyH, c.offset * sd * k, (c.offset + c.len) * sd * k, 0, gw);
        if (c.reverse) ctx.restore();
      }
      // fades: shade the faded corners
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      if (c.fadeIn > 0) { const fw = Math.min(w, c.fadeIn * px); ctx.beginPath(); ctx.moveTo(x, bodyY); ctx.lineTo(x + fw, bodyY); ctx.lineTo(x, bodyY + bodyH); ctx.closePath(); ctx.fill(); }
      if (c.fadeOut > 0) { const fw = Math.min(w, c.fadeOut * px); ctx.beginPath(); ctx.moveTo(x + w, bodyY); ctx.lineTo(x + w - fw, bodyY); ctx.lineTo(x + w, bodyY + bodyH); ctx.closePath(); ctx.fill(); }
    } else drawAutomationCurve(ctx, c, look.auto, x, bodyY, w, bodyH, px, gw, ink);
    ctx.restore();

    if (w > 28) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x + 2, y, w - 4, CLIP_HEAD); ctx.clip();
      ctx.font = '10px "Noto Sans", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = look.muted ? T.text : '#10181c';
      ctx.fillText(look.name, Math.max(x, 0) + 6, y + CLIP_HEAD / 2 + 0.5);
      ctx.restore();
    }

    ctx.strokeStyle = sel ? T.noteSelOutline : 'rgba(0,0,0,.65)';
    ctx.lineWidth = sel ? 2 : 1;
    roundRect(ctx, x + 0.5, y + 0.5, Math.max(2, w) - 1, hh - 1, 3);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  function drawMiniNotes(ctx, c, pat, x, bodyY, w, bodyH, px, patInfo, gw, ink) {
    let info = patInfo.get(pat.id);
    if (!info) {
      let min = 127, max = 0, count = 0;
      for (const list of Object.values(pat.notes)) for (const n of list) { min = Math.min(min, n.p); max = Math.max(max, n.p); count++; }
      info = { min, max, count, len: store.patternSteps(pat) };
      patInfo.set(pat.id, info);
    }
    if (!info.count) return;
    const range = Math.max(12, info.max - info.min + 1);
    const nh = clamp(bodyH / range, 1.5, 4);
    const loops = Math.ceil((c.len + c.offset) / info.len) + 1;
    for (let k = 0; k < loops; k++) {
      for (const list of Object.values(pat.notes)) {
        for (const n of list) {
          const t = n.s - c.offset + k * info.len;
          if (t + n.l < 0 || t >= c.len) continue;
          const nx = x + Math.max(0, t) * px;
          if (nx > gw || nx < -50) continue;
          const nw = Math.max(1.5, (Math.min(t + n.l, c.len) - Math.max(0, t)) * px - 0.5);
          const ny = bodyY + 3 + (bodyH - 6 - nh) * (1 - (n.p - info.min) / Math.max(1, range - 1));
          ctx.fillRect(nx, ny, nw, nh);
        }
      }
      const bx = x + (k * info.len - c.offset) * px;
      if (k > 0 && bx > x && bx < x + w) {
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        ctx.fillRect(bx, bodyY, 1, bodyH);
        ctx.fillStyle = ink;
      }
    }
  }

  function drawAutomationCurve(ctx, c, auto, x, bodyY, w, bodyH, px, gw, ink) {
    if (!auto) return;
    const x0 = Math.max(0, -x);
    const x1 = Math.min(w, gw - x);
    ctx.beginPath();
    let started = false;
    for (let dx = x0; dx <= x1; dx += 2) {
      const v = curveAt(auto.points, dx / px + (c.offset || 0));
      const yy = bodyY + 3 + (bodyH - 6) * (1 - v);
      if (!started) { ctx.moveTo(x + dx, yy); started = true; } else ctx.lineTo(x + dx, yy);
    }
    if (!started) return;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(x + x1, bodyY + bodyH);
    ctx.lineTo(x + x0, bodyY + bodyH);
    ctx.closePath();
    ctx.fillStyle = rgba(auto.color, 0.18);
    ctx.fill();
    ctx.lineWidth = 1;
  }

  function drawRuler() {
    const ctx = g.ruler;
    const { gw } = sizes;
    const sx = scroller.scrollLeft;
    const px = pxStep();
    const grad = ctx.createLinearGradient(0, 0, 0, RULER_H);
    grad.addColorStop(0, T.rulerA); grad.addColorStop(1, T.rulerB);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, gw, RULER_H);

    const loop = store.project.loop;
    if (loop) {
      ctx.fillStyle = transport.loopEnabled ? T.loopBar : T.loopBarOff;
      ctx.fillRect(loop.start * px - sx, RULER_H - 8, (loop.end - loop.start) * px, 8);
    }

    ctx.font = '10px "Noto Sans", sans-serif';
    ctx.textBaseline = 'middle';
    const everyBars = S.pxBar < 40 ? 4 : S.pxBar < 70 ? 2 : 1;
    const s0 = Math.floor(sx / px);
    const s1 = Math.ceil((sx + gw) / px);
    for (let s = s0; s <= s1; s++) {
      const x = Math.round(s * px - sx) + 0.5;
      if (s % BAR() === 0) {
        const bar = s / BAR();
        const major = bar % everyBars === 0;
        ctx.strokeStyle = major ? T.rulerMajor : T.rulerMinor;
        ctx.beginPath(); ctx.moveTo(x, major ? 4 : 14); ctx.lineTo(x, RULER_H); ctx.stroke();
        if (major) { ctx.fillStyle = T.rulerText; ctx.fillText(String(bar + 1), x + 4, 10); }
      } else if (s % BEAT() === 0 && px * 4 >= 26) {
        ctx.strokeStyle = T.rulerTick;
        ctx.beginPath(); ctx.moveTo(x, 17); ctx.lineTo(x, RULER_H); ctx.stroke();
      }
    }
    // time markers: a flag with the name, over the bar numbers
    ctx.font = '600 10px "Noto Sans", sans-serif';
    for (const m of markers(store)) {
      const mx = Math.round(m.step * px - sx) + 0.5;
      const tw = ctx.measureText(m.name).width + 10;
      if (mx + tw < 0 || mx > gw) continue;
      ctx.fillStyle = T.text;
      ctx.fillRect(mx - 0.5, 0, 1, RULER_H);
      ctx.fillStyle = T.surface || T.rulerA;
      ctx.fillRect(mx + 1, 1, tw, 13);
      ctx.strokeStyle = T.text;
      ctx.strokeRect(mx + 1, 1.5, tw, 12);
      ctx.fillStyle = T.textBright || T.text;
      ctx.fillText(m.name, mx + 6, 8);
    }
    ctx.strokeStyle = T.gridEdge;
    ctx.beginPath(); ctx.moveTo(0, RULER_H - 0.5); ctx.lineTo(gw, RULER_H - 0.5); ctx.stroke();
  }

  /** The marker whose flag is under ruler x (in view pixels), or null. */
  function markerAtRuler(vx, vy) {
    if (vy > 15) return null;
    const px = pxStep();
    const sx = scroller.scrollLeft;
    const ctx = g.ruler;
    ctx.font = '600 10px "Noto Sans", sans-serif';
    for (const m of [...markers(store)].reverse()) {
      const mx = m.step * px - sx;
      if (vx >= mx - 3 && vx <= mx + ctx.measureText(m.name).width + 12) return m;
    }
    return null;
  }

  async function renameMarker(m) {
    const name = await promptDialog('Rename marker', m.name);
    if (name == null || !name.trim()) return;
    store.checkpoint();
    m.name = name.trim();
    store.emit('playlist');
  }

  function rulerMenu(e, step) {
    const at = snapRound(step, snap() || BEAT());
    const marker = markerAtRuler(e.offsetX, e.offsetY);
    const list = markers(store);
    showMenu([
      ...(marker ? [
        { label: `Rename “${marker.name}”…`, action: () => renameMarker(marker) },
        { label: `Delete “${marker.name}”`, action: () => { store.checkpoint(); removeMarker(store, marker.id); store.emit('playlist'); } },
        { separator: true },
      ] : []),
      { label: 'Add marker here', action: async () => {
        const name = await promptDialog('Add marker', `Marker ${list.length + 1}`);
        if (name == null) return;
        store.checkpoint();
        addMarker(store, at, name.trim());
        store.emit('playlist');
      } },
      { label: 'Jump to marker', disabled: !list.length, submenu: list.map((m) => ({ label: m.name, action: () => transport.seek(m.step) })) },
      { separator: true },
      { label: 'Loop between markers', disabled: list.length < 1, submenu: list.map((m, k) => ({ label: `${m.name} → ${list[k + 1]?.name ?? 'end'}`, action: () => {
        const end = list[k + 1]?.step ?? Math.max(m.step + BAR(), Math.ceil(store.playlistEndStep() / BAR()) * BAR());
        store.checkpoint();
        store.project.loop = { start: m.step, end };
        store.emit('loop');
        transport.setLoop(true);
      } })) },
      { label: 'Clear loop', disabled: !store.project.loop, action: () => { store.checkpoint(); store.project.loop = null; store.emit('loop'); invalidate(); } },
    ], e.clientX, e.clientY);
  }

  // ----------------------------------------------------------- interaction
  const world = (e) => {
    const r = scroller.getBoundingClientRect();
    return { x: e.clientX - r.left + scroller.scrollLeft, y: e.clientY - r.top + scroller.scrollTop, vx: e.clientX - r.left };
  };
  const onScrollbar = (e) => {
    const r = scroller.getBoundingClientRect();
    return e.clientX - r.left > scroller.clientWidth || e.clientY - r.top > scroller.clientHeight;
  };
  const trackAt = (y) => clamp(Math.floor(y / TRACK_H), 0, PLAYLIST_TRACKS - 1);

  function clipAt(step, track) {
    const list = clips();
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (c.track === track && step >= c.start && step < c.start + c.len) return c;
    }
    return null;
  }
  const edgeOf = (c, step) => {
    const px = pxStep();
    if (c.len * px < 18) return null;
    if ((step - c.start) * px <= 6) return 'left';
    if ((c.start + c.len - step) * px <= 6) return 'right';
    return null;
  };

  let dirtyNotify = false;
  function emitPlaylist() {
    if (dirtyNotify) return;
    dirtyNotify = true;
    requestAnimationFrame(() => { dirtyNotify = false; store.emit('playlist'); });
  }

  const patLen = (patId) => store.patternSteps(store.pattern(patId));
  const placeClip = (patId, track, start, len) => store.addClip({ type: 'pattern', pat: patId, track, start: Math.max(0, start), len });

  /** Place an audio clip for a stored sample at the given position. */
  async function placeAudio(sampleId, track, start) {
    const buf = await engine.ensureSample(sampleId);
    if (!buf) return null;
    const len = Math.max(1, Math.round(buf.duration / stepSeconds()));
    store.checkpoint();
    const c = store.addClip({ type: 'audio', sampleId, track, start: Math.max(0, start), len });
    store.emit('playlist');
    return c;
  }

  let drag = null;
  scroller.addEventListener('contextmenu', (e) => e.preventDefault());
  scroller.addEventListener('pointerdown', (e) => {
    if (onScrollbar(e)) return;
    root.focus({ preventScroll: true });
    const w = world(e);
    const step = w.x / pxStep();
    const track = trackAt(w.y);
    const hit = clipAt(step, track);
    const sz = e.altKey ? 0 : snap();
    let tool = S.tool;
    if (e.button === 2 && hit && w.y - hit.track * TRACK_H <= CLIP_HEAD + 1) {
      // right-click on a clip's title bar: clip menu (right-click on the body deletes, as in FL Studio)
      showClipMenu(hit, e.clientX, e.clientY);
      return;
    }
    if (e.button === 2) tool = 'delete';
    else if (e.ctrlKey || e.metaKey) tool = 'select';
    scroller.setPointerCapture(e.pointerId);

    if (tool === 'delete') {
      store.checkpoint();
      drag = { type: 'erase' };
      eraseAt(step, track);
      return;
    }
    if (tool === 'mute') {
      store.checkpoint();
      drag = { type: 'mute', done: new Set() };
      if (hit) { hit.mute = !hit.mute; drag.done.add(hit.id); emitPlaylist(); invalidate(); }
      return;
    }
    if (tool === 'slice') {
      if (!hit) return;
      const at = snapRound(step, sz || 1);
      if (at <= hit.start + 0.99 || at >= hit.start + hit.len - 0.99) return;
      store.checkpoint();
      const type = typeOf(hit);
      const into = at - hit.start;
      const offset = type === 'pattern' ? mod(hit.offset + into, patLen(hit.pat)) : (hit.offset || 0) + into;
      const second = { ...hit, id: store.uid(), start: at, len: hit.start + hit.len - at, offset };
      hit.len = into;
      clips().push(second);
      emitPlaylist(); invalidate();
      return;
    }

    if (hit) {
      if (!S.selection.has(hit.id)) { if (!e.shiftKey) S.selection.clear(); S.selection.add(hit.id); }
      else if (e.shiftKey) { S.selection.delete(hit.id); invalidate(); return; }
      store.checkpoint();
      const sel = clips().filter((c) => S.selection.has(c.id));
      const edge = tool === 'draw' || tool === 'select' ? edgeOf(hit, step) : null;
      if (edge) {
        drag = { type: edge === 'left' ? 'resize-left' : 'resize-right', anchor: step, orig: sel.map((c) => ({ c, start: c.start, len: c.len, offset: c.offset })) };
      } else {
        drag = { type: 'move', anchor: step, anchorTrack: track, orig: sel.map((c) => ({ c, start: c.start, track: c.track })) };
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

    // draw: place the selected pattern and allow painting copies by dragging right
    S.selection.clear();
    store.checkpoint();
    const patId = store.project.selected.pattern;
    const len = patLen(patId);
    const start = Math.max(0, snapFloor(step, sz || 1));
    const c = placeClip(patId, track, start, len);
    S.selection.add(c.id);
    drag = { type: 'paint', track, patId, len, next: start + len };
    updateSpacer();
    emitPlaylist(); invalidate();
  });

  scroller.addEventListener('pointermove', (e) => {
    const w = world(e);
    const step = w.x / pxStep();
    if (!drag) {
      if (onScrollbar(e)) return;
      const hit = clipAt(step, trackAt(w.y));
      const edge = hit && (S.tool === 'draw' || S.tool === 'select') ? edgeOf(hit, step) : null;
      scroller.style.cursor = edge ? 'ew-resize' : hit ? (S.tool === 'slice' ? 'col-resize' : 'grab') : 'crosshair';
      return;
    }
    const sz = e.altKey ? 0 : snap();
    if (drag.type === 'move') {
      let ds = snapRound(step - drag.anchor, sz);
      ds = Math.max(ds, -Math.min(...drag.orig.map((o) => o.start)));
      const dt = clamp(trackAt(w.y) - drag.anchorTrack, -Math.min(...drag.orig.map((o) => o.track)), PLAYLIST_TRACKS - 1 - Math.max(...drag.orig.map((o) => o.track)));
      for (const o of drag.orig) { o.c.start = o.start + ds; o.c.track = o.track + dt; }
      updateSpacer();
    } else if (drag.type === 'resize-right') {
      const ds = step - drag.anchor;
      for (const o of drag.orig) o.c.len = Math.max(sz || 0.25, snapRound(o.len + ds, sz || 0.25));
      updateSpacer();
    } else if (drag.type === 'resize-left') {
      const ds = step - drag.anchor;
      for (const o of drag.orig) {
        const type = typeOf(o.c);
        const lowest = type === 'pattern' ? 0 : o.start - (o.offset || 0);
        const newStart = clamp(snapRound(o.start + ds, sz || 0.25), lowest, o.start + o.len - (sz || 0.25));
        const d = newStart - o.start;
        o.c.start = newStart;
        o.c.len = o.len - d;
        if (type === 'pattern') o.c.offset = mod(o.offset + d, patLen(o.c.pat));
        else o.c.offset = Math.max(0, (o.offset || 0) + d);
      }
    } else if (drag.type === 'paint') {
      while (step >= drag.next && drag.next < totalSteps()) {
        if (!clipAt(drag.next + 0.01, drag.track)) { const c = placeClip(drag.patId, drag.track, drag.next, drag.len); S.selection.add(c.id); }
        drag.next += drag.len;
      }
      updateSpacer();
    } else if (drag.type === 'band') {
      S.band.x1 = w.x; S.band.y1 = w.y;
      const x0 = Math.min(S.band.x0, S.band.x1) / pxStep(), x1 = Math.max(S.band.x0, S.band.x1) / pxStep();
      const t0 = trackAt(Math.min(S.band.y0, S.band.y1)), t1 = trackAt(Math.max(S.band.y0, S.band.y1));
      S.selection = new Set(drag.base);
      for (const c of clips()) if (c.start < x1 && c.start + c.len > x0 && c.track >= t0 && c.track <= t1) S.selection.add(c.id);
    } else if (drag.type === 'erase') {
      eraseAt(step, trackAt(w.y));
    } else if (drag.type === 'mute') {
      const hit = clipAt(step, trackAt(w.y));
      if (hit && !drag.done.has(hit.id)) { hit.mute = !hit.mute; drag.done.add(hit.id); }
    }
    emitPlaylist();
    invalidate();
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    S.band = null;
    store.dirty = true;
    emitPlaylist();
    invalidate();
  };
  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);

  scroller.addEventListener('dblclick', (e) => {
    if (onScrollbar(e)) return;
    const w = world(e);
    const hit = clipAt(w.x / pxStep(), trackAt(w.y));
    if (!hit) return;
    const type = typeOf(hit);
    if (type === 'pattern') { store.selectPattern(hit.pat); wm.get('rack').show(); }
    else if (type === 'auto') app.actions.openAutomation(hit.autoId);
  });

  function showClipMenu(c, x, y) {
    const type = typeOf(c);
    const pat = type === 'pattern' ? store.pattern(c.pat) : null;
    if (!S.selection.has(c.id)) { S.selection.clear(); S.selection.add(c.id); invalidate(); }
    const items = [];
    if (pat) {
      items.push(
        { label: 'Open in channel rack', action: () => { store.selectPattern(pat.id); wm.get('rack').show(); } },
        { label: 'Open in piano roll', action: () => { store.selectPattern(pat.id); wm.get('piano').show(); } },
        { label: 'Rename pattern…', action: () => app.actions.renamePattern(pat.id) },
        { label: 'Make unique', action: () => makeUnique(c) },
        { label: 'Split by channel', disabled: store.project.channels.filter((ch) => pat.notes[ch.id]?.length).length < 2, action: () => {
          store.checkpoint();
          const made = splitByChannel(store, c);
          S.selection = new Set(made.map((x) => x.id));
          store.emit('patterns');
          store.emit('playlist');
        } },
        { label: 'Fit clip to pattern length', action: () => { store.checkpoint(); c.len = patLen(c.pat); c.offset = 0; store.emit('playlist'); } },
        { label: 'Color', submenu: COLORS.map((col) => ({ label: ' ', swatch: col, action: () => { store.checkpoint(); pat.color = col; store.emit('patterns'); } })) },
        { separator: true },
      );
    } else if (type === 'auto') {
      items.push({ label: 'Edit automation…', action: () => app.actions.openAutomation(c.autoId) }, { separator: true });
    } else if (type === 'audio') {
      const fades = (key) => [0, 0.5, 1, 2, 4, 8, 16].map((st) => ({
        label: st ? `${st >= 4 ? `${st / 4} beat${st > 4 ? 's' : ''}` : `${st} step${st > 1 ? 's' : ''}`}` : 'None',
        checked: (c[key] || 0) === st,
        action: () => { store.checkpoint(); if (st) c[key] = Math.min(st, c.len); else delete c[key]; store.emit('playlist'); },
      }));
      items.push(
        { label: 'Gain…', action: async () => {
          const db = Math.round(20 * Math.log10(c.gain ?? 1) * 10) / 10;
          const v = await formDialog('Clip gain', [{ key: 'db', label: 'Gain (dB)', value: db, min: -48, max: 12, step: 0.5 }], 'Set');
          if (!v) return;
          store.checkpoint();
          c.gain = Math.round(10 ** (v.db / 20) * 10000) / 10000;
          store.emit('playlist');
        } },
        { label: 'Fade in', submenu: fades('fadeIn') },
        { label: 'Fade out', submenu: fades('fadeOut') },
        { label: 'Reverse', checked: !!c.reverse, action: () => { store.checkpoint(); if (c.reverse) delete c.reverse; else c.reverse = true; store.emit('playlist'); } },
        { label: c.pitch ? `Pitch (${c.pitch > 0 ? '+' : ''}${c.pitch} st)…` : 'Pitch…', action: async () => {
          const v = await formDialog('Clip pitch', [{ key: 'st', label: 'Semitones (length stays the same)', value: c.pitch ?? 0, min: -24, max: 24, step: 0.1 }], 'Set');
          if (!v) return;
          store.checkpoint();
          const st = Math.round(v.st * 10) / 10;
          if (st) c.pitch = st; else delete c.pitch;
          store.emit('playlist');
        } },
        { label: 'Follow the project tempo', submenu: [
          { label: 'Off (play as recorded)', checked: !c.stretch, action: () => { store.checkpoint(); delete c.stretch; store.emit('playlist'); } },
          { label: 'Stretch (keep the pitch)…', checked: c.stretch?.mode === 'stretch', action: () => tempoFollow(c, 'stretch') },
          { label: 'Resample (pitch follows)…', checked: c.stretch?.mode === 'resample', action: () => tempoFollow(c, 'resample') },
        ] },
        { separator: true },
      );
    }
    items.push(
      { label: 'Duplicate', shortcut: 'Ctrl+B', action: () => duplicateSelection() },
      ...(type !== 'auto' ? [{ label: S.selection.size > 1 ? 'Render selection to an audio clip' : 'Render to an audio clip', action: () => app.actions.renderClipsToAudio([...S.selection]) }] : []),
      { label: c.mute ? 'Unmute' : 'Mute', action: () => { store.checkpoint(); c.mute = !c.mute; store.emit('playlist'); } },
      { label: 'Delete', shortcut: 'Del', action: () => { store.checkpoint(); store.project.playlist.clips = clips().filter((x) => x !== c); S.selection.delete(c.id); store.emit('playlist'); } },
    );
    showMenu(items, x, y);
  }

  /** Make an audio clip follow the project tempo: ask the loop's own tempo (guessed from its length) and fit the clip. */
  async function tempoFollow(c, mode) {
    const buf = store.samples.get(c.sampleId)?.buffer;
    if (!buf) return;
    const guess = c.stretch?.bpm ?? guessLoopBpm(buf.duration, BAR() / 4, store.project.bpm);
    const v = await formDialog(mode === 'stretch' ? 'Stretch to the project tempo' : 'Resample to the project tempo', [
      { key: 'bpm', label: 'The loop\'s own tempo (BPM)', value: guess, min: 20, max: 400, step: 0.01 },
    ], 'Apply', `At ${store.project.bpm} BPM the clip will play ${mode === 'stretch' ? 'at its own pitch' : 'faster or slower, and higher or lower'}. The tempo is guessed from the length of the sample; correct it if the loop drifts.`);
    if (!v) return;
    store.checkpoint();
    c.stretch = { mode, bpm: v.bpm };
    // the clip covers the whole loop at the new speed (whole steps where it is close)
    const steps = (buf.duration * v.bpm * 4) / 60;
    c.len = Math.abs(steps - Math.round(steps)) < 0.05 ? Math.round(steps) : Math.round(steps * 4) / 4;
    c.offset = 0;
    store.emit('playlist');
  }

  /** Clone the clip's pattern and point the clip at the clone so it can be edited independently. */
  function makeUnique(c) {
    const src = store.pattern(c.pat);
    if (!src) return;
    const copy = store.clonePattern(src.id); // checkpoints and selects the clone
    const base = src.name.replace(/ #\d+$/, '');
    let k = 2;
    while (store.project.patterns.some((p) => p.name === `${base} #${k}`)) k++;
    copy.name = `${base} #${k}`;
    c.pat = copy.id;
    store.emit('patterns');
    store.emit('playlist');
  }

  /** Copy the selected clips right after the selection (Ctrl+B). */
  function duplicateSelection() {
    const sel = clips().filter((c) => S.selection.has(c.id));
    if (!sel.length) return;
    store.checkpoint();
    const start = Math.min(...sel.map((c) => c.start));
    const end = Math.max(...sel.map((c) => c.start + c.len));
    const q = snap() || 1;
    const span = Math.max(q, Math.ceil((end - start) / q - 1e-6) * q);
    S.selection.clear();
    for (const c of sel) S.selection.add(store.addClip({ ...c, id: undefined, start: c.start + span }).id);
    store.emit('playlist');
  }

  function eraseAt(step, track) {
    const hit = clipAt(step, track);
    if (!hit) return;
    store.project.playlist.clips = clips().filter((c) => c !== hit);
    S.selection.delete(hit.id);
    emitPlaylist();
    invalidate();
  }

  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, world(e).vx); }
  }, { passive: false });
  scroller.addEventListener('scroll', invalidate);
  appearance.on('change', invalidate);
  heads.addEventListener('wheel', (e) => { scroller.scrollTop += e.deltaY; }, { passive: true });
  picker.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  // drag & drop: patterns, library samples, and audio files from the desktop
  const accepts = (e) => {
    const t = e.dataTransfer.types;
    return t.includes('text/openstudio-pattern') || t.includes('text/openstudio-sample') || t.includes('text/openstudio-file') || t.includes('Files');
  };
  scroller.addEventListener('dragover', (e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  scroller.addEventListener('drop', async (e) => {
    if (!accepts(e)) return;
    // desktop files the playlist can't place (a project, say) are left to the window
    const files = [...e.dataTransfer.files];
    if (files.length && !files.some((f) => /\.(mid|midi|rmi|wav|mp3|ogg|flac|aiff?|aac|m4a)$/i.test(f.name) || /^audio\//.test(f.type))) return;
    e.preventDefault();
    const w = world(e);
    const sz = snap();
    const start = snapFloor(w.x / pxStep(), sz || 1);
    let track = trackAt(w.y);
    const patId = Number(e.dataTransfer.getData('text/openstudio-pattern'));
    const sampleId = Number(e.dataTransfer.getData('text/openstudio-sample'));
    const libFile = e.dataTransfer.getData('text/openstudio-file');
    if (libFile) {
      // a file from the browser's sample folders
      try {
        const data = await app.browser.readFile(libFile);
        const id = store.addSample(libFile.split(/[\\/]/).pop(), data.slice(0));
        await placeAudio(id, track, start);
      } catch (err) { console.warn('Could not place the sample', err); }
    } else if (store.pattern(patId)) {
      store.checkpoint();
      placeClip(patId, track, start, patLen(patId));
      store.emit('playlist');
    } else if (store.samples.has(sampleId)) {
      await placeAudio(sampleId, track, start);
    } else {
      for (const file of e.dataTransfer.files) {
        if (/\.(mid|midi|rmi)$/i.test(file.name)) { await app.actions.importMidiFile(file, { track: track++, start }); continue; }
        if (!/^audio\//.test(file.type) && !/\.(wav|mp3|ogg|flac|aac|m4a)$/i.test(file.name)) continue;
        const id = store.addSample(file.name, await file.arrayBuffer());
        await placeAudio(id, track++, start);
      }
    }
  });

  // ruler: click seeks, shift/right-drag selects a loop region, double-click clears it
  let scrub = null;
  const rulerStep = (e) => Math.max(0, (e.offsetX + scroller.scrollLeft) / pxStep());
  cRuler.addEventListener('contextmenu', (e) => e.preventDefault());
  cRuler.addEventListener('pointerdown', (e) => {
    cRuler.setPointerCapture(e.pointerId);
    const step = rulerStep(e);
    const marker = e.button === 0 && !e.shiftKey ? markerAtRuler(e.offsetX, e.offsetY) : null;
    if (marker) { transport.seek(marker.step); scrub = { type: 'marker', marker }; return; }
    if (e.button === 2) { scrub = { type: 'pending', x: e.clientX, step, e }; return; }
    if (e.shiftKey) {
      const a = snapRound(step, BEAT());
      scrub = { type: 'loop', a };
      store.checkpoint();
      store.project.loop = { start: a, end: a + BEAT() };
    } else {
      scrub = { type: 'seek' };
      transport.seek(snapRound(step, Math.min(snap() || 1, 4)));
    }
  });
  cRuler.addEventListener('pointermove', (e) => {
    if (!scrub) return;
    const step = rulerStep(e);
    if (scrub.type === 'marker') return;
    if (scrub.type === 'pending') {
      // a right-drag selects a loop region; a right-click without a drag opens the ruler menu
      if (Math.abs(e.clientX - scrub.x) < 4) return;
      const a = snapRound(scrub.step, BEAT());
      scrub = { type: 'loop', a };
      store.checkpoint();
    }
    if (scrub.type === 'seek') transport.seek(snapRound(step, Math.min(snap() || 1, 4)));
    else {
      const b = snapRound(step, BEAT());
      store.project.loop = { start: Math.min(scrub.a, b), end: Math.max(scrub.a, b) + (b === scrub.a ? BEAT() : 0) };
      invalidate();
    }
  });
  cRuler.addEventListener('pointerup', (e) => {
    if (scrub?.type === 'pending') { const st = scrub.step; scrub = null; rulerMenu(e, st); return; }
    if (scrub?.type === 'loop') { store.dirty = true; store.emit('loop'); if (!transport.loopEnabled) transport.setLoop(true); }
    scrub = null;
  });
  cRuler.addEventListener('dblclick', (e) => {
    const marker = markerAtRuler(e.offsetX, e.offsetY);
    if (marker) { renameMarker(marker); return; }
    if (store.project.loop && !e.shiftKey) { store.checkpoint(); store.project.loop = null; store.emit('loop'); invalidate(); }
  });

  // keyboard
  root.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    const sel = clips().filter((c) => S.selection.has(c.id));
    const removeSelection = () => { store.project.playlist.clips = clips().filter((c) => !S.selection.has(c.id)); S.selection.clear(); store.emit('playlist'); };
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!sel.length) return;
      handled();
      store.checkpoint();
      removeSelection();
    } else if (ctrl && e.key.toLowerCase() === 'a') {
      handled();
      S.selection = new Set(clips().map((c) => c.id));
      invalidate();
    } else if (ctrl && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
      if (!sel.length) return;
      handled();
      const minS = Math.min(...sel.map((c) => c.start));
      const minT = Math.min(...sel.map((c) => c.track));
      S.clipboard = sel.map((c) => ({ ...c, start: c.start - minS, track: c.track - minT }));
      if (e.key.toLowerCase() === 'x') { store.checkpoint(); removeSelection(); }
    } else if (ctrl && e.key.toLowerCase() === 'v') {
      if (!S.clipboard.length) return;
      handled();
      store.checkpoint();
      const at = snapFloor(transport.playing || transport.mode === 'song' ? transport.position() : scroller.scrollLeft / pxStep(), BAR());
      const baseTrack = Math.floor(scroller.scrollTop / TRACK_H);
      S.selection.clear();
      for (const c of S.clipboard) {
        const n = store.addClip({ ...c, id: undefined, start: c.start + at, track: clamp(c.track + baseTrack, 0, PLAYLIST_TRACKS - 1) });
        S.selection.add(n.id);
      }
      store.emit('playlist');
    } else if (ctrl && e.key.toLowerCase() === 'b') {
      handled();
      duplicateSelection();
    } else if (ctrl && e.key.toLowerCase() === 'd') {
      handled();
      S.selection.clear(); invalidate();
    } else if (e.key === 'Escape') { S.selection.clear(); invalidate(); }
  });

  // ---------------------------------------------------------------- wiring
  store.on('project', () => { S.selection.clear(); buildHeads(); buildPicker(); updateSpacer(); invalidate(); });
  store.on('playlist', () => { updateSpacer(); invalidate(); });
  store.on('notes', invalidate);
  store.on('loop', invalidate);
  store.on('sampleReady', invalidate);
  store.on('patterns', () => { buildPicker(); invalidate(); });
  store.on('selection', buildPicker);
  transport.on('change', invalidate);
  app.on('snap', invalidate);
  win.on('show', () => { layout(); invalidate(); });
  buildHeads();
  buildPicker();

  function update() {
    if (!win.visible) return;
    const show = transport.mode === 'song';
    playhead.style.display = show ? 'block' : 'none';
    if (!show) return;
    const pos = transport.position();
    let x = pos * pxStep() - scroller.scrollLeft;
    if (transport.playing && (x > scroller.clientWidth - 30 || x < 0)) {
      scroller.scrollLeft = Math.max(0, pos * pxStep() - 60);
      x = pos * pxStep() - scroller.scrollLeft;
    }
    playhead.style.display = x < 0 || x > scroller.clientWidth ? 'none' : 'block';
    playhead.style.transform = `translateX(${x + PICKER_W + HEAD_W}px)`;
  }

  return { win, update, placeAudio };
}
