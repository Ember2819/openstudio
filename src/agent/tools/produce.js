import { bool, choice, num, obj, str } from '../schema.js';
import { edit, fail, pickByName, round } from '../helpers.js';
import { songContext, rememberSong } from '../music/session.js';
import { roleOf, isDrumRole } from '../music/roles.js';
import { critique, flattenSong } from '../music/critique.js';
import { applyMixPlan, gainToFader } from '../music/mixing.js';
import { STYLES, STYLE_IDS, MIX_ROLES, DRUM_LANES } from '../music/styles.js';
import { ENGINE_PRESETS, DRUM_KIT, allEnginePresets } from '../../audio/instruments.js';
import { busiestWindow, measure } from '../stems.js';
import { faderToGain, COLORS } from '../../util.js';
import { SFX } from '../../audio/sfx.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const DEFAULT_KEY = { house: 'F minor', techno: 'A minor', trance: 'A minor', trap: 'F# minor', hiphop: 'D minor', lofi: 'E minor', pop: 'C major', rock: 'E minor', dnb: 'F minor', synthwave: 'A minor', funk: 'E dorian', ambient: 'D major' };
const ROLE_ORDER = [...DRUM_LANES, 'bass', 'chords', 'stabs', 'pad', 'arp', 'lead', 'fx'];
const ROLE_COLOR = { kick: '#c76c5d', snare: '#c4824f', clap: '#bb5d85', hat: '#bfa650', openhat: '#bfa650', perc: '#a0527f', tom: '#c4824f', crash: '#6a7f93', ride: '#6a7f93', bass: '#5b8bc4', chords: '#8b6cc0', stabs: '#a0527f', pad: '#5f9ea0', arp: '#6cae8f', lead: '#92a95c', fx: '#6a7f93' };

/** Turn a style's cast entry into the spec store.addChannel takes. */
function channelSpec(cast) {
  switch (cast.kind) {
    case 'drum': return { name: cast.name ?? cast.voice, type: 'drum', voice: cast.voice };
    case 'kitpiece': return { name: cast.name, type: 'sf', bank: 128, program: cast.kit, fixedKey: cast.key };
    case 'sf': return { name: cast.name, type: 'sf', bank: 0, program: cast.program };
    default: {
      const preset = Object.values(ENGINE_PRESETS[cast.kind]).flat().find((p) => p.name === cast.preset);
      if (!preset) throw new Error(`Style refers to a missing ${cast.kind} preset "${cast.preset}"`);
      return { name: preset.name, type: cast.kind, preset: preset.params };
    }
  }
}

/** "Slap Bass 1", "Reese Bass", "kick808" … -> a channel spec, searching engine presets, drum voices and the General MIDI bank. */
function specFromText(app, text, role) {
  const q = text.trim().toLowerCase();
  const presets = allEnginePresets();
  const exact = presets.filter((p) => p.name.toLowerCase() === q);
  const hit = exact.length === 1 ? exact[0] : presets.filter((p) => p.name.toLowerCase().includes(q)).length === 1 ? presets.filter((p) => p.name.toLowerCase().includes(q))[0] : null;
  if (hit) return { name: hit.name, type: hit.type, preset: hit.params };
  if (isDrumRole(role)) {
    const d = DRUM_KIT.find((x) => x.voice === q || x.name.toLowerCase() === q);
    if (d) return { name: d.name, type: 'drum', voice: d.voice };
  }
  const cat = app.actions.catalog?.();
  if (cat) {
    const p = pickByName(cat.families.flatMap((f) => f.presets), text, 'instrument');
    return { name: p.name.replace(/ \(variation \d+\)$/, ''), type: 'sf', bank: p.bank, program: p.program };
  }
  return fail(`"${text}" is not a synth / FM / organ / plucked / sfx preset, and the General MIDI bank is not loaded yet — see list_catalog`);
}

const renderLevels = (app, opts) => measure(app, opts);

