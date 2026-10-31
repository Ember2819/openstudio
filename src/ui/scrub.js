import { h, clamp } from '../util.js';

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/**
 * Song position slider for the toolbar: shows how far playback is through the song (or the pattern in pattern
 * mode), the loop region, and bar lines, and lets you click or drag to jump anywhere. Arrow keys nudge by a
 * beat (a bar with Shift), Home / End jump to the ends.
 */
export function createScrub(app) {
  const { transport, store } = app;

  const elapsed = h('span', { class: 'scrub-time' }, '0:00');
  const total = h('span', { class: 'scrub-time dim' }, '0:00');
  const loopBand = h('div', { class: 'scrub-loop' });
  const fill = h('div', { class: 'scrub-fill' });
  const thumb = h('div', { class: 'scrub-thumb' });
  const track = h('div', { class: 'scrub-track' }, loopBand, fill, thumb);
  const root = h('div', {
    class: 'scrub', role: 'slider', tabindex: 0, 'aria-label': 'Song position', 'aria-valuemin': 0,
    'data-hint': 'Song position — click or drag to jump, arrow keys nudge a beat (Shift: a bar), Home restarts',
  }, elapsed, track, total);

  let drag = null; // { frac, last }
  let shown = { frac: -1, len: -1, sec: -1, bars: -1, loop: '', state: '' };

  const fracAt = (e) => {
    const r = track.getBoundingClientRect();
    return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
  };
  const jump = (frac) => {
    const len = transport.lengthSteps;
    if (len > 0) transport.seek(Math.min(len - 1, Math.round(frac * len)));
  };

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || transport.lengthSteps <= 0) return;
    root.setPointerCapture(e.pointerId);
    root.focus({ preventScroll: true });
    drag = { frac: fracAt(e), last: 0 };
    root.classList.add('dragging');
    jump(drag.frac);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.frac = fracAt(e);
    // seeking while playing restarts the voices, so don't do it on every pixel
    const now = performance.now();
    if (!transport.playing || now - drag.last > 70) { drag.last = now; jump(drag.frac); }
  });
  const end = (e) => {
    if (!drag) return;
    jump(fracAt(e));
    drag = null;
    root.classList.remove('dragging');
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', () => { drag = null; root.classList.remove('dragging'); });

  root.addEventListener('keydown', (e) => {
    const len = transport.lengthSteps;
    if (len <= 0) return;
    const pos = transport.position();
    const move = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    let to;
    if (move) to = pos + move * (e.shiftKey ? store.barSteps : store.beatSteps);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = len - 1;
    else return;
    e.preventDefault();
    e.stopPropagation(); // Home would otherwise reach the global shortcut too
    transport.seek(clamp(Math.round(to), 0, len - 1));
  });

  /** Called every animation frame. Only touches the DOM for what actually changed. */
  function update() {
    const len = transport.lengthSteps;
    const raw = transport.position();
    const pos = transport.mode === 'pattern' && transport.playing && len > 0 ? raw % len : raw; // the pattern loops; one length lookup per frame
    const frac = drag ? drag.frac : len > 0 ? clamp(pos / len, 0, 1) : 0;
    const sec = transport.secondsAt(frac * len);

    if (frac !== shown.frac) {
      shown.frac = frac;
      const pct = `${(frac * 100).toFixed(2)}%`;
      fill.style.width = pct;
      thumb.style.left = pct;
    }
    const secShown = Math.floor(sec);
    if (secShown !== shown.sec || len !== shown.len) {
      shown.sec = secShown;
      elapsed.textContent = clock(sec);
      root.setAttribute('aria-valuenow', Math.round(pos));
      root.setAttribute('aria-valuemax', len);
      root.setAttribute('aria-valuetext', `${clock(sec)} of ${clock(transport.secondsAt(len))}`);
    }
    const bars = len / store.barSteps;
    if (len !== shown.len || bars !== shown.bars) {
      shown.len = len;
      shown.bars = bars;
      total.textContent = clock(transport.secondsAt(len));
      // bar lines are a repeating gradient; with hundreds of bars they'd be noise
      const lines = bars > 0 && bars <= 96;
      track.style.setProperty('--bars', lines ? bars : 1);
      track.classList.toggle('no-bars', !lines);
      root.classList.toggle('empty', len <= 0);
    }
    const loop = store.project.loop;
    const loopKey = transport.mode === 'song' && loop && len > 0 ? `${loop.start}:${loop.end}:${transport.loopEnabled}:${len}` : '';
    if (loopKey !== shown.loop) {
      shown.loop = loopKey;
      loopBand.hidden = !loopKey;
      if (loopKey) {
        loopBand.style.left = `${(loop.start / Math.max(len, loop.end)) * 100}%`;
        loopBand.style.width = `${((loop.end - loop.start) / Math.max(len, loop.end)) * 100}%`;
        loopBand.classList.toggle('on', transport.loopEnabled);
      }
    }
    if (transport.state !== shown.state) {
      shown.state = transport.state;
      root.dataset.state = transport.state;
    }
  }

  return { el: root, update };
}
