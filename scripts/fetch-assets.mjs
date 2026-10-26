#!/usr/bin/env node
// Downloads the large audio assets that are intentionally not stored in git.
// Usage: npm run assets            (skips files that are already present and valid)
//        npm run assets -- --force (re-download)
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/97049183643d5fc5a9322a69c5b09efb667c6c3a';

const ASSETS = [
  {
    name: 'GeneralUser GS SoundFont',
    url: `${REPO}/GeneralUser-GS.sf2`,
    dest: 'assets/soundfonts/GeneralUser-GS.sf2',
    sha256: '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe',
  },
  {
    name: 'GeneralUser GS license',
    url: `${REPO}/documentation/LICENSE.txt`,
    dest: 'assets/soundfonts/GeneralUser-GS-LICENSE.txt',
    sha256: null,
  },
];

const force = process.argv.includes('--force');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

for (const asset of ASSETS) {
  const file = join(root, asset.dest);
  if (!force && existsSync(file) && (!asset.sha256 || sha(await readFile(file)) === asset.sha256)) {
    console.log(`✓ ${asset.name} already present`);
    continue;
  }
  process.stdout.write(`↓ ${asset.name}… `);
  const res = await fetch(asset.url);
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${asset.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (asset.sha256 && sha(buf) !== asset.sha256) throw new Error(`checksum mismatch for ${asset.name}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buf);
  console.log(`${(buf.length / 1048576).toFixed(1)} MB`);
}
