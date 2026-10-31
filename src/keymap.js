// The app-wide keyboard shortcuts, as rebindable commands. Settings → Keys edits them; the user's choices are kept in
// localStorage and everything that shows a shortcut (menus, F1) reads it from here. Keys are physical-key combos as
// tiling.js's comboOf() writes them: "Ctrl+Shift+S", "F5", "Alt+F8", "=", "Space".
import { Emitter } from './util.js';

/** [id, label, group, default combos] */
export const COMMANDS = [
  ['play', 'Play / pause', 'Transport', ['Space']],
  ['to-start', 'Jump to the start', 'Transport', ['Home']],
  ['toggle-mode', 'Switch pattern / song mode', 'Transport', ['Ctrl+L']],
  ['metronome', 'Metronome', 'Transport', ['Ctrl+M']],
  ['record', 'Record', 'Transport', []],
  ['loop', 'Loop the loop region', 'Transport', []],
  ['undo', 'Undo', 'Edit', ['Ctrl+Z']],
  ['redo', 'Redo', 'Edit', ['Ctrl+Y', 'Ctrl+Shift+Z']],
  ['new', 'New project', 'File', ['Ctrl+N']],
  ['open', 'Open project', 'File', ['Ctrl+O']],
  ['save', 'Save', 'File', ['Ctrl+S']],
  ['save-as', 'Save as', 'File', ['Ctrl+Shift+S']],
  ['export-wav', 'Export audio (WAV)', 'File', ['Ctrl+R']],
  ['export-mp3', 'Export audio (MP3, 320 kbps)', 'File', []],
  ['export-stems', 'Export stems', 'File', ['Ctrl+Shift+R']],
  ['playlist', 'Playlist', 'Windows', ['F5']],
  ['rack', 'Channel rack', 'Windows', ['F6']],
  ['piano', 'Piano roll', 'Windows', ['F7']],
  ['mixer', 'Mixer', 'Windows', ['F9']],
  ['browser', 'Browser', 'Windows', ['Alt+F8']],
  ['channel-settings', 'Channel settings', 'Windows', ['F10']],
  ['rename-channel', 'Rename the selected channel', 'Windows', ['F2']],
  ['preferences', 'Settings (themes, keys …)', 'Windows', ['Ctrl+,']],
  ['help', 'Keyboard shortcuts', 'Windows', ['F1']],
  ['new-pattern', 'New pattern', 'Patterns', ['F4', 'Ctrl+Shift+P']],
  ['next-pattern', 'Next pattern', 'Patterns', ['=', 'Shift+=', 'Num+']],
  ['prev-pattern', 'Previous pattern', 'Patterns', ['-', 'Num-']],
];
const BY_ID = new Map(COMMANDS.map((c) => [c[0], c]));
const KEY = 'openstudio.keymap';

/** Readable form of a combo for menus: "Ctrl+Shift+S", "+" for "Shift+=". */
export const comboLabel = (c) => (c === 'Shift+=' || c === 'Num+' ? '+' : c === 'Num-' ? '-' : c);

class Keymap extends Emitter {
  constructor() {
    super();
    let saved;
    try { saved = JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
    // only known commands, only lists of strings
    this.overrides = Object.fromEntries(Object.entries(saved).filter(([id, v]) => BY_ID.has(id) && Array.isArray(v) && v.every((x) => typeof x === 'string')));
  }

  /** The combos bound to a command. */
  binds(id) { return this.overrides[id] ?? BY_ID.get(id)?.[3] ?? []; }

  /** The first combo of a command, for menus ('' if none). */
  label(id) { const b = this.binds(id)[0]; return b ? comboLabel(b) : ''; }

  isDefault(id) { return !(id in this.overrides); }

  set(id, combos) {
    const def = BY_ID.get(id)[3];
    if (combos.length === def.length && combos.every((c, i) => c === def[i])) delete this.overrides[id];
    else this.overrides[id] = [...combos];
    this._save();
  }

  reset(id = null) {
    if (id) delete this.overrides[id]; else this.overrides = {};
    this._save();
  }

  /** combo -> command id. Keys the user chose win over defaults they clash with. */
  map() {
    const m = new Map();
    const order = [...COMMANDS.filter(([id]) => !this.isDefault(id)), ...COMMANDS.filter(([id]) => this.isDefault(id))];
    for (const [id] of order) for (const c of this.binds(id)) if (!m.has(c)) m.set(c, id);
    return m;
  }

  /** "id|combo" -> description of the clash, for every combo bound to two commands. */
  conflicts() {
    const seen = new Map();
    const out = new Map();
    for (const [id, label] of COMMANDS) {
      for (const c of this.binds(id)) {
        const other = seen.get(c);
        if (other && other !== id) {
          out.set(`${id}|${c}`, `Also “${BY_ID.get(other)[1]}”`);
          out.set(`${other}|${c}`, `Also “${label}”`);
        } else seen.set(c, id);
      }
    }
    return out;
  }

  _save() {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(this.overrides));
    this.emit('change');
  }
}

export const keymap = new Keymap();
