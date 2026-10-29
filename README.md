# Ainogo

An image-rating study with per-rating reaction times, local session recovery,
and CSV export.

## Download and run

Get the **offline desktop app** from [GitHub Releases](https://github.com/kiefferjh/ainogo/releases).
Windows, Linux, and universal macOS packages include the app and study images.
No server, Node installation, or internet connection is required after download.
Initial preview builds are unsigned by a trusted commercial publisher; see
[desktop instructions](DESKTOP.md) for platform details and local data locations.

Each rating is automatically saved to a session JSON file on the computer.
Use **Open data folder** to locate it and **Export session CSV** for analysis.
Keep a separate backup of that folder: local storage cannot protect against a
failed or lost computer. Session files are separate from the app installation.

The [browser preview](https://kiefferjh.github.io/ainogo/) remains available,
but its browser-local records are separate from the desktop app's files.

## Development

```sh
npm ci
npm run start:desktop
```

- `npm test`: session logic and file persistence/recovery checks.
- `npm run test:desktop`: native app restart/recovery and CSV Save dialog checks.
- `npm run package:desktop`: build downloads for the current OS.
- `npm run test:browser`: browser regression tests (install Playwright Chromium first).

The desktop release workflow builds and tests each platform before publishing a
preview release. [DATA.md](DATA.md) defines the data fields and timing; [TESTING.md](TESTING.md)
describes the browser checks. Final study instructions and participant information
are still governed by the unresolved study-design questions in the project notes.
