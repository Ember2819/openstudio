import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const u = createRequire(import.meta.url)('../updater.js');
const REPO = 'Ember2819/openstudio';
const dl = (name) => `https://github.com/${REPO}/releases/download/v0.2.0-build9/${name}`;

test('parseTag reads version and build number', () => {
  assert.deepEqual(u.parseTag('v0.2.0-build57'), { version: [0, 2, 0], build: 57 });
  assert.deepEqual(u.parseTag('1.4.10'), { version: [1, 4, 10], build: 0 });
  assert.equal(u.parseTag('nightly'), null);
});

test('compareBuilds orders by version, then build number', () => {
  const v = (t) => u.parseTag(t);
  assert.ok(u.compareBuilds(v('v0.2.0-build10'), v('v0.2.0-build9')) > 0);
  assert.ok(u.compareBuilds(v('v0.3.0-build1'), v('v0.2.0-build99')) > 0);
  assert.ok(u.compareBuilds(v('v0.2.0-build5'), v('v0.2.0-build5')) === 0);
  assert.ok(u.compareBuilds(v('v0.2.0-build5'), v('v0.2.1-build1')) < 0);
});

test('repoSlug is taken from package.json', () => {
  assert.equal(u.repoSlug({ repository: { url: 'git+https://github.com/Ember2819/openstudio.git' } }), REPO);
  assert.equal(u.repoSlug({ repository: 'https://github.com/a/b' }), 'a/b');
  assert.throws(() => u.repoSlug({}));
});

const assets = [
  { name: 'OpenStudio-0.2.0-windows-x64-portable.exe', browser_download_url: dl('w64.exe'), size: 3 },
  { name: 'OpenStudio-0.2.0-windows-arm64-portable.exe', browser_download_url: dl('wa.exe'), size: 3 },
  { name: 'OpenStudio-0.2.0-linux-x64.AppImage', browser_download_url: dl('l64.AppImage'), size: 3, digest: `sha256:${'ab'.repeat(32)}` },
  { name: 'OpenStudio-0.2.0-linux-arm64.AppImage', browser_download_url: dl('la.AppImage'), size: 3 },
  { name: 'OpenStudio-0.2.0-macos-arm64.dmg', browser_download_url: dl('m.dmg'), size: 3 },
];

test('pickAsset matches platform and architecture', () => {
  assert.equal(u.pickAsset(assets, 'linux', 'x64').name, 'OpenStudio-0.2.0-linux-x64.AppImage');
  assert.equal(u.pickAsset(assets, 'linux', 'arm64').name, 'OpenStudio-0.2.0-linux-arm64.AppImage');
  assert.equal(u.pickAsset(assets, 'win32', 'arm64').name, 'OpenStudio-0.2.0-windows-arm64-portable.exe');
  assert.equal(u.pickAsset(assets, 'darwin', 'arm64').name, 'OpenStudio-0.2.0-macos-arm64.dmg');
  assert.equal(u.pickAsset(assets, 'darwin', 'x64'), null);
  assert.equal(u.pickAsset(assets, 'freebsd', 'x64'), null);
  assert.equal(u.pickAsset(assets, 'linux', 'x64').sha256, 'ab'.repeat(32));
});

test('isTrustedUrl only accepts this repo\'s GitHub downloads and GitHub CDNs', () => {
  assert.ok(u.isTrustedUrl(dl('x'), REPO));
  assert.ok(u.isTrustedUrl('https://objects.githubusercontent.com/abc', REPO));
  assert.ok(!u.isTrustedUrl('http://github.com/Ember2819/openstudio/releases/download/x', REPO));
  assert.ok(!u.isTrustedUrl('https://github.com/evil/repo/releases/download/x', REPO));
  assert.ok(!u.isTrustedUrl('https://githubusercontent.com.evil.com/x', REPO));
  assert.ok(!u.isTrustedUrl('not a url', REPO));
});

const json = (body, status = 200) => async () => ({ ok: status < 300, status, statusText: '', json: async () => body });
const release = (tag) => ({ tag_name: tag, name: tag, html_url: 'https://github.com/x', assets });

