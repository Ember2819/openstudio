import { ROOT_NOTE } from '../util.js';
import { CUSTOM_WAVES } from './dsp.js';
import { DRUMS, playDrum } from './drums.js';
import { playSynth, playFm, playOrgan, playPluck, DRAWBARS } from './synths.js';
import { playSfx, SFX, SFX_SOUNDS } from './sfx.js';

export { playDrum, playSynth, playFm, playOrgan, playPluck, playSfx };

// ---------------------------------------------------------------------------
// Parameter metadata (drives the channel settings window, defaults, automation and agent validation)
// ---------------------------------------------------------------------------
const pct = (v) => `${Math.round(v * 100)}%`;
const st = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} st`;
const ms = (v) => `${(v * 1000).toFixed(0)} ms`;
const hz = (v) => `${Math.round(v)} Hz`;

const DRUM_PARAMS = [
  { key: 'pitch', label: 'Pitch', min: -12, max: 12, def: 0, fmt: st },
  { key: 'decay', label: 'Decay', min: 0.2, max: 3, def: 1, fmt: (v) => `${(v * 100).toFixed(0)}%` },
  { key: 'tone', label: 'Tone', min: 0, max: 1, def: 0.85, fmt: pct },
];

const WAVES = ['sine', 'triangle', 'sawtooth', 'square', ...CUSTOM_WAVES];
const SYNTH_PARAMS = [
  { key: 'wave1', label: 'Osc 1', type: 'select', options: WAVES, def: 'sawtooth' },
  { key: 'wave2', label: 'Osc 2', type: 'select', options: WAVES, def: 'square' },
  { key: 'mix', label: 'Osc 2 mix', min: 0, max: 1, def: 0.4, fmt: pct },
  { key: 'detune', label: 'Detune', min: -100, max: 100, def: 8, fmt: (v) => `${v.toFixed(0)} ct` },
  { key: 'octave2', label: 'Osc 2 oct', min: -2, max: 2, def: 0, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'unison', label: 'Unison', min: 1, max: 7, def: 1, step: 1, fmt: (v) => `${v} voice${v > 1 ? 's' : ''}` },
  { key: 'spread', label: 'Spread', min: 0, max: 60, def: 16, fmt: (v) => `${v.toFixed(0)} ct` },
  { key: 'sub', label: 'Sub osc', min: 0, max: 1, def: 0, fmt: pct },
  { key: 'noise', label: 'Noise', min: 0, max: 1, def: 0, fmt: pct },
  { key: 'cutoff', label: 'Cutoff', min: 60, max: 18000, def: 4200, log: true, fmt: hz },
  { key: 'res', label: 'Resonance', min: 0.1, max: 18, def: 1.5, fmt: (v) => v.toFixed(1) },
  { key: 'slope', label: 'Filter slope', type: 'select', options: ['12 dB', '24 dB'], def: '12 dB' },
  { key: 'keytrack', label: 'Key track', min: 0, max: 1, def: 0.3, fmt: pct },
  { key: 'envAmt', label: 'Filter env', min: 0, max: 1, def: 0.35, fmt: pct },
  { key: 'drive', label: 'Drive', min: 0, max: 1, def: 0, fmt: pct },
  { key: 'attack', label: 'Attack', min: 0.001, max: 2, def: 0.01, log: true, fmt: ms },
  { key: 'decay', label: 'Decay', min: 0.01, max: 3, def: 0.25, log: true, fmt: ms },
  { key: 'sustain', label: 'Sustain', min: 0, max: 1, def: 0.6, fmt: pct },
  { key: 'release', label: 'Release', min: 0.005, max: 4, def: 0.18, log: true, fmt: ms },
  { key: 'vibrato', label: 'Vibrato', min: 0, max: 1, def: 0, fmt: pct },
  { key: 'wobble', label: 'Filter LFO', min: 0, max: 1, def: 0, fmt: pct },
  { key: 'lfoRate', label: 'LFO rate', min: 0.1, max: 12, def: 5, log: true, fmt: (v) => `${v.toFixed(2)} Hz` },
];

const FM_PARAMS = [
  { key: 'cratio', label: 'Carrier ratio', min: 0.25, max: 8, def: 1, log: true, fmt: (v) => `×${v.toFixed(2)}` },
  { key: 'ratio', label: 'Mod 1 ratio', min: 0.25, max: 16, def: 2, log: true, fmt: (v) => `×${v.toFixed(2)}` },
  { key: 'index', label: 'Mod 1 index', min: 0, max: 12, def: 3, fmt: (v) => v.toFixed(2) },
  { key: 'ratio2', label: 'Mod 2 ratio', min: 0.25, max: 16, def: 1, log: true, fmt: (v) => `×${v.toFixed(2)}` },
  { key: 'index2', label: 'Mod 2 index', min: 0, max: 8, def: 0, fmt: (v) => v.toFixed(2) },
  { key: 'indexDecay', label: 'Index decay', min: 0.02, max: 4, def: 0.5, log: true, fmt: ms },
  { key: 'indexSus', label: 'Index sustain', min: 0, max: 1, def: 0.3, fmt: pct },
  { key: 'velSens', label: 'Velocity → index', min: 0, max: 1, def: 0.5, fmt: pct },
  { key: 'attack', label: 'Attack', min: 0.001, max: 2, def: 0.003, log: true, fmt: ms },
  { key: 'decay', label: 'Decay', min: 0.02, max: 4, def: 0.9, log: true, fmt: ms },
  { key: 'sustain', label: 'Sustain', min: 0, max: 1, def: 0.2, fmt: pct },
  { key: 'release', label: 'Release', min: 0.005, max: 4, def: 0.3, log: true, fmt: ms },
  { key: 'trem', label: 'Tremolo', min: 0, max: 1, def: 0, fmt: pct },
  { key: 'tremRate', label: 'Trem rate', min: 0.5, max: 12, def: 5, log: true, fmt: (v) => `${v.toFixed(2)} Hz` },
  { key: 'cutoff', label: 'Low-pass', min: 200, max: 20000, def: 20000, log: true, fmt: (v) => (v >= 19999 ? 'Open' : hz(v)) },
];

const ORGAN_PARAMS = [
  ...DRAWBARS.map((d) => ({ key: d.key, label: d.label, min: 0, max: 8, def: d.key === 'd8' ? 8 : d.key === 'd16' || d.key === 'd4' ? 6 : 0, step: 1, fmt: (v) => String(Math.round(v)) })),
  { key: 'perc', label: 'Percussion', type: 'select', options: ['off', '2nd', '3rd'], def: 'off' },
  { key: 'click', label: 'Key click', min: 0, max: 1, def: 0.25, fmt: pct },
  { key: 'rotor', label: 'Rotary', type: 'select', options: ['off', 'slow', 'fast'], def: 'slow' },
  { key: 'rotorDepth', label: 'Rotary depth', min: 0, max: 1, def: 0.5, fmt: pct },
  { key: 'attack', label: 'Attack', min: 0.002, max: 0.3, def: 0.006, log: true, fmt: ms },
  { key: 'release', label: 'Release', min: 0.01, max: 1.5, def: 0.07, log: true, fmt: ms },
];

const PLUCK_PARAMS = [
  { key: 'decay', label: 'Ring time', min: 0.15, max: 8, def: 2, log: true, fmt: (v) => `${v.toFixed(2)} s` },
  { key: 'bright', label: 'Brightness', min: 0, max: 1, def: 0.6, fmt: pct },
  { key: 'damp', label: 'Damping', min: 0, max: 1, def: 0.4, fmt: pct },
  { key: 'pick', label: 'Pick position', min: 0.05, max: 0.5, def: 0.2, fmt: pct },
  { key: 'body', label: 'Body', min: 0, max: 1, def: 0.3, fmt: pct },
  { key: 'release', label: 'Release', min: 0.02, max: 2, def: 0.35, log: true, fmt: ms },
];

const SFX_PARAMS = [
  { key: 'sound', label: 'Sound', type: 'select', options: SFX_SOUNDS, labels: Object.fromEntries(Object.entries(SFX).map(([k, v]) => [k, v.label])), def: 'riser' },
  { key: 'length', label: 'Length', min: 0.2, max: 16, def: 3, log: true, fmt: (v) => `${v.toFixed(2)} s` },
  { key: 'follow', label: 'Length = note', type: 'toggle', def: true },
  { key: 'pitch', label: 'Pitch', min: -24, max: 24, def: 0, fmt: st },
  { key: 'tone', label: 'Brightness', min: 0, max: 1, def: 0.5, fmt: pct },
];

const SAMPLER_PARAMS = [
  { key: 'pitch', label: 'Pitch', min: -12, max: 12, def: 0, fmt: st },
  { key: 'start', label: 'Start', min: 0, max: 0.95, def: 0, fmt: pct },
  { key: 'attack', label: 'Attack', min: 0.001, max: 1, def: 0.002, log: true, fmt: ms },
  { key: 'release', label: 'Release', min: 0.005, max: 2, def: 0.05, log: true, fmt: ms },
  { key: 'cutoff', label: 'Cutoff', min: 100, max: 20000, def: 20000, log: true, fmt: hz },
  { key: 'gate', label: 'Gate', type: 'toggle', def: false },
  { key: 'reverse', label: 'Reverse', type: 'toggle', def: false },
];

const SF_PARAMS = [
  { key: 'tune', label: 'Tune', min: -12, max: 12, def: 0, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} st` },
  { key: 'attack', label: 'Attack', min: 0, max: 1.5, def: 0, fmt: (v) => `+${(v * 1000).toFixed(0)} ms` },
  { key: 'release', label: 'Release', min: 0.1, max: 4, def: 1, log: true, fmt: (v) => `${v.toFixed(2)}x` },
  { key: 'cutoff', label: 'Low-pass', min: 200, max: 20000, def: 20000, log: true, fmt: (v) => (v >= 19999 ? 'Open' : hz(v)) },
];

