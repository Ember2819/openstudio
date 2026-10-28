// Genre knowledge: tempo, groove, harmony, instrumentation and arrangement for each style the agent tools know.
//
// Pattern notation (all positions are in steps: 16 per bar, 4 per beat):
//   drum grid  16 characters, one per step.   X accent  x hit  m medium  o soft  g ghost  . rest
//   bass hits  "0r2 3f1 6o1.5": step + kind + length.  r root, f fifth, o octave, t third, s seventh, a approach (a semitone below the next chord)
//   rhythms    "0/3 4/1 6/2": start/length pairs

export const VELOCITY = { X: 0.95, x: 0.78, m: 0.62, o: 0.44, g: 0.3 };

// ---------------------------------------------------------------------------
// Chord progressions by mood (roman numerals, so they work in any key)
// ---------------------------------------------------------------------------
export const PROGRESSIONS = {
  major: {
    pop: 'I V vi IV', axis: 'vi IV I V', fifties: 'I vi IV V', uplifting: 'I IV vi V', rising: 'I iii IV V',
    anthem: 'I V IV V', soul: 'IVmaj7 iii7 ii7 Vsus4', jazz: 'IIImaj7 vi7 ii7 V7', gospel: 'I I7 IV iv', sunny: 'I IV I V',
  },
  minor: {
    epic: 'i VI III VII', dark: 'i VII VI VII', sad: 'i iv VII III', driving: 'i III VII VI', drama: 'i VI iv V',
    trance: 'i VI VII i', hypnotic: 'i i VII VI', lofi: 'i7 iv7 VII7 IIImaj7', cinematic: 'i III iv VI', noir: 'i7 VI7 ii7 V7',
  },
  modal: { dorian: 'i IV', mixolydian: 'I bVII IV I', phrygian: 'i bII', lydian: 'I II', vamp: 'i i IV i' },
};

/** Pick a progression by name from any mood group; returns the roman-numeral text. */
export function namedProgression(name) {
  for (const group of Object.values(PROGRESSIONS)) if (group[name]) return group[name];
  return null;
}

