// A musical critic that works from the notes alone (an agent cannot listen): key, harmony, register, dynamics,
// repetition and arrangement problems, each with what to do about it. Pure functions over the project data.
import { noteName } from '../../util.js';
import { pcName, parseKey, scalePcs, QUALITIES } from './theory.js';
import { roleOf, isDrumRole } from './roles.js';

const BAR = 16;
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

/**
 * Notes of every channel as they play: in song mode the pattern clips of the playlist laid out in time, otherwise
 * the selected pattern. Returns { notes: Map(channelId -> [{p,s,l,v}]), steps }.
 */
export function flattenSong(store, song = store.project.mode === 'song') {
  const proj = store.project;
  const notes = new Map(proj.channels.map((c) => [c.id, []]));
  if (!song) {
    const pat = store.currentPattern;
    for (const [id, list] of Object.entries(pat.notes)) if (notes.has(Number(id))) notes.get(Number(id)).push(...list.filter((n) => !n.m).map((n) => ({ ...n })));
    return { notes, steps: store.patternSteps(pat) };
  }
  for (const clip of proj.playlist.clips) {
    if ((clip.type || 'pattern') !== 'pattern' || clip.mute || proj.playlist.tracks[clip.track]?.mute) continue;
    const pat = store.pattern(clip.pat);
    if (!pat) continue;
    const len = store.patternSteps(pat);
    const loops = Math.ceil((clip.len + clip.offset) / len) + 1;
    for (const [id, list] of Object.entries(pat.notes)) {
      const out = notes.get(Number(id));
      if (!out) continue;
      for (let k = 0; k < loops; k++) {
        for (const n of list) {
          if (n.m) continue;
          const t = n.s - clip.offset + k * len;
          if (t < 0 || t >= clip.len) continue;
          out.push({ p: n.p, s: clip.start + t, l: Math.min(n.l, clip.len - t), v: n.v });
        }
      }
    }
  }
  for (const list of notes.values()) list.sort((a, b) => a.s - b.s || a.p - b.p);
  const audible = proj.playlist.clips.filter((c) => !c.mute && !proj.playlist.tracks[c.track]?.mute);
  return { notes, steps: audible.reduce((end, c) => Math.max(end, c.start + c.len), 0) };
}

// Krumhansl-Schmuckler key profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function correlation(a, b) {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Best-fit major/minor key for a pitch-class histogram. */
export function detectKey(hist) {
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const [mode, profile] of [['major', MAJOR], ['minor', MINOR]]) {
      const rotated = profile.map((_, i) => profile[(i - root + 12) % 12]);
      const score = correlation(hist, rotated);
      if (!best || score > best.score) best = { root, mode, score };
    }
  }
  return best && { ...best, name: `${pcName(best.root)} ${best.mode}`, confidence: r2(best.score) };
}

/** Name the chord that best matches a set of pitch classes (weights by duration), or null. */
export function nameChord(weights, flats = false) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let best = null;
  const shapes = { '': QUALITIES.maj, m: QUALITIES.min, dim: QUALITIES.dim, aug: QUALITIES.aug, sus2: QUALITIES.sus2, sus4: QUALITIES.sus4, 7: QUALITIES[7], maj7: QUALITIES.maj7, m7: QUALITIES.m7 };
  for (let root = 0; root < 12; root++) {
    for (const [label, intervals] of Object.entries(shapes)) {
      const set = new Set(intervals.map((i) => (root + i) % 12));
      let inside = 0, outside = 0;
      weights.forEach((w, pc) => { if (set.has(pc)) inside += w; else outside += w; });
      const score = inside / total - outside / total * 1.4 - (set.size - 3) * 0.02 + (weights[root] / total) * 0.15;
      if (!best || score > best.score) best = { score, root, label };
    }
  }
  return best && best.score > 0.45 ? `${pcName(best.root, flats)}${best.label}` : null;
}

const NAME_OF = (p) => noteName(p);

/**
 * Analyse the project. Options: { key } the intended key (default: detected), { song } analyse song / pattern.
 */