export const PARAM_META = { drum: DRUM_PARAMS, synth: SYNTH_PARAMS, fm: FM_PARAMS, organ: ORGAN_PARAMS, pluck: PLUCK_PARAMS, sfx: SFX_PARAMS, sampler: SAMPLER_PARAMS, sf: SF_PARAMS };

export function defaultParams(type) {
  const out = {};
  for (const m of PARAM_META[type] || []) out[m.key] = m.def;
  return out;
}

/** The built-in generator channel types: label for menus and the settings window, icon, and a one-line description. */
export const ENGINES = {
  synth: { label: 'Synth', icon: 'synth', blurb: 'Subtractive synth: two oscillators, unison, sub, filter, LFO' },
  fm: { label: 'FM Synth', icon: 'synth', blurb: 'Three-operator FM: electric pianos, bells, mallets, bass' },
  organ: { label: 'Organ', icon: 'keys', blurb: 'Tonewheel organ with drawbars, percussion and rotary speaker' },
  pluck: { label: 'Plucked String', icon: 'wave', blurb: 'Physically modelled strings: guitar, harp, koto, banjo, bass' },
  sfx: { label: 'Sound FX', icon: 'wave', blurb: 'Risers, impacts, sweeps, textures and one-shot effects' },
};

// ---------------------------------------------------------------------------
// Presets shown in the browser and the agent catalogue
// ---------------------------------------------------------------------------
export const DRUM_KIT = [
  { name: 'Kick', voice: 'kick' },
  { name: 'Kick 808', voice: 'kick808' },
  { name: 'Punch Kick', voice: 'kickpunch' },
  { name: 'Snare', voice: 'snare' },
  { name: 'Snare 808', voice: 'snare808' },
  { name: 'Fat Snare', voice: 'snarefat' },
  { name: 'Clap', voice: 'clap' },
  { name: 'Snap', voice: 'snap' },
  { name: 'Rimshot', voice: 'rimshot' },
  { name: 'Rim', voice: 'rim' },
  { name: 'Closed Hat', voice: 'hat' },
  { name: 'Open Hat', voice: 'openhat' },
  { name: 'Pedal Hat', voice: 'hatpedal' },
  { name: 'Tom', voice: 'tom' },
  { name: 'Conga', voice: 'conga' },
  { name: 'Bongo', voice: 'bongo' },
  { name: 'Cowbell', voice: 'cowbell' },
  { name: 'Wood Block', voice: 'woodblock' },
  { name: 'Crash', voice: 'crash' },
  { name: 'Ride', voice: 'ride' },
  { name: 'Ride Bell', voice: 'ridebell' },
  { name: 'Shaker', voice: 'shaker' },
  { name: 'Cabasa', voice: 'cabasa' },
  { name: 'Tambourine', voice: 'tambourine' },
  { name: 'Triangle', voice: 'triangle' },
  { name: 'Clave', voice: 'clave' },
];

