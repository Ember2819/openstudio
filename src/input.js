/** Live note input shared by the computer keyboard and MIDI devices: plays the selected channel and records. */
export function createInput(app) {
  const { store, engine, transport } = app;
  const held = new Map(); // source key -> { ch, pitch, voice }

  function noteOn(key, pitch, vel = 0.8) {
    const ch = store.selectedChannel;
    if (!ch || held.has(key)) return;
    engine.ensure();
    const voice = engine.playNote(ch, pitch, vel, engine.ctx.currentTime, Infinity);
    held.set(key, { ch, pitch, voice });
    transport.recordNoteOn(ch, pitch, vel);
    app.emit('keyboardNote', { pitch, on: true });
  }

  function noteOff(key) {
    const h = held.get(key);
    if (!h) return;
    held.delete(key);
    h.voice?.release(engine.ctx.currentTime);
    transport.recordNoteOff(h.ch, h.pitch);
    app.emit('keyboardNote', { pitch: h.pitch, on: false });
  }

  function allOff() {
    for (const key of [...held.keys()]) noteOff(key);
  }

  return { noteOn, noteOff, allOff };
}
