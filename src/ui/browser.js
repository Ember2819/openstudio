import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { ENGINE_PRESETS, ENGINES, DRUM_KIT, defaultParams } from '../audio/instruments.js';
import { EFFECT_DEFS, EFFECT_GROUPS, defaultEffectParams } from '../audio/effects.js';
import { showMenu } from './menu.js';
import { messageDialog } from './dialog.js';

const channelIcon = (c) => ({ drum: 'drum', sampler: 'sampler', organ: 'keys', pluck: 'wave', sfx: 'wave', sf: c.bank === 128 ? 'drum' : 'piano' }[c.type] || 'synth');

export function createBrowser(app) {
  const { store, engine, wm, actions } = app;
  const root = document.getElementById('browser');
  const splitter = document.getElementById('browser-splitter');

  const search = h('input', { type: 'text', placeholder: 'Search…', class: 'br-search' });
  const header = h('div', { class: 'br-header' }, h('span', { class: 'br-title' }, 'Browser'), search);
  const tree = h('div', { class: 'br-tree' });
  root.append(header, tree);

  const open = new Set(['Current project', 'Instruments', 'Drum kits', 'Sample folders']);
  let selectedPath = null;

  const spec = (type, extra) => ({ type, params: defaultParams(type), ...extra });
  /** Audition low sounds low, so a bass preset is judged where it will be played. */
  const previewPitch = (type, cat) => (cat === 'Bass' || /bass/i.test(cat) ? 48 : type === 'sfx' ? 60 : 60);

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

  // ---------------------------------------------------------------- sample folders on disk
  const libApi = window.studioAPI?.library;
  const lib = { folders: [], dirs: new Map(), data: new Map(), decoded: new Map() };
  const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
  if (libApi) libApi.folders().then((f) => { lib.folders = f; render(); }).catch(() => {});

  async function loadDir(dir) {
    lib.dirs.set(dir, 'loading');
    try { lib.dirs.set(dir, await libApi.list(dir)); } catch (err) { lib.dirs.set(dir, err); }
    render();
  }
  /** File contents, cached for the last few files (previews and adding the same file twice). */
  async function readFile(file) {
    if (lib.data.has(file)) return lib.data.get(file);
    const data = await libApi.read(file);
    lib.data.set(file, data);
    if (lib.data.size > 24) lib.data.delete(lib.data.keys().next().value);
    return data;
  }
  let previewSrc = null;
  async function previewFile(file) {
    try {
      engine.ensure();
      let buf = lib.decoded.get(file);
      if (!buf) {
        buf = await engine.ctx.decodeAudioData((await readFile(file)).slice(0));
        lib.decoded.set(file, buf);
        if (lib.decoded.size > 24) lib.decoded.delete(lib.decoded.keys().next().value);
      }
      try { previewSrc?.stop(); } catch { /* already finished */ }
      const src = engine.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(engine.track(0).input);
      src.start();
      previewSrc = src;
    } catch (err) {
      console.warn('Preview failed', err);
    }
  }
  async function addFileAsChannel(file) {
    try {
      const data = await readFile(file);
      const name = baseName(file);
      const id = store.addSample(name, data.slice(0));
      store.addChannel({ name: name.replace(/\.[^.]+$/, ''), type: 'sampler', sampleId: id });
    } catch (err) {
      messageDialog('Could not load the sample', err.message);
    }
  }
  function dirNodes(dir) {
    const e = lib.dirs.get(dir);
    if (!e || e === 'loading') return [{ label: 'Loading…', icon: 'wave' }];
    if (e instanceof Error) return [{ label: 'Cannot read this folder', icon: 'wave' }];
    if (!e.length) return [{ label: '(no audio files)', icon: 'wave' }];
    return e.map((x) => (x.dir
      ? { label: x.name, icon: 'folder', lazy: x.path, children: dirNodes(x.path) }
      : { label: x.name, icon: 'wave', dragFile: x.path, hint: 'Click to preview · double-click to add a sampler channel · drag to the playlist or channel rack', onClick: () => previewFile(x.path), onDbl: () => addFileAsChannel(x.path) }));
  }
  function libraryNode() {
    const add = { label: 'Add a folder…', icon: 'plus', onClick: async () => { lib.folders = await libApi.add(); render(); } };
    return {
      label: 'Sample folders', icon: 'folder',
      children: [
        ...lib.folders.map((f) => ({
          label: baseName(f), icon: 'folder', lazy: f, children: dirNodes(f), hint: f,
          onContext: (e) => showMenu([
            { label: 'Refresh', action: () => { for (const k of [...lib.dirs.keys()]) if (k.startsWith(f)) lib.dirs.delete(k); render(); } },
            { label: 'Remove from the browser', action: async () => { lib.folders = await libApi.remove(f); render(); } },
          ], e.clientX, e.clientY),
        })),
        add,
      ],
    };
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
      ...(libApi ? [libraryNode()] : []),
      ...soundfontNodes(),
      ...Object.entries(ENGINE_PRESETS).map(([type, cats]) => ({
        label: type === 'synth' ? 'Synth presets' : `${ENGINES[type].label} presets`, icon: 'folder',
        children: Object.entries(cats).map(([cat, list]) => ({
          label: cat, icon: 'folder',
          children: list.map((p) => ({
            label: p.name, icon: ENGINES[type].icon,
            onClick: () => engine.previewSpec({ type, params: { ...defaultParams(type), ...p.params } }, previewPitch(type, cat)),
            onDbl: () => actions.addChannel(type, p),
          })),
        })),
      })),
      {
        label: 'Drum voices', icon: 'folder',
        children: DRUM_KIT.map((d) => ({
          label: d.name, icon: 'drum',
          onClick: () => engine.previewSpec({ type: 'drum', voice: d.voice, params: defaultParams('drum') }, 60),
          onDbl: () => actions.addChannel('drum', d),
        })),
      },
      {
        label: 'Generators', icon: 'folder',
        children: [
          ...Object.entries(ENGINES).map(([type, info]) => ({
            label: info.label, icon: info.icon, hint: info.blurb,
            onClick: () => engine.previewSpec(spec(type)), onDbl: () => actions.addChannel(type),
          })),
          { label: 'Sampler…', icon: 'sampler', onDbl: () => actions.addSamplerFromFile(), onClick: () => {} },
        ],
      },
      {
        label: 'Effects', icon: 'folder',
        children: Object.entries(EFFECT_GROUPS).map(([label, types]) => ({
          label, icon: 'folder',
          children: types.map((type) => ({
            label: EFFECT_DEFS[type].name, icon: 'fx',
            hint: 'Double-click to add to the selected mixer track',
            onDbl: () => addEffect(type),
          })),
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
          draggable: node.dragPattern != null || node.dragSample != null || node.dragFile != null,
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
        if (node.onContext) row.addEventListener('contextmenu', (e) => { e.preventDefault(); node.onContext(e); });
        if (node.dragFile != null) {
          row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/openstudio-file', node.dragFile); e.dataTransfer.effectAllowed = 'copy'; });
        }
        // a sample folder loads its contents the first time it is opened
        if (node.lazy && isOpen && !lib.dirs.has(node.lazy)) loadDir(node.lazy);
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

  return { render, readFile };
}
