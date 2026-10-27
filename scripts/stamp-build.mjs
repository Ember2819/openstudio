#!/usr/bin/env node
// Writes buildinfo.json (gitignored, packaged by electron-builder) so an installed app knows which CI build it is.
// Releases are tagged v<version>-build<run number>, so the run number is what orders them — see updater.js.
// Usage: BUILD_NUMBER=42 GITHUB_SHA=abc… node scripts/stamp-build.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const build = Number.parseInt(process.env.BUILD_NUMBER ?? '', 10);
if (!Number.isInteger(build) || build < 0) {
  console.error('BUILD_NUMBER must be set to a non-negative integer');
  process.exit(1);
}
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'buildinfo.json');
writeFileSync(file, `${JSON.stringify({ build, commit: process.env.GITHUB_SHA ?? null, date: new Date().toISOString() }, null, 2)}\n`);
console.log(`Stamped build ${build} -> ${file}`);
