#!/usr/bin/env node
// End-to-end test of the MCP server: launches the real app (headless via xvfb when there is no display),
// connects with the official MCP client over HTTP and drives a small production through the tools.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electron = join(root, 'node_modules', '.bin', 'electron');
if (!existsSync(join(root, 'assets/soundfonts/GeneralUser-GS.sf2'))) {
  console.error('Missing instrument bank — run `npm run assets` first.');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'openstudio-mcp-'));
const args = ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${join(work, 'profile')}`, '--mcp-port=0'];
const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const child = headless
  ? spawn('xvfb-run', ['-a', '-s', '-screen 0 1600x900x24', electron, ...args], { cwd: root })
  : spawn(electron, args, { cwd: root });

let log = '';
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`The app did not start the MCP server:\n${log.slice(-2000)}`)), 60000);
  const onData = (d) => {
    log += d;
    const m = /\[mcp\] listening on (\S+)/.exec(log);
    if (m) { clearTimeout(timer); resolve(m[1]); }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The app exited early (${code}):\n${log.slice(-2000)}`)); });
});

const results = [];
const ok = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'ok' : 'FAIL'} ${name}${cond ? '' : ` ${extra}`}`); };

const client = new Client({ name: 'openstudio-e2e', version: '1.0.0' });
let failed = true;
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const run = async (name, a = {}) => {
    const res = await client.callTool({ name, arguments: a });
    const text = res.content.find((c) => c.type === 'text')?.text;
    return { res, error: res.isError ? text : null, value: res.isError || !text ? null : JSON.parse(text) };
  };
  const must = async (name, a) => {
    const r = await run(name, a);
    if (r.error) throw new Error(`${name} failed: ${r.error}`);
    return r.value;
  };

  const { tools } = await client.listTools();
  ok('tools are listed', tools.length >= 40 && tools.some((t) => t.name === 'screenshot') && tools.some((t) => t.name === 'render_audio'), `(${tools.length})`);

  // the instrument bank loads asynchronously after start-up
  let catalog = null;
  for (let i = 0; i < 100 && !catalog; i++) {
    const r = await run('list_catalog', { kind: 'instruments', query: 'Grand Piano' });
    catalog = r.value;
    if (!catalog) await new Promise((res) => setTimeout(res, 200));
  }
  ok('instrument bank is available to agents', catalog?.instruments?.[0]?.name === 'Grand Piano');

  // compose a short piece
  await must('set_project', { name: 'MCP demo', bpm: 120, mode: 'song' });
  const piano = await must('add_channel', { type: 'instrument', instrument: 'Grand Piano', mixer: 6 });
  const pattern = (await must('get_project')).patterns[0].id;
  await must('set_notes', { pattern, channel: piano.id, notes: [
    ...['C5', 'E5', 'G5'].map((pitch) => ({ pitch, start: 0, length: 8, velocity: 0.7 })),
    ...['A4', 'C5', 'E5'].map((pitch) => ({ pitch, start: 8, length: 8, velocity: 0.7 })),
  ] });
  await must('set_steps', { channel: 'Kick', grid: 'x...x...x...x...' });
  await must('set_steps', { channel: 'Hat', grid: '..x...x...x...x.' });
  await must('add_clips', { clips: [{ type: 'pattern', pattern, track: 0, start: 0, length: 64 }] });
  await must('set_effect', { track: 6, type: 'reverb', params: { mix: 0.25 } });
  await must('create_automation', { target: { kind: 'mixer', track: 6, param: 'vol' }, length: 64, points: [{ step: 0, value: 0.4 }, { step: 64, value: 0.8 }] });

  const project = await must('get_project');
  ok('project reflects the edits', project.bpm === 120 && project.name === 'MCP demo' && project.channels.length === 5 && project.playlist.clipCount === 2 && project.unsavedChanges);

  // render and listen (analytically)
  const mix = await must('render_audio', { scope: 'song' });
  ok('rendered mix has signal', !mix.silent && mix.peakDb > -30 && mix.peakDb <= 0.5, JSON.stringify({ peak: mix.peakDb, warnings: mix.warnings }));
  ok('analysis includes timeline and spectrum', mix.timeline.length >= 4 && mix.spectrum?.energyShare && mix.bars === 4);
  const pianoOnly = await must('render_audio', { scope: 'song', channel: piano.id });
  const drumsOnly = await must('render_audio', { scope: 'song', channel: 'Kick' });
  ok('single-channel renders differ', pianoOnly.spectrum.centroidHz > drumsOnly.spectrum.centroidHz, `${pianoOnly.spectrum.centroidHz} vs ${drumsOnly.spectrum.centroidHz}`);
  await must('update_channel', { channel: piano.id, mute: true });
  const muted = await must('render_audio', { scope: 'song' });
  ok('muting a channel changes the render', muted.rmsDb < mix.rmsDb);
  await must('update_channel', { channel: piano.id, mute: false });
  const wav = join(work, 'mix.wav');
  const written = await must('render_audio', { scope: 'pattern', path: wav });
  ok('render can be written to a wav file', written.path === wav && statSync(wav).size > 10000 && readFileSync(wav).subarray(0, 4).toString() === 'RIFF');

  // transport
  await must('transport', { action: 'seek', bar: 1 });
  const playing = await must('transport', { action: 'play' });
  await new Promise((res) => setTimeout(res, 700));
  const later = await must('transport', { action: 'status' });
  ok('transport plays and advances', playing.playing && later.playing && later.positionSteps > 0);
  const stopped = await must('transport', { action: 'stop' });
  ok('transport stops', !stopped.playing);

  // the window can be seen
  const shot = await client.callTool({ name: 'screenshot', arguments: {} });
  const img = shot.content.find((c) => c.type === 'image');
  ok('screenshot returns a PNG', img?.mimeType === 'image/png' && Buffer.from(img.data, 'base64').subarray(1, 4).toString() === 'PNG');

  // files, safety and undo
  const osp = join(work, 'song.osp');
  const refused = await run('new_project');
  ok('unsaved work is protected', /unsaved changes/.test(refused.error ?? ''));
  await must('save_project', { path: osp });
  await must('new_project');
  ok('new project is clean', (await must('get_project')).channels.length === 4);
  const reopened = await must('open_project', { path: osp });
  ok('saved project reopens intact', reopened.name === 'song' && reopened.channels.length === 5 && reopened.playlist.clipCount === 2 && reopened.automations.length === 1);
  const mid = join(work, 'song.mid');
  await must('export_midi', { path: mid });
  ok('midi export writes a file', readFileSync(mid).subarray(0, 4).toString() === 'MThd');

  await must('set_project', { bpm: 77 });
  await must('history', { action: 'undo' });
  ok('undo reverts agent edits', (await must('get_project')).bpm === 120);

  const bad = await run('set_notes', { channel: piano.id, notes: [{ pitch: 'H9', start: 0, length: 1 }] });
  ok('errors are reported as tool errors', bad.res.isError && /not a pitch/.test(bad.error));
  const invalid = await run('set_project', { bpm: 'fast' });
  ok('invalid arguments are rejected clearly', invalid.res.isError && /bpm must be number/.test(invalid.error));

  failed = results.some((r) => !r);
} catch (err) {
  console.error(err.stack || err);
} finally {
  await client.close().catch(() => {});
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 3000).unref();
  rmSync(work, { recursive: true, force: true });
}
console.log(failed ? '\nMCP E2E FAILED' : '\nMCP E2E passed');
process.exit(failed ? 1 : 0);
