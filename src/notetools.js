// Piano-roll note operations as pure functions over note lists ({ p, s, l, v, pan?, fine?, m? }, times in steps).
// Each returns the notes that should replace the input (the caller swaps them in as one undo step), so they are easy
// to test and to share between the piano roll and agent tools.

const EPS = 1e-6;
const round = (x) => Math.round(x * 10000) / 10000;
const copy = (n, patch) => ({ ...n, ...patch });

/** Group notes that start together (within `tol` steps) into chords, in time order. */
export function chords(list, tol = 0.05) {
  const sorted = [...list].sort((a, b) => a.s - b.s || a.p - b.p);
  const out = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n.s - last.s <= tol) last.notes.push(n);
    else out.push({ s: n.s, notes: [n] });
  }
  for (const c of out) c.end = Math.max(...c.notes.map((n) => n.s + n.l));
  return out;
}

/**
 * Arpeggiate chords: each chord becomes a run of its notes, one every `rate` steps until the chord ends.
 * pattern: 'up' | 'down' | 'updown' | 'downup' | 'random'; gate: note length as a fraction of `rate`;
 * octaves: extend the run up by whole octaves (1 = just the chord); seed: for 'random'.
 */
export function arpeggiate(list, { rate = 1, pattern = 'up', gate = 0.9, octaves = 1, seed = 1 } = {}) {
  let r = seed >>> 0 || 1;
  const rand = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 2 ** 32; };
  const out = [];
  for (const c of chords(list)) {
    const base = [...c.notes].sort((a, b) => a.p - b.p);
    const tones = [];
    for (let o = 0; o < Math.max(1, octaves); o++) for (const n of base) tones.push({ n, p: n.p + 12 * o });
    let seq;
    if (pattern === 'down') seq = [...tones].reverse();
    else if (pattern === 'updown') seq = [...tones, ...tones.slice(1, -1).reverse()];
    else if (pattern === 'downup') seq = [...[...tones].reverse(), ...tones.slice(1, -1)];
    else seq = tones;
    if (!seq.length) continue;
    const steps = Math.max(1, Math.round((c.end - c.s) / rate - EPS) || 1);
    for (let i = 0; i < steps; i++) {
      const t = pattern === 'random' ? tones[Math.floor(rand() * tones.length)] : seq[i % seq.length];
      const s = c.s + i * rate;
      out.push(copy(t.n, { p: Math.min(127, t.p), s: round(s), l: round(Math.max(0.0625, Math.min(rate * gate, c.end - s))) }));
    }
  }
  return out;
}

/**
 * Strum chords: spread each chord's notes over `spread` steps, upwards (low note first) or downwards. Notes keep their
 * end times; velocity can taper by `taper` (0..1) from the first note of the strum to the last.
 */
export function strum(list, { spread = 0.5, direction = 'up', taper = 0 } = {}) {
  const out = [];
  for (const c of chords(list)) {
    const notes = [...c.notes].sort((a, b) => (direction === 'down' ? b.p - a.p : a.p - b.p));
    const k = notes.length;
    notes.forEach((n, i) => {
      const off = k > 1 ? (spread * i) / (k - 1) : 0;
      const end = n.s + n.l;
      const s = n.s + off;
      out.push(copy(n, { s: round(s), l: round(Math.max(0.0625, end - s)), v: Math.max(0.02, n.v * (1 - taper * (k > 1 ? i / (k - 1) : 0))) }));
    });
  }
  return out;
}

/** Chop every note into pieces of `size` steps (the last piece takes what is left). */
export function chop(list, size = 1) {
  const out = [];
  for (const n of list) {
    if (n.l <= size + EPS) { out.push(copy(n)); continue; }
    for (let s = n.s; s < n.s + n.l - EPS; s += size) out.push(copy(n, { s: round(s), l: round(Math.min(size, n.s + n.l - s)) }));
  }
  return out;
}

/** Add a quieter grace note `offset` steps before every note (a flam). */
export function flam(list, { offset = 0.25, velocity = 0.6 } = {}) {
  const out = [];
  for (const n of list) {
    out.push(copy(n));
    if (n.s - offset >= -EPS) out.push(copy(n, { s: round(Math.max(0, n.s - offset)), l: round(Math.min(offset, n.l)), v: Math.max(0.02, n.v * velocity) }));
  }
  return out;
}

/** Move every pitch to the nearest note of a scale (`intervals` above `root`, 0 = C); ties go down. */
export function snapToScale(list, root, intervals) {
  const inScale = (p) => intervals.includes((((p - root) % 12) + 12) % 12);
  return list.map((n) => {
    if (inScale(n.p)) return copy(n);
    for (let d = 1; d < 12; d++) {
      if (inScale(n.p - d)) return copy(n, { p: n.p - d });
      if (inScale(n.p + d)) return copy(n, { p: n.p + d });
    }
    return copy(n);
  });
}

/** Velocity ramp from `from` to `to` (0..1) across the notes in time order (fade in / out). */
export function velocityRamp(list, from, to) {
  if (!list.length) return [];
  const lo = Math.min(...list.map((n) => n.s));
  const hi = Math.max(...list.map((n) => n.s));
  return list.map((n) => copy(n, { v: Math.max(0.02, Math.min(1, from + (to - from) * (hi > lo ? (n.s - lo) / (hi - lo) : 1))) }));
}

/** Set each note's length to `ratio` of the distance to the next note start (staccato < 1, legato = 1). */
export function articulate(list, ratio = 0.5) {
  const starts = [...new Set(list.map((n) => n.s))].sort((a, b) => a - b);
  return list.map((n) => {
    const next = starts.find((s) => s > n.s + EPS);
    return next == null ? copy(n, { l: round(Math.max(0.0625, n.l * ratio)) }) : copy(n, { l: round(Math.max(0.0625, (next - n.s) * ratio)) });
  });
}

/** Keep notes inside a pitch range by moving them by octaves (FL's "Limit"). */
export function limitRange(list, lo, hi) {
  return list.map((n) => {
    let p = n.p;
    while (p < lo && p + 12 <= 127) p += 12;
    while (p > hi && p - 12 >= 0) p -= 12;
    return copy(n, { p });
  });
}