export const SYNTH_PRESETS = {
  Bass: [
    { name: 'Sub Bass', params: { wave1: 'sine', wave2: 'triangle', mix: 0.25, detune: 0, octave2: -1, cutoff: 1400, res: 0.7, envAmt: 0.1, attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.1 } },
    { name: 'Saw Bass', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.5, detune: 12, octave2: -1, cutoff: 900, res: 4, envAmt: 0.65, attack: 0.004, decay: 0.22, sustain: 0.35, release: 0.1 } },
    { name: 'Pluck Bass', params: { wave1: 'square', wave2: 'sawtooth', mix: 0.3, detune: 5, octave2: 0, cutoff: 700, res: 6, envAmt: 0.9, attack: 0.002, decay: 0.14, sustain: 0.0, release: 0.08 } },
    { name: 'Acid Bass', params: { wave1: 'sawtooth', wave2: 'square', mix: 0.2, detune: 3, octave2: -1, cutoff: 480, res: 9, slope: '24 dB', envAmt: 0.95, attack: 0.002, decay: 0.18, sustain: 0.0, release: 0.06 } },
    { name: 'Dark Repeater', params: { wave1: 'square', wave2: 'square', mix: 0.45, detune: -9, octave2: -1, cutoff: 1100, res: 2.5, envAmt: 0.35, attack: 0.01, decay: 0.3, sustain: 0.55, release: 0.15 } },
    { name: '808 Sub', params: { wave1: 'sine', wave2: 'sine', mix: 0, sub: 0.55, drive: 0.35, cutoff: 1200, res: 0.5, envAmt: 0.05, keytrack: 0, attack: 0.003, decay: 0.7, sustain: 0.75, release: 0.25 } },
    { name: 'Reese Bass', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.9, detune: 22, octave2: 0, unison: 3, spread: 18, sub: 0.5, cutoff: 560, res: 1.2, slope: '24 dB', keytrack: 0.2, envAmt: 0.12, drive: 0.3, attack: 0.01, decay: 0.4, sustain: 0.9, release: 0.15, wobble: 0.1, lfoRate: 0.35 } },
    { name: 'Wobble Bass', params: { wave1: 'sawtooth', wave2: 'square', mix: 0.5, detune: 6, octave2: -1, sub: 0.4, cutoff: 800, res: 5, slope: '24 dB', keytrack: 0.1, envAmt: 0.1, drive: 0.25, attack: 0.005, decay: 0.3, sustain: 0.95, release: 0.12, wobble: 0.5, lfoRate: 2.5 } },
    { name: 'Moog Bass', params: { wave1: 'sawtooth', wave2: 'square', mix: 0.6, detune: 4, octave2: -1, sub: 0.3, cutoff: 420, res: 7, slope: '24 dB', keytrack: 0.5, envAmt: 0.8, attack: 0.002, decay: 0.3, sustain: 0.25, release: 0.1 } },
    { name: 'Rubber Bass', params: { wave1: 'pulse25', wave2: 'square', mix: 0.35, detune: 3, octave2: -1, sub: 0.25, cutoff: 520, res: 3.5, slope: '24 dB', keytrack: 0.4, envAmt: 0.9, attack: 0.002, decay: 0.2, sustain: 0.1, release: 0.1 } },
  ],
  Leads: [
    { name: 'Saw Lead', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.6, detune: 14, octave2: 0, cutoff: 6500, res: 2, envAmt: 0.3, attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.2 } },
    { name: 'Square Lead', params: { wave1: 'square', wave2: 'square', mix: 0.4, detune: 7, octave2: 1, cutoff: 5200, res: 1.2, envAmt: 0.2, attack: 0.008, decay: 0.15, sustain: 0.75, release: 0.15 } },
    { name: 'Soft Sine', params: { wave1: 'sine', wave2: 'triangle', mix: 0.35, detune: 4, octave2: 1, cutoff: 9000, res: 0.5, envAmt: 0, attack: 0.02, decay: 0.3, sustain: 0.8, release: 0.3 } },
    { name: 'Supersaw', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.2, detune: 10, octave2: 0, unison: 5, spread: 40, cutoff: 7200, res: 1, envAmt: 0.25, attack: 0.02, decay: 0.3, sustain: 0.8, release: 0.35 } },
    { name: 'Whistle', params: { wave1: 'sine', wave2: 'sine', mix: 0.3, detune: 6, octave2: 1, cutoff: 12000, res: 2.5, envAmt: 0.1, attack: 0.015, decay: 0.2, sustain: 0.85, release: 0.25, vibrato: 0.35, lfoRate: 5.5 } },
    { name: 'Pulse Lead', params: { wave1: 'pulse25', wave2: 'pulse12', mix: 0.5, detune: 9, octave2: 0, unison: 2, spread: 12, cutoff: 5200, res: 2.5, keytrack: 0.5, envAmt: 0.35, attack: 0.01, decay: 0.25, sustain: 0.7, release: 0.2, vibrato: 0.25, lfoRate: 5.2 } },
    { name: 'Trance Lead', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.5, detune: 12, octave2: 0, unison: 5, spread: 30, sub: 0.15, cutoff: 7500, res: 1.5, keytrack: 0.4, envAmt: 0.3, drive: 0.2, attack: 0.008, decay: 0.25, sustain: 0.8, release: 0.3 } },
    { name: 'Vocal Lead', params: { wave1: 'vocal', wave2: 'reed', mix: 0.3, detune: 5, octave2: 0, noise: 0.04, cutoff: 5500, res: 1.2, keytrack: 0.6, envAmt: 0.15, attack: 0.05, decay: 0.3, sustain: 0.8, release: 0.3, vibrato: 0.35, lfoRate: 5.6 } },
    { name: 'Reed Lead', params: { wave1: 'reed', wave2: 'hollow', mix: 0.45, detune: 3, octave2: 0, cutoff: 4200, res: 1, keytrack: 0.6, envAmt: 0.25, attack: 0.03, decay: 0.2, sustain: 0.8, release: 0.18, vibrato: 0.3, lfoRate: 5 } },
    { name: 'Glass Lead', params: { wave1: 'glass', wave2: 'sine', mix: 0.3, detune: 4, octave2: 1, cutoff: 9500, res: 1, keytrack: 0.5, envAmt: 0.1, attack: 0.02, decay: 0.3, sustain: 0.75, release: 0.4, vibrato: 0.2, lfoRate: 5.2 } },
  ],
  Pads: [
    { name: 'Warm Pad', params: { wave1: 'sawtooth', wave2: 'triangle', mix: 0.5, detune: 9, octave2: 0, cutoff: 1800, res: 0.8, envAmt: 0.25, attack: 0.5, decay: 0.8, sustain: 0.75, release: 1.2 } },
    { name: 'Glass Pad', params: { wave1: 'triangle', wave2: 'sine', mix: 0.55, detune: 7, octave2: 1, cutoff: 7000, res: 0.6, envAmt: 0.1, attack: 0.7, decay: 1, sustain: 0.8, release: 1.5 } },
    { name: 'Dark Pad', params: { wave1: 'sawtooth', wave2: 'square', mix: 0.35, detune: 5, octave2: -1, cutoff: 850, res: 1.2, envAmt: 0.3, attack: 1.2, decay: 1.5, sustain: 0.7, release: 2.5 } },
    { name: 'Choir Pad', params: { wave1: 'triangle', wave2: 'triangle', mix: 0.5, detune: 12, octave2: 0, unison: 3, spread: 22, cutoff: 3200, res: 0.7, envAmt: 0.15, attack: 0.6, decay: 1, sustain: 0.85, release: 2 } },
    { name: 'String Pad', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.6, detune: 8, octave2: 0, unison: 5, spread: 22, cutoff: 2800, res: 0.7, keytrack: 0.4, envAmt: 0.2, attack: 0.55, decay: 1, sustain: 0.85, release: 1.2, vibrato: 0.12, lfoRate: 5.2 } },
    { name: 'Vocal Pad', params: { wave1: 'vocal', wave2: 'vocal', mix: 0.5, detune: 9, octave2: 0, unison: 3, spread: 18, noise: 0.05, cutoff: 4500, res: 0.6, envAmt: 0.1, attack: 0.8, decay: 1, sustain: 0.85, release: 1.6, vibrato: 0.15, lfoRate: 4.8 } },
    { name: 'Analog Pad', params: { wave1: 'sawtooth', wave2: 'pulse25', mix: 0.6, detune: 7, octave2: 0, unison: 2, spread: 14, cutoff: 1500, res: 1.5, keytrack: 0.3, envAmt: 0.2, attack: 0.9, decay: 1.2, sustain: 0.8, release: 2, wobble: 0.08, lfoRate: 0.2 } },
    { name: 'Dream Pad', params: { wave1: 'glass', wave2: 'sine', mix: 0.5, detune: 6, octave2: 1, unison: 3, spread: 16, cutoff: 6500, res: 0.6, envAmt: 0.1, attack: 1.1, decay: 1.4, sustain: 0.85, release: 2.5, vibrato: 0.2, lfoRate: 4.5 } },
    { name: 'Evolving Drone', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.7, detune: 6, octave2: -1, unison: 3, spread: 8, sub: 0.5, cutoff: 380, res: 3, slope: '24 dB', envAmt: 0.1, attack: 2, decay: 2, sustain: 1, release: 3, wobble: 0.15, lfoRate: 0.1 } },
  ],
  Keys: [
    { name: 'E Piano', params: { wave1: 'sine', wave2: 'triangle', mix: 0.3, detune: 2, octave2: 0, cutoff: 2500, res: 1.5, envAmt: 0.4, attack: 0.002, decay: 0.5, sustain: 0.15, release: 0.25 } },
    { name: 'Clav', params: { wave1: 'square', wave2: 'sawtooth', mix: 0.4, detune: 4, octave2: 0, cutoff: 1800, res: 5, envAmt: 0.8, attack: 0.001, decay: 0.2, sustain: 0.2, release: 0.1 } },
    { name: 'Wurli', params: { wave1: 'hollow', wave2: 'triangle', mix: 0.35, detune: 3, octave2: 1, cutoff: 3200, res: 1.2, keytrack: 0.5, envAmt: 0.45, attack: 0.002, decay: 0.6, sustain: 0.1, release: 0.2 } },
    { name: 'Synth Keys', params: { wave1: 'pulse25', wave2: 'sawtooth', mix: 0.3, detune: 7, octave2: 0, unison: 2, spread: 10, cutoff: 3600, res: 1.5, keytrack: 0.5, envAmt: 0.5, attack: 0.004, decay: 0.4, sustain: 0.35, release: 0.25 } },
  ],
  Stabs: [
    { name: 'House Stab', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.6, detune: 14, octave2: 0, unison: 3, spread: 20, cutoff: 2600, res: 3, keytrack: 0.4, envAmt: 0.85, attack: 0.002, decay: 0.18, sustain: 0.0, release: 0.12 } },
    { name: 'Rave Stab', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.7, detune: 30, octave2: 0, unison: 5, spread: 45, cutoff: 3500, res: 2, keytrack: 0.3, envAmt: 0.6, drive: 0.5, attack: 0.004, decay: 0.3, sustain: 0.2, release: 0.2 } },
    { name: 'Disco Stab', params: { wave1: 'sawtooth', wave2: 'square', mix: 0.4, detune: 6, octave2: 0, unison: 2, spread: 10, cutoff: 3200, res: 1.5, keytrack: 0.5, envAmt: 0.55, attack: 0.012, decay: 0.2, sustain: 0.3, release: 0.15 } },
  ],
  Arps: [
    { name: 'Arp Saw', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.3, detune: 8, octave2: 0, cutoff: 3000, res: 2.5, keytrack: 0.5, envAmt: 0.6, attack: 0.002, decay: 0.14, sustain: 0.1, release: 0.08 } },
    { name: 'Arp Pulse', params: { wave1: 'pulse25', wave2: 'pulse12', mix: 0.35, detune: 6, octave2: 1, cutoff: 3800, res: 2, keytrack: 0.5, envAmt: 0.5, attack: 0.002, decay: 0.16, sustain: 0.05, release: 0.08 } },
  ],
  Bells: [
    { name: 'FM Bell', params: { wave1: 'sine', wave2: 'sine', mix: 0.5, detune: 0, octave2: 2, cutoff: 14000, res: 0.5, envAmt: 0.05, attack: 0.001, decay: 1.2, sustain: 0.0, release: 0.8 } },
    { name: 'Music Box', params: { wave1: 'triangle', wave2: 'sine', mix: 0.25, detune: 0, octave2: 2, cutoff: 9000, res: 0.8, envAmt: 0.1, attack: 0.001, decay: 0.7, sustain: 0.0, release: 0.4 } },
  ],
  Brass: [
    { name: 'Brass Section', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.5, detune: 12, octave2: 0, cutoff: 2500, res: 1.5, envAmt: 0.5, attack: 0.06, decay: 0.4, sustain: 0.7, release: 0.3 } },
    { name: 'Soft Horn', params: { wave1: 'triangle', wave2: 'sawtooth', mix: 0.45, detune: 6, octave2: 0, cutoff: 1600, res: 1, envAmt: 0.35, attack: 0.09, decay: 0.5, sustain: 0.75, release: 0.4 } },
  ],
  Plucks: [
    { name: 'Soft Pluck', params: { wave1: 'triangle', wave2: 'sine', mix: 0.4, detune: 3, octave2: 1, cutoff: 3000, res: 1, envAmt: 0.6, attack: 0.002, decay: 0.3, sustain: 0.0, release: 0.2 } },
    { name: 'Bell Pluck', params: { wave1: 'sine', wave2: 'sine', mix: 0.5, detune: 0, octave2: 2, cutoff: 12000, res: 0.5, envAmt: 0.0, attack: 0.001, decay: 0.9, sustain: 0.0, release: 0.5 } },
    { name: 'Kalimba', params: { wave1: 'sine', wave2: 'triangle', mix: 0.2, detune: 1, octave2: 1, cutoff: 6000, res: 1.2, envAmt: 0.2, attack: 0.001, decay: 0.45, sustain: 0.0, release: 0.25 } },
    { name: 'Trance Pluck', params: { wave1: 'sawtooth', wave2: 'square', mix: 0.4, detune: 10, octave2: 0, unison: 3, spread: 16, cutoff: 1500, res: 2, keytrack: 0.5, envAmt: 0.9, attack: 0.002, decay: 0.2, sustain: 0.0, release: 0.12 } },
    { name: 'Marimba Synth', params: { wave1: 'sine', wave2: 'triangle', mix: 0.3, detune: 0, octave2: 2, cutoff: 5000, res: 0.8, keytrack: 0.6, envAmt: 0.3, attack: 0.001, decay: 0.5, sustain: 0.0, release: 0.2 } },
  ],
};

