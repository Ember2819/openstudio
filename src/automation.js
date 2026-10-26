import { faderToGain, channelGain, clamp } from './util.js';
import { EFFECT_DEFS } from './audio/effects.js';
import { PARAM_META } from './audio/instruments.js';

/**
 * Automation targets are small JSON descriptors so they can be saved with the project:
 *   { kind: 'mixer', track, param: 'vol' | 'pan' }
 *   { kind: 'fx', track, slot, key }
 *   { kind: 'channel', id, param: 'vol' | 'pan' }
 *   { kind: 'chparam', id, key }
 * Values are stored normalised (0..1) in automation clips and mapped to the real range here.
 */

function range(store, t) {
  switch (t.kind) {
    case 'mixer':
      return t.param === 'pan' ? { min: -1, max: 1 } : { min: 0, max: 1 };
    case 'channel':
      return t.param === 'pan' ? { min: -1, max: 1 } : { min: 0, max: 1 };
    case 'fx': {
      const slot = store.project.mixer[t.track]?.fx[t.slot];
      const meta = slot && EFFECT_DEFS[slot.type].params.find((p) => p.key === t.key);
      return meta ? { min: meta.min, max: meta.max, log: meta.log } : null;
    }
    case 'chparam': {
      const ch = store.channel(t.id);
      const meta = ch && PARAM_META[ch.type]?.find((p) => p.key === t.key);
      return meta && meta.min != null ? { min: meta.min, max: meta.max, log: meta.log } : null;
    }
    default:
      return null;
  }
}

export function targetValid(store, t) {
  if (!t) return false;
  switch (t.kind) {
    case 'mixer': return !!store.project.mixer[t.track];
    case 'channel': return !!store.channel(t.id);
    case 'fx':
    case 'chparam': return !!range(store, t);
    default: return false;
  }
}

export function normToValue(store, t, n) {
  const r = range(store, t);
  if (!r) return 0;
  n = clamp(n, 0, 1);
  return r.log ? r.min * Math.pow(r.max / r.min, n) : r.min + n * (r.max - r.min);
}

export function valueToNorm(store, t, v) {
  const r = range(store, t);
  if (!r) return 0;
  return clamp(r.log ? Math.log(v / r.min) / Math.log(r.max / r.min) : (v - r.min) / (r.max - r.min), 0, 1);
}

export function readTarget(store, t) {
  switch (t.kind) {
    case 'mixer': return store.project.mixer[t.track][t.param];
    case 'channel': return store.channel(t.id)?.[t.param] ?? 0;
    case 'fx': return store.project.mixer[t.track].fx[t.slot]?.params[t.key] ?? 0;
    case 'chparam': return store.channel(t.id)?.params[t.key] ?? 0;
    default: return 0;
  }
}

export function describeTarget(store, t) {
  switch (t.kind) {
    case 'mixer': return `${store.project.mixer[t.track]?.name ?? 'Mixer'} — ${t.param === 'pan' ? 'Pan' : 'Volume'}`;
    case 'channel': return `${store.channel(t.id)?.name ?? 'Channel'} — ${t.param === 'pan' ? 'Pan' : 'Volume'}`;
    case 'fx': {
      const slot = store.project.mixer[t.track]?.fx[t.slot];
      const meta = slot && EFFECT_DEFS[slot.type].params.find((p) => p.key === t.key);
      return `${store.project.mixer[t.track]?.name} — ${slot ? EFFECT_DEFS[slot.type].name : 'FX'} ${meta?.label ?? ''}`;
    }
    case 'chparam': {
      const ch = store.channel(t.id);
      const meta = ch && PARAM_META[ch.type]?.find((p) => p.key === t.key);
      return `${ch?.name ?? 'Channel'} — ${meta?.label ?? t.key}`;
    }
    default: return 'Automation';
  }
}

export function formatTarget(store, t, v) {
  switch (t.kind) {
    case 'mixer':
      if (t.param === 'pan') return Math.abs(v) < 0.01 ? 'Centered' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'L' : 'R'}`;
      return `${Math.round((v / 0.8) * 100)}%`;
    case 'channel':
      return t.param === 'pan' ? (Math.abs(v) < 0.01 ? 'Centered' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'L' : 'R'}`) : `${Math.round((v / 0.78) * 100)}%`;
    case 'fx': {
      const slot = store.project.mixer[t.track]?.fx[t.slot];
      const meta = slot && EFFECT_DEFS[slot.type].params.find((p) => p.key === t.key);
      return meta?.fmt ? meta.fmt(v) : v.toFixed(2);
    }
    case 'chparam': {
      const ch = store.channel(t.id);
      const meta = ch && PARAM_META[ch.type]?.find((p) => p.key === t.key);
      return meta?.fmt ? meta.fmt(v) : v.toFixed(2);
    }
    default: return v.toFixed(2);
  }
}

/** Value of an automation curve at `x` steps from the start of the clip. */
export function curveAt(points, x) {
  if (!points.length) return 0;
  if (x <= points[0].x) return points[0].y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (x <= b.x) {
      const span = b.x - a.x;
      if (span <= 0) return b.y;
      const t = (x - a.x) / span;
      const k = a.curve === 'hold' ? 0 : a.curve === 'smooth' ? t * t * (3 - 2 * t) : t;
      return a.y + (b.y - a.y) * k;
    }
  }
  return points[points.length - 1].y;
}

/** Apply `value` (real units) to the target. Audio params are ramped to value1 at time1 when given. */
export function applyTarget(store, engine, t, value, time, value1 = null, time1 = null) {
  const ctx = engine.ctx;
  const ramp = (param, v0, v1) => {
    param.setValueAtTime(v0, time);
    if (v1 != null && time1 != null) param.linearRampToValueAtTime(v1, time1);
  };
  switch (t.kind) {
    case 'mixer': {
      const strip = engine.tracks[t.track];
      if (!strip) return;
      if (t.param === 'pan') ramp(strip.pan.pan, value, value1);
      else ramp(strip.fader.gain, faderToGain(value), value1 == null ? null : faderToGain(value1));
      break;
    }
    case 'channel': {
      const node = engine.channelNodes.get(t.id);
      if (!node) return;
      if (t.param === 'pan') ramp(node.pan.pan, value, value1);
      else ramp(node.gain.gain, channelGain(value), value1 == null ? null : channelGain(value1));
      break;
    }
    case 'fx':
      engine.setEffectParam(t.track, t.slot, t.key, value);
      break;
    case 'chparam': {
      const ch = store.channel(t.id);
      if (ch) ch.params[t.key] = value;
      break;
    }
    default:
      break;
  }
  void ctx;
}
