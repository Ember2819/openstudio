// Standard MIDI File (type 0/1) reader and importer.
import { STEPS_PER_BEAT, STEPS_PER_BAR } from './state.js';
import { GM_FAMILIES } from './audio/sf2.js';

const GM_NAMES_FALLBACK = (program) => `${GM_FAMILIES[program >> 3] ?? 'Instrument'} ${program + 1}`;

/**
 * Parse a Standard MIDI File.
 * Returns { format, division, tempo (µs per quarter, first one), timeSig: [num, den] | null,
 *           tracks: [{ name, notes: [{ tick, dur, key, vel, ch }], programs: Map(ch -> program) }] }
 */
export function parseMidi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let pos = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[pos + i]); return s; };
  const u32 = () => { const v = ((b[pos] << 24) >>> 0) + (b[pos + 1] << 16) + (b[pos + 2] << 8) + b[pos + 3]; pos += 4; return v; };
  const u16 = () => { const v = (b[pos] << 8) | b[pos + 1]; pos += 2; return v; };
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) { const c = b[pos++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
    return v;
  };

  // some files carry a RIFF ("RMID") wrapper
  if (str(4) === 'RIFF') {
    pos = 12;
    while (pos < b.length - 8 && str(4) !== 'data') { pos += 4; pos += u32(); }
    pos += 8;
  }
  if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
  pos += 4;
  const hlen = u32();
  const hstart = pos;
  const format = u16();
  const ntracks = u16();
  const division = u16();
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  pos = hstart + hlen;

  let tempo = null;
  let timeSig = null;
  const tracks = [];
  for (let t = 0; t < ntracks && pos + 8 <= b.length; t++) {
    const id = str(4);
    pos += 4;
    const len = u32();
    const end = Math.min(b.length, pos + len);
    if (id !== 'MTrk') { pos = end; continue; }
    const track = { name: '', notes: [], programs: new Map() };
    const open = new Map(); // `${ch}:${key}` -> [note, ...] (stacked note-ons)
    let tick = 0;
    let running = 0;
    while (pos < end) {
      tick += vlq();
      let status = b[pos];
      if (status & 0x80) pos++; else status = running; // running status
      if (status === 0xff) {
        const type = b[pos++];
        const l = vlq();
        if (type === 0x03 && !track.name) track.name = new TextDecoder().decode(b.subarray(pos, pos + l)).replace(/\0/g, '').trim();
        else if (type === 0x51 && tempo == null && l === 3) tempo = (b[pos] << 16) | (b[pos + 1] << 8) | b[pos + 2];
        else if (type === 0x58 && !timeSig && l >= 2) timeSig = [b[pos], 2 ** b[pos + 1]];
        pos += l;
        if (type === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { const l = vlq(); pos += l; continue; }
      running = status;
      const cmd = status & 0xf0;
      const ch = status & 0x0f;
      const d1 = b[pos++];
      const d2 = cmd === 0xc0 || cmd === 0xd0 ? 0 : b[pos++];
      const key = `${ch}:${d1}`;
      if (cmd === 0x90 && d2 > 0) {
        const n = { tick, dur: 0, key: d1, vel: d2, ch };
        track.notes.push(n);
        if (!open.has(key)) open.set(key, []);
        open.get(key).push(n);
      } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
        const n = open.get(key)?.shift();
        if (n) n.dur = tick - n.tick;
      } else if (cmd === 0xc0) {
        if (!track.programs.has(ch)) track.programs.set(ch, d1);
      }
    }
    // notes never released last until the end of the track
    for (const list of open.values()) for (const n of list) if (!n.dur) n.dur = Math.max(1, tick - n.tick);
    tracks.push(track);
    pos = end;
  }
  return { format, division, tempo, timeSig, tracks };
}

/**
 * Import a parsed MIDI file into the project: one channel per (track, MIDI channel) and one pattern holding all
 * of them (like FL Studio's MIDI import). Drums (MIDI channel 10) become a full drum-kit channel.
 * Returns the new pattern. Call store.checkpoint() first if it should be undoable.
 */
export function importMidi(store, midi, { name = 'MIDI import', setTempo = true, maxChannels = 64 } = {}) {
  const proj = store.project;
  const toStep = (tick) => (tick / midi.division) * STEPS_PER_BEAT;
  const groups = new Map(); // `${track}:${ch}` -> { track, ch, notes }
  midi.tracks.forEach((tr, ti) => {
    for (const n of tr.notes) {
      const k = `${ti}:${n.ch}`;
      if (!groups.has(k)) groups.set(k, { tr, ch: n.ch, notes: [] });
      groups.get(k).notes.push(n);
    }
  });
  if (!groups.size) throw new Error('The MIDI file contains no notes');

  const pat = store._addPattern(name);
  let end = 0;
  const mixerStart = store.freeMixerTrack?.() ?? null;
  let mixer = mixerStart;
  for (const { tr, ch, notes } of [...groups.values()].slice(0, maxChannels)) {
    const drums = ch === 9;
    const program = tr.programs.get(ch) ?? midi.tracks.find((t) => t.programs.has(ch))?.programs.get(ch) ?? 0;
    const label = tr.name || (drums ? 'Drums' : GM_NAMES_FALLBACK(program));
    const spec = drums
      ? { name: label, type: 'sf', bank: 128, program: 0, rootPitch: 36 }
      : { name: label, type: 'sf', bank: 0, program };
    if (mixer != null && mixer < proj.mixer.length) {
      spec.mixer = mixer;
      if (/^Insert \d+$/.test(proj.mixer[mixer].name)) proj.mixer[mixer].name = label;
      mixer = mixer + 1 < proj.mixer.length ? mixer + 1 : null;
    }
    const chan = store._addChannel(spec);
    pat.notes[chan.id] = notes.map((n) => {
      const s = toStep(n.tick);
      const l = Math.max(0.0625, toStep(n.tick + n.dur) - s);
      end = Math.max(end, s + l);
      return { p: n.key, s: Math.round(s * 1000) / 1000, l: Math.round(l * 1000) / 1000, v: Math.max(0.02, n.vel / 127) };
    });
  }
  pat.bars = Math.max(1, Math.ceil(end / STEPS_PER_BAR - 1e-6));
  if (setTempo && midi.tempo) proj.bpm = Math.min(522, Math.max(10, Math.round((60000000 / midi.tempo) * 1000) / 1000));
  proj.selected.pattern = pat.id;
  proj.selected.channel = proj.channels[proj.channels.length - 1]?.id ?? proj.selected.channel;
  return pat;
}
