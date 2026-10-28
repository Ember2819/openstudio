// Part generators: given a key, a chord progression and a style they write drums, bass, chords, arpeggios and
// melodies as plain note lists ({ p: pitch, s: start step, l: length in steps, v: velocity 0-1}).
// Everything is deterministic for a given seed, so a part can be regenerated or varied on purpose.
import { STYLES, VELOCITY, MELODY_RHYTHMS } from './styles.js';
import { rng, voiceChord, pitchesOfPc, chordPcs, scaleStep, snapToScale, inScale } from './theory.js';

export const BAR = 16;
const round = (x) => Math.round(x * 1000) / 1000;
const clampV = (v) => Math.min(1, Math.max(0.06, v));
const velScale = (style, energy) => (0.62 + 0.38 * energy) * (style.velocityScale ?? 1);

// ---------------------------------------------------------------------------
// Chord timeline: the progression laid out over the bars of a pattern
// ---------------------------------------------------------------------------
/** [{ chord, start, len }] covering `bars` bars, the progression repeating as needed. */
export function chordTimeline(progression, bars, chordBars = 1) {
  const total = bars * BAR;
  const out = [];
  let at = 0, i = 0;
  while (at < total - 1e-6) {
    const chord = progression[i % progression.length];
    const len = Math.min(Math.max(0.25, chord.bars * chordBars) * BAR, total - at);
    out.push({ chord, start: at, len });
    at += len;
    i++;
  }
  return out;
}
export const segmentAt = (timeline, step) => timeline.find((s) => step >= s.start - 1e-6 && step < s.start + s.len - 1e-6) ?? timeline[timeline.length - 1];
export const chordAt = (timeline, step) => segmentAt(timeline, step).chord;

/** "0r2 3f1 6o1.5*" -> [{ s, kind, len, accent }] */
export function parseHits(text) {
  return text.trim().split(/\s+/).filter(Boolean).map((tok) => {
    const m = /^(\d+(?:\.\d+)?)([roftsa])(\d+(?:\.\d+)?)?(\*?)$/.exec(tok);
    if (!m) throw new Error(`Bad bass token "${tok}"`);
    return { s: Number(m[1]), kind: m[2], len: m[3] ? Number(m[3]) : 1, accent: !!m[4] };
  });
}
/** "0/3 4/1 6/2" -> [{ s, len }] */
export function parseRhythm(text) {
  return text.trim().split(/\s+/).filter(Boolean).map((tok) => {
    const [s, l] = tok.split('/').map(Number);
    if (!Number.isFinite(s) || !Number.isFinite(l)) throw new Error(`Bad rhythm token "${tok}"`);
    return { s, len: l };
  });
}

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------
/** One drum fill for the last beat of a phrase: lane -> [[step, velocity, tom?], ...]. Needs a snare or clap to build on. */
function pickFill(rand, have, tomFill = false) {
  const target = have.has('snare') ? 'snare' : have.has('clap') ? 'clap' : null;
  if (!target) return {};
  const tomRun = { [target]: [[12, 0.7]], tom: [[13, 0.85, 0], [14, 0.85, 1], [15, 0.95, 2]] };
  if (tomFill && rand.chance(0.6)) return tomRun; // rock and synthwave drummers fill on the toms
  const fill = rand.pick([
    { [target]: [[12, 0.6], [13, 0.7], [14, 0.82], [15, 0.95]] },
    { [target]: [[12, 0.72], [14, 0.86], [15, 0.95]] },
    { [target]: [[12, 0.8], [15, 0.95]], kick: [[14, 0.9]] },
    tomRun,
  ]);
  return fill;
}

/**
 * Drum parts as { lane: [{ s, l, v, alt? }] }. Every lane of the style is always generated (so kick, snare and fills
 * stay in step with each other however the lanes are split over channels); `lanes` only selects what is returned.
 * Lanes below their energy threshold stay silent. `alt` numbers a tom (0 high … 2 low) for kits that map it to keys.
 */
