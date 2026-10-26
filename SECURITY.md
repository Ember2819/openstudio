# Security policy

## Supported versions

Only the latest release and the `main` branch receive fixes while the project is pre-1.0.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
"Report a vulnerability" button (Security → Advisories) on this repository to report privately.
Include steps to reproduce and, if possible, a minimal project file. You can expect an acknowledgement within
a few days.

## Scope

OpenStudio is a local desktop app. The areas most relevant to security are:
- parsing untrusted files (`.osp` projects, audio files, SoundFonts);
- the Electron bridge in `preload.js` / `main.js` (file dialogs, asset loading);
- the asset downloader (`scripts/fetch-assets.mjs`), which verifies a pinned SHA-256 checksum.

The renderer runs with `contextIsolation` on, `nodeIntegration` off and a restrictive Content-Security-Policy.
Please keep it that way in contributions.
