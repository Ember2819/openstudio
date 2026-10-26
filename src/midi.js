/** Web MIDI input: every connected device plays the selected channel (and records when armed). */
export async function initMidi(app) {
  const state = { access: null, enabled: new Map(), error: null };
  app.midi = state;
  if (!navigator.requestMIDIAccess) { state.error = 'Web MIDI is not available'; return; }
  try {
    state.access = await navigator.requestMIDIAccess();
  } catch (err) {
    state.error = err.message;
    return;
  }

  const attach = () => {
    for (const input of state.access.inputs.values()) {
      if (!state.enabled.has(input.id)) state.enabled.set(input.id, true);
      input.onmidimessage = (msg) => {
        if (!state.enabled.get(input.id)) return;
        const [status, a, b] = msg.data;
        const cmd = status & 0xf0;
        const key = `midi:${input.id}:${a}`;
        if (cmd === 0x90 && b > 0) app.input.noteOn(key, a, b / 127);
        else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) app.input.noteOff(key);
        else if (cmd === 0xb0 && a === 64) app.input.setSustain(b >= 64);
        else if (cmd === 0xb0 && (a === 120 || a === 123)) app.input.allOff();
      };
    }
    app.emit('midi');
  };
  state.access.onstatechange = attach;
  attach();

  state.devices = () => [...state.access.inputs.values()].map((i) => ({ id: i.id, name: i.name || 'MIDI device', on: state.enabled.get(i.id) }));
  state.toggle = (id) => { state.enabled.set(id, !state.enabled.get(id)); app.emit('midi'); };
}
