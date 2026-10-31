import { isMenuOpen } from './ui/menu.js';
import { isKitChannel } from './audio/catalog.js';
import { keymap } from './keymap.js';
import { comboOf } from './ui/tiling.js';

const LOWER = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16 };
const UPPER = { KeyQ: 0, Digit2: 1, KeyW: 2, Digit3: 3, KeyE: 4, KeyR: 5, Digit5: 6, KeyT: 7, Digit6: 8, KeyY: 9, Digit7: 10, KeyU: 11, KeyI: 12, Digit9: 13, KeyO: 14, Digit0: 15, KeyP: 16 };

const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function installShortcuts(app) {
  const { store, transport, wm, actions } = app;
  const input = app.input;
  const RUN = {
    play: () => transport.togglePlay(),
    'to-start': () => transport.seek(0),
    'toggle-mode': () => transport.toggleMode(),
    metronome: () => transport.setMetronome(!transport.metronome),
    record: () => transport.setRecording(!transport.recording),
    loop: () => transport.setLoop(!transport.loopEnabled),
    undo: () => actions.undo(),
    redo: () => actions.redo(),
    new: () => actions.newProject(),
    open: () => actions.openProject(),
    save: () => actions.saveProject(false),
    'save-as': () => actions.saveProject(true),
    'export-wav': () => actions.exportWav(),
    'export-mp3': () => actions.exportMp3(320),
    'export-stems': () => actions.exportStems(),
    playlist: () => wm.get('playlist').toggle(),
    rack: () => wm.get('rack').toggle(),
    piano: () => wm.get('piano').toggle(),
    mixer: () => wm.get('mixer').toggle(),
    browser: () => actions.toggleBrowser(),
    'channel-settings': () => actions.openChannelSettings(store.selectedChannel?.id),
    'rename-channel': () => actions.renameChannel(),
    preferences: () => actions.togglePreferences(),
    help: () => actions.showShortcuts(),
    'new-pattern': () => store.addPattern(),
    'next-pattern': () => store.stepPattern(1),
    'prev-pattern': () => store.stepPattern(-1),
  };
  const REPEATS = new Set(['next-pattern', 'prev-pattern', 'undo', 'redo']); // holding these keeps going

  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || keymap.capturing) return;
    const combo = comboOf(e);
    const map = keymap.map();
    // macOS: Cmd works wherever Ctrl is bound
    const id = combo && (map.get(combo) ?? (combo.includes('Super') ? map.get(combo.replace('Super', 'Ctrl')) : undefined));
    if (id === 'play') {
      e.preventDefault();
      if (!e.repeat) RUN.play();
      return;
    }
    if (isMenuOpen()) return;
    if (id) {
      e.preventDefault();
      if (!e.repeat || REPEATS.has(id)) RUN[id]();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;

    // typing keyboard → piano
    if (e.altKey || e.repeat) return;
    const semis = LOWER[e.code] ?? (UPPER[e.code] != null ? UPPER[e.code] + 12 : undefined);
    if (semis === undefined) return;
    const ch = store.selectedChannel;
    input.noteOn(e.code, (ch && isKitChannel(ch) ? 36 : 60) + semis, 0.8);
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault();
    input.noteOff(e.code);
  });

  window.addEventListener('blur', () => input.allOff());
}