// ---------------------------------------------------------------------------
// Rhythm motifs for melodies: two bars (32 steps) each
// ---------------------------------------------------------------------------
export const MELODY_RHYTHMS = {
  sparse: [
    '0/6 8/4 16/6 24/6', '0/4 6/2 8/8 16/4 22/2 24/8', '2/6 10/6 18/4 24/8', '0/8 8/4 12/4 16/12',
  ],
  medium: [
    '0/3 3/1 4/4 8/2 10/2 12/4 16/3 19/1 20/4 24/4', '0/2 2/2 4/3 8/2 10/2 12/4 16/2 18/2 20/4 26/2 28/4',
    '0/4 4/2 6/2 8/4 14/2 16/4 20/2 22/2 24/6', '2/2 4/2 6/4 12/2 14/2 18/2 20/2 22/4 28/4',
  ],
  busy: [
    '0/2 2/2 4/2 6/2 8/2 10/2 12/4 16/2 18/2 20/2 22/2 24/4 28/4', '0/1 1/1 2/2 4/2 6/1 7/1 8/4 12/2 14/2 16/1 17/1 18/2 20/4 24/2 26/2 28/4',
    '0/2 3/1 4/2 7/1 8/2 10/2 12/2 14/2 16/2 19/1 20/2 22/2 24/2 26/2 28/2 30/2',
  ],
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const GM = { // General MIDI program numbers, so the setup does not depend on how a catalogue spells names
  piano: 0, epiano: 4, harpsichord: 6, clav: 7, vibes: 11, marimba: 12, organ: 16, nylon: 24, steel: 25, jazzGuitar: 26, cleanGuitar: 27,
  mutedGuitar: 28, overdrive: 29, distortion: 30, acousticBass: 32, fingerBass: 33, pickBass: 34, fretless: 35, slap: 36, synthBass1: 38, synthBass2: 39,
  violin: 40, cello: 42, pizz: 45, harp: 46, strings: 48, slowStrings: 49, synthStrings: 50, choir: 52, oohs: 53, synthVoice: 54, orchHit: 55,
  trumpet: 56, trombone: 57, horns: 60, brass: 61, synthBrass: 62, alto: 65, tenor: 66, flute: 73, panflute: 75, squareLead: 80, sawLead: 81, charang: 84,
  fantasia: 88, warmPad: 89, polysynth: 90, haloPad: 94, sweepPad: 95, kalimba: 108, steelDrums: 114,
};

const KIT = { standard: 0, room: 8, power: 16, electronic: 24, tr808: 25, dance: 26, jazz: 32, brush: 40 };

/** Roles every tool understands. drums lanes: kick snare clap hat openhat perc tom crash ride. */
export const ROLES = ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc', 'tom', 'crash', 'ride', 'drums', 'bass', 'chords', 'pad', 'arp', 'lead', 'stabs', 'fx'];
export const DRUM_LANES = ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc', 'tom', 'crash', 'ride'];

/** General MIDI drum map: where each lane lives on a kit channel, and which kit keys count as which lane. */
export const LANE_KEY = { kick: 36, snare: 38, clap: 39, hat: 42, openhat: 46, perc: 70, tom: 45, crash: 49, ride: 51 };
export const KEY_LANE = {
  35: 'kick', 36: 'kick', 38: 'snare', 40: 'snare', 37: 'snare', 39: 'clap', 42: 'hat', 44: 'hat', 46: 'openhat',
  49: 'crash', 57: 'crash', 51: 'ride', 59: 'ride', 53: 'ride', 70: 'perc', 69: 'perc', 54: 'perc', 56: 'perc', 75: 'perc', 62: 'perc', 63: 'perc', 64: 'perc',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom',
};
export const VOICE_LANE = {
  kick: 'kick', kick808: 'kick', kickpunch: 'kick', snare: 'snare', snare808: 'snare', snarefat: 'snare', rimshot: 'snare', rim: 'snare', clap: 'clap', snap: 'clap',
  hat: 'hat', hatpedal: 'hat', openhat: 'openhat', tom: 'tom', conga: 'perc', bongo: 'perc', cowbell: 'perc', woodblock: 'perc', shaker: 'perc', cabasa: 'perc',
  tambourine: 'perc', triangle: 'perc', clave: 'perc', crash: 'crash', ride: 'ride', ridebell: 'ride',
};

// shorthand to keep the tables below readable
const sf = (program, name) => ({ kind: 'sf', program, name });
const syn = (preset) => ({ kind: 'synth', preset });
const fm = (preset) => ({ kind: 'fm', preset });
const org = (preset) => ({ kind: 'organ', preset });
const plk = (preset) => ({ kind: 'pluck', preset });
const sfx = (preset) => ({ kind: 'sfx', preset });
const drum = (voice, name) => ({ kind: 'drum', voice, name });
const piece = (kit, key, name) => ({ kind: 'kitpiece', kit, key, name });

export const STYLES = {
  house: {
    name: 'House', blurb: 'Four-on-the-floor dance music: offbeat bass and hats, claps on 2 and 4, stabby chords.',
    bpm: [118, 124, 130], swing: 0, mode: 'minor', progressions: ['dark', 'epic', 'pop'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X...X...X...X...'] },
        clap: { min: 0.4, pats: ['....X.......X...', '....X.......X..o'] },
        hat: { min: 0.25, pats: ['o.X.o.X.o.X.o.X.', 'ogXgogXgogXgogXg'] },
        openhat: { min: 0.55, pats: ['..x...x...x...x.'] },
        perc: { min: 0.65, pats: ['.g.o.g.o.g.o.g.o'] },
      },
      fills: true, crash: true, ghost: 0,
    },
    bass: { patterns: ['2r2 6r2 10r2 14r1.5', '0r1 2r2 6r2 8r1 10r2 14f2'], gate: 0.9, range: [31, 43] },
    chords: { rhythms: ['0/1.5 3/1.5 6/1 10/1.5', '2/1.5 6/1.5 10/1.5 14/1.5', '0/16'], size: 4, range: [53, 74] },
    pad: { range: [48, 70] },
    arp: { rate: 1, pattern: 'updown', gate: 0.7, range: [60, 84] },
    lead: { feel: 'medium', range: [67, 84] },
    cast: {
      kick: drum('kickpunch', 'Kick'), clap: drum('clap', 'Clap'), hat: drum('hat', 'Closed Hat'), openhat: drum('openhat', 'Open Hat'),
      bass: syn('Rubber Bass'), chords: syn('House Stab'), pad: syn('String Pad'), lead: syn('Pulse Lead'), arp: syn('Arp Pulse'), fx: sfx('Riser'),
    },
  },
  techno: {
    name: 'Techno', blurb: 'Relentless 4/4, minimal and hypnotic: rolling bass, sparse stabs, long builds.',
    bpm: [126, 132, 140], swing: 0, mode: 'minor', progressions: ['hypnotic', 'dark', 'vamp'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X...X...X...X...'] },
        clap: { min: 0.45, pats: ['....x.......x...'] },
        hat: { min: 0.3, pats: ['g.X.g.X.g.X.g.X.', 'gmXmgmXmgmXmgmXm'] },
        perc: { min: 0.5, pats: ['..o..o..o..o..o.', 'm..o..m.o..o.o..'] },
        openhat: { min: 0.7, pats: ['..x...x...x...x.'] },
      },
      fills: false, crash: false, ghost: 0,
    },
    bass: { patterns: ['2r1.5 6r1.5 10r1.5 14r1.5', '0r1 2r1.5 6r1.5 8r1 10r1.5 14o1.5'], gate: 0.85, range: [31, 43] },
    chords: { rhythms: ['2/1 6/1 10/1 14/1', '0/2 6/2 10/2', '3/1 7/1 11/1'], size: 3, range: [53, 72] },
    pad: { range: [48, 68] },
    arp: { rate: 1, pattern: 'up', gate: 0.55, range: [55, 79] },
    lead: { feel: 'sparse', range: [64, 81] },
    cast: {
      kick: drum('kickpunch', 'Kick'), clap: drum('clap', 'Clap'), hat: drum('hat', 'Closed Hat'), openhat: drum('openhat', 'Open Hat'), perc: drum('conga', 'Conga'),
      bass: syn('Acid Bass'), chords: syn('Rave Stab'), pad: syn('Dark Pad'), lead: syn('Glass Lead'), arp: syn('Arp Saw'), fx: sfx('Noise Sweep Up'),
    },
  },
  trance: {
    name: 'Trance', blurb: 'Euphoric, 138 BPM: rolling 16th bass, offbeat hats, supersaw leads and long risers.',
    bpm: [132, 138, 142], swing: 0, mode: 'minor', progressions: ['trance', 'epic', 'dark'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X...X...X...X...'] },
        clap: { min: 0.4, pats: ['....X.......X...'] },
        hat: { min: 0.3, pats: ['..x...x...x...x.', 'g.X.g.X.g.X.gXXg'] },
        openhat: { min: 0.5, pats: ['..X...X...X...X.'] },
        perc: { min: 0.7, pats: ['mgmgmgmgmgmgmgmg'] },
      },
      fills: true, crash: true, ghost: 0,
    },
    bass: { patterns: ['1r1 2r1 3r1 5r1 6r1 7r1 9r1 10r1 11r1 13r1 14r1 15r1'], gate: 0.8, range: [31, 43] },
    chords: { rhythms: ['0/16', '0/3 3/3 6/2 8/3 11/3 14/2'], size: 3, range: [55, 76] },
    pad: { range: [50, 72] },
    arp: { rate: 1, pattern: 'up', gate: 0.6, range: [60, 88] },
    lead: { feel: 'medium', range: [69, 88] },
    cast: {
      kick: drum('kickpunch', 'Kick'), clap: drum('clap', 'Clap'), hat: drum('hat', 'Closed Hat'), openhat: drum('openhat', 'Open Hat'), perc: drum('shaker', 'Shaker'),
      bass: syn('Saw Bass'), chords: syn('Supersaw'), pad: syn('String Pad'), lead: syn('Trance Lead'), arp: syn('Trance Pluck'), fx: sfx('Riser'),
    },
  },
  trap: {
    name: 'Trap', blurb: 'Half-time 140 BPM: booming 808, snare on beat 3, skittering hat rolls, dark minor melodies.',
    bpm: [130, 140, 150], swing: 0, mode: 'minor', progressions: ['sad', 'dark', 'cinematic'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X.......o.X.....', 'X.....X...o.X...', 'X..o....o.X..o..'] },
        snare: { min: 0.1, pats: ['........X.......'] },
        clap: { min: 0.3, pats: ['........x.......'] },
        hat: { min: 0.15, pats: ['m.m.m.m.m.m.m.m.', 'm.m.mmmmm.m.mmm.', 'm.m.m.m.mmmmmmm.'] },
        openhat: { min: 0.6, pats: ['......x.......x.'] },
        perc: { min: 0.7, pats: ['...o.......o....'] },
      },
      fills: true, crash: false, ghost: 0,
    },
    bass: { patterns: ['0r5 6f1 8r3 12o2', '0r4 5r1 8r2 11f1 12r4', '0r6 8r2 10r4 14r2'], gate: 0.97, range: [26, 38] },
    chords: { rhythms: ['0/8 8/8', '0/3 3/3 6/2 8/8'], size: 4, range: [55, 76] },
    pad: { range: [50, 72] },
    arp: { rate: 1, pattern: 'updown', gate: 0.5, range: [67, 91] },
    lead: { feel: 'sparse', range: [67, 88] },
    cast: {
      kick: drum('kick808', 'Kick 808'), snare: drum('snare808', 'Snare'), clap: drum('clap', 'Clap'), hat: drum('hat', 'Closed Hat'), openhat: drum('openhat', 'Open Hat'), perc: drum('rimshot', 'Rimshot'),
      bass: syn('808 Sub'), chords: fm('FM E-Piano'), pad: syn('Dream Pad'), lead: fm('Bell'), arp: fm('FM Kalimba'), fx: sfx('Downlifter'),
    },
  },
  hiphop: {
    name: 'Hip-hop (boom bap)', blurb: 'Laid-back 90 BPM swung drums, dusty keys, walking sub bass, space for a vocal.',
    bpm: [82, 90, 98], swing: 0.2, mode: 'minor', progressions: ['lofi', 'noir', 'sad'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X.....o...X.....', 'X..o..o...X..o..', 'X.....o..oX.....'] },
        snare: { min: 0.1, pats: ['....X.......X...', '....X..o....X...'] },
        hat: { min: 0.2, pats: ['m.o.m.o.m.o.m.o.', 'm.o.m.o.m.o.mgo.'] },
        openhat: { min: 0.7, pats: ['......x.........'] },
        perc: { min: 0.6, pats: ['..o...o...o...o.'] },
      },
      fills: true, crash: false, ghost: 0.25,
    },
    bass: { patterns: ['0r3 4r1 6f1 8r2 12r1 14s1', '0r2 3r1 6r2 8r3 12f1 14r1'], gate: 0.92, range: [31, 43] },
    chords: { rhythms: ['0/6 6/2 8/6 14/2', '0/3 3/2 8/3 11/2'], size: 4, range: [52, 72] },
    pad: { range: [48, 69] },
    arp: { rate: 2, pattern: 'up', gate: 0.8, range: [60, 84] },
    lead: { feel: 'sparse', range: [64, 81] },
    cast: {
      kick: piece(KIT.standard, 36, 'Kick'), snare: piece(KIT.standard, 38, 'Snare'), hat: piece(KIT.standard, 42, 'Closed Hat'), openhat: piece(KIT.standard, 46, 'Open Hat'), perc: piece(KIT.standard, 37, 'Side Stick'),
      bass: sf(GM.fingerBass, 'Finger Bass'), chords: fm('FM E-Piano'), pad: sf(GM.slowStrings, 'Slow Strings'), lead: fm('FM Vibraphone'), arp: plk('Nylon Guitar'), fx: sfx('Vinyl Crackle'),
    },
  },
  lofi: {
    name: 'Lo-fi', blurb: 'Warm, slow and swung (78 BPM): soft drums, jazzy seventh chords, mellow keys, vinyl crackle.',
    bpm: [68, 78, 86], swing: 0.25, mode: 'minor', progressions: ['lofi', 'noir', 'soul'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X.....o...o.X...', 'X.......o.o.X...'] },
        snare: { min: 0.1, pats: ['....x.......x...', '....x.....o.x...'] },
        hat: { min: 0.2, pats: ['m.o.m.o.m.o.m.o.', 'm.g.m.g.m.g.mgg.'] },
        perc: { min: 0.55, pats: ['..g...g...g...g.'] },
      },
      fills: false, crash: false, ghost: 0.3,
    },
    bass: { patterns: ['0r3 6f2 8r3 12s2', '0r4 8r2 10f2 12r3'], gate: 0.95, range: [31, 43] },
    chords: { rhythms: ['0/5 6/2 8/5 14/2', '0/16', '0/3 4/2 8/3 12/4'], size: 4, range: [52, 72] },
    pad: { range: [48, 67] },
    arp: { rate: 2, pattern: 'broken', gate: 0.9, range: [60, 81] },
    lead: { feel: 'sparse', range: [64, 81] },
    cast: {
      kick: piece(KIT.jazz, 36, 'Kick'), snare: piece(KIT.jazz, 38, 'Snare'), hat: piece(KIT.jazz, 42, 'Closed Hat'), perc: piece(KIT.jazz, 37, 'Side Stick'),
      bass: sf(GM.acousticBass, 'Acoustic Bass'), chords: fm('FM E-Piano'), pad: sf(GM.warmPad, 'Warm Pad'), lead: fm('FM Vibraphone'), arp: plk('Nylon Guitar'), fx: sfx('Vinyl Crackle'),
    },
    velocityScale: 0.82,
  },
  pop: {
    name: 'Pop', blurb: 'Bright and direct (110 BPM): clear backbeat, singable melody, piano or guitar chords, simple bass.',
    bpm: [96, 110, 124], swing: 0, mode: 'major', progressions: ['pop', 'axis', 'uplifting'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X.......X.o.....', 'X.....o.X.......', 'X.......X.X.....'] },
        snare: { min: 0.1, pats: ['....X.......X...'] },
        clap: { min: 0.7, pats: ['....x.......x...'] },
        hat: { min: 0.2, pats: ['m.m.m.m.m.m.m.m.', 'm.o.m.o.m.o.m.o.'] },
        openhat: { min: 0.75, pats: ['..............x.'] },
        perc: { min: 0.6, pats: ['o.o.o.o.o.o.o.o.'] },
      },
      fills: true, crash: true, ghost: 0.1,
    },
    bass: { patterns: ['0r2 2r2 4r2 6r2 8r2 10r2 12r2 14r2', '0r3 3r1 4r2 6r1 8r3 11r1 12r2 14r2'], gate: 0.9, range: [31, 45] },
    chords: { rhythms: ['0/3 4/1 6/2 8/3 12/1 14/2', '0/4 4/4 8/4 12/4', '0/2 2/2 4/2 6/2 8/2 10/2 12/2 14/2'], size: 4, range: [52, 74] },
    pad: { range: [48, 69] },
    arp: { rate: 2, pattern: 'up', gate: 0.85, range: [60, 84] },
    lead: { feel: 'medium', range: [67, 84] },
    cast: {
      kick: piece(KIT.standard, 36, 'Kick'), snare: piece(KIT.standard, 38, 'Snare'), clap: piece(KIT.standard, 39, 'Clap'), hat: piece(KIT.standard, 42, 'Closed Hat'), openhat: piece(KIT.standard, 46, 'Open Hat'), perc: piece(KIT.standard, 54, 'Tambourine'),
      crash: piece(KIT.standard, 49, 'Crash'),
      bass: sf(GM.fingerBass, 'Finger Bass'), chords: sf(GM.piano, 'Grand Piano'), pad: sf(GM.synthStrings, 'Synth Strings 1'), lead: syn('Vocal Lead'), arp: plk('Steel Guitar'), fx: sfx('Reverse Crash'),
    },
  },
  rock: {
    name: 'Rock', blurb: 'Live-band energy (120 BPM): driving 8th bass, big backbeat, power chords, organ and a lead guitar.',
    bpm: [104, 120, 140], swing: 0, mode: 'minor', progressions: ['drama', 'driving', 'anthem'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X.......X.X.....', 'X.....o.X.X.....', 'X.X.....X.......'] },
        snare: { min: 0.1, pats: ['....X.......X...', '....X.......X..o'] },
        hat: { min: 0.2, pats: ['m.m.m.m.m.m.m.m.', 'x.m.x.m.x.m.x.m.'] },
        ride: { min: 0.75, pats: ['x.x.x.x.x.x.x.x.'] },
        tom: { min: 0.95, pats: ['................'] },
      },
      fills: true, crash: true, ghost: 0.1,
    },
    bass: { patterns: ['0r2 2r2 4r2 6r2 8r2 10r2 12r2 14r2', '0r2 2r2 4r2 6r2 8r2 10r2 12r1 14r1 15a1'], gate: 0.9, range: [28, 43] },
    chords: { rhythms: ['0/3 4/1 6/2 8/3 12/1 14/2', '0/8 8/8', '0/2 2/2 4/2 6/2 8/2 10/2 12/2 14/2'], size: 3, range: [52, 72], power: true },
    pad: { range: [48, 70] },
    arp: { rate: 2, pattern: 'up', gate: 0.8, range: [60, 84] },
    lead: { feel: 'medium', range: [64, 84] },
    cast: {
      kick: piece(KIT.power, 36, 'Kick'), snare: piece(KIT.power, 38, 'Snare'), hat: piece(KIT.power, 42, 'Closed Hat'), ride: piece(KIT.power, 51, 'Ride'), crash: piece(KIT.power, 49, 'Crash'), tom: piece(KIT.power, 45, 'Tom'),
      bass: sf(GM.pickBass, 'Pick Bass'), chords: sf(GM.overdrive, 'Overdrive Guitar'), pad: org('Rock Organ'), lead: sf(GM.distortion, 'Distortion Guitar'), arp: sf(GM.cleanGuitar, 'Clean Guitar'), fx: sfx('Reverse Crash'),
    },
  },
  dnb: {
    name: 'Drum & bass', blurb: 'Fast 174 BPM breakbeat: two-step drums, rolling reese bass, pads and atmospheric stabs.',
    bpm: [168, 174, 178], swing: 0, mode: 'minor', progressions: ['dark', 'epic', 'sad'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X.........X.....', 'X.........X..o..', 'X.....o...X.....'] },
        snare: { min: 0.1, pats: ['....X.......X...', '....X.......X..o'] },
        hat: { min: 0.25, pats: ['m.m.m.m.m.m.m.m.', 'm.mgm.m.m.mgm.m.'] },
        openhat: { min: 0.6, pats: ['..x.......x.....'] },
        perc: { min: 0.7, pats: ['.g..o..g..o..g..'] },
      },
      fills: true, crash: true, ghost: 0.35,
    },
    bass: { patterns: ['0r3 3r1 6r2 10r3 14r2', '0r2 2r1 3r1 6r2 8r2 10r3 14r1 15a1'], gate: 0.95, range: [29, 41] },
    chords: { rhythms: ['0/16', '0/6 8/6', '0/3 6/3 12/4'], size: 4, range: [53, 74] },
    pad: { range: [50, 72] },
    arp: { rate: 1, pattern: 'updown', gate: 0.6, range: [62, 86] },
    lead: { feel: 'sparse', range: [67, 86] },
    cast: {
      kick: drum('kickpunch', 'Kick'), snare: drum('snarefat', 'Snare'), hat: drum('hat', 'Closed Hat'), openhat: drum('openhat', 'Open Hat'), perc: drum('shaker', 'Shaker'), crash: drum('crash', 'Crash'),
      bass: syn('Reese Bass'), chords: syn('Disco Stab'), pad: syn('Dream Pad'), lead: fm('FM Lead'), arp: fm('Glass Bell'), fx: sfx('Riser'),
    },
  },
  synthwave: {
    name: 'Synthwave', blurb: 'Retro 80s (100 BPM): gated snare, pulsing octave bass, lush pads, saw lead and arpeggios.',
    bpm: [90, 100, 118], swing: 0, mode: 'minor', progressions: ['epic', 'drama', 'driving'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X.......X.X.....', 'X.....o.X.......'] },
        snare: { min: 0.1, pats: ['....X.......X...'] },
        clap: { min: 0.6, pats: ['....x.......x...'] },
        hat: { min: 0.2, pats: ['m.m.m.m.m.m.m.m.', 'm.o.m.o.m.o.m.mm'] },
        tom: { min: 0.9, pats: ['................'] },
      },
      fills: true, crash: true, ghost: 0,
    },
    bass: { patterns: ['0r1 1o1 2r1 3o1 4r1 5o1 6r1 7o1 8r1 9o1 10r1 11o1 12r1 13o1 14r1 15o1', '0r2 2o1 3r1 4r2 6o1 7r1 8r2 10o1 11r1 12r2 14o1 15r1'], gate: 0.8, range: [31, 43] },
    chords: { rhythms: ['0/16', '0/4 4/4 8/4 12/4'], size: 4, range: [55, 76] },
    pad: { range: [48, 72] },
    arp: { rate: 1, pattern: 'updown', gate: 0.65, range: [60, 88] },
    lead: { feel: 'medium', range: [69, 88] },
    cast: {
      kick: piece(KIT.electronic, 36, 'Kick'), snare: piece(KIT.electronic, 38, 'Snare'), clap: piece(KIT.electronic, 39, 'Clap'), hat: piece(KIT.electronic, 42, 'Closed Hat'), tom: piece(KIT.electronic, 45, 'Tom'), crash: piece(KIT.electronic, 49, 'Crash'),
      bass: syn('Saw Bass'), chords: syn('Analog Pad'), pad: syn('String Pad'), lead: syn('Saw Lead'), arp: syn('Arp Saw'), fx: sfx('Tonal Swell'),
    },
  },
  funk: {
    name: 'Funk', blurb: 'Tight and syncopated (108 BPM): 16th-note hats, ghost-note snare, slap bass, clavinet and horns.',
    bpm: [96, 108, 118], swing: 0.1, mode: 'dorian', progressions: ['vamp', 'dorian', 'mixolydian'],
    drums: {
      lanes: {
        kick: { min: 0.1, pats: ['X..o..X...o.X...', 'X.....X..o.X..o.', 'X..o..X.....X.o.'] },
        snare: { min: 0.1, pats: ['....X..o.o..X..o', '....X.o..o..X...'] },
        hat: { min: 0.2, pats: ['XgmgXgmgXgmgXgmg', 'mgmgmgmgmgmgmgmg'] },
        openhat: { min: 0.6, pats: ['..............x.'] },
        perc: { min: 0.65, pats: ['..o..o..o..o..o.'] },
      },
      fills: true, crash: true, ghost: 0.2,
    },
    bass: { patterns: ['0r1 3r1 4o1 6r1 7s1 10r1 12r1 14f1', '0r2 3r1 6r1 7f1 8r1 10s1 12r1 15a1'], gate: 0.75, range: [28, 43] },
    chords: { rhythms: ['0/1 3/1 4/1 7/1 10/1 12/1 14/1', '2/1 6/1 10/1 11/1 14/1'], size: 4, range: [54, 76] },
    pad: { range: [50, 70] },
    arp: { rate: 1, pattern: 'broken', gate: 0.6, range: [62, 86] },
    lead: { feel: 'medium', range: [64, 84] },
    cast: {
      kick: piece(KIT.standard, 36, 'Kick'), snare: piece(KIT.standard, 38, 'Snare'), hat: piece(KIT.standard, 42, 'Closed Hat'), openhat: piece(KIT.standard, 46, 'Open Hat'), perc: piece(KIT.standard, 54, 'Tambourine'), crash: piece(KIT.standard, 49, 'Crash'),
      bass: sf(GM.slap, 'Slap Bass 1'), chords: sf(GM.clav, 'Clavinet'), pad: org('Jazz Organ'), lead: sf(GM.brass, 'Brass Section'), arp: sf(GM.mutedGuitar, 'Muted Guitar'), fx: sfx('Whoosh'),
    },
  },
  ambient: {
    name: 'Ambient', blurb: 'Slow, spacious (70 BPM): evolving pads, sparse bell-like melody, drones, textures instead of drums.',
    bpm: [56, 70, 84], swing: 0, mode: 'major', progressions: ['sunny', 'uplifting', 'cinematic'], chordBars: 2,
    drums: { lanes: { perc: { min: 0.55, pats: ['g.......o.......'] } }, fills: false, crash: false, ghost: 0 },
    bass: { patterns: ['0r16'], gate: 1, range: [31, 43] },
    chords: { rhythms: ['0/32', '0/16 16/16'], size: 4, range: [52, 76] },
    pad: { range: [48, 72] },
    arp: { rate: 2, pattern: 'updown', gate: 1.2, range: [64, 91] },
    lead: { feel: 'sparse', range: [67, 88] },
    cast: {
      perc: drum('triangle', 'Triangle'),
      bass: syn('Evolving Drone'), chords: fm('FM Pad'), pad: syn('Dream Pad'), lead: fm('Glass Bell'), arp: plk('Harp'), fx: sfx('Ocean Waves'),
    },
  },
};

