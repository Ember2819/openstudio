// A small non-blocking notice at the bottom of the window, optionally with one action button.
import { h } from '../util.js';

let current = null;

/** Show `text`; returns { close }. opts: { action: label, onAction, timeout ms (0 = until closed) }. */
export function showToast(text, { action, onAction, timeout = 4000 } = {}) {
  current?.close();
  const btn = action ? h('button', { class: 'btn toast-btn' }, action) : null;
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, text), btn);
  document.getElementById('overlay-root').append(el);
  let timer = null;
  const handle = {
    close() { clearTimeout(timer); el.remove(); if (current === handle) current = null; },
    setText(t) { el.firstChild.textContent = t; },
  };
  btn?.addEventListener('click', () => { onAction?.(); handle.close(); });
  if (timeout) timer = setTimeout(() => handle.close(), timeout);
  current = handle;
  return handle;
}
