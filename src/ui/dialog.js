import { h } from '../util.js';

function modal(title, body, buttons) {
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
    const box = h('div', { class: 'modal' },
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