export const FM_PRESETS = {
  Keys: [
    { name: 'FM E-Piano', params: { cratio: 1, ratio: 1, index: 1.6, ratio2: 14, index2: 0.15, indexDecay: 0.6, indexSus: 0.25, velSens: 0.7, attack: 0.002, decay: 1.6, sustain: 0.1, release: 0.35 } },
    { name: 'Tine Piano', params: { cratio: 1, ratio: 1, index: 2.4, ratio2: 7, index2: 0.3, indexDecay: 0.35, indexSus: 0.15, velSens: 0.8, attack: 0.002, decay: 1.2, sustain: 0.08, release: 0.3, trem: 0.25, tremRate: 4.5 } },
    { name: 'FM Clav', params: { cratio: 1, ratio: 3, index: 4.5, indexDecay: 0.1, indexSus: 0.2, velSens: 0.6, attack: 0.001, decay: 0.3, sustain: 0.15, release: 0.1 } },
  ],
  Mallets: [
    { name: 'FM Marimba', params: { cratio: 1, ratio: 4, index: 1.8, indexDecay: 0.08, indexSus: 0.0, velSens: 0.6, attack: 0.001, decay: 0.7, sustain: 0.0, release: 0.25 } },
    { name: 'FM Vibraphone', params: { cratio: 1, ratio: 4, index: 1.0, indexDecay: 0.5, indexSus: 0.1, velSens: 0.5, attack: 0.001, decay: 2.4, sustain: 0.0, release: 0.8, trem: 0.55, tremRate: 5.5 } },
    { name: 'FM Kalimba', params: { cratio: 1, ratio: 5, index: 1.2, indexDecay: 0.05, indexSus: 0.0, velSens: 0.5, attack: 0.001, decay: 0.9, sustain: 0.0, release: 0.4 } },
  ],
  Bells: [
    { name: 'Bell', params: { cratio: 1, ratio: 3.5, index: 5.5, indexDecay: 2, indexSus: 0.1, velSens: 0.5, attack: 0.001, decay: 3.2, sustain: 0.0, release: 1.4 } },
    { name: 'Glass Bell', params: { cratio: 1, ratio: 7, index: 2.6, ratio2: 2, index2: 0.6, indexDecay: 1.4, indexSus: 0.1, velSens: 0.5, attack: 0.001, decay: 2.6, sustain: 0.0, release: 1.2 } },
    { name: 'Tubular Bell', params: { cratio: 1, ratio: 3.5, index: 3.2, ratio2: 5.1, index2: 0.8, indexDecay: 3, indexSus: 0.2, velSens: 0.4, attack: 0.001, decay: 4, sustain: 0.0, release: 2 } },
  ],
  Bass: [
    { name: 'FM Bass', params: { cratio: 1, ratio: 1, index: 4, indexDecay: 0.25, indexSus: 0.15, velSens: 0.5, attack: 0.002, decay: 0.3, sustain: 0.7, release: 0.12 } },
    { name: 'FM Slap Bass', params: { cratio: 1, ratio: 2, index: 5, ratio2: 1, index2: 0.8, indexDecay: 0.1, indexSus: 0.1, velSens: 0.8, attack: 0.001, decay: 0.35, sustain: 0.45, release: 0.1 } },
  ],
  Pads: [
    { name: 'FM Pad', params: { cratio: 1, ratio: 2, index: 1.2, ratio2: 1, index2: 0.4, indexDecay: 1.5, indexSus: 0.8, velSens: 0.2, attack: 0.7, decay: 1, sustain: 0.85, release: 1.4, trem: 0.1, tremRate: 3 } },
    { name: 'Metallic Pad', params: { cratio: 1, ratio: 3.01, index: 2.2, ratio2: 0.5, index2: 0.6, indexDecay: 2.5, indexSus: 0.6, velSens: 0.2, attack: 0.9, decay: 1.5, sustain: 0.8, release: 2, cutoff: 6000 } },
  ],
  Leads: [
    { name: 'FM Lead', params: { cratio: 1, ratio: 2, index: 3, ratio2: 1, index2: 1, indexDecay: 0.4, indexSus: 0.5, velSens: 0.4, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.2, cutoff: 9000 } },
    { name: 'FM Brass', params: { cratio: 1, ratio: 1, index: 4, indexDecay: 0.2, indexSus: 0.55, velSens: 0.6, attack: 0.05, decay: 0.4, sustain: 0.75, release: 0.25 } },
  ],
};