export function generateDrums({ style, bars, seed = 1, energy = 0.8, variation = 0.4, lanes, fills = true, crash = true, phrase = 4 }) {
  const rand = rng(seed);
  const def = style.drums;
  const vs = velScale(style, energy);
  const out = {};
  const put = (lane, s, v, l = 1, extra = {}) => { (out[lane] ??= []).push({ s: round(s), l, v: round(clampV(v)), ...extra }); };

  const rideOn = def.lanes.ride && energy >= def.lanes.ride.min;
  const active = Object.entries(def.lanes).filter(([lane, cfg]) => energy >= cfg.min && !(lane === 'hat' && rideOn));
  const have = new Set([...active.map(([lane]) => lane), 'tom']);

  for (let b = 0; b < bars; b++) {
    const base = b * BAR;
    const lastOfPhrase = b % phrase === phrase - 1;
    const fillNow = fills && def.fills && lastOfPhrase && b > 0 && energy > 0.35;
    const fill = fillNow ? pickFill(rand, have, !!def.lanes.tom) : {};
    for (const [lane, cfg] of active) {
      let pat = cfg.pats[0];
      if (cfg.pats.length > 1 && (b % 2 === 1 || lastOfPhrase) && rand.chance(0.25 + 0.7 * variation)) pat = rand.pick(cfg.pats.slice(1));
      const cut = fill[lane] ? 12 : 16;
      for (let s = 0; s < 16; s++) {
        const c = pat[s];
        if (c === '.' || !VELOCITY[c]) continue;
        if (s >= cut && (lane === 'snare' || lane === 'clap')) continue; // the fill replaces the backbeat
        if (fillNow && s >= 14 && (lane === 'hat' || lane === 'openhat')) continue; // leave air for the fill
        put(lane, base + s, VELOCITY[c] * vs * (1 + rand.gauss() * (lane === 'hat' || lane === 'openhat' || lane === 'perc' || lane === 'ride' ? 0.09 : 0.05)), 1);
      }
      // ghost notes between the backbeats
      if (lane === 'snare' && def.ghost > 0 && variation > 0) {
        for (const s of [3, 7, 10, 11, 14, 15]) {
          if (pat[s] === '.' && rand.chance(def.ghost * variation)) put(lane, base + s, 0.3 * vs * (1 + rand.gauss() * 0.15), 1);
        }
      }
    }
    for (const [lane, hits] of Object.entries(fill)) {
      for (const [s, v, alt] of hits) put(lane, base + s, v * vs, 1, alt === undefined ? {} : { alt });
    }
    if (crash && def.crash && energy >= 0.7 && b % (phrase * 2) === 0) put('crash', base, 0.9 * vs, 4);
  }
  for (const lane of Object.keys(out)) if (lanes && !lanes.includes(lane)) delete out[lane];
  for (const list of Object.values(out)) list.sort((a, b) => a.s - b.s);
  return out;
}

// ---------------------------------------------------------------------------
// Bass
// ---------------------------------------------------------------------------
const lowestPitchOf = (pc, lo) => pitchesOfPc(pc, lo, lo + 11)[0];

