// Settings drawer (gear button, Ctrl+,): themes, accent palettes, custom colours and wallpaper.
// Everything applies live and is remembered between sessions (src/theme.js).
import { h } from '../util.js';
import { icon } from './icons.js';
import { appearance, THEMES, ACCENTS } from '../theme.js';
import { SOLIDS, GRADIENTS, IMAGES, gradientCss, importImageFile, themeFromWallpaper } from '../wallpapers.js';
import { messageDialog } from './dialog.js';
import { claudePrompt, opencodePrompt, codexPrompt, antigravityPrompt, piPrompt } from './agentprompts.js';
import { PROFILES, ACTIONS, MODIFIERS, comboOf, resolveCombo } from './tiling.js';
import { keymap, COMMANDS, comboLabel } from '../keymap.js';

const COLOR_FIELDS = [
  ['bg', 'Background', 'Behind the windows'],
  ['surface', 'Panels', 'Windows, toolbar and browser'],
  ['text', 'Text', ''],
  ['accent', 'Accent', 'Selection and active controls'],
  ['green', 'Highlight', 'Play, LEDs and the playhead'],
  ['grid', 'Editor grid', 'Piano roll, playlist and automation'],
  ['red', 'Record', 'Record and close buttons'],
];

export function createPreferences(app) {
  let tab = 'theme';
  const body = h('div', { class: 'prefs-body' });
  const TAB_NAMES = { theme: 'Theme', wallpaper: 'Wallpaper', keys: 'Keys', windows: 'Windows', agents: 'Agents' };
  const tabs = Object.keys(TAB_NAMES).map((id) => {
    const b = h('button', { class: 'prefs-tab', onClick: () => { tab = id; render(); body.scrollTop = 0; } }, TAB_NAMES[id]);
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

  // ------------------------------------------------------------ windows tab
  const seg = (options, value, onPick) => h('div', { class: 'prefs-seg' }, options.map(([id, label, hint]) =>
    h('button', { class: value === id ? 'on' : '', 'data-hint': hint || null, onClick: () => onPick(id) }, label)));
  const check = (label, value, onChange) => {
    const input = h('input', { type: 'checkbox', checked: value });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'prefs-check' }, input, label);
  };
  /** "Mod+Shift+[" → key caps in the current modifier. */
  const bindCaps = (bind, mod) => resolveCombo(bind, mod).split(/\+(?=.)/).map((k) => h('kbd', {}, k === 'Super' ? 'Super' : k));

  let capture = null; // action id waiting for a key press
  function startCapture(id) {
    capture = id;
    app.tiler.capturing = true;
    render();
  }
  // ------------------------------------------------------------ keys tab (app-wide shortcuts)
  let keyCapture = null; // command id waiting for a key press
  const PIANO_KEYS = new Set('ZSXDCVGBHNJMQ2W3ER5T6Y7UI9O0P,L.;/'.split(''));
  const setKeyCapture = (id) => { keyCapture = id; keymap.capturing = !!id; app.tiler.capturing = !!id; render(); };
  window.addEventListener('keydown', (e) => {
    if (!keyCapture) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setKeyCapture(null); return; }
    const combo = comboOf(e);
    if (!combo) return; // waiting for a non-modifier key
    const list = keymap.binds(keyCapture);
    if (!list.includes(combo)) keymap.set(keyCapture, [...list, combo]);
    setKeyCapture(null);
  }, true);

  function renderKeys() {
    const conflicts = keymap.conflicts();
    const tiling = app.tiler.active ? app.tiler.bindingMap() : new Map();
    const warnOf = (id, c) => conflicts.get(`${id}|${c}`)
      ?? (tiling.has(c) ? 'Tiling mode takes this key' : null)
      ?? (PIANO_KEYS.has(c) ? 'No longer plays a note on the computer keyboard' : null);
    const groups = [...new Set(COMMANDS.map((c) => c[2]))];
    body.replaceChildren(
      h('p', { class: 'prefs-note' }, 'App-wide shortcuts. Click a key to remove it, + to add one (then press the keys; Esc cancels). Keys inside the editors (piano roll, playlist …) are listed under Help → Keyboard shortcuts.'),
      ...groups.map((g) => section(g, h('div', { class: 'prefs-binds' }, COMMANDS.filter((c) => c[2] === g).map(([id, label]) => {
        const list = keymap.binds(id);
        const warn = list.map((c) => warnOf(id, c)).filter(Boolean);
        return h('div', { class: 'prefs-bind' },
          h('span', { class: 'prefs-bind-label' },
            h('span', { class: 'prefs-bind-title' }, label, !keymap.isDefault(id) ? h('button', { class: 'prefs-link', 'data-hint': 'Back to the default keys', onClick: () => keymap.reset(id) }, 'reset') : null),
            warn.length ? h('span', { class: 'prefs-bind-warn' }, warn.join(' · ')) : null),
          h('span', { class: 'prefs-bind-keys' },
            list.map((c) => h('button', { class: `prefs-chip${warnOf(id, c) && conflicts.has(`${id}|${c}`) ? ' warn' : ''}`, 'aria-label': `Remove ${comboLabel(c)}`, 'data-hint': 'Click to remove this key', onClick: () => keymap.set(id, list.filter((x) => x !== c)) },
              comboLabel(c).split(/\+(?=.)/).map((k) => h('kbd', {}, k)))),
            keyCapture === id
              ? h('span', { class: 'prefs-chip listening' }, 'Press keys… (Esc cancels)')
              : h('button', { class: 'prefs-chip add', 'aria-label': `Add a key for ${label}`, 'data-hint': 'Add a key', onClick: () => setKeyCapture(id) }, icon('plus'))));
      })))),
      h('div', { class: 'prefs-match' }, h('button', { class: 'btn', onClick: () => keymap.reset() }, 'Reset all to defaults')));
  }
  keymap.on('change', () => { if (tab === 'keys' && !el.classList.contains('hidden')) render(); });

  window.addEventListener('keydown', (e) => {
    if (!capture) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { capture = null; app.tiler.capturing = false; render(); return; }
    const combo = comboOf(e);
    if (!combo) return; // waiting for a non-modifier key
    // store it relative to the modifier when it uses it, so changing the modifier carries it along
    const mod = app.tiler.cfg.mod.split('+');
    const parts = combo.split('+');
    const key = parts.pop();
    const usesMod = mod.every((m) => parts.includes(m));
    const rest = usesMod ? parts.filter((p) => !mod.includes(p)) : parts;
    const bind = [usesMod ? 'Mod' : null, ...rest, key].filter(Boolean).join('+');
    const list = app.tiler.cfg.binds[capture] || [];
    if (!list.includes(bind)) app.tiler.setBinds(capture, [...list, bind]);
    capture = null;
    app.tiler.capturing = false;
    render();
  }, true);

  function renderWindows() {
    const t = app.tiler;
    const cfg = t.cfg;
    const conflicts = t.conflicts();

    const shapes = h('div', { class: 'prefs-colors' }, Object.entries(PROFILES).map(([id, p]) => h('div', { class: 'prefs-row' },
      h('span', { class: 'prefs-color-text' }, h('span', { class: 'prefs-color-label' }, p.name), h('span', { class: 'prefs-color-sub' }, `Best ${p.orient}${p.fill ? ', takes spare room' : ''}`)),
      seg([['auto', 'Auto', `Use the built-in shape (${p.orient})`], ['wide', 'Wide'], ['tall', 'Tall'], ['square', 'Square']], cfg.orient[id] || 'auto',
        (o) => t.setConfig({ orient: { ...cfg.orient, [id]: o } })))));

    const binds = h('div', { class: 'prefs-binds' }, ACTIONS.map(([id, label]) => {
      const list = cfg.binds[id] || [];
      const warn = list.map((b) => conflicts.get(`${id}|${b}`)).filter(Boolean);
      return h('div', { class: 'prefs-bind' },
        h('span', { class: 'prefs-bind-label' }, label, warn.length ? h('span', { class: 'prefs-bind-warn' }, warn.join(' · ')) : null),
        h('span', { class: 'prefs-bind-keys' },
          list.map((b) => h('button', { class: `prefs-chip${conflicts.has(`${id}|${b}`) ? ' warn' : ''}`, 'data-hint': 'Click to remove this binding', onClick: () => t.setBinds(id, list.filter((x) => x !== b)) }, bindCaps(b, cfg.mod))),
          capture === id
            ? h('span', { class: 'prefs-chip listening' }, 'Press keys… (Esc cancels)')
            : h('button', { class: 'prefs-chip add', 'data-hint': 'Add a key binding', onClick: () => startCapture(id) }, icon('plus'))));
    }));

    body.replaceChildren(
      section('Layout',
        h('div', { class: 'prefs-row' }, h('span', { class: 'prefs-color-label' }, 'Mode'),
          seg([['floating', 'Floating', 'Drag windows anywhere'], ['tiling', 'Tiling', 'Windows tile and scroll in columns, driven by the keyboard']], cfg.mode,
            (m) => (m === 'tiling' ? t.enter() : t.exit()))),
        h('p', { class: 'prefs-note' }, `Tiling works like niri: columns on a strip that scrolls sideways. The window you're working in grows to the size it needs and the others make room. ${resolveCombo('Mod+T', cfg.mod)} switches modes from anywhere.`),
        h('div', { class: 'prefs-match' }, h('button', { class: 'btn', disabled: !t.active, onClick: () => t.arrange() }, 'Re-arrange now'))),
      section('Behaviour',
        check('Grow the window I\'m working in', cfg.grow, (v) => t.setConfig({ grow: v })),
        check('Animate', cfg.animate, (v) => t.setConfig({ animate: v })),
        h('div', { class: 'prefs-row' }, h('span', { class: 'prefs-color-label' }, 'Centre focus'),
          seg([['never', 'Never', 'Scroll just enough to show it'], ['overflow', 'Off-screen', 'Centre a column that was off-screen'], ['always', 'Always']], cfg.center, (v) => t.setConfig({ center: v }))),
        (() => {
          const out = h('span', { class: 'prefs-slider-val' }, `${cfg.gaps} px`);
          const input = h('input', { type: 'range', min: 0, max: 24, step: 1, value: cfg.gaps });
          input.addEventListener('input', () => { out.textContent = `${input.value} px`; t.setConfig({ gaps: +input.value }); });
          return h('label', { class: 'prefs-slider' }, h('span', { class: 'prefs-color-label' }, 'Gaps'), input, out);
        })()),
      section('Window shapes', shapes),
      section('Modifier key',
        seg(Object.keys(MODIFIERS).map((m) => [m, m]), cfg.mod, (m) => t.setConfig({ mod: m })),
        h('p', { class: 'prefs-note' }, 'Super is usually taken by the desktop (Hyprland, niri, GNOME…), so OpenStudio may never see it. Alt is the safest choice.')),
      sectionWith('Key bindings', h('button', { class: 'prefs-link', onClick: () => t.resetBinds() }, 'Reset to defaults'), binds));
  }

  // ------------------------------------------------------------ agents tab
  function renderAgents() {
    const url = app.agent?.url;
    const copy = (btn, label, text) => {
      (window.studioAPI?.copyText ? window.studioAPI.copyText(text) : navigator.clipboard.writeText(text)).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = label; }, 1600);
      }, () => messageDialog('Copy failed', 'Could not reach the clipboard. Select the prompt text manually instead:\n\n' + text));
    };
    const quick = (label, desc, makePrompt) => {
      const btn = h('button', { class: 'btn primary prefs-copy', disabled: !url, 'data-hint': 'Copies a prompt — paste it into the agent and it sets itself up' }, label);
      btn.addEventListener('click', () => copy(btn, label, makePrompt(url)));
      return h('div', { class: 'prefs-agent' }, btn, h('p', { class: 'prefs-note' }, desc));
    };
    body.replaceChildren(
      section('Connect an AI agent',
        h('p', { class: 'prefs-note' }, url
          ? 'OpenStudio runs an MCP server so AI agents can write notes, build the arrangement, mix and render. Copy a quickstart, paste it into your agent, and it will connect itself — every edit it makes is on your undo stack.'
          : 'The MCP server is off. Start OpenStudio without --no-mcp (and without OPENSTUDIO_MCP=0), and make sure its port is free, to let AI agents work on your projects.'),
        quick('Copy quickstart for Claude Code', 'Tells Claude Code to run claude mcp add for you.', claudePrompt),
        quick('Copy quickstart for OpenCode', 'Tells OpenCode to add the server to its opencode.json config.', opencodePrompt),
        quick('Copy quickstart for Codex', 'Tells Codex to run codex mcp add for you.', codexPrompt),
        quick('Copy quickstart for Antigravity', 'Tells Antigravity\'s agent to add the server to its mcp_config.json.', antigravityPrompt),
        quick('Copy quickstart for Pi', 'Tells Pi to run pi mcp add for you.', piPrompt)),
      section('Endpoint',
        h('p', { class: 'prefs-note' }, url ? `${url}  (this computer only)` : 'Not running'),
        h('p', { class: 'prefs-note' }, 'Other clients: add it as a Streamable HTTP MCP server with this URL, or use node scripts/mcp-stdio.mjs for stdio-only clients. Details: docs/AGENTS.md')));
  }

  function render() {
    tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const top = body.scrollTop;
    if (tab === 'theme') renderTheme(); else if (tab === 'wallpaper') renderWallpaper(); else if (tab === 'agents') renderAgents(); else if (tab === 'keys') renderKeys(); else renderWindows();
    body.scrollTop = top;
  }

  // re-render on change, but never while the user is dragging a colour picker or slider in the drawer
  appearance.on('change', () => {
    if (el.classList.contains('hidden')) return;
    const a = document.activeElement;
    if (a && el.contains(a) && a.tagName === 'INPUT' && (a.type === 'color' || a.type === 'range')) return;
    render();
  });

  const refreshWindows = () => { if (tab === 'windows' && !el.classList.contains('hidden')) render(); };
  app.tiler.on('config', refreshWindows);
  app.tiler.on('mode', refreshWindows);
  function open(which) { if (TAB_NAMES[which]) tab = which; render(); el.classList.remove('hidden'); el.focus({ preventScroll: true }); }
  function close() { el.classList.add('hidden'); }
  const isOpen = () => !el.classList.contains('hidden');
  return { open, close, toggle: () => (isOpen() ? close() : open()), isOpen };
}
