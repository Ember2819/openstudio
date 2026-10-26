# OpenStudio

An open-source, pattern-based digital audio workstation for the desktop — a familiar step-sequencer /
piano-roll / playlist / mixer workflow built with **Electron** and the **Web Audio API**, with no build step.

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![OpenStudio](docs/screenshot.png)

> **Status: early (0.x).** It makes music today, but it is not a replacement for a mature DAW yet —
> see [Limitations](#limitations) and the [roadmap](docs/ROADMAP.md). Contributions are very welcome.

## Features

**Sound**
- 261 General MIDI instruments and 13 drum kits (TR-808/909, Electronic, Jazz, Orchestral, …) from the
  [GeneralUser GS](assets/CREDITS.md) SoundFont, played by a built-in sampler engine (velocity, loops, envelopes,
  filters, vibrato, hi-hat choke).
- Built-in subtractive synth (dual oscillator, unison, filter envelope) and a sampler for your own audio files.
- Mixer effects: reverb, delay, chorus, phaser, distortion, filter, EQ, compressor, limiter, stereo width.

**Workflow**
- **Channel rack** step sequencer — pads are real piano-roll notes — with swing, mute/solo and mixer routing.
- **Piano roll** with draw / select / delete / mute / slice tools, scale highlighting, ghost notes, velocity lane,
  quantize, and drum-kit key labels.
- **Playlist** with pattern, audio and automation clips, loop region, drag-and-drop of samples and audio files.
- **Mixer** with 125 inserts, sends (feedback-protected), 10 effect slots per track and stereo meters.
- **Automation** — right-click any knob or fader to create an automation clip with an editable curve.
- Undo/redo, `.osp` project files, WAV and MIDI export, computer-keyboard and MIDI-keyboard input, live recording.

## Getting started

Requirements: [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone <this repository>
cd openstudio
npm install
npm run assets   # downloads the ~31 MB instrument bank (checksum-verified)
npm start
```

Then choose **File → Open demo project**, press <kbd>Space</kbd> to play, and <kbd>F1</kbd> for shortcuts.

If Electron's binary is missing after `npm install`, run `node node_modules/electron/install.js`.

### Handy keys

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>F5</kbd> <kbd>F6</kbd> <kbd>F7</kbd> <kbd>F9</kbd> | Playlist, Channel rack, Piano roll, Mixer |
| <kbd>Z</kbd>…<kbd>M</kbd> / <kbd>Q</kbd>…<kbd>U</kbd> | Play the selected channel from the keyboard |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd> | Undo / redo |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> / <kbd>O</kbd> / <kbd>R</kbd> | Save, open, export audio |
| Right-click a knob | Create an automation clip |

## Development

```bash
npm run lint        # ESLint
npm test            # unit tests (node:test) — store, automation, MIDI writer, SoundFont parser
npm run test:e2e    # launches the real app headlessly and smoke-tests playback, mixing, export
```

The app is plain ES modules loaded straight by Electron — edit a file and restart. A headless screenshot /
scripting harness is built into `main.js` (see [CONTRIBUTING](CONTRIBUTING.md#debugging-and-screenshots)).
For a tour of the code read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Limitations

Plugin (VST/CLAP) hosting, time signatures other than 4/4, time-stretching audio, audio recording, tempo
automation, importing other DAWs' project files, and most of the commercial DAWs' bundled instruments and effects
are not implemented. OpenStudio is an independent project and is not affiliated with, endorsed by, or derived
from any commercial DAW; product names mentioned in this repository belong to their respective owners.

## Contributing

Bug reports, ideas and pull requests are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

Code: [MIT](LICENSE). Audio assets are covered by their own licenses — see [assets/CREDITS.md](assets/CREDITS.md).