/** Set a channel's loudness by `db`, through its own mixer fader (or the channel volume when the track is shared). */
function nudge(store, ch, db) {
  const shared = ch.mixer === 0 || store.project.channels.filter((c) => c.mixer === ch.mixer).length > 1;
  if (shared) {
    const g = Math.sqrt(Math.max(1e-4, (ch.vol * ch.vol * 1.15 * Math.pow(10, db / 20)) / 1.15));
    ch.vol = Math.min(1, Math.max(0.02, round(g, 3)));
  } else {
    const m = store.project.mixer[ch.mixer];
    m.vol = round(gainToFader(faderToGain(m.vol) * Math.pow(10, db / 20)), 3);
  }
}

export const tools = [
  {
    name: 'setup_song',
    title: 'Set up a song',
    description: 'Start a song in a style: creates a well-chosen set of instruments (drums as separate kick / snare / hat … channels, bass, chords, pad, arpeggio, lead, riser and impact effects), routes each to its own mixer track with sensible levels, pan, high-pass, compression, shared reverb and delay buses and a master chain, sets tempo and swing, and remembers style and key for compose and build_song. A fresh project\'s four default drum channels are replaced; a project with notes needs clear: true. Swap any instrument afterwards with update_channel, or choose them up front with `instruments` (a name per role, e.g. { "bass": "Slap Bass 1", "lead": "Vocal Lead" }). Style list: music_theory kind "styles".',
    inputSchema: obj({
      style: choice(STYLE_IDS, 'Style'),
      key: str('Key, e.g. "A minor" (default: a typical key for the style)'),
      progression: str('Chord progression: roman numerals, chord names, or a name (default: the style\'s)'),
      bpm: num('Tempo (default: the style\'s typical tempo)', { minimum: 40, maximum: 220 }),
      name: str('Project name'),
      instruments: { type: 'object', description: 'Override instruments by role: { role: "instrument or preset name" }, e.g. { "bass": "Reese Bass", "chords": "Grand Piano" }', additionalProperties: true },
      mix: bool('Also apply the starting mix (default true)'),
      clear: bool('Replace everything: remove all existing channels, notes and clips (required when the project has notes)'),
    }, ['style']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Set up a song' },
    run(a, app) {
      const { store, transport } = app;
      const proj = store.project;
      const style = STYLES[a.style];
      const ctx = songContext(app, { style: a.style, key: a.key ?? DEFAULT_KEY[a.style], progression: a.progression });
      const hasNotes = proj.patterns.some((p) => Object.values(p.notes).some((l) => l.length)) || proj.playlist.clips.length > 0;
      if (hasNotes && !a.clear) fail('The project already has notes or clips. Pass clear: true to start over with a new set of instruments, or add channels with add_channel.');

      const cast = { ...style.cast };
      const overrides = {};
      for (const [role, text] of Object.entries(a.instruments ?? {})) {
        if (!ROLE_ORDER.includes(role)) fail(`instruments: "${role}" is not a role (${ROLE_ORDER.join(', ')})`);
        if (typeof text !== 'string') fail(`instruments.${role} must be a name`);
        overrides[role] = specFromText(app, text, role);
      }
      const roles = ROLE_ORDER.filter((r) => cast[r] || overrides[r]);
      const specs = roles.map((role) => ({ role, spec: overrides[role] ?? channelSpec(cast[role]) }));
      // risers and hits for transitions (not for ambient pieces, which have none)
      const fxSound = cast.fx ? Object.values(ENGINE_PRESETS.sfx).flat().find((p) => p.name === cast.fx.preset)?.params.sound : null;
      if (cast.fx && !SFX[fxSound]?.texture) {
        const hit = Object.values(ENGINE_PRESETS.sfx).flat().find((p) => p.name === 'Impact');
        specs.push({ role: 'fx', spec: { name: hit.name, type: 'sfx', preset: hit.params } });
      }

      const made = [];
      edit(store, () => {
        proj.channels = [];
        proj.playlist.clips = [];
        proj.patterns = [];
        store._addPattern('Pattern 1');
        proj.selected.pattern = proj.patterns[0].id;
        specs.forEach(({ role, spec }, i) => {
          const ch = store._addChannel({ ...spec, color: ROLE_COLOR[role] ?? COLORS[i % COLORS.length] });
          ch.role = role;
          made.push(ch);
        });
        proj.selected.channel = made.find((c) => c.role === 'bass')?.id ?? made[0]?.id ?? null;
        proj.bpm = a.bpm ?? style.bpm[1];
        proj.swing = style.swing;
        proj.mode = 'pattern';
        if (a.name) proj.name = a.name.trim() || proj.name;
        rememberSong(app, ctx, { bpmSet: true });
        if (a.mix !== false) applyMixPlan(app, { style: a.style, bpm: proj.bpm });
        store.emit('channels'); store.emit('patterns'); store.emit('notes'); store.emit('playlist'); store.emit('selection'); store.emit('mixer'); store.emit('mixerSelection');
      });
      transport.emit('bpm');
      transport.emit('mode');
      return {
        style: a.style, about: style.blurb, key: ctx.key.name, bpm: proj.bpm, swing: proj.swing, chords: ctx.chordNames,
        channels: made.map((c) => ({ id: c.id, name: c.name, role: c.role, type: c.type, mixer: c.mixer })),
        next: 'build_song for a complete first draft, or compose into a pattern for one section at a time. Swap instruments with update_channel; preview with preview_note.',
      };
    },
  },
  {
    name: 'analyze_song',
    title: 'Analyse the song',
    description: 'A musical review that works from the notes (you cannot listen): the detected and intended key and how much of the music stays in it, the chord of every bar and whether the bass follows it, each channel\'s register and dynamics, the energy curve and sections, and warnings with a fix for each — flat velocities, muddy or out-of-range registers, notes out of key, empty channels, patterns never placed, a song with no build or a single repeated loop, no intro or ending. Run it after writing, fix the warnings, and run it again. Reviews the playlist in song mode, the selected pattern otherwise (scope overrides).',
    inputSchema: obj({
      key: str('The key the song should be in (default: detect it)'),
      scope: choice(['auto', 'song', 'pattern'], 'What to review (default: follow the project mode)'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Analyse the song' },
    run(a, app) {
      const scope = a.scope ?? 'auto';
      const song = scope === 'auto' ? undefined : scope === 'song';
      const key = a.key ?? app.store.project.song?.key;
      return critique(app.store, app.store.project.bpm, { key, song });
    },
  },
  {
    name: 'auto_mix',
    title: 'Automatic mix',
    description: 'Mix the song like an engineer would: every channel on its own mixer track with level, pan, high-pass and compression chosen for its role (kick and bass centred and loud, hats and arps to the sides, pads wide and quiet), shared reverb and delay buses (delay in time with the tempo) fed by role-specific sends, and a master compressor and limiter. With calibrate (default) it then renders the busiest bars once per channel and corrects each fader so the balance matches a typical mix (kick / bass / lead forward, hats and pads back), re-checks the result, and pulls the master down if it would clip. Effects it adds are tagged so running it again replaces them; your own effects are left alone. Reports the levels it measured.',
    inputSchema: obj({
      calibrate: bool('Measure stems and balance the faders (default true; needs notes to render)'),
      plan: bool('Apply the role-based starting mix first (default true). false keeps the current faders, sends and effects and only calibrates'),
      style: choice(STYLE_IDS, 'Style, for the amount of reverb and delay (default: the song\'s)'),
      strength: num('0-1: how far calibration moves faders toward the target (default 0.7)', { minimum: 0.1, maximum: 1 }),
    }),
    annotations: { ...WRITE, destructiveHint: true, title: 'Automatic mix' },
    async run(a, app) {
      const { store } = app;
      const proj = store.project;
      const style = a.style ?? proj.song?.style ?? 'pop';
      if (!proj.channels.length) fail('There are no channels to mix');
      const report = {};
      if (a.plan !== false) {
        edit(store, () => { report.plan = applyMixPlan(app, { style, bpm: proj.bpm }); });
      }
      if (a.calibrate === false) return { ...report, calibrated: false, next: 'render_audio to check the levels.' };

      const withNotes = flattenSong(store);
      const stems = proj.channels.filter((c) => (withNotes.notes.get(c.id) ?? []).length);
      if (!stems.length || withNotes.steps <= 0) return { ...report, calibrated: false, note: 'Nothing to render yet — write some notes (compose / build_song) and run auto_mix again to balance them.' };
      const { from, to } = busiestWindow(store);
      const strength = a.strength ?? 0.7;

      // Full-mix renders are the expensive part (a stem is a fraction of the cost), so the mix is measured only
      // twice: now, to know how loud everything is, and at the end, to set the master level with headroom.
      // The safety limiter is bypassed for both: it hides how hot a mix really is.
      const before = await renderLevels(app, { from, to, unlimited: true });
      if (before.peakDb < -80) return { ...report, calibrated: false, note: 'The render is silent: check that channels are not muted and have notes in the section that plays.' };
      const rows = new Map();
      let todo = stems.slice(0, 24);
      for (let pass = 0; pass < 2 && todo.length; pass++) {
        const adjustments = [];
        for (const ch of todo) {
          const role = roleOf(ch);
          const target = before.rmsDb + (MIX_ROLES[role] ?? MIX_ROLES.chords).rel;
          const stem = await renderLevels(app, { from, to, only: ch });
          const row = rows.get(ch.id) ?? rows.set(ch.id, { channel: ch.id, name: ch.name, role, changeDb: 0 }).get(ch.id);
          if (stem.rmsDb < -70) { row.note = 'silent in the measured bars'; continue; }
          row.rmsDb = round(stem.rmsDb, 1);
          row.targetDb = round(target, 1);
          const delta = Math.max(-8, Math.min(6, (target - stem.rmsDb) * strength));
          if (Math.abs(delta) > (pass ? 1.5 : 0.4)) { adjustments.push({ ch, delta }); row.changeDb = round(row.changeDb + delta, 1); }
        }
        if (!adjustments.length) break;
        edit(store, () => {
          for (const { ch, delta } of adjustments) nudge(store, ch, delta);
          store.emit('mixer'); store.emit('channels'); store.emit('mixerSelection');
        });
        // channels do not affect each other's solo level, so only the ones that moved a lot need a second look
        todo = adjustments.filter(({ delta }) => Math.abs(delta) > 3).map(({ ch }) => ch);
      }

      const ceiling = -2;
      const hot = await renderLevels(app, { from, to, unlimited: true });
      let masterDb = 0;
      if (hot.peakDb > ceiling || hot.peakDb < -14) {
        masterDb = Math.max(-18, Math.min(6, ceiling - hot.peakDb));
        edit(store, () => { proj.mixer[0].vol = round(gainToFader(faderToGain(proj.mixer[0].vol) * Math.pow(10, masterDb / 20)), 3); store.emit('mixer'); });
      }
      const rows_ = [...rows.values()];
      return {
        ...report, calibrated: true,
        measuredBars: `${from / 16 + 1}-${to / 16}`,
        stems: rows_,
        master: { peakDb: round(hot.peakDb + masterDb, 1), rmsDb: round(hot.rmsDb + masterDb, 1), faderChangeDb: round(masterDb, 1), before: { peakDb: round(before.peakDb, 1), rmsDb: round(before.rmsDb, 1) }, note: 'levels before the final safety limiter' },
        next: 'render_audio (stems: true) to confirm, and listen on the user\'s side: tell them what you changed.',
      };
    },
  },
];
