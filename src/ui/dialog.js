import { h } from '../util.js';

function modal(title, body, buttons, cls = '') {
  return new Promise((resolve) => {
    const shade = h('div', { class: 'modal-shade' });
    const close = (val) => { shade.remove(); window.removeEventListener('keydown', onKey, true); resolve(val); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      // Enter confirms (the prompt input handles its own Enter)
      else if (e.key === 'Enter' && e.target.tagName !== 'INPUT') { e.preventDefault(); e.stopPropagation(); box.querySelector('.btn.primary')?.click(); }
      // keep shortcuts (Space = play, typing keyboard…) from reaching the app behind the dialog
      else if (e.target.tagName !== 'INPUT') e.stopPropagation();
    };
    const btnEls = buttons.map((b) =>
      h('button', { class: `btn${b.primary ? ' primary' : ''}`, onClick: () => close(b.value()) }, b.label));
    const box = h('div', { class: `modal${cls ? ` ${cls}` : ''}` },
      h('div', { class: 'modal-title' }, title),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-buttons' }, btnEls));
    shade.append(box);
    shade.addEventListener('pointerdown', (e) => { if (e.target === shade) close(null); });
    document.getElementById('overlay-root').append(shade);
    window.addEventListener('keydown', onKey, true);
    box.querySelector('input')?.focus();
    box.querySelector('input')?.select();
    modal.last = { box, close };
  });
}

export function promptDialog(title, value = '', label = '') {
  const input = h('input', { type: 'text', value });
  const p = modal(title, [label ? h('div', {}, label) : null, input], [
    { label: 'Cancel', value: () => null },
    { label: 'OK', primary: true, value: () => input.value },
  ]);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') modal.last.box.querySelector('.btn.primary').click();
    e.stopPropagation();
  });
  return p;
}

export function confirmDialog(title, message, okLabel = 'OK') {
  return modal(title, [h('div', { style: { maxWidth: '440px', lineHeight: '1.5', whiteSpace: 'pre-wrap' } }, message)], [
    { label: 'Cancel', value: () => false },
    { label: okLabel, primary: true, value: () => true },
  ]).then((v) => v === true);
}

export function messageDialog(title, message) {
  return modal(title, [h('div', { style: { maxWidth: '420px', lineHeight: '1.5', whiteSpace: 'pre-wrap' } }, message)], [
    { label: 'OK', primary: true, value: () => true },
  ]);
}

/** Dialog with arbitrary content and buttons ([{ label, value, primary }]); resolves to the chosen button's value (null on Escape). */
export function customDialog(title, body, buttons, cls = '') {
  return modal(title, body, buttons.map((b) => ({ ...b, value: () => b.value })), cls);
}

/**
 * Modal progress bar. `done` resolves (to null) when the user cancels or presses Escape;
 * `set(fraction, text)` updates the bar (fraction null = indeterminate) and `close()` dismisses it.
 */
export function progressDialog(title, message, cancelLabel = 'Cancel') {
  const text = h('div', { style: { minWidth: '320px' } }, message);
  const fill = h('div', { class: 'progress-fill indeterminate' });
  const done = modal(title, [text, h('div', { class: 'progress' }, fill)], [{ label: cancelLabel, value: () => null }]);
  const { close } = modal.last;
  return {
    done,
    close: () => close(null),
    set(fraction, msg) {
      fill.classList.toggle('indeterminate', fraction == null);
      fill.style.width = fraction == null ? '' : `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
      if (msg != null) text.textContent = msg;
    },
  };
}

/** One key combo ("Ctrl+Shift+S", "+", "Z S X") as key caps. */
function keyCaps(combo) {
  const parts = combo === '+' ? ['+'] : combo.includes(' ') && !combo.includes('+') ? combo.split(' ') : combo.split('+');
  const joiner = combo.includes('+') && combo !== '+' ? '+' : '';
  return h('span', { class: 'kbd-combo' }, parts.map((k, i) => [i && joiner ? h('span', { class: 'kbd-plus' }, joiner) : null, h('kbd', { class: /click|Drag|Wheel/.test(k) ? 'mouse' : null }, k)]));
}

/** groups: [[title, [[keys, description], …]], …]; keys may list alternatives separated by " / ". */
export function shortcutsDialog(title, groups) {
  const sections = groups.map(([name, rows]) => h('section', { class: 'sc-group' },
    h('div', { class: 'sc-title' }, name),
    rows.map(([keys, desc]) => h('div', { class: 'sc-row' },
      h('span', { class: 'sc-desc' }, desc),
      h('span', { class: 'sc-keys' }, keys.split(' / ').map((k, i) => [i ? h('span', { class: 'sc-or' }, '/') : null, keyCaps(k)]))))));
  return modal(title, [h('div', { class: 'sc-grid' }, sections)], [{ label: 'Close', primary: true, value: () => true }], 'modal-wide');
}