export const ORGAN_PRESETS = {
  Organs: [
    { name: 'Jazz Organ', params: { d16: 8, d513: 8, d8: 8, d4: 0, d223: 0, d2: 0, d135: 0, d113: 0, d1: 0, perc: '3rd', click: 0.3, rotor: 'slow', rotorDepth: 0.5 } },
    { name: 'Full Gospel', params: { d16: 8, d513: 8, d8: 8, d4: 8, d223: 8, d2: 8, d135: 8, d113: 8, d1: 8, perc: 'off', click: 0.2, rotor: 'fast', rotorDepth: 0.6 } },
    { name: 'Rock Organ', params: { d16: 8, d513: 4, d8: 8, d4: 8, d223: 0, d2: 0, d135: 0, d113: 0, d1: 5, perc: 'off', click: 0.35, rotor: 'fast', rotorDepth: 0.45 } },
    { name: 'Church', params: { d16: 6, d513: 0, d8: 8, d4: 0, d223: 6, d2: 0, d135: 0, d113: 0, d1: 0, perc: 'off', click: 0.05, rotor: 'off', rotorDepth: 0 } },
    { name: 'Soft Flute', params: { d16: 0, d513: 0, d8: 8, d4: 4, d223: 0, d2: 0, d135: 0, d113: 0, d1: 0, perc: 'off', click: 0.1, rotor: 'slow', rotorDepth: 0.3 } },
    { name: 'Percussive Pop', params: { d16: 0, d513: 0, d8: 8, d4: 8, d223: 0, d2: 0, d135: 0, d113: 0, d1: 0, perc: '2nd', click: 0.4, rotor: 'slow', rotorDepth: 0.35 } },
  ],
};

