// Tempo map: the tempo at any step of the song, and where each step falls in time.
//
// The project tempo (`project.bpm`) holds everywhere unless the playlist has tempo automation clips
// (automation target { kind: 'tempo' }). Inside such a clip the tempo follows its curve; after a clip ends the tempo
// stays at the clip's last value until the next one starts, like a knob left where the automation put it. Pattern mode
// always plays at the project tempo. The tempo is constant within a step (a 16th note), which is fine-grained enough
// for ramps and keeps scheduling simple.
import { STEPS_PER_BEAT } from './state.js';
import { curveAt, normToValue } from './automation.js';

/** Tempo automation clips that are playing (not muted, on an unmuted track), sorted by start. */
export function tempoClips(store) {
  const proj = store.project;
  const out = [];
  for (const c of proj.playlist.clips) {
    if (c.type !== 'auto' || c.mute || proj.playlist.tracks[c.track]?.mute) continue;
    const auto = store.automation(c.autoId);
    if (auto?.target?.kind === 'tempo') out.push({ clip: c, auto });
  }
  return out.sort((a, b) => a.clip.start - b.clip.start);
}

/** Tempo (BPM) at a step, given the sorted tempo clips. */
export function bpmAt(store, step, clips) {
  const proj = store.project;
  if (proj.mode !== 'song' || !clips.length) return proj.bpm;
  let hit = null;
  for (const c of clips) {
    if (c.clip.start > step + 1e-9) break;
    hit = c;
  }
  if (!hit) return proj.bpm;
  const { clip, auto } = hit;
  const local = Math.min(step, clip.start + clip.len) - clip.start + (clip.offset || 0);
  return normToValue(store, auto.target, curveAt(auto.points, local));
}

/**
 * Cached tempo map for a store. Rebuilt lazily whenever the project changed (the store's revision counter), the
 * tempo was changed, or the transport mode flipped.
 */
export class TempoMap {
  constructor(store) {
    this.store = store;
    this.key = '';
    this.clips = [];
    this.cum = [0]; // cum[i] = seconds at the start of step i (only built when the tempo varies)
  }

  _refresh() {
    const p = this.store.project;
    const key = `${this.store.rev}|${p.bpm}|${p.mode}`;
    if (key === this.key) return;
    this.key = key;
    this.clips = tempoClips(this.store);
    this.cum = [0];
  }

  /** Does the tempo change anywhere? */
  get varies() { this._refresh(); return this.store.project.mode === 'song' && this.clips.length > 0; }

  bpm(step) { this._refresh(); return bpmAt(this.store, Math.floor(step + 1e-9), this.clips); }

  /** Length of one step (seconds) at `step`. */
  stepDur(step) { return 60 / this.bpm(step) / STEPS_PER_BEAT; }

  /** Seconds from the song start to `step` (fractional steps allowed). */
  timeAt(step) {
    this._refresh();
    if (!this.varies) return (step * 60) / this.store.project.bpm / STEPS_PER_BEAT;
    if (step <= 0) return step * this.stepDur(0);
    const whole = Math.floor(step);
    const cum = this.cum;
    for (let i = cum.length - 1; i < whole; i++) cum.push(cum[i] + this.stepDur(i));
    return cum[whole] + (step - whole) * this.stepDur(whole);
  }

  /** The (fractional) step that sounds `seconds` after the song start. */
  stepAt(seconds) {
    this._refresh();
    if (!this.varies) return (seconds * this.store.project.bpm * STEPS_PER_BEAT) / 60;
    if (seconds <= 0) return 0;
    let hi = 1;
    while (this.timeAt(hi) < seconds) hi *= 2;
    let lo = Math.floor(hi / 2);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= seconds) lo = mid; else hi = mid;
    }
    return lo + (seconds - this.timeAt(lo)) / this.stepDur(lo);
  }
}
