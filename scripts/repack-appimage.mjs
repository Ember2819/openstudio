#!/usr/bin/env node
// Rebuild an AppImage with the statically-linked AppImage runtime from
// https://github.com/AppImage/type2-runtime (libfuse2 compiled in).
//
// Why: electron-builder's AppImage runtime dlopen()s libfuse.so.2, which modern
// distros (Ubuntu 24.04+, Fedora 40+, ...) no longer ship by default, so a
// freshly downloaded OpenStudio AppImage fails with
// "dlopen(): error loading libfuse.so.2" until the user installs extra packages.
// The official static runtime has libfuse2 linked in (and falls back to
// extracting to a temp dir if FUSE is unavailable), so the AppImage runs
// out of the box. The squashfs payload is identical — we only splice a new
// runtime in front of it.
//
// Usage: node scripts/repack-appimage.mjs <input.AppImage> <runtimeFile> [output.AppImage]

import { readFileSync, writeFileSync, chmodSync } from 'node:fs';

const [input, runtimeFile, outputArg] = process.argv.slice(2);
if (!input || !runtimeFile) {
  console.error('Usage: node scripts/repack-appimage.mjs <input.AppImage> <runtimeFile> [output.AppImage]');
  process.exit(1);
}

const appImage = readFileSync(input);
const runtime = readFileSync(runtimeFile);

// Sanity checks: both parts must be ELF binaries.
for (const [name, buf] of [['appimage', appImage], ['runtime', runtime]]) {
  if (buf.subarray(0, 4).toString() !== '\x7fELF') {
    console.error(`${name} does not look like an ELF binary`);
    process.exit(1);
  }
}

// The squashfs payload ("hsqs" magic) starts right after the old runtime.
// Find its offset: take the last occurrence (an earlier match can appear
// inside the runtime binary itself).
const SQUASHFS_MAGIC = Buffer.from('hsqs');
const offset = appImage.lastIndexOf(SQUASHFS_MAGIC);
if (offset < 0) {
  console.error('No squashfs payload found in AppImage');
  process.exit(1);
}

const output = outputArg || input;
const out = Buffer.concat([runtime, appImage.subarray(offset)]);
writeFileSync(output, out);
chmodSync(output, 0o755);

console.log(`Repacked ${input} -> ${output} (static runtime ${runtime.length} bytes, payload at ${offset})`);
