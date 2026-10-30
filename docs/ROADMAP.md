# Roadmap

Rough priorities, not promises. Pick something and open an issue before starting large work.

## Near term
- Audio recording (input device → audio clip).
- Per-note cutoff and slide (portamento) notes in the piano roll.
- Sampler: root key, loop points, slicing; drag-to-load into a channel.
- Recent files.
- Packaged installers (electron-builder) for Windows, macOS and Linux.

## Mid term
- Time-stretch and pitch-shift for audio clips.
- More built-in effects (gate, convolution reverb, multiband) and instruments (wavetable, sample-based pianos / strings).
- Spectrum analyser and track meters with peak hold in the mixer; track grouping and insert routing UI.
- Stem export (per track) and MP3/FLAC export.
- Theming and a keyboard-shortcut editor; accessibility pass.

## Long term
- Plugin hosting (VST3/CLAP) via a native companion process.
- Importers for other DAWs' projects where legally and technically feasible (FL Studio .flp is done).
- Collaboration / cloud project sharing.
