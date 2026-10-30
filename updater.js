// Self-update support for the Electron main process: finds the newest GitHub release, picks the package that
// matches this platform/architecture, and downloads it with checksum verification. Deliberately free of any
// `electron` import so the logic can be unit tested; main.js wires it to IPC and handles install/restart.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Releases are tagged with the package version (see release.yml), and each
// release must increase that version instead of reusing it for a new build.
const TAG_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-build(\d+))?$/;
const TRUSTED_HOSTS = [/^github\.com$/, /(^|\.)githubusercontent\.com$/];

const PLATFORM_NAME = { win32: 'windows', linux: 'linux', darwin: 'macos' };
const PACKAGE_SUFFIX = { win32: '-portable.exe', linux: '.AppImage', darwin: '.dmg' };

function parseTag(tag) {
  const m = TAG_RE.exec(String(tag || '').trim());
  return m ? { version: [Number(m[1]), Number(m[2]), Number(m[3])], build: m[4] == null ? 0 : Number(m[4]) } : null;
}

/** <0, 0 or >0 like a comparator: positive when `a` is newer than `b`. */
function compareBuilds(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.version[i] !== b.version[i]) return a.version[i] - b.version[i];
  }
  return a.build - b.build;
}

/** Repo slug ("owner/name") from package.json's `repository` field. */
function repoSlug(pkg) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const m = /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/.exec(url || '');
  if (!m) throw new Error('package.json has no GitHub repository URL');
  return m[1];
}

/** The release asset built for this platform and CPU architecture, e.g. OpenStudio-0.2.0-linux-x64.AppImage. */
function pickAsset(assets, platform, arch) {
  const os = PLATFORM_NAME[platform];
  const suffix = PACKAGE_SUFFIX[platform];
  if (!os) return null;
  const hit = (assets || []).find((a) => a.name.includes(`-${os}-${arch}`) && a.name.endsWith(suffix));
  if (!hit) return null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(hit.digest || '');
  return { name: hit.name, url: hit.browser_download_url, size: hit.size || 0, sha256: digest ? digest[1].toLowerCase() : null };
}

function isTrustedUrl(url, repo) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && TRUSTED_HOSTS.some((re) => re.test(u.hostname)) &&
      (u.hostname !== 'github.com' || u.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases/download/`));
  } catch {
    return false;
  }
}

/**
 * Compare `current` ({ version: "0.2.0", build: number|null }) with the newest published release.
 * Resolves to { status: 'current' | 'available' | 'unknown', latest, asset } — `unknown` means this is an
 * unstamped (development) build whose position in the release history can't be determined.
 */
async function checkForUpdate({ repo, current, platform = process.platform, arch = process.arch, fetchImpl = fetch }) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenStudio-updater' },
    signal: AbortSignal.timeout(15000),
  });
  // GitHub also answers 404 for private repositories, so this must not be mistaken for "up to date"
  if (res.status === 404) throw new Error('No public releases were found for this project. If the project\'s GitHub repository is private, updates can\'t be checked until its releases are made public.');
  if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`.trim());
  const rel = await res.json();

  const remote = parseTag(rel.tag_name);
  if (!remote) throw new Error(`Unrecognised release tag "${rel.tag_name}"`);
  const latest = { tag: rel.tag_name, name: rel.name || rel.tag_name, url: rel.html_url, published: rel.published_at, build: remote.build, version: remote.version.join('.') };

  const here = parseTag(current.version);
  let status;
  if (current.build == null || !here) {
    // unstamped build: only a strictly higher package version is provably newer
    const newerVersion = compareBuilds({ ...remote, build: 0 }, { version: here?.version ?? [0, 0, 0], build: 0 }) > 0;
    status = newerVersion ? 'available' : 'unknown';
  } else status = compareBuilds(remote, { version: here.version, build: current.build }) > 0 ? 'available' : 'current';

  const asset = pickAsset(rel.assets, platform, arch);
  if (status === 'available' && asset && !isTrustedUrl(asset.url, repo)) throw new Error('Release asset URL is not a GitHub download');
  return { status, latest, asset };
}

/**
 * Stream `asset` to `dest`, reporting progress and verifying the SHA-256 digest GitHub publishes for the asset.
 * The partial file is removed on any failure, including cancellation through `signal`.
 */
async function downloadAsset({ asset, repo, dest, onProgress = () => {}, signal, fetchImpl = fetch }) {
  if (!isTrustedUrl(asset.url, repo)) throw new Error('Refusing to download from an untrusted address');
  let out;
  try {
    const res = await fetchImpl(asset.url, { headers: { 'User-Agent': 'OpenStudio-updater' }, signal });
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`.trim());
    // GitHub redirects release downloads to its CDN; make sure the final hop is still a GitHub host over https
    if (res.url) {
      const final = new URL(res.url);
      if (final.protocol !== 'https:' || !TRUSTED_HOSTS.some((re) => re.test(final.hostname))) throw new Error('Download was redirected to an untrusted host');
    }

    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    const hash = crypto.createHash('sha256');
    out = fs.createWriteStream(dest, { mode: 0o755 });
    let received = 0;
    for await (const chunk of res.body) {
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      received += chunk.length;
      onProgress({ received, total });
    }
    await new Promise((resolve, reject) => { out.once('error', reject); out.end(resolve); });

    if (asset.size && received !== asset.size) throw new Error(`Download was incomplete (${received} of ${asset.size} bytes)`);
    const got = hash.digest('hex');
    if (asset.sha256 && got !== asset.sha256) throw new Error('Checksum mismatch — the downloaded file is corrupt, so it was discarded');
    return dest;
  } catch (err) {
    out?.destroy();
    await fs.promises.rm(dest, { force: true });
    throw err;
  }
}

/** Build info stamped into the package by scripts/stamp-build.mjs; null for a development checkout. */
function readBuildInfo(dir) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'buildinfo.json'), 'utf8'));
    return Number.isInteger(info.build) ? info : null;
  } catch {
    return null;
  }
}

module.exports = { parseTag, compareBuilds, repoSlug, pickAsset, isTrustedUrl, checkForUpdate, downloadAsset, readBuildInfo };