export const STYLE_IDS = Object.keys(STYLES);

// ---------------------------------------------------------------------------
// Song structures: sections with a name, length and energy (0-1). `roles` lists extras for that section:
//   riser  — a riser over the last bars        impact — a hit on the first beat       drop — strip the drums out for the last beat
// ---------------------------------------------------------------------------
export const STRUCTURES = {
  standard: {
    blurb: 'Intro, verse, chorus, verse, chorus, bridge, final chorus, outro (~64 bars)',
    sections: [
      { name: 'Intro', bars: 4, energy: 0.25, kind: 'intro' },
      { name: 'Verse 1', bars: 8, energy: 0.5, kind: 'verse' },
      { name: 'Chorus 1', bars: 8, energy: 0.85, kind: 'chorus', impact: true },
      { name: 'Verse 2', bars: 8, energy: 0.58, kind: 'verse' },
      { name: 'Chorus 2', bars: 8, energy: 0.9, kind: 'chorus', impact: true },
      { name: 'Bridge', bars: 8, energy: 0.4, kind: 'break', riser: true },
      { name: 'Final Chorus', bars: 8, energy: 1, kind: 'chorus', impact: true },
      { name: 'Outro', bars: 4, energy: 0.22, kind: 'outro' },
    ],
  },
  edm: {
    blurb: 'Intro, build, drop, breakdown, build, drop, outro (~88 bars)',
    sections: [
      { name: 'Intro', bars: 8, energy: 0.3, kind: 'intro' },
      { name: 'Build', bars: 8, energy: 0.55, kind: 'build', riser: true },
      { name: 'Drop 1', bars: 16, energy: 1, kind: 'drop', impact: true },
      { name: 'Breakdown', bars: 8, energy: 0.3, kind: 'break', riser: true },
      { name: 'Build 2', bars: 8, energy: 0.65, kind: 'build', riser: true },
      { name: 'Drop 2', bars: 16, energy: 1, kind: 'drop', impact: true },
      { name: 'Outro', bars: 8, energy: 0.25, kind: 'outro' },
    ],
  },
  chill: {
    blurb: 'Intro, A, B, A, B, outro — relaxed loop-based arrangement (~40 bars)',
    sections: [
      { name: 'Intro', bars: 4, energy: 0.3, kind: 'intro' },
      { name: 'A', bars: 8, energy: 0.55, kind: 'verse' },
      { name: 'B', bars: 8, energy: 0.75, kind: 'chorus' },
      { name: 'A 2', bars: 8, energy: 0.6, kind: 'verse' },
      { name: 'B 2', bars: 8, energy: 0.8, kind: 'chorus' },
      { name: 'Outro', bars: 4, energy: 0.25, kind: 'outro' },
    ],
  },
  short: {
    blurb: 'Intro, verse, chorus, outro (~24 bars) — a quick full-form sketch',
    sections: [
      { name: 'Intro', bars: 4, energy: 0.3, kind: 'intro' },
      { name: 'Verse', bars: 8, energy: 0.55, kind: 'verse' },
      { name: 'Chorus', bars: 8, energy: 0.9, kind: 'chorus', impact: true },
      { name: 'Outro', bars: 4, energy: 0.25, kind: 'outro' },
    ],
  },
  evolve: {
    blurb: 'Slow evolving form for ambient and cinematic pieces (~56 bars)',
    sections: [
      { name: 'Opening', bars: 8, energy: 0.2, kind: 'intro' },
      { name: 'Rise', bars: 16, energy: 0.45, kind: 'verse' },
      { name: 'Bloom', bars: 16, energy: 0.75, kind: 'chorus' },
      { name: 'Fade', bars: 8, energy: 0.3, kind: 'break' },
      { name: 'Close', bars: 8, energy: 0.15, kind: 'outro' },
    ],
  },
  loop: {
    blurb: 'A single 8-bar loop at full energy',
    sections: [{ name: 'Loop', bars: 8, energy: 0.8, kind: 'verse' }],
  },
};

