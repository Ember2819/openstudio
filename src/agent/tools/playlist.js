import { COLOR, arr, bool, choice, int, num, obj, ref, str } from '../schema.js';
import { automationOf, clipOf, edit, fail, patternOf, playlistTrackOf } from '../helpers.js';
import { clipInfo } from '../describe.js';
import { STEPS_PER_BAR } from '../../state.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const TRACK = int('Playlist track, 0-124 (0 is the top track)', { minimum: 0, maximum: 124 });

const NEW_CLIP = obj({
  type: choice(['pattern', 'audio', 'automation'], 'What the clip plays'),
  pattern: ref('Pattern (for pattern clips)'),
  sample: int('Sample id from import_sample (for audio clips)'),
  automation: int('Automation id from create_automation (for automation clips)'),
  track: TRACK,
  start: num('Start in steps (16 per bar)', { minimum: 0 }),
  length: num('Length in steps (default: the pattern / sample / automation length)', { minimum: 0.25 }),
  offset: num('Steps into the source where playback starts', { minimum: 0 }),
  gain: num('Audio clip gain, 1 = unchanged', { minimum: 0, maximum: 4 }),
}, ['type', 'track', 'start']);

const CLIP_PATCH = obj({
  id: int('Clip id'),
  track: TRACK,
  start: num('New start in steps', { minimum: 0 }),
  length: num('New length in steps', { minimum: 0.25 }),
  offset: num('Steps into the source where playback starts', { minimum: 0 }),
  mute: bool('Mute the clip'),
  gain: num('Audio clip gain', { minimum: 0, maximum: 4 }),
}, ['id']);