export function critique(store, bpm, { key: keyText, song } = {}) {
  const proj = store.project;
  const { notes, steps } = flattenSong(store, song);
  const bars = Math.max(1, Math.ceil(steps / BAR - 1e-6));
  const seconds = (steps * 60) / bpm / 4;
  const warnings = [];
  const warn = (severity, area, message, fix) => warnings.push({ severity, area, message, ...(fix ? { fix } : {}) });

  const chans = proj.channels.map((ch) => ({ ch, role: roleOf(ch), list: notes.get(ch.id) ?? [] }));
  const pitched = chans.filter((c) => !isDrumRole(c.role) && c.role !== 'fx' && c.ch.type !== 'sampler');

  // ---- key ---------------------------------------------------------------------------------------------
  const hist = new Array(12).fill(0);
  for (const { list } of pitched) for (const n of list) hist[n.p % 12] += Math.min(n.l, 8) * (0.4 + n.v);
  const detected = hist.some((x) => x > 0) ? detectKey(hist) : null;
  let key = null;
  if (keyText) { try { key = parseKey(keyText); } catch (e) { warn('info', 'key', e.message); } }
  const useKey = key ?? (detected ? parseKey(detected.name) : null);
  let inKey = null;
  if (useKey) {
    const pcs = new Set(scalePcs(useKey));
    let inside = 0, total = 0;
    for (const { list, role } of pitched) {
      if (role === 'bass') continue; // approach notes are allowed to be chromatic
      for (const n of list) { total += n.l; if (pcs.has(n.p % 12)) inside += n.l; }
    }
    inKey = total ? inside / total : null;
    if (inKey !== null && inKey < 0.88) {
      warn('warning', 'harmony', `${Math.round((1 - inKey) * 100)}% of the pitched material is outside ${useKey.name}${key ? '' : ' (detected)'}.`, 'Use compose / music_theory so notes stay in key, or transpose the stray parts with transform_notes.');
    }
  }

  // ---- per channel ---------------------------------------------------------------------------------------
  const perChannel = chans.map(({ ch, role, list }) => {
    const info = { id: ch.id, name: ch.name, role, notes: list.length };
    if (!list.length) {
      warn('warning', 'arrangement', `"${ch.name}" has no notes in the ${proj.mode === 'song' ? 'song' : 'pattern'}.`, 'Write a part for it (compose / add_notes) or remove the channel.');
      return info;
    }
    const pitchesSeen = list.map((n) => n.p);
    const lowest = Math.min(...pitchesSeen), highest = Math.max(...pitchesSeen);
    const vels = list.map((n) => n.v);
    const activeBars = new Set();
    for (const n of list) for (let b = Math.floor(n.s / BAR); b <= Math.floor((n.s + n.l - 0.01) / BAR); b++) activeBars.add(b);
    Object.assign(info, {
      activeBars: activeBars.size, playsInPercentOfSong: Math.round((activeBars.size / bars) * 100),
      velocity: { mean: r2(mean(vels)), stdev: r2(stdev(vels)) },
      ...(isDrumRole(role) ? {} : { range: `${NAME_OF(lowest)}–${NAME_OF(highest)}`, lowest, highest }),
    });
    const sparseVelocity = isDrumRole(role) && !['hat', 'openhat', 'perc', 'ride'].includes(role); // a kick or clap is meant to be steady
    if (list.length >= 12 && stdev(vels) < 0.03 && stdev(vels) / Math.max(0.01, mean(vels)) < 0.05 && !sparseVelocity) warn('warning', 'dynamics', `"${ch.name}" has almost identical velocities (${r2(mean(vels))} ± ${r2(stdev(vels))}), which sounds mechanical.`, 'Rewrite it with compose, or transform_notes humanize / velocity accents on strong beats.');
    if (role === 'bass' && lowest >= 55) warn('warning', 'register', `Bass "${ch.name}" never goes below ${NAME_OF(lowest)} — too high to anchor the low end.`, 'Transpose it down an octave or two (bass roots usually sit around C2–C3 in OpenStudio naming).');
    if (role === 'bass' && highest > 60) warn('info', 'register', `Bass "${ch.name}" reaches ${NAME_OF(highest)}; high notes compete with the chords.`);
    if ((role === 'chords' || role === 'pad' || role === 'stabs') && lowest < 45) warn('warning', 'register', `"${ch.name}" has notes down to ${NAME_OF(lowest)}, which will muddy the bass.`, 'Voice the chords above C3 (MIDI 48): transpose up an octave or use compose.');
    if (role === 'lead' && (lowest < 55 || highest > 100)) warn('info', 'register', `Lead "${ch.name}" spans ${NAME_OF(lowest)}–${NAME_OF(highest)}; leads sit best between about G4 and C7.`);
    if (role === 'lead') { // arpeggios wrap from top to bottom by design; only a melody should avoid big leaps
      const leaps = list.slice(1).filter((n, i) => Math.abs(n.p - list[i].p) > 12).length;
      if (leaps > Math.max(2, list.length * 0.1)) warn('info', 'melody', `"${ch.name}" has ${leaps} leaps larger than an octave; melodies mostly move by step with a few small leaps.`);
    }
    if (role === 'kick' && !list.some((n) => n.s % BAR < 0.5)) warn('warning', 'rhythm', `Kick "${ch.name}" never hits on beat 1 of a bar.`);
    if ((role === 'snare' || role === 'clap') && list.length >= 8) {
      const hits = list.filter((n) => n.v >= 0.5); // ghost notes are meant to be off the backbeat
      const back = hits.length ? hits.filter((n) => Math.abs(n.s % BAR - 4) < 0.5 || Math.abs(n.s % BAR - 12) < 0.5 || Math.abs(n.s % BAR - 8) < 0.5).length / hits.length : 1;
      if (back < 0.4) warn('info', 'rhythm', `Only ${Math.round(back * 100)}% of "${ch.name}" lands on the backbeat (beats 2 and 4, or 3 in half-time).`);
    }
    return info;
  });

  // ---- energy over time and arrangement -----------------------------------------------------------------
  const weight = new Array(bars).fill(0);
  const active = new Array(bars).fill(0).map(() => new Set());
  for (const { ch, list } of chans) for (const n of list) { const b = Math.min(bars - 1, Math.floor(n.s / BAR)); weight[b] += n.v * Math.min(1.5, 0.6 + n.l / 8); active[b].add(ch.id); }
  const topWeight = Math.max(...weight, 1e-9);
  // how much of the band is playing, and how hard: equal parts
  const curve = weight.map((w, b) => r2(0.5 * (active[b].size / Math.max(1, chans.length)) + 0.5 * (w / topWeight)));
  const sections = [];
  const span = bars <= 16 ? 2 : bars <= 48 ? 4 : 8;
  for (let b = 0; b < bars; b += span) sections.push({ bars: `${b + 1}-${Math.min(bars, b + span)}`, energy: r2(mean(curve.slice(b, b + span))), channels: new Set(active.slice(b, b + span).flatMap((s) => [...s])).size });

  if (proj.mode === 'song' || song) {
    if (bars < 32) warn('info', 'structure', `The song is ${bars} bars (${Math.round(seconds)} s). Finished songs usually run 64–128 bars (2–4 minutes).`, 'build_song with a structure ("standard", "edm", "chill") or add more sections with arrange.');
    const sectionEnergy = sections.map((s) => s.energy);
    if (bars >= 16 && Math.max(...sectionEnergy) - Math.min(...sectionEnergy) < 0.2) warn('warning', 'dynamics', 'The energy is flat from start to finish: there is no build, drop or breakdown.', 'Give sections different instrumentation: thin the intro and breakdown, add the full band in the chorus / drop (build_song does this).');
    const introAvg = mean(curve.slice(0, Math.min(4, bars)));
    if (bars >= 16 && introAvg > 0.85) warn('info', 'structure', 'The song starts at full energy; a short intro with fewer instruments gives the entrance more impact.');
    const outroAvg = mean(curve.slice(-2));
    if (bars >= 16 && outroAvg > 0.7) warn('info', 'structure', 'The song ends at high energy; an outro that strips back (or a final hit) sounds finished.');
    const clips = proj.playlist.clips.filter((c) => (c.type || 'pattern') === 'pattern');
    if (clips.length) {
      const used = new Set(clips.map((c) => c.pat));
      const unused = proj.patterns.filter((p) => !used.has(p.id) && Object.values(p.notes).some((l) => l.length));
      if (unused.length) warn('info', 'arrangement', `${unused.length} pattern(s) with notes are not in the playlist: ${unused.slice(0, 4).map((p) => `"${p.name}"`).join(', ')}.`);
      if (bars >= 24 && used.size <= 2) warn('warning', 'repetition', `The whole ${bars}-bar song uses only ${used.size} pattern${used.size === 1 ? '' : 's'}: it will loop identically.`, 'Create variations for verse / chorus / bridge (compose with different seeds or energy) and place them with arrange.');
    }
    // long runs of the same pattern on one track
    const byTrack = new Map();
    const ambience = (c) => { // a texture is meant to run under the whole song
      const pat = store.pattern(c.pat);
      const owners = Object.entries(pat?.notes ?? {}).filter(([, l]) => l.length).map(([id]) => proj.channels.find((x) => x.id === Number(id)));
      return owners.length > 0 && owners.every((x) => x && roleOf(x) === 'fx');
    };
    for (const c of clips) if (!ambience(c)) (byTrack.get(c.track) ?? byTrack.set(c.track, []).get(c.track)).push(c);
    for (const [track, list] of byTrack) {
      list.sort((a, b) => a.start - b.start);
      let run = 1, startBar = 0;
      for (let i = 1; i <= list.length; i++) {
        if (i < list.length && list[i].pat === list[i - 1].pat && list[i].start <= list[i - 1].start + list[i - 1].len + 0.01) { if (run === 1) startBar = list[i - 1].start / BAR; run++; continue; }
        const lengthBars = run === 1 ? list[i - 1].len / BAR : (list[i - 1].start + list[i - 1].len - startBar * BAR) / BAR;
        if (lengthBars > 24) warn('info', 'repetition', `Playlist track ${track + 1} plays the same pattern for ${Math.round(lengthBars)} bars in a row.`, 'Change something every 4–8 bars: a fill, a different pattern, an element dropping out.');
        run = 1;
      }
    }
  }

  // ---- harmony: chord per bar, and whether the bass follows it -------------------------------------------
  const harmonic = chans.filter((c) => ['chords', 'pad', 'stabs'].includes(c.role) && c.list.length);
  const bassCh = chans.find((c) => c.role === 'bass' && c.list.length);
  const chordsByBar = [];
  let bassMatches = 0, bassChecked = 0;
  for (let b = 0; b < Math.min(bars, 64); b++) {
    const w = new Array(12).fill(0);
    for (const { list } of harmonic) for (const n of list) {
      const ov = Math.min(n.s + n.l, (b + 1) * BAR) - Math.max(n.s, b * BAR);
      if (ov > 0) w[n.p % 12] += ov;
    }
    const name = nameChord(w, useKey?.flats);
    chordsByBar.push(name);
    if (name && bassCh) {
      const root = pcNumber(name);
      const bw = new Array(12).fill(0);
      for (const n of bassCh.list) { const ov = Math.min(n.s + n.l, (b + 1) * BAR) - Math.max(n.s, b * BAR); if (ov > 0) bw[n.p % 12] += ov; }
      const bestPc = bw.indexOf(Math.max(...bw));
      if (Math.max(...bw) > 0) { bassChecked++; if (bestPc === root) bassMatches++; }
    }
  }
  if (bassChecked >= 4 && bassMatches / bassChecked < 0.6) warn('warning', 'harmony', `The bass plays the chord root in only ${Math.round((bassMatches / bassChecked) * 100)}% of bars.`, 'Let the bass follow the chord roots (compose role "bass" with the same key and progression).');

  const order = { warning: 0, info: 1 };
  warnings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    mode: proj.mode, bars, seconds: Math.round(seconds), bpm,
    key: { detected: detected ? { name: detected.name, confidence: detected.confidence } : null, used: useKey?.name ?? null, notesInKey: inKey === null ? null : r2(inKey) },
    channels: perChannel,
    harmony: { chordsByBar: chordsByBar.slice(0, 32).map((c, i) => `${i + 1}:${c ?? '–'}`), bassFollowsChords: bassChecked ? r2(bassMatches / bassChecked) : null },
    energy: { perBar: curve.length <= 64 ? curve : undefined, sections },
    warnings,
    verdict: warnings.some((w) => w.severity === 'warning') ? 'Fix the warnings, then render_audio to check the mix.' : 'The writing looks sound; check the mix with render_audio and auto_mix.',
  };
}

function pcNumber(chordName) {
  const m = /^([A-G])([#b]?)/.exec(chordName);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return (base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}
