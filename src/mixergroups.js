// Mixer track groups: tracks that share a group number (1-8) move together — a fader moves the others by the same
// amount, mute and solo switch them all. Hold Alt to move one track on its own. The master is never grouped.
export const GROUPS = 8;
export const GROUP_COLORS = ['#e8a33d', '#4fb3e8', '#8bd448', '#e85f8a', '#a77be8', '#46d1b5', '#e8d23d', '#e87a4f'];

export const validGroup = (g) => Number.isInteger(g) && g >= 1 && g <= GROUPS;

/** The other tracks in track i's group. */
export function groupMates(mixer, i) {
  const g = mixer[i]?.group;
  if (!validGroup(g) || i === 0) return [];
  const out = [];
  mixer.forEach((m, j) => { if (j > 0 && j !== i && m.group === g) out.push(j); });
  return out;
}

/**
 * Set track i's fader to `vol`; its group mates move by the same amount (in fader travel), each stopping at its end
 * stop. Returns the tracks that changed (i first).
 */
export function setGroupVolume(mixer, i, vol, { alone = false } = {}) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const delta = clamp(vol) - mixer[i].vol;
  mixer[i].vol = clamp(vol);
  const changed = [i];
  if (alone || !delta) return changed;
  for (const j of groupMates(mixer, i)) { mixer[j].vol = clamp(mixer[j].vol + delta); changed.push(j); }
  return changed;
}

/** Set mute or solo ('mute' | 'solo') on track i and its group. Returns the tracks that changed. */
export function setGroupFlag(mixer, i, flag, on, { alone = false } = {}) {
  const tracks = [i, ...(alone ? [] : groupMates(mixer, i))];
  for (const j of tracks) mixer[j][flag] = on;
  return tracks;
}
