import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { SYNTH_PRESETS, defaultParams } from '../audio/instruments.js';
import { EFFECT_DEFS, defaultEffectParams } from '../audio/effects.js';

const channelIcon = (c) => ({ drum: 'drum', sampler: 'sampler', sf: c.bank === 128 ? 'drum' : 'piano' }[c.type] || 'synth');

export function createBrowser(app) {
  const { store, engine, wm, actions } = app;
  const root = document.getElementById('browser');
  const splitter = document.getElementById('browser-splitter');

  const search = h('input', { type: 'text', placeholder: 'Search…', class: 'br-search' });
  const header = h('div', { class: 'br-header' }, h('span', { class: 'br-title' }, 'Browser'), search);
  const tree = h('div', { class: 'br-tree' });
  root.append(header, tree);

  const open = new Set(['Current project', 'Instruments', 'Drum kits']);
  let selectedPath = null;

  const spec = (type, extra) => ({ type, params: defaultParams(type), ...extra });

  function soundfontNodes() {
    const cat = actions.catalog();
    if (!cat) return [{ label: 'Loading instruments…', icon: 'wave', children: [] }];
    const sfSpec = (extra) => ({ type: 'sf', params: defaultParams('sf'), ...extra });
    return [
      {
        label: 'Instruments', icon: 'folder',
        children: cat.families.map((f) => ({
          label: f.name, icon: 'folder',
          children: f.presets.map((p) => ({
            label: p.name, icon: 'piano', hint: 'Click to preview · double-click to add a channel',
            onClick: () => engine.previewSpec(sfSpec({ bank: p.bank, program: p.program }), 60),
            onDbl: () => actions.addInstrument({ name: p.name, bank: p.bank, program: p.program }),
          })),
        })),
      },
      {
        label: 'Drum kits', icon: 'folder',
        children: cat.kits.map((k) => ({
          label: k.name, icon: 'folder',
          children: [
            { label: 'Full kit (piano roll)', icon: 'drum', onClick: () => engine.previewSpec(sfSpec({ bank: 128, program: k.program }), 36), onDbl: () => actions.addInstrument({ name: k.name, bank: 128, program: k.program, rootPitch: 36 }) },
            ...k.pieces.filter((pc) => pc.key >= 27).map((pc) => ({
              label: pc.name, icon: 'drum',
              onClick: () => engine.previewSpec(sfSpec({ bank: 128, program: k.program, fixedKey: pc.key }), 60),
              onDbl: () => actions.addInstrument({ name: pc.name, bank: 128, program: k.program, fixedKey: pc.key }),
            })),
          ],
        })),
      },
    ];
  }

  function nodes() {
    const proj = store.project;
    return [
      {
        label: 'Current project', icon: 'file',
        children: [
          {
            label: 'Channels', icon: 'channelrack',
            children: proj.channels.map((c) => ({
              label: c.name, icon: channelIcon(c), color: c.color,
              onClick: () => { store.selectChannel(c.id); engine.preview(c); },
              onDbl: () => wm.get('piano').show(),
            })),
          },
          {
            label: 'Patterns', icon: 'pattern',
            children: proj.patterns.map((p) => ({
              label: p.name, icon: 'pattern', color: p.color, dragPattern: p.id,
              onClick: () => store.selectPattern(p.id),
              onDbl: () => wm.get('rack').show(),
            })),
          },
          {
            label: 'Mixer', icon: 'mixer',
            children: proj.mixer.slice(0, 126).map((m, i) => ({ m, i })).filter(({ m, i }) => i === 0 || proj.channels.some((c) => c.mixer === i))
              .map(({ m, i }) => ({ label: m.name, icon: 'mixer', onClick: () => { proj.selected.mixer = i; store.emit('mixerSelection'); }, onDbl: () => wm.get('mixer').show() })),
          },
        ],
      },
      ...soundfontNodes(),
      {
        label: 'Synth presets', icon: 'folder',
        children: Object.entries(SYNTH_PRESETS).map(([cat, list]) => ({
          label: cat, icon: 'folder',
          children: list.map((p) => ({
            label: p.name, icon: 'synth',
            onClick: () => engine.previewSpec({ type: 'synth', params: { ...defaultParams('synth'), ...p.params } }, cat === 'Bass' ? 48 : 60),
            onDbl: () => actions.addChannel('synth', p),
          })),
        })),
      },
      {
        label: 'Generators', icon: 'folder',
        children: [
          { label: 'Synth', icon: 'synth', onClick: () => engine.previewSpec(spec('synth')), onDbl: () => actions.addChannel('synth') },
          { label: 'Sampler…', icon: 'sampler', onDbl: () => actions.addSamplerFromFile(), onClick: () => {} },
        ],
      },
      {
        label: 'Effects', icon: 'folder',
        children: Object.entries(EFFECT_DEFS).map(([type, def]) => ({
          label: def.name, icon: 'fx',
          hint: 'Double-click to add to the selected mixer track',
          onDbl: () => addEffect(type),
        })),
      },
      {
        label: 'Samples', icon: 'folder',
        children: [
          { label: 'Import sample…', icon: 'plus', onClick: () => actions.importSamples() },
          ...[...store.samples.entries()].map(([id, s]) => ({
            label: s.name, icon: 'wave', dragSample: id,
            onClick: () => engine.previewSpec({ type: 'sampler', sampleId: id, params: defaultParams('sampler') }),
            onDbl: () => store.addChannel({ name: s.name.replace(/\.[^.]+$/, ''), type: 'sampler', sampleId: id }),
          })),
        ],
      },
    ];
  }

  function addEffect(type) {
    const track = store.project.selected.mixer;
    const slots = store.project.mixer[track].fx;
    const free = slots.findIndex((s) => !s);
    if (free < 0) return;
    store.checkpoint();
    slots[free] = { type, params: defaultEffectParams(type), on: true };
    engine.syncFx(track);
    store.emit('mixerSelection');
    wm.get('mixer').show();
    store.emit('mixer');
  }

  const matches = (node, q) => node.label.toLowerCase().includes(q) || node.children?.some((c) => matches(c, q));

  function render() {
    const q = search.value.trim().toLowerCase();
    tree.replaceChildren();
    const walk = (list, depth, parentPath) => {
      for (const node of list) {
        if (q && !matches(node, q)) continue;
        const path = parentPath ? `${parentPath}/${node.label}` : node.label;
        const isOpen = q ? true : open.has(path);
        const row = h('div', {
          class: `br-row${node.children ? ' folder' : ''}${selectedPath === path ? ' selected' : ''}`,
          style: { paddingLeft: `${6 + depth * 14}px` },
          'data-hint': node.hint || (node.children ? '' : node.onDbl ? 'Click to preview · double-click to add' : ''),
          draggable: node.dragPattern != null || node.dragSample != null,
        },
        node.children ? h('span', { class: `br-caret${isOpen ? ' open' : ''}` }, icon('chevronRight')) : h('span', { class: 'br-caret-pad' }),
        h('span', { class: 'br-ico', style: node.color ? { color: node.color } : null }, icon(node.icon)),
        h('span', { class: 'br-label' }, node.label));
        row.addEventListener('click', () => {
          if (node.children) {
            if (open.has(path)) open.delete(path); else open.add(path);
          } else {
            selectedPath = path;
            node.onClick?.();
          }
          render();
        });
        if (node.onDbl) row.addEventListener('dblclick', node.onDbl);
        if (node.dragSample != null) {
          row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/openstudio-sample', String(node.dragSample)); e.dataTransfer.effectAllowed = 'copy'; });
        }
        if (node.dragPattern != null) {
          row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/openstudio-pattern', String(node.dragPattern)); e.dataTransfer.effectAllowed = 'copy'; });
        }
        tree.append(row);
        if (node.children && isOpen) walk(node.children, depth + 1, path);
      }
    };
    walk(nodes(), 0, '');
  }

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => e.stopPropagation());
  for (const evt of ['project', 'channels', 'patterns', 'selection']) store.on(evt, render);
  store.on('sampleReady', render);
  store.on('soundfontReady', render);
  render();

  // splitter
  let drag = null;
  splitter.addEventListener('pointerdown', (e) => {
    splitter.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, w: root.offsetWidth };
  });
  splitter.addEventListener('pointermove', (e) => {
    if (!drag) return;
    root.style.width = `${clamp(drag.w + e.clientX - drag.x, 170, 460)}px`;
  });
  splitter.addEventListener('pointerup', () => { drag = null; });

  return { render };
}
