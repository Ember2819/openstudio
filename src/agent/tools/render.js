import { bool, choice, int, num, obj, ref, str } from '../schema.js';
import { channelOf, fail, patternOf } from '../helpers.js';
import { analyze, BANDS } from '../analysis.js';
import { renderSteps } from '../../audio/render.js';
import { encodeWav } from '../../audio/wav.js';
import { STEPS_PER_BAR } from '../../state.js';
import { roleOf } from '../music/roles.js';
import { flattenSong } from '../music/critique.js';
import { busiestWindow, measure } from '../stems.js';

const MAX_SECONDS = 900;

/** Per-channel loudness / brightness over a window, plus what that says about the balance. */
async function stemReport(app, a, steps, channels) {
  const { store } = app;
  const win = a.fromStep !== undefined || a.toStep !== undefined
    ? { from: Math.floor(a.fromStep ?? 0), to: Math.min(steps, Math.ceil(a.toStep ?? steps)) }
    : busiestWindow(store);
  if (win.to - win.from > 64 * STEPS_PER_BAR) fail('Stems over more than 64 bars take too long: narrow it with fromStep / toStep');
  const { notes } = flattenSong(store);
  const players = channels.filter((c) => (notes.get(c.id) ?? []).length).slice(0, 24);
  const mix = await measure(app, { ...win });
  const rows = [];
  for (const ch of players) {
    const m = await measure(app, { ...win, only: ch, withSpectrum: true });
    rows.push({ channel: ch.id, name: ch.name, role: roleOf(ch), rmsDb: Math.round(m.rmsDb * 10) / 10, peakDb: Math.round(m.peakDb * 10) / 10, centroidHz: m.centroidHz, band: m.dominantBand, power: m.rms ** 2 });
  }
  const total = rows.reduce((s, r) => s + r.power, 0) || 1;
  const warnings = [];
  for (const r of rows) {
    r.share = Math.round((r.power / total) * 100) / 100;
    delete r.power;
    if (r.role !== 'fx' && r.rmsDb < mix.rmsDb - 24) warnings.push(`"${r.name}" is ${Math.round(mix.rmsDb - r.rmsDb)} dB below the mix: nearly inaudible. Raise its fader (update_mixer_track) or auto_mix.`);
    if (r.share > 0.5 && rows.length > 2) warnings.push(`"${r.name}" holds ${Math.round(r.share * 100)}% of the energy and will dominate the mix: lower it.`);
  }
  const low = rows.filter((r) => ['sub', 'bass', 'lowMid'].includes(r.band) && r.share > 0.12);
  if (low.length > 2) warnings.push(`${low.map((r) => `"${r.name}"`).join(', ')} all sit in the low range and will mask each other: high-pass the chords / pads, or move parts up an octave.`);
  return { barsMeasured: `${win.from / STEPS_PER_BAR + 1}-${win.to / STEPS_PER_BAR}`, mixRmsDb: Math.round(mix.rmsDb * 10) / 10, mixPeakDb: Math.round(mix.peakDb * 10) / 10, channels: rows, warnings };
}

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
      stems: bool('Also render every channel on its own (over the busiest 4 bars, or fromStep-toStep) and report its level, brightness and share of the mix, with warnings about channels that are inaudible, dominate, or fight for the same range'),
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
        if (a.stems) result.stems = await stemReport(app, a, steps, store.project.channels);
        return result;
      } finally {
        proj.mode = keep.mode;
        proj.selected.pattern = keep.pattern;
        proj.channels.forEach((c, i) => { c.solo = keep.solo[i]; });
      }
    },
  },
];