test('checkForUpdate reports available / current / unknown', async () => {
  const run = (current, tag) => u.checkForUpdate({ repo: REPO, current, platform: 'linux', arch: 'x64', fetchImpl: json(release(tag)) });
  assert.equal((await run({ version: '0.2.0', build: 5 }, 'v0.2.0-build9')).status, 'available');
  assert.equal((await run({ version: '0.2.0', build: 9 }, 'v0.2.0-build9')).status, 'current');
  assert.equal((await run({ version: '0.2.0', build: 12 }, 'v0.2.0-build9')).status, 'current');
  assert.equal((await run({ version: '0.1.0', build: 99 }, 'v0.2.0-build1')).status, 'available');
  assert.equal((await run({ version: '0.2.0', build: null }, 'v0.2.0-build9')).status, 'unknown');
  assert.equal((await run({ version: '0.1.0', build: null }, 'v0.2.0-build9')).status, 'available');
  assert.equal((await run({ version: '0.2.0', build: 5 }, 'v0.2.0-build9')).asset.name, 'OpenStudio-0.2.0-linux-x64.AppImage');
});

test('checkForUpdate reports a missing repository and API errors', async () => {
  await assert.rejects(u.checkForUpdate({ repo: REPO, current: { version: '0.2.0', build: 1 }, fetchImpl: json({}, 404) }), /No public releases/);
  await assert.rejects(u.checkForUpdate({ repo: REPO, current: { version: '0.2.0', build: 1 }, fetchImpl: json({}, 403) }), /403/);
  await assert.rejects(u.checkForUpdate({ repo: REPO, current: { version: '0.2.0', build: 1 }, fetchImpl: json(release('latest')) }), /tag/);
});

// --- downloads -----------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openstudio-updater-'));
const payload = Buffer.from('hello update');
const sha = crypto.createHash('sha256').update(payload).digest('hex');
const body = (chunks) => ({
  ok: true, status: 200, statusText: '', url: 'https://objects.githubusercontent.com/x',
  headers: { get: () => String(payload.length) },
  body: (async function* () { for (const c of chunks) yield c; })(),
});
const asset = (over = {}) => ({ name: 'a', url: dl('a'), size: payload.length, sha256: sha, ...over });

test('downloadAsset writes the file, reports progress and verifies the checksum', async () => {
  const dest = path.join(tmp, 'ok.bin');
  const seen = [];
  await u.downloadAsset({ asset: asset(), repo: REPO, dest, onProgress: (p) => seen.push(p.received), fetchImpl: async () => body([payload.subarray(0, 5), payload.subarray(5)]) });
  assert.deepEqual(fs.readFileSync(dest), payload);
  assert.deepEqual(seen, [5, payload.length]);
});

test('downloadAsset discards corrupt, truncated and untrusted downloads', async () => {
  const bad = path.join(tmp, 'bad.bin');
  await assert.rejects(u.downloadAsset({ asset: asset({ sha256: '0'.repeat(64) }), repo: REPO, dest: bad, fetchImpl: async () => body([payload]) }), /Checksum/);
  assert.ok(!fs.existsSync(bad));

  const short = path.join(tmp, 'short.bin');
  await assert.rejects(u.downloadAsset({ asset: asset(), repo: REPO, dest: short, fetchImpl: async () => body([payload.subarray(0, 4)]) }), /incomplete/);
  assert.ok(!fs.existsSync(short));

  const evil = path.join(tmp, 'evil.bin');
  await assert.rejects(u.downloadAsset({ asset: asset({ url: 'https://evil.example/a' }), repo: REPO, dest: evil, fetchImpl: async () => body([payload]) }), /untrusted/);
  await assert.rejects(u.downloadAsset({ asset: asset(), repo: REPO, dest: evil, fetchImpl: async () => ({ ...body([payload]), url: 'https://evil.example/a' }) }), /untrusted/);
  assert.ok(!fs.existsSync(evil));
});

test('readBuildInfo returns null without a valid buildinfo.json', () => {
  assert.equal(u.readBuildInfo(tmp), null);
  fs.writeFileSync(path.join(tmp, 'buildinfo.json'), '{"build":42}');
  assert.equal(u.readBuildInfo(tmp).build, 42);
  fs.writeFileSync(path.join(tmp, 'buildinfo.json'), '{"build":"x"}');
  assert.equal(u.readBuildInfo(tmp), null);
});
