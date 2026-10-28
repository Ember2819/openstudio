// What job a channel does in the song. Agents can set a channel's `role` explicitly; otherwise it is guessed from
// the instrument, so compose / build_song / auto_mix / analyze_song still work on a project the user started.
import { KEY_LANE, VOICE_LANE, ROLES } from './styles.js';

const BY_NAME = [
  [/\b(kick|bass drum)\b/i, 'kick'], [/\b(snare|rim ?shot|side stick)\b/i, 'snare'], [/\bclap|snap\b/i, 'clap'], [/open.?hat/i, 'openhat'],
  [/\bhat\b|hi-?hat|hihat/i, 'hat'], [/\btom\b/i, 'tom'], [/crash/i, 'crash'], [/\bride\b/i, 'ride'],
  [/shaker|tamb|conga|bongo|cowbell|clave|wood ?block|triangle|cabasa|percussion|perc\b/i, 'perc'],
  [/\bbass\b|\bsub\b|808|reese|wobble|moog/i, 'bass'],
  [/\bpad\b|drone|string|choir|swell|ensemble|atmos|halo|strings/i, 'pad'],
  [/\barp\b|pluck|kalimba|harp|marimba|bell|music box|celeste|glock|vibraphone|xylophone/i, 'arp'],
  [/\bstab\b/i, 'stabs'],
  [/\blead\b|whistle|vocal|flute|sax|trumpet|solo|melody|violin|oboe|clarinet/i, 'lead'],
  [/riser|impact|sweep|whoosh|crackle|vinyl|noise|fx|effect|laser|zap|siren|wind|ocean/i, 'fx'],
];

function programRole(p) {
  if (p < 8) return 'chords';
  if (p < 16) return 'arp';
  if (p < 32) return 'chords';
  if (p < 40) return 'bass';
  if (p < 48) return p === 46 || p === 45 ? 'arp' : 'pad';
  if (p < 56) return 'pad';
  if (p < 64) return 'stabs';
  if (p < 80) return 'lead';
  if (p < 88) return 'lead';
  if (p < 104) return 'pad';
  if (p < 112) return 'arp';
  if (p < 120) return 'perc';
  return 'fx';
}

/** The role of a channel: its own `role`, else a guess from what it plays. */
export function roleOf(ch) {
  if (ch.role && ROLES.includes(ch.role)) return ch.role;
  if (ch.type === 'drum') return VOICE_LANE[ch.voice] ?? 'perc';
  if (ch.type === 'sf' && ch.bank === 128) return ch.fixedKey != null ? (KEY_LANE[ch.fixedKey] ?? 'perc') : 'drums';
  if (ch.type === 'sfx') return 'fx';
  for (const [re, role] of BY_NAME) if (re.test(ch.name ?? '')) return role;
  if (ch.type === 'sf') return programRole(ch.program ?? 0);
  if (ch.type === 'organ') return 'chords';
  if (ch.type === 'pluck') return 'arp';
  if (ch.type === 'sampler') return 'perc';
  return 'lead';
}

/** Is this a channel that plays rhythm lanes rather than pitches? */
export const isDrumRole = (role) => ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc', 'tom', 'crash', 'ride', 'drums'].includes(role);