export const tools = [
  {
    name: 'get_playlist',
    title: 'Get playlist',
    description: 'List playlist clips (id, type, track, start, length in steps, source), sorted by track then start, and the used playlist tracks. Filter by track or by a step range.',
    inputSchema: obj({ track: TRACK, from: num('Only clips ending after this step'), to: num('Only clips starting before this step') }),
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Get playlist' },
    run(a, app) {
      const { store } = app;
      const clips = store.project.playlist.clips
        .filter((c) => (a.track === undefined || c.track === a.track) && (a.from === undefined || c.start + c.len > a.from) && (a.to === undefined || c.start < a.to))
        .sort((x, y) => x.track - y.track || x.start - y.start)
        .map(clipInfo);
      const tracks = store.project.playlist.tracks
        .map((t, i) => ({ track: i, name: t.name, mute: t.mute, mixer: t.mixer, color: t.color }))
        .filter((t) => store.project.playlist.clips.some((c) => c.track === t.track) || t.mute || t.mixer || t.color || t.name !== `Track ${t.track + 1}`);
      const end = store.playlistEndStep();
      return { endStep: end, endBar: end / STEPS_PER_BAR, tracks, clips };
    },
  },
  {
    name: 'add_clips',
    title: 'Add clips',
    description: 'Place clips on the playlist: pattern clips (play a pattern), audio clips (play an imported sample) and automation clips. Positions are in steps (16 = 1 bar). Returns the new clip ids. Only plays in song mode (set_project mode "song").',
    inputSchema: obj({ clips: arr(NEW_CLIP, 'Clips to place', { minItems: 1, maxItems: 500 }) }, ['clips']),
    annotations: { ...WRITE, title: 'Add clips' },
    async run(a, app) {
      const { store, engine, transport } = app;
      // resolve everything first (audio needs decoding) so a bad entry changes nothing
      const planned = [];
      for (const [i, c] of a.clips.entries()) {
        playlistTrackOf(store, c.track);
        const at = `clips[${i}]`;
        if (c.type === 'pattern') {
          if (c.pattern === undefined) fail(`${at}: pattern clips need pattern`);
          const pat = patternOf(store, c.pattern);
          planned.push({ type: 'pattern', pat: pat.id, len: store.patternSteps(pat) });
        } else if (c.type === 'audio') {
          if (!store.samples.has(c.sample)) fail(`${at}: no sample with id ${c.sample} — use import_sample`);
          const buf = await engine.ensureSample(c.sample);
          if (!buf) fail(`${at}: sample ${c.sample} could not be decoded`);
          planned.push({ type: 'audio', sampleId: c.sample, len: Math.max(1, Math.round(buf.duration / transport.stepDur)), ...(c.gain !== undefined ? { gain: c.gain } : {}) });
        } else {
          if (c.automation === undefined) fail(`${at}: automation clips need automation`);
          planned.push({ type: 'auto', autoId: automationOf(store, c.automation).id, len: automationOf(store, c.automation).len });
        }
      }
      const made = edit(store, () => a.clips.map((c, i) => {
        const p = planned[i];
        const clip = store.addClip({ ...p, track: c.track, start: c.start, len: c.length ?? p.len, offset: c.offset ?? 0 });
        return clipInfo(clip);
      }));
      store.emit('playlist');
      return { added: made, endStep: store.playlistEndStep() };
    },
  },
  {
    name: 'update_clips',
    title: 'Update clips',
    description: 'Move, resize, offset, mute or change the gain of existing clips. Each entry names a clip id and the fields to change.',
    inputSchema: obj({ clips: arr(CLIP_PATCH, 'Clip changes', { minItems: 1, maxItems: 500 }) }, ['clips']),
    annotations: { ...WRITE, idempotentHint: true, title: 'Update clips' },
    run(a, app) {
      const { store } = app;
      const targets = a.clips.map((p) => ({ p, clip: clipOf(store, p.id) }));
      for (const { p } of targets) if (p.track !== undefined) playlistTrackOf(store, p.track);
      edit(store, () => {
        for (const { p, clip } of targets) {
          if (p.track !== undefined) clip.track = p.track;
          if (p.start !== undefined) clip.start = p.start;
          if (p.length !== undefined) clip.len = p.length;
          if (p.offset !== undefined) clip.offset = p.offset;
          if (p.mute !== undefined) clip.mute = p.mute;
          if (p.gain !== undefined) clip.gain = p.gain;
        }
        store.emit('playlist');
      });
      return { updated: targets.map(({ clip }) => clipInfo(clip)) };
    },
  },
  {
    name: 'edit_clips',
    title: 'Edit clips',
    description: 'Act on clips chosen by `ids` or by `track` (every clip on that track). action: "remove", "duplicate" (copies placed right after the originals, or `steps` later), "make_unique" (pattern clips get their own copy of the pattern so edits do not affect other clips), "fit_to_pattern" (resize pattern clips to the pattern length), "mute" / "unmute".',
    inputSchema: obj({
      ids: arr(int('Clip id'), 'Clip ids', { minItems: 1 }),
      track: TRACK,
      action: choice(['remove', 'duplicate', 'make_unique', 'fit_to_pattern', 'mute', 'unmute'], 'What to do'),
      steps: num('duplicate: offset in steps (default: the span of the selection)', { minimum: 0.25 }),
    }, ['action']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Edit clips' },
    run(a, app) {
      const { store } = app;
      if ((a.ids === undefined) === (a.track === undefined)) fail('Pass either ids or track');
      const all = store.project.playlist.clips;
      const sel = a.ids ? a.ids.map((id) => clipOf(store, id)) : all.filter((c) => c.track === a.track);
      if (!sel.length) return { changed: 0 };
      const out = edit(store, () => {
        switch (a.action) {
          case 'remove': {
            const kill = new Set(sel);
            store.project.playlist.clips = all.filter((c) => !kill.has(c));
            return { removed: sel.map((c) => c.id) };
          }
          case 'duplicate': {
            const start = Math.min(...sel.map((c) => c.start));
            const end = Math.max(...sel.map((c) => c.start + c.len));
            const span = a.steps ?? Math.max(1, Math.ceil(end - start - 1e-6));
            return { added: sel.map((c) => clipInfo(store.addClip({ ...c, id: undefined, start: c.start + span }))) };
          }
          case 'make_unique': {
            const made = [];
            for (const c of sel) {
              if (c.type !== 'pattern') continue;
              const src = store.pattern(c.pat);
              const copy = store.clonePattern(src.id);
              const base = src.name.replace(/ #\d+$/, '');
              let k = 2;
              while (store.project.patterns.some((p) => p.name === `${base} #${k}`)) k++;
              copy.name = `${base} #${k}`;
              c.pat = copy.id;
              made.push({ clip: c.id, pattern: copy.id, name: copy.name });
            }
            store.emit('patterns');
            return { unique: made };
          }
          case 'fit_to_pattern':
            for (const c of sel) if (c.type === 'pattern') { c.len = store.patternSteps(store.pattern(c.pat)); c.offset = 0; }
            return { changed: sel.length };
          default:
            for (const c of sel) c.mute = a.action === 'mute';
            return { changed: sel.length };
        }
      });
      store.emit('playlist');
      return out;
    },
  },
  {
    name: 'update_playlist_track',
    title: 'Update playlist track',
    description: 'Name, colour or mute a playlist track, or route all its audio clips to a mixer track.',
    inputSchema: obj({ track: TRACK, name: str('Track name'), color: COLOR, mute: bool('Mute the whole track'), mixer: int('Mixer track for audio clips on this track', { minimum: 0, maximum: 125 }) }, ['track']),
    annotations: { ...WRITE, idempotentHint: true, title: 'Update playlist track' },
    run(a, app) {
      const { store } = app;
      const t = playlistTrackOf(store, a.track);
      edit(store, () => {
        if (a.name !== undefined) t.name = a.name.trim() || t.name;
        if (a.color) t.color = a.color;
        if (a.mute !== undefined) t.mute = a.mute;
        if (a.mixer !== undefined) t.mixer = a.mixer;
        store.emit('playlist');
      });
      return { track: a.track, name: t.name, color: t.color, mute: t.mute, mixer: t.mixer };
    },
  },
];

