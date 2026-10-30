// Standard MIDI File (type 1) writer.
import { validTimeSig } from './state.js';
import { TempoMap } from './tempo.js';

const PPQ = 96;
const TICKS_PER_STEP = PPQ / 4;

const vlq = (n) => {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const text = (s) => [...new TextEncoder().encode(s)];
/** Meta text event body: length is the UTF-8 byte count, not the JS string length. */
const metaText = (type, s) => { const b = text(s); return [0xff, type, ...vlq(b.length), ...b]; };

function chunk(id, data) {
  return [...text(id), ...u32(data.length), ...data];
}

/** Notes of one channel across the song (or the current pattern), in steps. */
function collectNotes(store, ch, song) {
  const out = [];
  const proj = store.project;
  if (!song) {
    for (const n of store.currentPattern.notes[ch.id] || []) out.push({ s: n.s, l: n.l, p: n.p, v: n.v });
    return out;
  }
  for (const clip of proj.playlist.clips) {
    if ((clip.type || 'pattern') !== 'pattern' || clip.mute || proj.playlist.tracks[clip.track]?.mute) continue;
    const pat = store.pattern(clip.pat);
    const list = pat?.notes[ch.id];
    if (!list) continue;
    const len = store.patternSteps(pat);
    const loops = Math.ceil((clip.len + clip.offset) / len) + 1;
    for (let k = 0; k < loops; k++) {
      for (const n of list) {
        const t = n.s - clip.offset + k * len;
        if (t < 0 || t >= clip.len) continue;
        out.push({ s: clip.start + t, l: Math.min(n.l, clip.len - t), p: n.p, v: n.v });
      }
    }
  }
  return out;
}

export function buildMidi(store, { song }) {
  const proj = store.project;
  const tracks = [];

  const tempoEvent = (bpm) => { const us = Math.round(60000000 / bpm); return [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255]; };
  const [num, den] = validTimeSig(proj.timeSig) ? proj.timeSig : [4, 4];
  const conductor = [
    0, ...metaText(0x03, proj.name),
    0, ...tempoEvent(proj.bpm),
    0, 0xff, 0x58, 0x04, num, Math.log2(den), 24, 8,
  ];
  // tempo automation becomes tempo changes (one per step where the tempo moves)
  const map = new TempoMap(store);
  if (song && map.varies) {
    let last = proj.bpm;
    let lastTick = 0;
    const end = store.playlistEndStep();
    for (let step = 0; step < end; step++) {
      const bpm = Math.round(map.bpm(step) * 1000) / 1000;
      if (Math.abs(bpm - last) < 0.001) continue;
      const tick = step * TICKS_PER_STEP;
      conductor.push(...vlq(tick - lastTick), ...tempoEvent(bpm));
      last = bpm;
      lastTick = tick;
    }
  }
  conductor.push(0, 0xff, 0x2f, 0x00);
  tracks.push(chunk('MTrk', conductor));

  let nextChannel = 0;
  for (const ch of proj.channels) {
    const notes = collectNotes(store, ch, song);
    if (!notes.length) continue;
    const isDrum = ch.type === 'sf' && ch.bank === 128;
    let midiCh;
    if (isDrum) midiCh = 9;
    else {
      // 16 channels minus the GM drum channel; wrap around rather than ever landing on 9
      midiCh = nextChannel % 15;
      if (midiCh >= 9) midiCh++;
      nextChannel++;
    }

    const events = [];
    for (const n of notes) {
      const key = Math.max(0, Math.min(127, isDrum && ch.fixedKey != null ? ch.fixedKey + (n.p - 60) : n.p));
      const vel = Math.max(1, Math.min(127, Math.round(n.v * 127)));
      events.push({ t: Math.round(n.s * TICKS_PER_STEP), order: 1, data: [0x90 | midiCh, key, vel] });
      events.push({ t: Math.max(Math.round((n.s + n.l) * TICKS_PER_STEP), Math.round(n.s * TICKS_PER_STEP) + 1), order: 0, data: [0x80 | midiCh, key, 0] });
    }
    events.sort((a, b) => a.t - b.t || a.order - b.order);

    const body = [0, ...metaText(0x03, ch.name)];
    if (ch.type === 'sf' && !isDrum) body.push(0, 0xc0 | midiCh, ch.program & 127);
    let last = 0;
    for (const e of events) { body.push(...vlq(e.t - last), ...e.data); last = e.t; }
    body.push(0, 0xff, 0x2f, 0x00);
    tracks.push(chunk('MTrk', body));
  }

  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)]);
  return new Uint8Array([...header, ...tracks.flat()]);
}