export const PLUCK_PRESETS = {
  Strings: [
    { name: 'Nylon Guitar', params: { decay: 1.8, bright: 0.45, damp: 0.45, pick: 0.18, body: 0.6, release: 0.25 } },
    { name: 'Steel Guitar', params: { decay: 2.6, bright: 0.8, damp: 0.25, pick: 0.12, body: 0.4, release: 0.3 } },
    { name: 'Harp', params: { decay: 4, bright: 0.55, damp: 0.3, pick: 0.3, body: 0.2, release: 1.2 } },
    { name: 'Koto', params: { decay: 2.5, bright: 0.85, damp: 0.15, pick: 0.08, body: 0.25, release: 0.6 } },
    { name: 'Banjo', params: { decay: 1, bright: 0.95, damp: 0.2, pick: 0.1, body: 0.1, release: 0.15 } },
    { name: 'Mandolin', params: { decay: 1.2, bright: 0.9, damp: 0.3, pick: 0.14, body: 0.3, release: 0.2 } },
    { name: 'Pizzicato', params: { decay: 0.35, bright: 0.5, damp: 0.6, pick: 0.3, body: 0.4, release: 0.08 } },
    { name: 'Upright Bass', params: { decay: 1.4, bright: 0.3, damp: 0.55, pick: 0.25, body: 0.7, release: 0.2 } },
  ],
};