export const DEFAULT_STRUCTURE = { house: 'edm', techno: 'edm', trance: 'edm', dnb: 'edm', trap: 'standard', hiphop: 'chill', lofi: 'chill', pop: 'standard', rock: 'standard', synthwave: 'standard', funk: 'standard', ambient: 'evolve' };

/**
 * Which roles play in a section of a given kind: a role listed here is heard (further limited by the energy
 * thresholds of the drum lanes). Missing roles are simply skipped.
 */
export const SECTION_ROLES = {
  intro: ['kick', 'hat', 'perc', 'pad', 'chords', 'arp', 'fx'],
  verse: ['kick', 'snare', 'clap', 'hat', 'perc', 'tom', 'bass', 'chords', 'pad', 'lead'],
  build: ['kick', 'snare', 'clap', 'hat', 'perc', 'tom', 'bass', 'chords', 'arp', 'pad', 'fx'],
  chorus: ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc', 'tom', 'crash', 'ride', 'bass', 'chords', 'pad', 'arp', 'lead'],
  drop: ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc', 'tom', 'crash', 'ride', 'bass', 'chords', 'arp', 'lead', 'pad'],
  break: ['pad', 'chords', 'arp', 'lead', 'fx', 'perc'],
  outro: ['kick', 'hat', 'perc', 'pad', 'chords', 'bass'],
};

