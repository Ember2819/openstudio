import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { SNAPS } from './snap.js';
import { showMenuBelow } from './menu.js';

/** Dropdown bound to the global snap setting (app.ui.snap). Emits app 'snap'. */
export function createSnapSelect(app, extraClass = '') {
  const label = h('span', {}, 'Line');
  const btn = h('button', { class: `dd snap-dd ${extraClass}`, 'data-hint': 'Snap — grid used when placing and moving notes and clips' },
    icon('magnet'), label, h('span', { class: 'caret' }, '▼'));
  const set = (id) => { app.ui.snap = id; app.emit('snap'); };
  btn.addEventListener('click', () => {
    showMenuBelow(btn, SNAPS.map((s) => ({ label: s.label, checked: app.ui.snap === s.id, action: () => set(s.id) })));
  });
  btn.addEventListener('wheel', (e) => {
    e.preventDefault();
    const i = SNAPS.findIndex((s) => s.id === app.ui.snap);
    set(SNAPS[clamp(i + Math.sign(e.deltaY), 0, SNAPS.length - 1)].id);
  }, { passive: false });
  const refresh = () => { label.textContent = SNAPS.find((s) => s.id === app.ui.snap).label; };
  app.on('snap', refresh);
  refresh();
  return btn;
}
