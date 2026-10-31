// Sampler multi-sample zones: several samples on one channel, each covering a key range (and optionally a velocity
// range) and played relative to its own root key — how sampled pianos, strings and drum kits are built
// (FL Studio's DirectWave / FPC). A zone is { sampleId, root, lo, hi, vlo?, vhi? } with keys as MIDI numbers.

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * The note named in a sample's file name ("Piano_C#4.wav", "Strings Db3 mf.wav", "bass-a1"), or null. Sample
 * libraries name notes the scientific way (C4 = middle C = MIDI 60), unlike FL Studio's own C5.
 * Returns { pc, midi } — `midi` is the scientific reading; `pc` the pitch class for when the octave is doubtful.
 */
export function noteFromName(name) {
  const base = String(name).replace(/\.[^.]+$/, '');
  // a note letter, an optional sharp / flat, an octave; not inside a longer word ("Bass2" is not B-flat 2... but "A2" is)
  const re = /(?:^|[^a-z])([a-g])(#|♯|b|♭|s)?(-?\d)(?![\d])/gi;
  let m;
  let last = null;
  while ((m = re.exec(base))) last = m; // the last match: "Grand Piano C4" → C4, not the "d" of Grand
  if (!last) return null;
  const acc = last[2] ? (/^(#|♯|s)$/i.test(last[2]) ? 1 : -1) : 0;
  const pc = (NOTE[last[1].toLowerCase()] + acc + 12) % 12;
  const oct = Number(last[3]);
  const midi = (oct + 1) * 12 + NOTE[last[1].toLowerCase()] + acc;
  return { pc, midi: midi >= 0 && midi <= 127 ? midi : null };
}

/**
 * Fundamental of a pitched sample as a fractional MIDI note, or null when it isn't clearly pitched. Looks at the
 * loudest stretch of the first second (after the attack) with a normalised autocorrelation.
 */
export function detectPitch(mono, sampleRate) {
  const win = Math.min(Math.floor(sampleRate * 0.1), mono.length);
  if (win < 512) return null;
  // the loudest window in the first second
  const hop = Math.floor(win / 2);
  let at = 0;
  let best = -1;
  for (let i = 0; i + win <= Math.min(mono.length, sampleRate); i += hop) {
    let e = 0;
    for (let k = i; k < i + win; k += 4) e += mono[k] * mono[k];
    if (e > best) { best = e; at = i; }
  }
  if (best <= 1e-6) return null;
  const minLag = Math.floor(sampleRate / 2100);
  const maxLag = Math.min(Math.floor(sampleRate / 27), Math.floor(win / 2));
  const n = win - maxLag;
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += mono[at + i] * mono[at + i];
  const corr = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1 && lag < win - n; lag++) {
    let s = 0;
    let e = 0;
    for (let i = 0; i < n; i++) { s += mono[at + i] * mono[at + i + lag]; e += mono[at + i + lag] ** 2; }
    corr[lag] = s / Math.sqrt(r0 * e + 1e-12);
  }
  let top = 0;
  for (let lag = minLag; lag <= maxLag; lag++) top = Math.max(top, corr[lag]);
  if (top < 0.8) return null; // noise, drums, chords
  // the shortest lag that is nearly as good (avoids octave-down picks), refined with a parabola
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] >= top * 0.93 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      const a = corr[lag - 1], b = corr[lag], c = corr[lag + 1];
      const d = a - 2 * b + c;
      const exact = d < 0 ? lag + (0.5 * (a - c)) / d : lag;
      const hz = sampleRate / exact;
      return 69 + 12 * Math.log2(hz / 440);
    }
  }
  return null;
}

/**
 * The root key of a sample: the file name's note, with its octave checked against the detected pitch (libraries
 * disagree about octave numbers); otherwise the detected pitch; otherwise `fallback`.
 */
export function guessRoot(name, mono, sampleRate, fallback = 60) {
  const named = noteFromName(name);
  const heard = mono ? detectPitch(mono, sampleRate) : null;
  if (named && heard != null) {
    // the octave of the named pitch class closest to what was heard
    const k = Math.round((heard - named.pc) / 12);
    return Math.max(0, Math.min(127, named.pc + 12 * k));
  }
  if (named?.midi != null) return named.midi;
  if (heard != null) return Math.max(0, Math.min(127, Math.round(heard)));
  return fallback;
}

/**
 * Give zones key ranges from their roots: each zone reaches halfway to its neighbours, the lowest down to key 0 and
 * the highest up to 127. Zones that share a root (velocity layers) share the range. Returns new zone objects.
 */
export function spreadZones(zones) {
  const roots = [...new Set(zones.map((z) => z.root))].sort((a, b) => a - b);
  const range = new Map(roots.map((r, i) => [r, {
    lo: i === 0 ? 0 : Math.floor((roots[i - 1] + r) / 2) + 1,
    hi: i === roots.length - 1 ? 127 : Math.floor((r + roots[i + 1]) / 2),
  }]));
  return zones.map((z) => ({ ...z, ...range.get(z.root) })).sort((a, b) => a.root - b.root || (a.vlo ?? 0) - (b.vlo ?? 0));
}

/**
 * The zones that sound for a key at a velocity (0..1): every zone whose key and velocity ranges contain it (so zones
 * can layer). A key outside every zone plays the zone with the nearest root, so nothing goes silent.
 */
export function pickZones(zones, key, vel = 0.8) {
  if (!zones?.length) return [];
  const k = Math.round(key);
  const inVel = (z) => vel >= (z.vlo ?? 0) - 1e-9 && vel <= (z.vhi ?? 1) + 1e-9;
  const hits = zones.filter((z) => k >= z.lo && k <= z.hi && inVel(z));
  if (hits.length) return hits;
  const byKey = zones.filter((z) => k >= z.lo && k <= z.hi);
  const pool = byKey.length ? byKey : zones;
  let best = pool[0];
  for (const z of pool) if (Math.abs(z.root - k) < Math.abs(best.root - k)) best = z;
  return [best];
}

/** Is this a usable zone list? (Used when loading projects.) */
export const validZones = (zones) => Array.isArray(zones) && zones.length > 0 && zones.every((z) => z
  && Number.isFinite(z.sampleId) && [z.root, z.lo, z.hi].every((x) => Number.isInteger(x) && x >= 0 && x <= 127) && z.lo <= z.hi
  && (z.vlo === undefined || (Number.isFinite(z.vlo) && z.vlo >= 0 && z.vlo <= 1))
  && (z.vhi === undefined || (Number.isFinite(z.vhi) && z.vhi >= 0 && z.vhi <= 1)));
