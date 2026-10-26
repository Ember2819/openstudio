# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/)
and the project uses [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

## [0.2.0]

### Added
- SoundFont engine with 261 General MIDI instruments and 13 drum kits (GeneralUser GS), including a kit-aware piano roll.
- Audio clips (with waveforms), automation clips and an automation editor, playlist loop region, swing.
- Mixer sends with feedback protection; chorus, phaser, limiter and stereo-width effects; a better reverb.
- Piano roll mute/slice tools, quantize and scale highlighting; synth unison.
- MIDI keyboard input and MIDI file export.
- Unit tests, an end-to-end smoke test, ESLint and CI; open-source project files.

### Changed
- Flat, calmer UI with one consistent icon set; master meter and audio status in the toolbar.
- Application moved to the repository root; the large instrument bank is downloaded with `npm run assets`.

## [0.1.0]

### Added
- First playable version: toolbar, channel rack, piano roll, playlist, mixer, browser, synthesized drums and synth,
  undo/redo, project files and WAV export.
