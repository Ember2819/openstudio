#!/usr/bin/env node
// Self-healing pre-flight check run automatically before `npm start`.
// - verifies npm exists (Node is implied already)
// - reinstalls dependencies if node_modules is missing
// - repairs Electron when its binary failed to install (corrupt download
//   cache, skipped postinstall scripts, ...)
// - fetches the audio assets (a no-op when they are already present)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function npmStatus(args) {
  return spawnSync('npm', args, { cwd: root, stdio: 'inherit' }).status ?? 1;
}

function npmAvailable() {
  try {
    execFileSync('npm', ['--version'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 1. npm is available (if we got here through node, Node itself already is)
if (!npmAvailable()) {
  console.error(
    'npm was not found. Install Node.js 22+ from https://nodejs.org (or with your package manager) and try again.'
  );
  process.exit(1);
}

// 2. dependencies present?
const depsDir = join(root, 'node_modules');
if (!existsSync(depsDir) || !existsSync(join(depsDir, 'electron', 'package.json'))) {
  console.log('Dependencies missing — running npm install…');
  if (npmStatus(['install']) !== 0) process.exit(1);
}

// 3. Electron binary intact? (its postinstall may have been skipped, or the
//    download cache may hold a truncated zip)
const electronDir = join(depsDir, 'electron');
const electronOk = (() => {
  try {
    const rel = readFileSync(join(electronDir, 'path.txt'), 'utf8').trim();
    const bin = join(electronDir, 'dist', rel);
    return existsSync(bin) && statSync(bin).size > 0;
  } catch {
    return false;
  }
})();

if (!electronOk) {
  console.log('Electron binary missing — reinstalling it…');
  if (npmStatus(['rebuild', 'electron']) !== 0 && !existsSync(join(electronDir, 'path.txt'))) {
    console.log('npm rebuild did not restore it — trying a forced install…');
    if (npmStatus(['install', 'electron', '--force']) !== 0) {
      console.error('Could not install Electron automatically. Try: rm -rf node_modules/electron && npm install');
      process.exit(1);
    }
  }
}

// 4. audio assets (downloads only what is missing)
if (spawnSync(process.execPath, [join(root, 'scripts', 'fetch-assets.mjs')], { cwd: root, stdio: 'inherit' }).status !== 0) {
  console.warn('Warning: could not fetch audio assets — playback may stay silent until `npm run assets` succeeds.');
}

console.log('Ready — starting OpenStudio…\n');