export const SFX_PRESETS = {
  Risers: [
    { name: 'Riser', params: { sound: 'riser', length: 4, follow: true, pitch: 0, tone: 0.5 } },
    { name: 'Tonal Swell', params: { sound: 'swell', length: 4, follow: true, pitch: 0, tone: 0.5 } },
    { name: 'Reverse Crash', params: { sound: 'reverse_crash', length: 2, follow: true, pitch: 0, tone: 0.5 } },
    { name: 'Noise Sweep Up', params: { sound: 'sweep_up', length: 3, follow: true, pitch: 0, tone: 0.5 } },
  ],
  Falls: [
    { name: 'Downlifter', params: { sound: 'downlifter', length: 3, follow: true, pitch: 0, tone: 0.5 } },
    { name: 'Noise Sweep Down', params: { sound: 'sweep_down', length: 3, follow: true, pitch: 0, tone: 0.5 } },
    { name: 'Tape Stop', params: { sound: 'tape_stop', length: 1.2, follow: true, pitch: 0, tone: 0.5 } },
  ],
  Impacts: [
    { name: 'Impact', params: { sound: 'impact', length: 2, follow: false, pitch: 0, tone: 0.5 } },
    { name: 'Boom', params: { sound: 'boom', length: 3, follow: false, pitch: 0, tone: 0.4 } },
    { name: 'Bass Drop', params: { sound: 'bass_drop', length: 2, follow: false, pitch: 0, tone: 0.4 } },
  ],
  Hits: [
    { name: 'Laser', params: { sound: 'laser', length: 1, follow: false, pitch: 0, tone: 0.5 } },
    { name: 'Zap', params: { sound: 'zap', length: 1, follow: false, pitch: 0, tone: 0.5 } },
    { name: 'Water Droplet', params: { sound: 'droplet', length: 1, follow: false, pitch: 0, tone: 0.5 } },
  ],
  Ambience: [
    { name: 'Whoosh', params: { sound: 'whoosh', length: 1.6, follow: true, pitch: 0, tone: 0.5 } },
    { name: 'Wind', params: { sound: 'wind', length: 8, follow: true, pitch: 0, tone: 0.4 } },
    { name: 'Ocean Waves', params: { sound: 'ocean', length: 10, follow: true, pitch: 0, tone: 0.4 } },
    { name: 'Vinyl Crackle', params: { sound: 'vinyl', length: 12, follow: true, pitch: 0, tone: 0.5 } },
    { name: 'Sparkle', params: { sound: 'sparkle', length: 3, follow: true, pitch: 0, tone: 0.5 } },
    { name: 'Siren', params: { sound: 'siren', length: 3, follow: true, pitch: 0, tone: 0.5 } },
  ],
};