/** A bassline following the chord roots with the style's rhythm. */
export function generateBass({ style, timeline, bars, seed = 1, energy = 0.8, variation = 0.4, octave = 0, range, pattern }) {
  const rand = rng(seed);
  const cfg = style.bass;
  const [lo, hi] = (range ?? cfg.range).map((x) => x + octave * 12);
  const vs = velScale(style, energy);
  const patterns = (pattern ? [pattern] : cfg.patterns).map(parseHits);
  const notes = [];
  for (let b = 0; b < bars; b++) {
    const base = b * BAR;
    const lastOfPhrase = b % 4 === 3;
    const hits = patterns.length > 1 && ((b % 2 === 1 && rand.chance(variation * 0.8)) || (lastOfPhrase && rand.chance(0.5 + variation / 2)))
      ? patterns[1 + Math.floor(rand.next() * (patterns.length - 1))]
      : patterns[0];
    hits.forEach((h, i) => {
      const step = base + h.s;
      const seg = segmentAt(timeline, step);
      const chord = seg.chord;
      const rootPc = chord.bass ?? chord.root;
      const root = lowestPitchOf(rootPc, lo);
      let p;
      switch (h.kind) {
        case 'o': p = root + 12 > hi + 7 ? root : root + 12; break;
        case 'f': p = root + 7; break;
        case 't': p = root + (chord.intervals[1] ?? 4); break;
        case 's': p = root + (chord.intervals[3] ?? 10); break;
        case 'a': { // lead into the next chord from a semitone below (or above, now and then)
          const next = timeline[(timeline.indexOf(seg) + 1) % timeline.length].chord;
          const target = lowestPitchOf(next.bass ?? next.root, lo);
          p = next === chord ? root : target - (rand.chance(0.7) ? 1 : -1);
          break;
        }
        default: p = root;
      }
      while (p > hi + 12) p -= 12;
      const room = Math.min(h.len * cfg.gate, seg.start + seg.len - step - 0.05, (hits[i + 1] ? base + hits[i + 1].s : base + BAR) - step);
      if (room <= 0.1) return;
      const accent = h.accent || h.s === 0;
      notes.push({ p, s: round(step), l: round(Math.max(0.25, room)), v: round(clampV((accent ? 0.93 : 0.8) * vs * (1 + rand.gauss() * 0.05))) });
    });
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Chords and pads
// ---------------------------------------------------------------------------
/** Block chords with smooth voice leading. role: 'chords' (rhythmic), 'pad' (sustained), 'stabs' (short). */
export function generateChords({ style, timeline, bars, seed = 1, energy = 0.8, variation = 0.4, role = 'chords', octave = 0, range, rhythm }) {
  const rand = rng(seed);
  const cfg = role === 'pad' ? style.pad : style.chords;
  const [lo, hi] = (range ?? cfg.range).map((x) => x + octave * 12);
  const vs = velScale(style, energy);
  const rhythms = (rhythm ? [rhythm] : style.chords.rhythms).map(parseRhythm);
  // quiet sections comp with the sparsest rhythm the style has, big ones with the busiest
  const hits = (r) => r.length;
  const mainRhythm = rhythms.length > 1 ? [...rhythms].sort((x, y) => (energy < 0.6 ? hits(x) - hits(y) : hits(y) - hits(x)))[0] : rhythms[0];
  const notes = [];
  let prev = null;
  for (const seg of timeline) {
    let voicing;
    if (style.chords.power && role !== 'pad') { // rock: root + fifth + octave
      const root = pitchesOfPc(seg.chord.root, lo, lo + 11)[0] ?? lo;
      voicing = [root, root + 7, root + 12];
    } else {
      voicing = voiceChord(seg.chord, prev, { lo, hi, center: (lo + hi) / 2 - 2, size: style.chords.size ?? 4 });
    }
    prev = voicing;
    const strum = role === 'pad' ? 0.12 : 0.08;
    const emit = (start, len, vel) => {
      voicing.forEach((p, i) => {
        const top = i === voicing.length - 1;
        notes.push({ p, s: round(start + (len >= 2 ? i * strum * (0.4 + rand.next()) : 0)), l: round(len), v: round(clampV((vel + (top ? 0.05 : 0) + rand.gauss() * 0.04) * vs)) });
      });
    };
    if (role === 'pad') {
      emit(seg.start, seg.len, 0.62);
      continue;
    }
    const segBars = Math.ceil(seg.len / BAR - 1e-6);
    for (let b = 0; b < segBars; b++) {
      const barIdx = Math.floor(seg.start / BAR) + b;
      const r = rhythms.length > 1 && barIdx % 4 === 3 && rand.chance(variation) ? rhythms[1 + Math.floor(rand.next() * (rhythms.length - 1))] : mainRhythm;
      const period = Math.max(BAR, Math.ceil(Math.max(...r.map((h) => h.s + h.len)) / BAR) * BAR);
      if ((barIdx * BAR) % period !== 0 && period > BAR) continue; // multi-bar rhythms play once per period
      for (const h of r) {
        const start = barIdx * BAR + h.s;
        if (start >= seg.start + seg.len - 1e-6 || start < seg.start - 1e-6) continue;
        const len = Math.min(role === 'stabs' ? Math.min(h.len, 1.5) : h.len, seg.start + seg.len - start);
        emit(start, len, h.s % 4 === 0 ? 0.78 : 0.66);
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Arpeggio
// ---------------------------------------------------------------------------
export function generateArp({ style, timeline, bars, seed = 1, energy = 0.8, variation = 0.3, octave = 0, range, rate, pattern, gate }) {
  const rand = rng(seed);
  const cfg = style.arp;
  const [lo, hi] = (range ?? cfg.range).map((x) => x + octave * 12);
  const stepSize = rate ?? cfg.rate;
  const mode = pattern ?? cfg.pattern;
  const g = gate ?? cfg.gate;
  const vs = velScale(style, energy);
  const notes = [];
  for (const seg of timeline) {
    const pool = chordPcs(seg.chord).flatMap((pc) => pitchesOfPc(pc, lo, Math.min(hi, lo + 23))).sort((a, b) => a - b);
    if (!pool.length) continue;
    const n = pool.length;
    const seq = (() => {
      const idx = [...Array(n).keys()];
      switch (mode) {
        case 'down': return idx.reverse();
        case 'updown': return [...idx, ...idx.slice(1, -1).reverse()];
        case 'broken': return idx.flatMap((i) => [i, Math.min(n - 1, i + 2)]);
        case 'random': return idx.map(() => Math.floor(rand.next() * n));
        default: return idx;
      }
    })();
    let k = 0;
    for (let s = seg.start; s < seg.start + seg.len - 1e-6; s += stepSize, k++) {
      if (variation > 0 && rand.chance(variation * 0.12)) continue; // an occasional rest keeps it breathing
      const beat = (s - seg.start) % 4 === 0;
      notes.push({ p: pool[seq[k % seq.length]], s: round(s), l: round(Math.min(stepSize * g, seg.start + seg.len - s)), v: round(clampV((beat ? 0.78 : 0.62) * vs * (1 + rand.gauss() * 0.06))) });
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Melody
// ---------------------------------------------------------------------------
/**
 * A melody built from a two-bar motif that is answered (same rhythm start, new ending, shifted contour) and
 * resolved to a chord tone at the end of each phrase. Strong beats land on chord tones; the rest moves mostly
 * by step within the key, so it sounds intentional instead of random.
 */
export function generateMelody({ style, key, timeline, bars, seed = 1, density, energy = 0.8, variation = 0.4, octave = 0, range }) {
  const rand = rng(seed);
  const [lo, hi] = (range ?? style.lead.range).map((x) => x + octave * 12);
  const center = (lo + hi) / 2 - 1;
  const feel = density === undefined ? style.lead.feel : density < 0.34 ? 'sparse' : density < 0.7 ? 'medium' : 'busy';
  const pool = MELODY_RHYTHMS[feel];
  const vs = velScale(style, energy);
  const notes = [];

  const chordTones = (chord) => chordPcs(chord).flatMap((pc) => pitchesOfPc(pc, lo, hi));
  const nearest = (list, p) => list.reduce((best, x) => (Math.abs(x - p) < Math.abs(best - p) ? x : best), list[0]);
  /** Nearest to `p` that is not the note we are already on (a sustained tune should not stutter on one pitch). */
  const nearestMoving = (list, p) => { const alt = list.filter((x) => x !== prev); return nearest(alt.length ? alt : list, p); };
  const clampPitch = (p) => (p > hi ? snapToScale(key, hi - (inScale(key, hi) ? 0 : 1)) : p < lo ? snapToScale(key, lo) : p);

  /** Move from `prev` to a chord tone near it. */
  const toChordTone = (prev, chord) => {
    const all = chordTones(chord);
    const moving = all.filter((t) => t !== prev); // repeating the same note on every strong beat sounds stuck
    const near = moving.filter((t) => Math.abs(t - prev) <= 7); // and a tune mostly moves within a fifth
    const tones = (near.length ? near : moving.length ? moving : all).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev)).slice(0, 3);
    return rand.weighted(tones.map((t, i) => [t, [5, 3, 1][i]]));
  };
  /** Step through the scale, leaning back towards the middle of the range when the line has strayed far from it. */
  const stepFrom = (prev, repeated) => {
    const down = prev > center + 5 ? 0.5 : prev < center - 5 ? -0.5 : 0; // > 0: favour falling steps
    const choices = [[-3, 0.03 + down * 0.04], [-2, 0.1 + down * 0.1], [-1, 0.33 + down * 0.2], [0, repeated ? 0 : 0.09], [1, 0.33 - down * 0.2], [2, 0.1 - down * 0.1], [3, 0.03 - down * 0.04]]
      .map(([d, w]) => [d, Math.max(0.005, w)]);
    const delta = rand.weighted(choices);
    const base = inScale(key, prev) ? prev : snapToScale(key, prev);
    return clampPitch(scaleStep(key, base, delta) ?? prev);
  };

  let prev = nearest(chordTones(timeline[0].chord), center);
  let prevPrev = null;
  const phraseBars = 4;

  const place = (s, len, p, vel) => {
    notes.push({ p, s: round(s), l: round(len), v: round(clampV(vel * vs * (1 + rand.gauss() * 0.05))) });
    prevPrev = prev;
    prev = p;
  };

  for (let ph = 0; ph * phraseBars < bars; ph++) {
    const phStart = ph * phraseBars * BAR;
    const phEnd = Math.min(bars * BAR, phStart + phraseBars * BAR);
    const rhythmA = parseRhythm(rand.pick(pool));
    const other = parseRhythm(rand.pick(pool));
    const answerHead = rhythmA.filter((h) => h.s < 24);
    const headEnd = answerHead.length ? answerHead[answerHead.length - 1].s + answerHead[answerHead.length - 1].len : 0;
    const rhythmB = [...answerHead, ...other.filter((h) => h.s >= 24 && h.s >= headEnd - 0.01)];
    const firstNote = notes.length;
    const shift = rand.weighted([[0, 0.3], [-1, 0.25], [1, 0.25], [2, 0.12], [-2, 0.08]]);
    const motif = []; // pitches of the first two bars, reused by the answer

    for (const [part, rhythm] of [[0, rhythmA], [1, rhythmB]]) {
      const partStart = phStart + part * 2 * BAR;
      rhythm.forEach((h, i) => {
        const s = partStart + h.s;
        if (s >= phEnd - 1e-6) return;
        const chord = chordAt(timeline, s);
        const strong = h.s % 4 === 0 || h.len >= 3 || (part === 0 && i === 0);
        let p;
        if (part === 1 && i < answerHead.length && motif[i] !== undefined) {
          const sh = scaleStep(key, inScale(key, motif[i]) ? motif[i] : snapToScale(key, motif[i]), shift);
          p = clampPitch(sh ?? motif[i]);
          if (strong && !chordPcs(chord).includes(p % 12)) p = nearestMoving(chordTones(chord), p); // answer lands on chord tones too
        } else if (strong) {
          p = toChordTone(prev, chord);
        } else {
          p = stepFrom(prev, prevPrev === prev);
        }
        const isLastOfPhrase = part === 1 && i === rhythm.length - 1;
        let len = Math.min(h.len, phEnd - s);
        if (isLastOfPhrase) { // resolve to a chord tone (the root half the time), held towards the end of the phrase
          const tones = chordTones(chord);
          const roots = tones.filter((t) => t % 12 === chord.root);
          p = rand.chance(0.5) && roots.length ? nearestMoving(roots, p) : nearestMoving(tones, p);
          len = Math.min(Math.max(h.len, 4), phEnd - s);
        }
        if (part === 0) motif[i] = p;
        place(s, len, p, strong ? 0.86 : 0.7);
      });
    }
    // eight-bar form: every second phrase lifts its first half a step, so the tune does not just loop
    if (variation > 0.2 && ph % 2 === 1 && rand.chance(0.5)) {
      for (const n of notes.slice(firstNote)) {
        if (n.s >= phStart + 2 * BAR) break;
        const up = scaleStep(key, inScale(key, n.p) ? n.p : snapToScale(key, n.p), 1);
        if (up != null && up <= hi) n.p = up;
      }
    }
  }
  // no overlaps: a note ends where the next begins
  notes.sort((a, b) => a.s - b.s);
  for (let i = 0; i < notes.length - 1; i++) if (notes[i].s + notes[i].l > notes[i + 1].s) notes[i].l = round(Math.max(0.25, notes[i + 1].s - notes[i].s));
  return notes;
}

// ---------------------------------------------------------------------------
// Effects and transitions
// ---------------------------------------------------------------------------
/** Riser / sweep over the whole pattern, or a single hit on the downbeat (impact). */
export function generateFx({ kind = 'riser', bars }) {
  if (kind === 'impact') return [{ p: 60, s: 0, l: 4, v: 1 }];
  return [{ p: 60, s: 0, l: bars * BAR, v: 0.9 }];
}

// ---------------------------------------------------------------------------
// Feel
// ---------------------------------------------------------------------------
/** Tiny random timing and velocity drift so parts do not sound sequenced. amount 0-1. Never moves a note before step 0. */
export function humanize(notes, seed, amount, { timing = true } = {}) {
  if (!(amount > 0)) return notes;
  const rand = rng(seed ^ 0x9e3779b9);
  for (const n of notes) {
    if (timing && n.s > 0) n.s = round(Math.max(0, n.s + rand.gauss() * 0.035 * amount));
    n.v = round(clampV(n.v + rand.gauss() * 0.04 * amount));
  }
  return notes;
}

export const styleOf = (id) => STYLES[id];
