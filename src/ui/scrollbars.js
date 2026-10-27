import { h, clamp } from '../util.js';

const MIN_THUMB = 28;

/**
 * Slim scrollbars that float over `scroller` instead of taking layout space, so panes that sit
 * beside it (piano keys, track headers, the master strip…) line up with its edges at any size.
 * The scroller keeps native scrolling (wheel, Shift+wheel, touchpads); the bars add mouse dragging,
 * click-to-page and wheel-over-the-bar. `host` must be a positioned ancestor covering the scroller.
 */
export function overlayScrollbars(scroller, { host = scroller.parentElement, x = true, y = true } = {}) {
  scroller.classList.add('osb-scroller');
  const bars = [];

  const makeBar = (axis) => {
    const thumb = h('div', { class: 'osb-thumb' });
    const bar = h('div', { class: `osb osb-${axis}` }, thumb);
    const horiz = axis === 'x';
    const metrics = () => {
      const view = horiz ? scroller.clientWidth : scroller.clientHeight;
      const full = horiz ? scroller.scrollWidth : scroller.scrollHeight;
      const track = horiz ? bar.clientWidth : bar.clientHeight;
      const len = Math.max(MIN_THUMB, Math.round((track * view) / Math.max(full, 1)));
      return { view, full, track, len, range: full - view };
    };
    const getPos = () => (horiz ? scroller.scrollLeft : scroller.scrollTop);
    const setPos = (v) => { if (horiz) scroller.scrollLeft = v; else scroller.scrollTop = v; };

    const update = () => {
      const m = metrics();
      const show = m.range > 1;
      bar.classList.toggle('hidden', !show);
      if (!show) return false;
      const off = m.range > 0 ? ((m.track - m.len) * getPos()) / m.range : 0;
      thumb.style[horiz ? 'width' : 'height'] = `${m.len}px`;
      thumb.style.transform = horiz ? `translateX(${off}px)` : `translateY(${off}px)`;
      return true;
    };

    thumb.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      thumb.setPointerCapture(e.pointerId);
      bar.classList.add('dragging');
      const start = horiz ? e.clientX : e.clientY;
      const startPos = getPos();
      const m = metrics();
      const ratio = m.range / Math.max(1, m.track - m.len);
      const move = (ev) => setPos(startPos + ((horiz ? ev.clientX : ev.clientY) - start) * ratio);
      const up = () => {
        bar.classList.remove('dragging');
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
    });
    // click the track: page towards the pointer
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target !== bar) return;
      e.preventDefault();
      e.stopPropagation();
      const r = thumb.getBoundingClientRect();
      const before = horiz ? e.clientX < r.left : e.clientY < r.top;
      const m = metrics();
      scroller.scrollBy({ [horiz ? 'left' : 'top']: (before ? -1 : 1) * m.view * 0.9, behavior: 'smooth' });
    });
    // any wheel over the bar scrolls along it (vertical wheels included — no touchpad needed)
    bar.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setPos(clamp(getPos() + d, 0, metrics().range));
    }, { passive: false });

    host.append(bar);
    return { axis, bar, update };
  };

  if (x) bars.push(makeBar('x'));
  if (y) bars.push(makeBar('y'));

  let raf = 0;
  const update = () => {
    raf = 0;
    const shown = Object.fromEntries(bars.map((b) => [b.axis, b.update()]));
    // keep the two bars out of each other's corner
    host.classList.toggle('osb-both', !!(shown.x && shown.y));
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };

  scroller.addEventListener('scroll', schedule, { passive: true });
  const ro = new ResizeObserver(schedule);
  ro.observe(scroller);
  const observeChildren = () => { for (const c of scroller.children) ro.observe(c); };
  observeChildren();
  new MutationObserver(observeChildren).observe(scroller, { childList: true });
  schedule();
  return { update: schedule };
}

/** Plain vertical wheel scrolls `el` sideways, unless a control under the pointer already handled it. */
export function wheelScrollsHorizontally(el) {
  el.addEventListener('wheel', (e) => {
    if (e.defaultPrevented || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, { passive: false });
}

/** A one-row toolbar that scrolls sideways when its window is too narrow, fading the clipped edge(s). */
export function scrollingToolbar(el) {
  wheelScrollsHorizontally(el);
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('fade-l', max > 1 && el.scrollLeft > 1);
    el.classList.toggle('fade-r', max > 1 && el.scrollLeft < max - 1);
  };
  el.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(el);
  update();
}
