// Music theory for the agent tools: keys, scales, chords (symbols and roman numerals), smooth voicings and a
// seeded random generator. Pure functions, no audio. Pitches are MIDI numbers (60 = C5 in OpenStudio's naming).

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set([5, 10, 3, 8, 1]); // F, Bb, Eb, Ab, Db major: spell with flats
export const pcName = (pc, flats = false) => (flats ? PC_FLAT_NAMES : PC_NAMES)[((pc % 12) + 12) % 12];

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};
const MODE_ALIASES = {
  '': 'major', maj: 'major', major: 'major', ionian: 'major', M: 'major',
  m: 'minor', min: 'minor', minor: 'minor', aeolian: 'minor', 'natural minor': 'minor',
  dorian: 'dorian', phrygian: 'phrygian', lydian: 'lydian', mixolydian: 'mixolydian', locrian: 'locrian',
  'harmonic minor': 'harmonic_minor', 'melodic minor': 'melodic_minor',
  'pentatonic major': 'pentatonic_major', 'major pentatonic': 'pentatonic_major',
  'pentatonic minor': 'pentatonic_minor', 'minor pentatonic': 'pentatonic_minor', blues: 'blues',
};

/** "A minor", "Am", "F# dorian", "Bb", "C major pentatonic" -> { root, mode, scale, name, flats } */
export function parseKey(text) {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(.*?)\s*$/.exec(String(text));
  if (!m) throw new Error(`"${text}" is not a key — use e.g. "A minor", "C major", "F# dorian", "Bb"`);
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
  const root = (LETTER[m[1].toUpperCase()] + acc + 12) % 12;
  const word = m[3].toLowerCase().replace(/[_-]/g, ' ');
  const mode = MODE_ALIASES[m[3] === 'M' ? 'M' : word];
  if (!mode) throw new Error(`Unknown mode "${m[3]}" in key "${text}" — modes: ${Object.keys(SCALES).join(', ')}`);
  const flats = acc < 0 || (acc === 0 && FLAT_KEYS.has(root) && mode !== 'minor') || (mode === 'minor' && [2, 7, 0, 5, 10].includes(root));
  return { root, mode, scale: SCALES[mode], flats, name: `${pcName(root, flats)} ${mode.replace('_', ' ')}` };
}

/** Pitch classes (0-11) of a key's scale. */
export const scalePcs = (key) => key.scale.map((i) => (key.root + i) % 12);
export const inScale = (key, pitch) => scalePcs(key).includes(((pitch % 12) + 12) % 12);

/** The scale degree (index into key.scale, wrapping octaves) `steps` above/below a pitch that is in the scale, or null. */
export function scaleStep(key, pitch, steps) {
  const pcs = scalePcs(key);
  const rel = (((pitch - key.root) % 12) + 12) % 12;
  const idx = key.scale.indexOf(rel);
  if (idx < 0) return null;
  const oct = Math.floor((pitch - key.root) / 12);
  const total = idx + steps;
  const n = pcs.length;
  const wraps = Math.floor(total / n);
  return key.root + (oct + wraps) * 12 + key.scale[((total % n) + n) % n];
}

