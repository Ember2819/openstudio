import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeMp3 } from '../src/audio/mp3.js';
import { HUFFMAN } from '../src/audio/mp3tables.js';

const buffer = (sampleRate, channels, length, fn) => {
  const data = Array.from({ length: channels }, (_, c) => Float32Array.from({ length }, (_, i) => fn(i / sampleRate, c)));
  return { numberOfChannels: channels, sampleRate, length, getChannelData: (c) => data[c] };
};
const music = (t, c) => 0.3 * Math.sin(2 * Math.PI * (220 + 110 * c) * t + 20 * t * t) + 0.1 * Math.sin(2 * Math.PI * 2500 * t) * Math.exp(-((t % 0.25) * 12));

test('the Huffman tables are complete prefix codes', () => {
  for (const [t, codes] of Object.entries(HUFFMAN)) {
    const kraft = codes.reduce((s, c) => s + 2 ** -Math.floor(c / 2 ** 20), 0);
    assert.ok(Math.abs(kraft - 1) < 1e-9, `table ${t}`);
  }
});

test('frames: sync words, CBR sizes with padding, an Info tag with the delay and padding', async () => {
  for (const [rate, kbps, channels] of [[44100, 320, 2], [48000, 192, 1], [32000, 256, 2]]) {
    const len = Math.round(rate * 0.7);
    const bytes = new Uint8Array(await encodeMp3(buffer(rate, channels, len, music), { bitrate: kbps }));
    let p = 0;
    let frames = 0;
    while (p < bytes.length) {
      const h = (bytes[p] << 24 | bytes[p + 1] << 16 | bytes[p + 2] << 8 | bytes[p + 3]) >>> 0;
      assert.equal(h >>> 21, 0x7ff, `sync at ${p}`);
      const padding = (h >> 9) & 1;
      p += Math.floor((144000 * kbps) / rate) + padding;
      frames++;
    }
    assert.equal(p, bytes.length, 'the last frame ends the file');
    const side = channels === 2 ? 32 : 17;
    assert.equal(String.fromCharCode(...bytes.subarray(4 + side, 8 + side)), 'Info');
    const dv = new DataView(bytes.buffer);
    assert.equal(dv.getUint32(12 + side), frames - 1, 'audio frame count');
    assert.equal(dv.getUint32(16 + side), bytes.length, 'file size');
    const lame = 4 + side + 4 + 4 + 4 + 4 + 100 + 4;
    assert.equal(String.fromCharCode(...bytes.subarray(lame, lame + 4)), 'LAME');
    const delays = (bytes[lame + 21] << 16) | (bytes[lame + 22] << 8) | bytes[lame + 23];
    assert.equal(delays >> 12, 528);
    assert.equal((frames - 1) * 1152 - (delays >> 12) - (delays & 4095), len, 'delay + padding + length = audio frames');
  }
});

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('decodes back to the input (ffmpeg)', { skip: !ffmpeg && 'ffmpeg is not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openstudio-mp3-'));
  for (const [rate, kbps, channels] of [[44100, 256, 2], [48000, 320, 1], [44100, 128, 2]]) {
    const len = Math.round(rate * 1.5);
    const src = buffer(rate, channels, len, music);
    const file = join(dir, `t${rate}-${kbps}.mp3`);
    writeFileSync(file, Buffer.from(await encodeMp3(src, { bitrate: kbps })));
    const res = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
    assert.equal(res.status, 0, res.stderr?.toString());
    assert.equal(res.stderr.length, 0, `decoder complaints: ${res.stderr}`);
    const out = new Float32Array(res.stdout.buffer, res.stdout.byteOffset, res.stdout.byteLength / 4);
    assert.equal(out.length / channels, len, 'gapless: exactly as long as the input');
    let err = 0, ref = 0;
    for (let c = 0; c < channels; c++) {
      const d = src.getChannelData(c);
      for (let i = 0; i < len; i++) { err += (out[i * channels + c] - d[i]) ** 2; ref += d[i] ** 2; }
    }
    const snr = 10 * Math.log10(ref / err);
    assert.ok(snr > (kbps >= 256 ? 40 : 30), `${rate} Hz ${kbps} kbps: SNR ${snr.toFixed(1)} dB`);
  }
});
