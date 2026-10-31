// Playlist operations shared by the playlist window and agent tools: time markers and splitting a pattern clip into
// one clip per channel. Each mutates the project; the caller checkpoints first and emits afterwards.
import { PLAYLIST_TRACKS } from './state.js';

/** Time markers, sorted: [{ id, step, name }]. */
export function markers(store) {
  const list = store.project.markers ?? [];
  return [...list].sort((a, b) => a.step - b.step);
}

export function addMarker(store, step, name) {
  const p = store.project;
  p.markers ??= [];
  const m = { id: store.uid(), step: Math.max(0, Math.round(step * 1000) / 1000), name: name || `Marker ${p.markers.length + 1}` };
  p.markers.push(m);
  return m;
}

export function removeMarker(store, id) {
  const p = store.project;
  const before = p.markers?.length ?? 0;
  p.markers = (p.markers ?? []).filter((m) => m.id !== id);
  return p.markers.length < before;
}

/** The marker after / before a position (for jumping), or null. */
export function nextMarker(store, step, dir = 1) {
  const list = markers(store);
  if (dir > 0) return list.find((m) => m.step > step + 1e-6) ?? null;
  return [...list].reverse().find((m) => m.step < step - 0.5) ?? null;
}

/** Is [start, start + len) free on `track` (ignoring `except`)? */
function trackFree(store, track, start, len, except) {
  return !store.project.playlist.clips.some((c) => c !== except && c.track === track && c.start < start + len && c.start + c.len > start);
}

/**
 * Split a pattern clip into one clip per channel that plays in that pattern (FL's "Split by channel"): each channel's
 * notes go into a new pattern named after it, placed on the clip's track and the free tracks below. The original
 * pattern is kept. Returns the new clips (empty when the pattern has fewer than two channels with notes).
 */
export function splitByChannel(store, clip) {
  const pat = store.pattern(clip.pat);
  if (!pat) return [];
  const chans = store.project.channels.filter((ch) => pat.notes[ch.id]?.length);
  if (chans.length < 2) return [];
  const clips = store.project.playlist.clips;
  clips.splice(clips.indexOf(clip), 1);
  const made = [];
  let track = clip.track;
  for (const ch of chans) {
    const np = store._addPattern(`${pat.name} - ${ch.name}`);
    np.color = ch.color;
    np.bars = pat.bars;
    np.notes[ch.id] = pat.notes[ch.id].map((n) => ({ ...n }));
    while (track < PLAYLIST_TRACKS - 1 && !trackFree(store, track, clip.start, clip.len)) track++;
    made.push(store.addClip({ type: 'pattern', pat: np.id, track, start: clip.start, len: clip.len, offset: clip.offset, mute: clip.mute }));
    track = Math.min(PLAYLIST_TRACKS - 1, track + 1);
  }
  return made;
}
