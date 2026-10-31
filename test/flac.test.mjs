import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeFlac } from '../src/audio/flac.js';

class FakeBuffer {
  constructor(ch, n, sr) { this.numberOfChannels = ch; this.length = n; this.sampleRate = sr; this.d = Array.from({ length: ch }, () => new Float32Array(n)); }
  getChannelData(c) { return this.d[c]; }
}

function signal(channels, n, sr) {
  const b = new FakeBuffer(channels, n, sr);
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    b.d[0][i] = 0.6 * Math.sin(i / 13) * Math.cos(i / 5000) + (seed / 2 ** 32 - 0.5) * 0.05;
    if (channels > 1) b.d[1][i] = i % 30000 < 9000 ? 0 : 1.2 * Math.sin(i / 3); // silence and clipping
  }
  return b;
}

test('FLAC stream has a valid header and compresses', async () => {
  const b = signal(2, 44100 * 2 + 77, 44100);
  const out = new Uint8Array(await encodeFlac(b));
  assert.equal(String.fromCharCode(...out.subarray(0, 4)), 'fLaC');
  assert.equal(out[4] & 0x7f, 0, 'STREAMINFO');
  assert.ok(out.length < b.length * 4 * 0.8, `${out.length} bytes`);
});

const hasFlac = spawnSync('flac', ['--version']).status === 0;
test('the reference decoder reads it back bit for bit', { skip: !hasFlac && 'flac is not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'osflac-'));
  for (const [ch, sr] of [[2, 44100], [1, 48000]]) {
    const b = signal(ch, sr * 3 + 1234, sr);
    writeFileSync(join(dir, 'a.flac'), Buffer.from(await encodeFlac(b)));
    const res = spawnSync('flac', ['-d', '-f', '--force-raw-format', '--endian=little', '--sign=signed', '-o', join(dir, 'a.raw'), join(dir, 'a.flac')]);
    assert.equal(res.status, 0, res.stderr.toString());
    const raw = readFileSync(join(dir, 'a.raw'));
    assert.equal(raw.length, b.length * ch * 2);
    for (let i = 0; i < b.length; i += 97) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, b.d[c][i]));
        assert.equal(raw.readInt16LE((i * ch + c) * 2), Math.round(s < 0 ? s * 0x8000 : s * 0x7fff));
      }
    }
  }
});
