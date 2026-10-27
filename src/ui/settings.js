import { h } from '../util.js';
import { icon } from './icons.js';
import { createKnob } from './knob.js';
import { showMenu } from './menu.js';
import { PARAM_META } from '../audio/instruments.js';
import { sizeCanvas } from './draw.js';
import { T, appearance } from '../theme.js';

const TYPE_LABEL = { drum: 'Drum voice', synth: 'Synth', sampler: 'Sampler', sf: 'Instrument' };
const iconFor = (ch) => ({ drum: 'drum', sampler: 'sampler', sf: ch.bank === 128 ? 'drum' : 'piano' }[ch.type] || 'synth');

export function createSettings(app) {
  const { store, wm, engine, actions } = app;
  const win = wm.create({
    id: 'settings', title: 'Channel settings', icon: 'settings', minW: 420, minH: 220,
    rect: (dw, dh) => ({ x: Math.max(20, dw / 2 - 320), y: Math.max(40, dh / 2 - 190), w: 640, h: 360 }),
    visible: false,
  });
  win.body.classList.add('cs-body');

  let chId = null;
  const channel = () => store.channel(chId);

  function open(id) {
    chId = id ?? store.selectedChannel?.id ?? null;
    if (chId == null) return;
    render();
    win.show();
  }

  function touch() {
    store.dirty = true;
    store.emit('channelParams', chId);
  }

  function render() {
    const ch = channel();
    win.body.replaceChildren();
    if (!ch) { win.setTitle('Channel settings'); return; }
    win.setTitle(`Channel settings — ${ch.name}`);

    const nameBtn = h('button', { class: 'btn cs-name', style: { borderLeft: `4px solid ${ch.color}` } }, icon(iconFor(ch)), ch.name);
    nameBtn.addEventListener('click', () => actions.renameChannel(ch.id));

    const vol = createKnob({ value: ch.vol, min: 0, max: 1, def: 0.78, size: 38, label: 'Volume', target: { kind: 'channel', id: ch.id, param: 'vol' }, fmt: (v) => `${Math.round((v / 0.78) * 100)}%`, onStart: () => store.checkpoint(), onChange: (v) => { ch.vol = v; store.emit('channelMix'); } });
    const pan = createKnob({ value: ch.pan, min: -1, max: 1, def: 0, size: 38, bipolar: true, label: 'Panning', target: { kind: 'channel', id: ch.id, param: 'pan' }, fmt: (v) => (Math.abs(v) < 0.01 ? 'Centered' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'left' : 'right'}`), onStart: () => store.checkpoint(), onChange: (v) => { ch.pan = v; store.emit('channelMix'); } });
    const head = h('div', { class: 'cs-head' },
      nameBtn,
      ch.type === 'sf' ? presetPicker(ch) : h('span', { class: 'cs-type' }, ch.type === 'drum' ? `${TYPE_LABEL.drum} · ${ch.voice}` : TYPE_LABEL[ch.type]),
      h('div', { class: 'tb-flex' }),
      h('div', { class: 'cs-knob' }, vol, h('span', {}, 'Vol')),
      h('div', { class: 'cs-knob' }, pan, h('span', {}, 'Pan')));
    win.body.append(head);

    if (ch.type === 'sampler') win.body.append(samplerPanel(ch));

    const grid = h('div', { class: 'cs-grid' });
    for (const meta of PARAM_META[ch.type]) {
      if (meta.type === 'select') {
        const btn = h('button', { class: 'dd' }, h('span', {}, ch.params[meta.key]), h('span', { class: 'caret' }, '▼'));
        btn.addEventListener('click', () => {
          const r = btn.getBoundingClientRect();
          showMenu(meta.options.map((o) => ({ label: o, checked: ch.params[meta.key] === o, action: () => { store.checkpoint(); ch.params[meta.key] = o; touch(); render(); } })), r.left, r.bottom);
        });
        grid.append(h('div', { class: 'cs-param' }, btn, h('span', {}, meta.label)));
      } else if (meta.type === 'toggle') {
        const b = h('button', { class: `btn cs-toggle${ch.params[meta.key] ? ' on' : ''}` }, ch.params[meta.key] ? 'On' : 'Off');
        b.addEventListener('click', () => { store.checkpoint(); ch.params[meta.key] = !ch.params[meta.key]; touch(); render(); });
        grid.append(h('div', { class: 'cs-param' }, b, h('span', {}, meta.label)));
      } else {
        const k = createKnob({
          value: ch.params[meta.key], min: meta.min, max: meta.max, def: meta.def, size: 42, log: meta.log, step: meta.step || 0,
          label: meta.label, fmt: meta.fmt, onStart: () => store.checkpoint(),
          target: { kind: 'chparam', id: ch.id, key: meta.key },
          onChange: (v) => { ch.params[meta.key] = v; touch(); },
        });
        grid.append(h('div', { class: 'cs-param' }, k, h('span', {}, meta.label)));
      }
    }
    win.body.append(grid);

    const test = h('button', { class: 'btn cs-test' }, icon('play'), 'Test note');
    test.addEventListener('click', () => engine.preview(ch, 60, 0.85, 0.6));
    win.body.append(h('div', { class: 'cs-foot' }, test));
  }

  /** Preset chooser for SoundFont channels (instrument family → preset, or drum kit → piece). */
  function presetPicker(ch) {
    const cat = actions.catalog();
    const isDrum = ch.bank === 128;
    const kit = cat?.kits.find((k) => k.program === ch.program);
    const current = isDrum
      ? `${kit?.name ?? 'Drum kit'}${ch.fixedKey != null ? ` · ${kit?.pieces.find((p) => p.key === ch.fixedKey)?.name ?? ch.fixedKey}` : ''}`
      : (cat?.families.flatMap((f) => f.presets).find((p) => p.bank === ch.bank && p.program === ch.program)?.name ?? 'Instrument');
    const btn = h('button', { class: 'dd cs-preset', 'data-hint': 'Change the sound' }, h('span', {}, current), h('span', { class: 'caret' }, '▼'));
    btn.addEventListener('click', () => {
      if (!cat) return;
      const r = btn.getBoundingClientRect();
      const apply = (patch) => { store.checkpoint(); Object.assign(ch, patch); touchChannel(ch); };
      const items = isDrum
        ? cat.kits.map((k) => ({
            label: k.name,
            checked: k.program === ch.program,
            submenu: [
              ...(ch.fixedKey == null ? [] : []),
              ...k.pieces.filter((p) => p.key >= 27).map((p) => ({ label: p.name, checked: ch.fixedKey === p.key && k.program === ch.program, action: () => apply({ program: k.program, ...(ch.fixedKey != null ? { fixedKey: p.key, name: p.name } : {}) }) })),
            ],
          }))
        : cat.families.map((f) => ({
            label: f.name,
            submenu: f.presets.map((p) => ({ label: p.name, checked: p.bank === ch.bank && p.program === ch.program, action: () => apply({ bank: p.bank, program: p.program, name: p.name }) })),
          }));
      showMenu(items, r.left, r.bottom);
    });
    return btn;
  }

  function touchChannel(ch) {
    store.emit('channels');
    engine.preview(ch, ch.fixedKey != null || ch.bank === 128 ? (ch.rootPitch ?? 60) : 60, 0.8, 0.8);
  }

  function samplerPanel(ch) {
    const s = store.samples.get(ch.sampleId);
    const canvas = h('canvas', { class: 'cs-wave' });
    const load = h('button', { class: 'btn' }, icon('open'), s ? s.name : 'Load sample…');
    load.addEventListener('click', async () => {
      const files = await window.studioAPI.openSamples();
      if (!files.length) return;
      store.checkpoint();
      ch.sampleId = store.addSample(files[0].name, files[0].data);
      ch.name = files[0].name.replace(/\.[^.]+$/, '');
      store.emit('channels');
      render();
    });
    const wrap = h('div', { class: 'cs-sampler' }, canvas, load);
    requestAnimationFrame(() => drawWave(canvas, s, ch));
    return wrap;
  }

  function drawWave(canvas, s, ch) {
    const w = canvas.clientWidth || 560;
    const hh = 70;
    const ctx = canvas.getContext('2d');
    sizeCanvas(canvas, ctx, w, hh);
    ctx.fillStyle = T.waveBg;
    ctx.fillRect(0, 0, w, hh);
    if (!s?.buffer) {
      ctx.fillStyle = T.textDim;
      ctx.font = '12px "Noto Sans", sans-serif';
      ctx.fillText(s ? 'Decoding…' : 'No sample loaded', 12, hh / 2 + 4);
      return;
    }
    const data = s.buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    ctx.fillStyle = ch.color;
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      for (let i = 0; i < step; i++) { const v = data[x * step + i] || 0; if (v < min) min = v; if (v > max) max = v; }
      ctx.fillRect(x, hh / 2 - max * (hh / 2 - 3), 1, Math.max(1, (max - min) * (hh / 2 - 3)));
    }
    const sx = (ch.params.start || 0) * w;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, sx, hh);
  }

  store.on('selection', () => { if (win.visible && store.selectedChannel) { chId = store.selectedChannel.id; render(); } });
  store.on('channels', () => { if (win.visible) render(); });
  appearance.on('change', () => { if (win.visible) render(); });
  store.on('soundfontReady', () => { if (win.visible) render(); });
  store.on('sampleReady', () => { if (win.visible) render(); });
  store.on('project', () => { if (win.visible) { chId = store.selectedChannel?.id ?? null; render(); } });

  return { open, win };
}