/** Nearest in-scale pitch to `pitch` (ties go up). */
export function snapToScale(key, pitch) {
  for (let d = 0; d < 7; d++) {
    if (inScale(key, pitch + d)) return pitch + d;
    if (inScale(key, pitch - d)) return pitch - d;
  }
  return pitch;
}

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------
export const QUALITIES = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], 5: [0, 7],
  7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], mmaj7: [0, 3, 7, 11],
  6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
};
const SUFFIX = { '': 'maj', m: 'min', min: 'min', '-': 'min', dim: 'dim', '°': 'dim', aug: 'aug', '+': 'aug', sus2: 'sus2', sus4: 'sus4', sus: 'sus4', 5: '5', 7: '7', maj7: 'maj7', M7: 'maj7', '△': 'maj7', Δ: 'maj7', m7: 'm7', min7: 'm7', '-7': 'm7', m7b5: 'm7b5', ø: 'm7b5', ø7: 'm7b5', dim7: 'dim7', mMaj7: 'mmaj7', 6: '6', m6: 'm6', 9: '9', maj9: 'maj9', M9: 'maj9', m9: 'm9', add9: 'add9', madd9: 'madd9' };
const LABEL = { maj: '', min: 'm', dim: 'dim', aug: 'aug', sus2: 'sus2', sus4: 'sus4', 5: '5', 7: '7', maj7: 'maj7', m7: 'm7', m7b5: 'm7b5', dim7: 'dim7', mmaj7: 'mMaj7', 6: '6', m6: 'm6', 9: '9', maj9: 'maj9', m9: 'm9', add9: 'add9', madd9: 'madd9' };

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * Parse a chord token against a key.
 *   roman numerals: "i", "VI", "bVII", "V7", "ii7", "Imaj7", "vii°", "IVsus2", "#iv°"   (degrees of the key's scale)
 *   chord names:    "Am", "F", "G7", "Dm7", "Bbmaj7", "F#m7b5", "C/E"
 * Returns { symbol, name, root (pitch class), intervals, quality, bass (pitch class or null) }.
 */
export function parseChord(token, key) {
  const text = String(token).trim();
  const roman = /^([b#♭♯]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(text);
  if (roman) {
    const [, acc, numeral, rest] = roman;
    const degree = ROMAN.indexOf(numeral.toUpperCase());
    const upper = numeral === numeral.toUpperCase();
    if (key.scale.length < 7) throw new Error(`Roman numerals need a 7-note key, not ${key.mode.replace('_', ' ')} — use chord names such as "Am" instead`);
    const shift = acc === '#' || acc === '♯' ? 1 : acc ? -1 : 0;
    const root = (key.root + key.scale[degree] + shift + 12) % 12;
    let quality;
    const r = rest.trim();
    if (r === '') quality = upper ? 'maj' : 'min';
    else if (r === '7') quality = upper ? '7' : 'm7';
    else if (r === '9') quality = upper ? '9' : 'm9';
    else if (r === '6') quality = upper ? '6' : 'm6';
    else if (r === '°' || r === 'dim' || r === 'o') quality = 'dim';
    else if (r === '°7' || r === 'dim7' || r === 'o7') quality = 'dim7';
    else if (r === 'ø' || r === 'ø7' || r === 'm7b5') quality = 'm7b5';
    else if (r === 'maj7' || r === 'M7' || r === 'Δ' || r === '△') quality = 'maj7';
    else if (r === 'maj9' || r === 'M9') quality = 'maj9';
    else if (r === '+' || r === 'aug') quality = 'aug';
    else if (r === 'add9') quality = upper ? 'add9' : 'madd9';
    else if (SUFFIX[r] && !['', 'm'].includes(r)) quality = SUFFIX[r];
    else throw new Error(`Unknown chord ending "${r}" in "${text}"`);
    return finishChord(text, root, quality, null, acc === 'b' || acc === '♭' ? true : acc ? false : key.flats);
  }
  const abs = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/.exec(text);
  if (!abs) throw new Error(`"${text}" is not a chord — use roman numerals (i, VI, V7, ii7) or names (Am, F, G7, Dm7)`);
  const root = (LETTER[abs[1]] + (abs[2] === '#' || abs[2] === '♯' ? 1 : abs[2] ? -1 : 0) + 12) % 12;
  const quality = SUFFIX[abs[3]];
  if (!quality) throw new Error(`Unknown chord ending "${abs[3]}" in "${text}"`);
  const bass = abs[4] ? (LETTER[abs[4]] + (abs[5] === '#' || abs[5] === '♯' ? 1 : abs[5] ? -1 : 0) + 12) % 12 : null;
  return finishChord(text, root, quality, bass, abs[2] === 'b' || abs[2] === '♭');
}

function finishChord(symbol, root, quality, bass, flats = false) {
  return { symbol, name: `${pcName(root, flats)}${LABEL[quality]}`, root, quality, intervals: QUALITIES[quality], bass };
}

/** "i VI III VII", "Am - F - C - G", or an array -> chords. Bars may be given as "Am:2" (two bars). */
export function parseProgression(input, key) {
  const tokens = Array.isArray(input) ? input : String(input).split(/[\s,|\-–—]+/).filter(Boolean);
  if (!tokens.length) throw new Error('The progression is empty');
  return tokens.map((t) => {
    const [sym, bars] = String(t).split(':');
    const chord = parseChord(sym, key);
    chord.bars = bars ? Math.max(0.25, Number(bars)) : 1;
    return chord;
  });
}

/** Diatonic triads (and sevenths) of a 7-note key: [{ degree, numeral, name, pitches... }]. */
export function diatonicChords(key, withSevenths = false) {
  if (key.scale.length !== 7) return [];
  return key.scale.map((_, i) => {
    const third = key.scale[(i + 2) % 7] + (i + 2 >= 7 ? 12 : 0) - key.scale[i];
    const fifth = key.scale[(i + 4) % 7] + (i + 4 >= 7 ? 12 : 0) - key.scale[i];
    const seventh = key.scale[(i + 6) % 7] + (i + 6 >= 7 ? 12 : 0) - key.scale[i];
    let quality = third === 4 ? (fifth === 7 ? 'maj' : 'aug') : (fifth === 7 ? 'min' : 'dim');
    if (withSevenths) quality = third === 4 ? (fifth === 7 ? (seventh === 11 ? 'maj7' : '7') : 'aug') : (fifth === 7 ? 'm7' : (seventh === 10 ? 'm7b5' : 'dim7'));
    const root = (key.root + key.scale[i]) % 12;
    const upper = third === 4;
    let numeral = ROMAN[i];
    if (!upper) numeral = numeral.toLowerCase();
    if (quality === 'dim' || quality === 'dim7') numeral += '°';
    if (quality === 'm7b5') numeral += 'ø';
    return { degree: i + 1, numeral, ...finishChord(numeral, root, quality, null, key.flats) };
  });
}

/** Pitch classes of a chord. */
export const chordPcs = (chord) => [...new Set(chord.intervals.map((i) => (chord.root + i) % 12))];

// ---------------------------------------------------------------------------
// Voicing
// ---------------------------------------------------------------------------
/** All pitches with the given pitch class inside [lo, hi]. */
export function pitchesOfPc(pc, lo, hi) {
  const out = [];
  for (let p = lo; p <= hi; p++) if (((p % 12) + 12) % 12 === pc) out.push(p);
  return out;
}

/**
 * A voicing of `chord` (array of pitches, low to high) that moves as little as possible from `prev`
 * (or sits around `center` for the first chord), staying inside [lo, hi].
 * opts: { size } notes to use (default: the chord's tones, at most 4).
 */
export function voiceChord(chord, prev, { lo = 48, hi = 76, center = 62, size } = {}) {
  const tones = [...new Set(chord.intervals.map((i) => (chord.root + i) % 12))];
  const want = Math.min(size ?? 4, tones.length);
  const fifth = (chord.root + 7) % 12;
  while (tones.length > want) { // the 3rd and 7th carry the harmony: drop the 5th first, then the highest extension
    const i = tones.indexOf(fifth);
    tones.splice(i > 0 ? i : tones.length - 1, 1);
  }
  // candidate voicings: every rotation of the tones as the lowest note, stacked upwards, at several octaves
  const cands = [];
  for (let r = 0; r < tones.length; r++) {
    const order = [...tones.slice(r), ...tones.slice(0, r)];
    for (let base = lo - 12; base <= hi; base++) {
      if (((base % 12) + 12) % 12 !== order[0]) continue;
      const notes = [base];
      for (let k = 1; k < order.length; k++) {
        let p = notes[k - 1] + 1;
        while (((p % 12) + 12) % 12 !== order[k]) p++;
        notes.push(p);
      }
      if (notes[0] >= lo && notes[notes.length - 1] <= hi) cands.push(notes);
    }
  }
  if (!cands.length) return tones.map((t) => pitchesOfPc(t, lo, hi)[0] ?? center);
  const score = (v) => {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    let s = Math.abs(mean - center) * 0.35;
    if (prev) {
      const a = [...v], b = [...prev];
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) s += Math.abs((a[Math.min(i, a.length - 1)] ?? 0) - (b[Math.min(i, b.length - 1)] ?? 0));
    }
    s += (v[v.length - 1] - v[0] > 15 ? 3 : 0); // very wide closed stacks sound thin
    return s;
  };
  return cands.reduce((best, v) => (score(v) < score(best) ? v : best));
}

// ---------------------------------------------------------------------------
// Random numbers
// ---------------------------------------------------------------------------
/** Small seeded PRNG (mulberry32): the same seed always writes the same music. */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    /** pick by weight: [[item, weight], ...] */
    weighted(pairs) {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [item, w] of pairs) { x -= w; if (x <= 0) return item; }
      return pairs[pairs.length - 1][0];
    },
    /** roughly normal, mean 0, spread ~1 */
    gauss: () => (next() + next() + next() + next() - 2) * 1.2,
  };
  return r;
}

/** Hash text (e.g. a section name) to a seed offset so related patterns differ in a stable way. */
export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
