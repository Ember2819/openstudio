import { isMenuOpen } from './ui/menu.js';
import { isKitChannel } from './audio/catalog.js';

const LOWER = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16 };
const UPPER = { KeyQ: 0, Digit2: 1, KeyW: 2, Digit3: 3, KeyE: 4, KeyR: 5, Digit5: 6, KeyT: 7, Digit6: 8, KeyY: 9, Digit7: 10, KeyU: 11, KeyI: 12, Digit9: 13, KeyO: 14, Digit0: 15, KeyP: 16 };

const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function installShortcuts(app) {
  const { store, transport, wm, actions } = app;
  const input = app.input;

  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) transport.togglePlay();
      return;
    }
    if (isMenuOpen()) return;

    if (ctrl) {
      const k = e.key.toLowerCase();
      const map = {
        z: () => (e.shiftKey ? actions.redo() : actions.undo()),
        y: actions.redo,
        s: () => actions.saveProject(e.shiftKey),
        o: actions.openProject,
        n: actions.newProject,
        r: () => (e.shiftKey ? actions.exportStems() : actions.exportWav()),
        m: () => transport.setMetronome(!transport.metronome),
        l: () => transport.toggleMode(),
        p: () => { if (e.shiftKey) store.addPattern(); },
        ',': () => actions.togglePreferences(),
      };
      if (map[k]) { e.preventDefault(); map[k](); }
      return;
    }

    const fkeys = {
      F1: actions.showShortcuts,
      F4: () => store.addPattern(),
      F5: () => wm.get('playlist').toggle(),
      F6: () => wm.get('rack').toggle(),
      F7: () => wm.get('piano').toggle(),
      F9: () => wm.get('mixer').toggle(),
      F10: () => actions.openChannelSettings(store.selectedChannel?.id),
      F2: () => actions.renameChannel(),
      F8: () => { if (e.altKey) actions.toggleBrowser(); },
    };
    if (fkeys[e.code]) { e.preventDefault(); fkeys[e.code](); return; }

    if (e.code === 'Home') { transport.seek(0); return; }
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { store.stepPattern(1); return; }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') { store.stepPattern(-1); return; }

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