// ---------------------------------------------------------------------------
// Mixing knowledge per role: where it sits in level, pan and tone, and how much space it gets.
//   vol      mixer fader (0.8 = 0 dB)     pan  -1..1     hp  high-pass (Hz) to clear the low end   send  [reverb, delay] 0-1
//   rel      target loudness relative to the whole mix (dB), used when balancing from renders
// ---------------------------------------------------------------------------
export const MIX_ROLES = {
  kick: { vol: 0.8, pan: 0, hp: 0, send: [0, 0], rel: -11, comp: { threshold: -14, ratio: 3, attack: 0.012, release: 0.12, gain: 2 } },
  snare: { vol: 0.74, pan: 0, hp: 90, send: [0.22, 0], rel: -10, comp: { threshold: -16, ratio: 3, attack: 0.008, release: 0.1, gain: 2 } },
  clap: { vol: 0.7, pan: 0.05, hp: 200, send: [0.28, 0], rel: -13 },
  hat: { vol: 0.62, pan: 0.22, hp: 400, send: [0.05, 0], rel: -18 },
  openhat: { vol: 0.58, pan: -0.2, hp: 400, send: [0.1, 0], rel: -19 },
  perc: { vol: 0.6, pan: -0.3, hp: 250, send: [0.18, 0.1], rel: -19 },
  tom: { vol: 0.7, pan: 0, hp: 60, send: [0.2, 0], rel: -15 },
  crash: { vol: 0.6, pan: 0.3, hp: 300, send: [0.25, 0], rel: -18 },
  ride: { vol: 0.58, pan: 0.3, hp: 300, send: [0.15, 0], rel: -19 },
  drums: { vol: 0.74, pan: 0, hp: 0, send: [0.1, 0], rel: -7 },
  bass: { vol: 0.76, pan: 0, hp: 0, send: [0, 0], rel: -7, comp: { threshold: -18, ratio: 4, attack: 0.02, release: 0.15, gain: 3 } },
  chords: { vol: 0.64, pan: -0.15, hp: 120, send: [0.22, 0], rel: -9 },
  stabs: { vol: 0.62, pan: -0.1, hp: 150, send: [0.25, 0.15], rel: -11 },
  pad: { vol: 0.56, pan: 0, hp: 150, send: [0.35, 0], rel: -12, width: 1.35 },
  arp: { vol: 0.58, pan: 0.25, hp: 180, send: [0.25, 0.3], rel: -13 },
  lead: { vol: 0.7, pan: 0.08, hp: 160, send: [0.28, 0.22], rel: -8 },
  fx: { vol: 0.55, pan: 0, hp: 200, send: [0.2, 0], rel: -16 },
};
