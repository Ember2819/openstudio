import { choice, int, num, obj, ref, str } from '../schema.js';
import { channelOf, fail, patternOf } from '../helpers.js';
import { analyze, BANDS } from '../analysis.js';
import { renderSteps } from '../../audio/render.js';
import { encodeWav } from '../../audio/wav.js';
import { STEPS_PER_BAR } from '../../state.js';

const MAX_SECONDS = 900;

export const tools = [
  {
    name: 'render_audio',
    title: 'Render and analyse audio',
    description: 'Render the project offline (the same engine as playback and Export audio) and analyse the result, since you cannot listen: peak / RMS / crest in dBFS, clipped samples, stereo correlation, a loudness timeline (one entry per bar, merged for long pieces), spectral balance (share of energy per band + centroid) and plain-language warnings. scope "pattern" renders the selected (or given) pattern, "song" the playlist, "auto" follows the project mode. Restrict to one channel to judge it in isolation. Optionally writes a 16-bit WAV file. Playback is not affected.',
    inputSchema: obj({
      scope: choice(['auto', 'pattern', 'song'], 'What to render (default auto)'),
      pattern: ref('Pattern (with scope "pattern"; default the selected one)'),
      channel: ref('Render only this channel (others are silenced)'),
      fromStep: num('Analyse from this step (default 0)', { minimum: 0 }),
      toStep: num('Analyse up to this step (default the end)', { minimum: 0 }),
      tail: num('Seconds of release/reverb tail to include after the last step (default 2)', { minimum: 0, maximum: 20 }),
      path: str('Also write the render to this absolute .wav path'),
      sampleRate: int('Sample rate for the render (default 44100)', { minimum: 8000, maximum: 96000 }),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Render and analyse audio' },
    async run(a, app) {
      const { store, transport } = app;
      const proj = store.project;
      const scope = (a.scope ?? 'auto') === 'auto' ? proj.mode : a.scope;
      const pat = scope === 'pattern' ? patternOf(store, a.pattern) : null;
      const only = a.channel === undefined ? null : channelOf(store, a.channel);

      // the offline engine reads the project, so mode / selection / solo are set for the render and put back after
      const keep = { mode: proj.mode, pattern: proj.selected.pattern, solo: proj.channels.map((c) => c.solo) };
      let steps;
      try {
        proj.mode = scope;
        if (pat) proj.selected.pattern = pat.id;
        steps = scope === 'song' ? store.playlistEndStep() : store.patternSteps(store.currentPattern);
        if (steps <= 0) fail('Nothing to render — the playlist has no clips (add clips, or use scope "pattern")');
        const seconds = steps * transport.stepDur + (a.tail ?? 2);
        if (seconds > MAX_SECONDS) fail(`That would be ${Math.round(seconds)} s of audio; the limit is ${MAX_SECONDS} s`);
        if (only) proj.channels.forEach((c) => { c.solo = c.id === only.id; });
        const sampleRate = a.sampleRate ?? 44100;
        const rendered = await renderSteps(store, steps, { tail: a.tail ?? 2, sampleRate });
        const stepDur = 60 / proj.bpm / 4;
        const result = {
          scope, channel: only?.id ?? null, steps, bars: steps / STEPS_PER_BAR, bpm: proj.bpm, sampleRate,
          bandsHz: Object.fromEntries(BANDS.map(([name, lo, hi]) => [name, `${lo}-${hi}`])),
          ...analyze(rendered.getChannelData(0), rendered.getChannelData(1), sampleRate, {
            windowSeconds: STEPS_PER_BAR * stepDur,
            from: (a.fromStep ?? 0) * stepDur,
            to: a.toStep === undefined ? undefined : a.toStep * stepDur,
          }),
        };
        if (a.path) result.path = await app.files.write(a.path, encodeWav(rendered));
        return result;
      } finally {
        proj.mode = keep.mode;
        proj.selected.pattern = keep.pattern;
        proj.channels.forEach((c, i) => { c.solo = keep.solo[i]; });
      }
    },
  },
];
