# Contributing to OpenStudio

Thanks for helping! This guide gets you from clone to pull request.

## Setup

```bash
npm install
npm run assets     # instrument bank (not stored in git)
npm start
```

Useful commands: `npm run lint`, `npm test`, `npm run test:e2e`. CI runs all three on every pull request.

## Ground rules

- **No proprietary material.** Do not add samples, icons, skins, presets or code taken from other products or
  from FL Studio / Image-Line. Audio must be generated in code or come from a clearly redistributable source
  (CC0, permissive, or CC-BY with credit) that is documented in [assets/CREDITS.md](assets/CREDITS.md).
- Keep it dependency-light and **build-step free**: the renderer is plain ES modules.
- One pull request, one concern. Small PRs get reviewed faster.
- Be kind — see the [Code of Conduct](CODE_OF_CONDUCT.md).

## Code style

- ESLint enforces correctness (`npm run lint`); `.editorconfig` covers whitespace (2 spaces, LF).
- Match the surrounding code: concise comments that explain *why*, descriptive names, no dead code.
- UI: flat slate surfaces, the orange accent only for selection/active state, icons from `src/ui/icons.js`
  (one 16px line-icon family). Please don't add gradients, glows or one-off colours — use the CSS variables in
  `styles/theme.css`.

## Project layout

```
main.js, preload.js      Electron main process and bridge (file dialogs, asset loading)
index.html               Shell; loads src/main.js as an ES module
src/state.js             Project model, undo/redo, serialization
src/audio/               Engine, transport/scheduler, SoundFont parser + sampler, synth, effects
src/ui/                  One module per window (toolbar, rack, piano roll, playlist, mixer, …)
src/automation.js        Automation targets and curve maths
src/midi*.js, input.js   MIDI input, MIDI file export, live note input
styles/                  Design tokens (theme.css) and per-area CSS
test/                    Unit tests (node:test) and the e2e smoke script
scripts/                 Asset downloader and e2e runner
docs/                    Architecture notes and roadmap
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing the engine or the data model.

## Tests

- Put pure logic (model, maths, file formats) in modules that don't touch the DOM and cover it in `test/*.test.mjs`.
- Anything that needs the real audio graph or UI goes in `test/e2e/smoke.js`; keep it fast and deterministic.
- Bug fix? Add a test that fails without it.

## Debugging and screenshots

`main.js` has a developer harness that is only active with `--screenshot`:

```bash
npx electron . --screenshot=out.png --wait=2000 \
  --eval="(async () => { openstudio.actions.loadDemo(); return 'ok'; })()" \
  --input='[{"type":"mouseDown","x":400,"y":300,"button":"left"},{"type":"mouseUp","x":400,"y":300,"button":"left"}]'
```

`--eval` runs JavaScript in the renderer (the app is exposed as `window.openstudio`), `--input` replays real
mouse/keyboard events, and the window is captured before exit. On a machine without a display prefix the command
with `xvfb-run -a`. Open DevTools in the normal app with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>.

## Adding things

- **An effect** — add a definition (parameters + factory) to `src/audio/effects.js`; the mixer UI, automation and
  project saving pick it up automatically.
- **A synth/sampler parameter** — extend the metadata in `src/audio/instruments.js`; the settings window renders it.
- **A window** — create a module in `src/ui/` that calls `app.wm.create(...)`, then register it in `src/main.js`.
- **Project-format changes** — keep old projects loading (`Store.load` fills defaults) and add a test.

## Commit messages and pull requests

Write imperative, descriptive subjects ("Add chorus effect", not "stuff"). In the PR description explain the
motivation and attach a screenshot for UI changes. Maintainers squash-merge, so don't worry about tidy history.

## License of contributions

By contributing you agree that your work is released under the project's [MIT license](LICENSE).
