// Settings drawer (gear button, Ctrl+,): themes, accent palettes, custom colours and wallpaper.
// Everything applies live and is remembered between sessions (src/theme.js).
import { h } from '../util.js';
import { icon } from './icons.js';
import { appearance, THEMES, ACCENTS } from '../theme.js';
import { SOLIDS, GRADIENTS, IMAGES, gradientCss, importImageFile, themeFromWallpaper } from '../wallpapers.js';
import { messageDialog } from './dialog.js';

const COLOR_FIELDS = [
  ['bg', 'Background', 'Behind the windows'],
  ['surface', 'Panels', 'Windows, toolbar and browser'],
  ['text', 'Text', ''],
  ['accent', 'Accent', 'Selection and active controls'],
  ['green', 'Highlight', 'Play, LEDs and the playhead'],
  ['grid', 'Editor grid', 'Piano roll, playlist and automation'],
  ['red', 'Record', 'Record and close buttons'],
];

export function createPreferences() {
  let tab = 'theme';
  const body = h('div', { class: 'prefs-body' });
  const tabs = ['theme', 'wallpaper'].map((id) => {
    const b = h('button', { class: 'prefs-tab', onClick: () => { tab = id; render(); body.scrollTop = 0; } }, id === 'theme' ? 'Theme & colours' : 'Wallpaper');
    b.dataset.tab = id;
    return b;
  });
  const closeBtn = h('button', { class: 'win-btn', 'data-hint': 'Close (Esc)', onClick: () => close() }, icon('close'));
  const el = h('aside', { class: 'prefs hidden', tabIndex: -1 },
    h('div', { class: 'prefs-head' }, h('span', { class: 'prefs-head-ico' }, icon('gear')), h('span', { class: 'prefs-title' }, 'Settings'), h('span', { class: 'tb-flex' }), closeBtn),
    h('div', { class: 'prefs-tabs' }, tabs),
    body);
  document.getElementById('overlay-root').append(el);

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    // keep typing in fields (hex values) from triggering app shortcuts
    if (e.target.tagName === 'INPUT') e.stopPropagation();
  });

  const section = (title, ...children) => h('section', { class: 'prefs-sec' }, h('div', { class: 'prefs-sec-title' }, title), ...children);
  /** Section whose title row carries a small action on the right. */
  const sectionWith = (title, action, ...children) => h('section', { class: 'prefs-sec' },
    h('div', { class: 'prefs-sec-head' }, h('span', { class: 'prefs-sec-title' }, title), action), ...children);

  // ------------------------------------------------------------ theme tab
  function themeCard(id, t) {
    const on = appearance.state.theme === id;
    const card = h('button', { class: `prefs-theme${on ? ' on' : ''}`, 'data-hint': `${t.name} theme`, onClick: () => { appearance.setTheme(id); } },
      h('span', { class: 'pt-preview', style: { background: t.bg } },
        h('span', { class: 'pt-win', style: { background: t.surface } },
          h('span', { class: 'pt-bar', style: { background: t.text, opacity: 0.55 } }),
          h('span', { class: 'pt-grid', style: { background: t.grid } },
            h('span', { class: 'pt-note', style: { background: t.accent } }),
            h('span', { class: 'pt-note b', style: { background: t.green } })))),
      h('span', { class: 'pt-name' }, t.name));
    return card;
  }

  function renderTheme() {
    const st = appearance.state;
    const themes = h('div', { class: 'prefs-themes' }, Object.entries(THEMES).map(([id, t]) => themeCard(id, t)));
    if (st.theme === 'custom') themes.prepend(themeCard('custom', { ...st.base, name: 'Custom' }));

    const accents = h('div', { class: 'prefs-swatches accents' }, ACCENTS.map((a) => h('button', {
      class: `prefs-swatch round${st.base.accent.toLowerCase() === a.accent ? ' on' : ''}`,
      style: { background: a.accent }, 'data-hint': a.name, title: a.name,
      onClick: () => appearance.setBase({ accent: a.accent, green: a.green }),
    })));

    const rows = COLOR_FIELDS.map(([key, label, sub]) => colorRow(label, sub, st.base[key], (v) => appearance.setBase({ [key]: v })));

    body.replaceChildren(
      section('Theme', themes),
      section('Accent palette', accents),
      section('Colours', h('div', { class: 'prefs-colors' }, rows)),
      h('div', { class: 'prefs-foot' },
        h('button', { class: 'btn', 'data-hint': 'Slate theme, no wallpaper', onClick: () => appearance.reset() }, 'Reset appearance')));
  }

  /** Swatch that opens the system colour picker + editable hex value. Live while dragging. */
  function colorRow(label, sub, value, onChange) {
    const picker = h('input', { type: 'color', value, class: 'prefs-color-input' });
    const hexIn = h('input', { type: 'text', value, class: 'prefs-hex', spellcheck: false, maxLength: 7 });
    let raf = 0, pending = null;
    picker.addEventListener('input', () => {
      pending = picker.value; hexIn.value = pending;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; onChange(pending); });
    });
    const commitHex = () => {
      let v = hexIn.value.trim();
      if (!v.startsWith('#')) v = `#${v}`;
      if (/^#[0-9a-f]{3}$/i.test(v)) v = v.replace(/[0-9a-f]/gi, '$&$&');
      if (/^#[0-9a-f]{6}$/i.test(v)) { picker.value = v.toLowerCase(); onChange(v.toLowerCase()); } else hexIn.value = picker.value;
    };
    // the picker dialog closed: refresh the drawer (e.g. the "Custom" theme card)
    picker.addEventListener('change', () => { picker.blur(); render(); });
    hexIn.addEventListener('change', commitHex);
    hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexIn.blur(); });
    return h('label', { class: 'prefs-color' },
      h('span', { class: 'prefs-color-swatch', style: { background: value } }, picker),
      h('span', { class: 'prefs-color-text' }, h('span', { class: 'prefs-color-label' }, label), sub ? h('span', { class: 'prefs-color-sub' }, sub) : null),
      hexIn);
  }

  // ------------------------------------------------------------ wallpaper tab
  async function setWallpaper(patch) {
    appearance.setWallpaper(patch);
    if (appearance.wallpaper.autoTheme && appearance.wallpaper.kind !== 'none') await matchTheme();
  }

  async function matchTheme() {
    try {
      const base = await themeFromWallpaper(appearance.wallpaper, appearance.customImage);
      appearance.setBase(base);
    } catch (err) {
      messageDialog('Could not read the wallpaper', String(err.message || err));
    }
  }

  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; fileInput.value = ''; if (f) useFile(f); });

  async function useFile(file) {
    if (!file.type.startsWith('image/')) { messageDialog('Not an image', 'Choose a PNG, JPEG, WebP, GIF or SVG file.'); return; }
    // shrink until it fits in storage
    for (const [side, q] of [[2560, 0.88], [1920, 0.82], [1280, 0.78]]) {
      try {
        const data = await importImageFile(file, side, q);
        appearance.setCustomImage(data);
        await setWallpaper({ kind: 'custom', value: null });
        return;
      } catch (err) {
        if (err?.name !== 'QuotaExceededError') { messageDialog('Could not use that image', String(err.message || err)); return; }
      }
    }
    messageDialog('Image too large', 'That image could not be stored, even scaled down. Try a smaller one.');
  }

  function tile(on, attrs, ...children) {
    return h('button', { ...attrs, class: `prefs-tile${on ? ' on' : ''} ${attrs.class || ''}` }, ...children);
  }

  function renderWallpaper() {
    const w = appearance.wallpaper;
    const custom = appearance.customImage;

    const images = h('div', { class: 'prefs-tiles' },
      tile(w.kind === 'custom', { class: 'custom', 'data-hint': custom ? 'Your image — click to use it, or drop another here' : 'Choose an image from your computer, or drop one here', onClick: () => (custom && w.kind !== 'custom' ? setWallpaper({ kind: 'custom' }) : fileInput.click()) },
        h('span', { class: 'prefs-tile-img', style: custom ? { backgroundImage: `url("${custom}")` } : {} }, custom ? null : icon('plus')),
        h('span', { class: 'prefs-tile-name' }, custom ? 'Your image' : 'Choose…')),
      IMAGES.map((img) => tile(w.kind === 'preset' && w.value === img.url, { 'data-hint': img.name, onClick: () => setWallpaper({ kind: 'preset', value: img.url }) },
        h('span', { class: 'prefs-tile-img', style: { backgroundImage: `url("${img.url}")` } }), h('span', { class: 'prefs-tile-name' }, img.name))));

    const gradients = h('div', { class: 'prefs-tiles small' }, GRADIENTS.map((g) => {
      const css = gradientCss(g);
      return tile(w.kind === 'gradient' && w.value === css, { 'data-hint': g.name, onClick: () => setWallpaper({ kind: 'gradient', value: css }) },
        h('span', { class: 'prefs-tile-img', style: { background: css } }), h('span', { class: 'prefs-tile-name' }, g.name));
    }));

    const solidOn = (c) => w.kind === 'solid' && w.value === c;
    const customSolid = h('input', { type: 'color', value: w.kind === 'solid' ? w.value : '#30363d', class: 'prefs-color-input' });
    customSolid.addEventListener('change', () => setWallpaper({ kind: 'solid', value: customSolid.value }));
    const solids = h('div', { class: 'prefs-swatches solids' },
      SOLIDS.map((c) => h('button', { class: `prefs-swatch${solidOn(c) ? ' on' : ''}`, style: { background: c }, title: c, onClick: () => setWallpaper({ kind: 'solid', value: c }) })),
      h('span', { class: `prefs-swatch picker${w.kind === 'solid' && !SOLIDS.includes(w.value) ? ' on' : ''}`, 'data-hint': 'Any colour', style: w.kind === 'solid' && !SOLIDS.includes(w.value) ? { background: w.value } : {} }, icon('plus'), customSolid));

    const imageLike = w.kind === 'preset' || w.kind === 'custom' || w.kind === 'gradient';
    const fits = h('div', { class: 'prefs-seg' }, [['cover', 'Fill'], ['contain', 'Fit'], ['tile', 'Tile'], ['center', 'Centre']].map(([id, label]) =>
      h('button', { class: w.fit === id ? 'on' : '', disabled: !(w.kind === 'preset' || w.kind === 'custom'), onClick: () => setWallpaper({ fit: id }) }, label)));

    const slider = (label, key, min, max, step, fmt) => {
      const out = h('span', { class: 'prefs-slider-val' }, fmt(w[key]));
      const input = h('input', { type: 'range', min, max, step, value: w[key], disabled: !imageLike });
      input.addEventListener('input', () => { out.textContent = fmt(+input.value); appearance.setWallpaper({ [key]: +input.value }); });
      return h('label', { class: 'prefs-slider' }, h('span', { class: 'prefs-color-label' }, label), input, out);
    };

    const auto = h('input', { type: 'checkbox', checked: !!w.autoTheme });
    auto.addEventListener('change', async () => { appearance.setWallpaper({ autoTheme: auto.checked }); if (auto.checked && w.kind !== 'none') await matchTheme(); });

    body.replaceChildren(
      section('Match colours',
        h('div', { class: 'prefs-match' },
          h('button', { class: 'btn primary', disabled: w.kind === 'none', onClick: () => matchTheme(), 'data-hint': 'Build a theme from the wallpaper\'s colours' }, 'Theme from wallpaper'),
          h('label', { class: 'prefs-check' }, auto, 'Always match when I change wallpaper'))),
      sectionWith('Images', h('button', { class: 'prefs-link', disabled: w.kind === 'none', 'data-hint': 'Show the plain theme background', onClick: () => setWallpaper({ kind: 'none' }) }, 'Remove wallpaper'), images, fileInput),
      section('Gradients', gradients),
      section('Solid colours', solids),
      section('Display',
        h('div', { class: 'prefs-row' }, h('span', { class: 'prefs-color-label' }, 'Size'), fits),
        slider('Dim', 'dim', 0, 0.85, 0.01, (v) => `${Math.round(v * 100)}%`),
        slider('Blur', 'blur', 0, 24, 1, (v) => `${v} px`)));
  }

  // drop an image anywhere on the drawer
  el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', (e) => { if (e.target === el || !el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop');
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { tab = 'wallpaper'; useFile(f); }
  });

  function render() {
    tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const top = body.scrollTop;
    if (tab === 'theme') renderTheme(); else renderWallpaper();
    body.scrollTop = top;
  }

  // re-render on change, but never while the user is dragging a colour picker or slider in the drawer
  appearance.on('change', () => {
    if (el.classList.contains('hidden')) return;
    const a = document.activeElement;
    if (a && el.contains(a) && a.tagName === 'INPUT' && (a.type === 'color' || a.type === 'range')) return;
    render();
  });

  function open() { render(); el.classList.remove('hidden'); el.focus({ preventScroll: true }); }
  function close() { el.classList.add('hidden'); }
  const isOpen = () => !el.classList.contains('hidden');
  return { open, close, toggle: () => (isOpen() ? close() : open()), isOpen };
}
