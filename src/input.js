/** Live note input shared by the computer keyboard and MIDI devices: plays the selected channel and records. */
export function createInput(app) {
  const { store, engine, transport } = app;
  const held = new Map(); // source key -> { ch, pitch, voice }
  let sustain = false;
  const sustained = []; // voices whose key was released while the pedal was down

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
    if (sustain) sustained.push(h.voice);
    else h.voice?.release(engine.ctx.currentTime);
    transport.recordNoteOff(h.ch, h.pitch);
    app.emit('keyboardNote', { pitch: h.pitch, on: false });
  }

  function allOff() {
    for (const key of [...held.keys()]) noteOff(key);
  }

  /** Sustain pedal (MIDI CC 64): note-offs are held back until the pedal is lifted. */
  function setSustain(on) {
    sustain = on;
    if (on) return;
    const now = engine.ctx.currentTime;
    for (const v of sustained.splice(0)) v?.release(now);
  }

  return { noteOn, noteOff, allOff: () => { allOff(); setSustain(false); }, setSustain };
}
