// Wallpaper presets, custom-image import and "theme from wallpaper" palette extraction.
import { THEMES, toHsl, fromHsl, contrast, luminance, mix } from './theme.js';

export const SOLIDS = ['#1b1f24', '#2b2f36', '#1f2a37', '#22302b', '#2f2433', '#3a2a24', '#11161d', '#4a5560', '#c8ced4', '#e8e2d6'];

/** Gradients are kept as stops so they can be drawn to a canvas for colour extraction too. */
export const GRADIENTS = [
  { id: 'dusk', name: 'Dusk', angle: 160, stops: ['#2a2140', '#7a4a6a', '#e3946a'] },
  { id: 'lagoon', name: 'Lagoon', angle: 150, stops: ['#0f2027', '#203a43', '#2c5364'] },
  { id: 'ember', name: 'Ember', angle: 135, stops: ['#1f1c18', '#5a2d1a', '#b8572b'] },
  { id: 'orchid', name: 'Orchid', angle: 140, stops: ['#1d1730', '#4b2c5e', '#9d4d8c'] },
  { id: 'moss', name: 'Moss', angle: 160, stops: ['#151d17', '#2f4733', '#6e8b5a'] },
  { id: 'steel', name: 'Steel', angle: 180, stops: ['#3b4652', '#232a31', '#14181c'] },
  { id: 'sunrise', name: 'Sunrise', angle: 180, stops: ['#ffd1a8', '#f7a3a0', '#8f7fc8'] },
  { id: 'glacier', name: 'Glacier', angle: 170, stops: ['#e9f1f6', '#bcd3e2', '#7fa6c4'] },
];
export const gradientCss = (g) => `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})`;

export const IMAGES = [
  { id: 'aurora', name: 'Aurora' },
  { id: 'dunes', name: 'Dunes' },
  { id: 'peaks', name: 'Peaks' },
  { id: 'waveform', name: 'Waveform' },
  { id: 'topography', name: 'Topography' },
  { id: 'bokeh', name: 'Bokeh' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'felt', name: 'Felt' },
].map((w) => ({ ...w, url: `assets/wallpapers/${w.id}.svg` }));

// ------------------------------------------------------------------ loading
const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not read that image'));
  img.src = src;
});

/** A bundled wallpaper as a same-origin blob image (file:// images would taint the canvas). */
async function loadAssetImage(url) {
  const buf = await window.studioAPI.readAsset(url.replace(/^assets\//, ''));
  const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'image/svg+xml' }));
  try { return await loadImage(blobUrl); } finally { setTimeout(() => URL.revokeObjectURL(blobUrl), 1000); }
}

/** Read a user-picked image file and re-encode it small enough to keep in local storage. */
export async function importImageFile(file, maxSide = 2560, quality = 0.88) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}

/** Small canvas of the wallpaper for sampling. */
async function sampleCanvas(wallpaper, customImage) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 54;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (wallpaper.kind === 'solid') {
    ctx.fillStyle = wallpaper.value; ctx.fillRect(0, 0, 96, 54);
  } else if (wallpaper.kind === 'gradient') {
    const g = GRADIENTS.find((x) => gradientCss(x) === wallpaper.value) || GRADIENTS[0];
    const grad = ctx.createLinearGradient(0, 0, 0, 54);
    g.stops.forEach((s, i) => grad.addColorStop(i / (g.stops.length - 1), s));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 96, 54);
  } else {
    const img = wallpaper.kind === 'preset' ? await loadAssetImage(wallpaper.value) : await loadImage(customImage);
    // cover-crop like the wallpaper itself
    const k = Math.max(96 / img.naturalWidth, 54 / img.naturalHeight);
    const w = img.naturalWidth * k, hh = img.naturalHeight * k;
    ctx.drawImage(img, (96 - w) / 2, (54 - hh) / 2, w, hh);
  }
  return ctx.getImageData(0, 0, 96, 54).data;
}

// ------------------------------------------------------------------ palette
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Theme base colours that suit the wallpaper: tinted neutrals from its dominant hue, accent from its most vivid colour. */
export async function themeFromWallpaper(wallpaper, customImage) {
  const data = await sampleCanvas(wallpaper, customImage);
  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => ({ n: 0, s: 0, l: 0, hx: 0, hy: 0 }));
  let total = 0, sumL = 0, sumS = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [hh, s, l] = toHsl([data[i], data[i + 1], data[i + 2]]);
    total++; sumL += l; sumS += s;
    if (s < 0.12 || l < 0.06 || l > 0.96) continue;
    const b = bins[Math.floor(hh / (360 / BINS)) % BINS];
    b.n++; b.s += s; b.l += l;
    b.hx += Math.cos((hh * Math.PI) / 180); b.hy += Math.sin((hh * Math.PI) / 180);
  }
  const avgL = sumL / Math.max(1, total), avgS = sumS / Math.max(1, total);
  const light = avgL > 0.62;
  const groups = bins.filter((b) => b.n > 0).map((b) => ({
    hue: ((Math.atan2(b.hy, b.hx) * 180) / Math.PI + 360) % 360,
    n: b.n / total, s: b.s / b.n, l: b.l / b.n,
  }));

  // neutrals are tinted towards the most common hue
  const dominant = groups.slice().sort((a, b) => b.n - a.n)[0];
  const hue = dominant ? dominant.hue : 210;
  const tint = dominant ? Math.min(0.32, Math.max(0.08, avgS * 0.8)) : 0.06;

  // accent: vivid and reasonably present
  const vivid = groups.map((g) => ({ ...g, score: Math.sqrt(g.n) * g.s * g.s * (1 - Math.abs(g.l - 0.55)) })).sort((a, b) => b.score - a.score);
  const acc = vivid[0];
  const fallback = THEMES.slate;

  let base;
  if (light) {
    base = {
      bg: fromHsl(hue, tint * 0.8, 0.8), surface: fromHsl(hue, tint * 0.6, 0.93),
      grid: fromHsl(hue, tint * 0.7, 0.87), text: fromHsl(hue, 0.2, 0.15),
    };
  } else {
    base = {
      bg: fromHsl(hue, tint, 0.1), surface: fromHsl(hue, tint * 0.85, 0.145),
      grid: fromHsl(hue, tint * 1.1, 0.18), text: fromHsl(hue, 0.14, 0.86),
    };
  }
  base.accent = acc && acc.s > 0.2 ? fromHsl(acc.hue, Math.min(0.9, Math.max(0.6, acc.s)), light ? 0.45 : 0.62) : fallback.accent;
  // the highlight colour stays green-ish (it means "playing / on"), borrowing a green from the image when there is one
  const greenish = vivid.find((g) => g.hue >= 70 && g.hue <= 175 && (!acc || hueDist(g.hue, acc.hue) > 40));
  base.green = greenish ? fromHsl(greenish.hue, Math.min(0.75, Math.max(0.45, greenish.s)), light ? 0.38 : 0.58) : (light ? '#3d9a2e' : fallback.green);
  base.red = light ? '#d23a32' : fallback.red;

  // legibility guards
  for (let i = 0; i < 10 && contrast(base.accent, base.surface) < 3; i++) base.accent = mix(base.accent, light ? '#000000' : '#ffffff', 0.12);
  for (let i = 0; i < 10 && contrast(base.text, base.surface) < 8; i++) base.text = mix(base.text, luminance(base.surface) > 0.3 ? '#000000' : '#ffffff', 0.25);
  return base;
}
