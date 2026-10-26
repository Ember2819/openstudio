import { h } from '../util.js';

let openMenus = [];
let outsideHandler = null;
let onCloseCb = null;

export function closeMenus() {
  for (const m of openMenus) m.remove();
  openMenus = [];
  if (outsideHandler) {
    window.removeEventListener('pointerdown', outsideHandler, true);
    window.removeEventListener('keydown', escHandler, true);
    outsideHandler = null;
  }
  const cb = onCloseCb;
  onCloseCb = null;
  cb?.();
}

const escHandler = (e) => { if (e.key === 'Escape') closeMenus(); };

export const isMenuOpen = () => openMenus.length > 0;

function place(el, x, y, alignRightOf = null) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x;
  let top = y;
  if (left + r.width > vw - 4) left = alignRightOf != null ? alignRightOf - r.width : vw - r.width - 4;
  if (top + r.height > vh - 4) top = Math.max(4, vh - r.height - 4);
  el.style.left = `${Math.max(4, left)}px`;
  el.style.top = `${top}px`;
}

function build(items, depth) {
  const menu = h('div', { class: 'menu' });
  menu.addEventListener('contextmenu', (e) => e.preventDefault());
  let submenuEl = null;

  const closeSub = () => {
    if (!submenuEl) return;
    const idx = openMenus.indexOf(submenuEl);
    for (const m of openMenus.splice(idx)) m.remove();
    submenuEl = null;
    menu.querySelectorAll('.menu-item.open').forEach((n) => n.classList.remove('open'));
  };

  for (const it of items) {
    if (it.separator) { menu.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.title) { menu.append(h('div', { class: 'menu-title' }, it.title)); continue; }
    const row = h('div', { class: `menu-item${it.disabled ? ' disabled' : ''}` },
      h('span', { class: 'm-check' }, it.checked ? '✓' : ''),
      it.swatch ? h('span', { class: 'm-swatch', style: { background: it.swatch } }) : null,
      h('span', { class: 'm-label' }, it.label),
      it.shortcut ? h('span', { class: 'm-short' }, it.shortcut) : null,
      it.submenu ? h('span', { class: 'm-arrow' }, '▸') : null);
    row.addEventListener('pointerenter', () => {
      if (it.disabled) return;
      closeSub();
      if (it.submenu) {
        row.classList.add('open');
        const subItems = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
        submenuEl = build(subItems, depth + 1);
        document.getElementById('overlay-root').append(submenuEl);
        openMenus.push(submenuEl);
        const r = row.getBoundingClientRect();
        place(submenuEl, r.right - 2, r.top - 3, r.left + 2);
      }
    });
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.disabled || it.submenu) return;
      closeMenus();
      it.action?.();
    });
    menu.append(row);
  }
  return menu;
}

/** items: [{label, shortcut, action, disabled, checked, separator, title, submenu, swatch}] */
export function showMenu(items, x, y, { onClose } = {}) {
  closeMenus();
  onCloseCb = onClose || null;
  const menu = build(items, 0);
  document.getElementById('overlay-root').append(menu);
  openMenus.push(menu);
  place(menu, x, y);
  outsideHandler = (e) => {
    if (!openMenus.some((m) => m.contains(e.target))) closeMenus();
  };
  window.addEventListener('pointerdown', outsideHandler, true);
  window.addEventListener('keydown', escHandler, true);
  return menu;
}

export function showMenuBelow(el, items, opts) {
  const r = el.getBoundingClientRect();
  return showMenu(items, r.left, r.bottom + 1, opts);
}