/** Presets of every generator, by channel type. */
export const ENGINE_PRESETS = { synth: SYNTH_PRESETS, fm: FM_PRESETS, organ: ORGAN_PRESETS, pluck: PLUCK_PRESETS, sfx: SFX_PRESETS };

/** Flat list of { type, category, name, params } across all generators. */
export const allEnginePresets = () => Object.entries(ENGINE_PRESETS).flatMap(([type, cats]) => Object.entries(cats).flatMap(([category, list]) => list.map((p) => ({ type, category, name: p.name, params: p.params }))));

export const DRUM_VOICES = Object.keys(DRUMS);

export function playSample(ctx, dest, buffer, pitch, t, dur, vel, semis, p) {
  const src = ctx.createBufferSource();
  src.buffer = p.reverse ? reversed(ctx, buffer) : buffer;
  src.playbackRate.value = Math.pow(2, (pitch - ROOT_NOTE + semis + (p.pitch || 0)) / 12);
  const g = ctx.createGain();
  const peak = 0.25 + vel * 0.75;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.max(p.attack, 0.001));
  let node = src;
  if (p.cutoff < 19500) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.cutoff;
    src.connect(lp);
    node = lp;
  }
  node.connect(g).connect(dest);
  const offset = buffer.duration * (p.start || 0);
  const natural = (buffer.duration - offset) / src.playbackRate.value;
  const voice = { nodes: [src], out: g, end: t + natural + 0.05, released: false };
  voice.release = (when) => {
    if (voice.released || !p.gate) return;
    voice.released = true;
    const rt = Math.max(when, t + 0.002);
    g.gain.cancelAndHoldAtTime(rt);
    g.gain.setTargetAtTime(0.0001, rt, Math.max(p.release, 0.01) / 3);
    src.stop(rt + p.release * 1.6 + 0.05);
    voice.end = rt + p.release * 1.6 + 0.05;
  };
  src.start(t, offset);
  if (p.gate && Number.isFinite(dur)) voice.release(t + dur);
  return voice;
}

const reverseCache = new WeakMap();
function reversed(ctx, buffer) {
  if (reverseCache.has(buffer)) return reverseCache.get(buffer);
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  reverseCache.set(buffer, out);
  return out;
}
