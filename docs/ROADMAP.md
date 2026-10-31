# Roadmap

Rough priorities, not promises. Pick something and open an issue before starting large work.

## Next
- More built-in instruments (a sampled piano / strings bank beyond the General MIDI set, a drum sampler like FPC).
- A psychoacoustic model for the MP3 encoder, so 128-160 kbps sound as good as 256-320 do now.
- Screen-reader access to the editors' contents (notes, clips) — the controls around them are accessible already.

## Long term
- Plugin hosting (VST3/CLAP) via a native companion process.
- Importers for other DAWs' projects where legally and technically feasible (FL Studio .flp is done).
- Collaboration / cloud project sharing.

## Done recently
Packaged installers (electron-builder, `release.yml`), loop takes, per-note Mod X / Y and slide notes, sampler zones,
pitch shifter / correction and vocoder, mixer groups, MP3 export, theming, a keyboard-shortcut editor and an
accessibility pass — see the [changelog](../CHANGELOG.md).
