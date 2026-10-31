#!/usr/bin/env node
// Launches the real app (headless via xvfb when there is no display), runs test/e2e/smoke.js inside it
// and fails on any "FAIL" line or renderer error.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electron = join(root, 'node_modules', '.bin', 'electron');
// every test/e2e/*.js script is run in its own app launch; a script is one IIFE that resolves to "ok …"/"FAIL …" lines
// `npm run test:e2e -- voices` runs only the scripts whose names contain one of the arguments
const only = process.argv.slice(2);
const scripts = readdirSync(join(root, 'test/e2e')).filter((f) => f.endsWith('.js') && (!only.length || only.some((o) => f.includes(o)))).sort();
const shot = join(mkdtempSync(join(tmpdir(), 'openstudio-e2e-')), 'screenshot.png');

if (!existsSync(join(root, 'assets/soundfonts/GeneralUser-GS.sf2'))) {
  console.error('Missing instrument bank — run `npm run assets` first.');
  process.exit(2);
}

function runScript(name) {
  const script = readFileSync(join(root, 'test/e2e', name), 'utf8');
  const args = ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'openstudio-ud-'))}`,
    '--no-mcp', `--screenshot=${shot}`, '--wait=2500', `--eval=${script}`, '--after=300',
    // a fake microphone (a test tone) for the audio-recording test
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  const cmd = headless ? 'xvfb-run' : electron;
  const full = headless ? ['-a', '-s', '-screen 0 1600x900x24', electron, ...args] : args;

  const res = spawnSync(cmd, full, { cwd: root, encoding: 'utf8', timeout: 300000 });
  const out = `${res.stdout}\n${res.stderr}`;
  const evalLine = out.split('\n').find((l) => l.startsWith('[eval] '));
  const errors = out.split('\n').filter((l) => l.startsWith('[renderer]') && !/ResizeObserver loop/.test(l));
  if (!evalLine) {
    console.error(out.slice(-3000));
    console.error(`E2E: ${name}: the app did not report results`);
    return false;
  }
  const lines = JSON.parse(evalLine.slice(7)).split('\n');
  console.log(`# ${name}`);
  for (const l of lines) console.log(l);
  for (const e of errors) console.log(`FAIL renderer error: ${e}`);
  return !lines.some((l) => l.startsWith('FAIL')) && errors.length === 0;
}

const results = scripts.map(runScript);
const failed = results.some((r) => !r);
console.log(failed ? '\nE2E FAILED' : '\nE2E passed');
process.exit(failed ? 1 : 0);
