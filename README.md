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
The app also updates matching **all-experiments.json**, **all-experiments.csv**,
and **all-experiments.xlsx** files containing every saved experiment. Use
**Open data folder** to open the latest complete set. Export for an individual
session appears on completion (or earlier if saving fails), explicitly labeled
**this session only**. Selected saved sessions can also be exported individually.
Partial tests are saved after every accepted response, even without completing
the test or exporting CSV. They remain in all three combined formats, marked
`partial` with recorded/expected rating counts.
Choose **Next participant** after a test to start with a new random session ID;
resuming an interrupted test keeps its existing ID and responses.
Keep a separate backup of the data folder: local storage cannot protect against a
failed or lost computer. Session files are separate from the app installation.

Choose **Take test online — not saved** on the [website](https://kiefferjh.github.io/ainogo/)
to try the study without a download. Ratings and reaction times stay in memory,
are not uploaded, and disappear when the page closes or refreshes. CSV export is
available in the desktop app and the secondary browser-saving option. Existing
browser-local records remain separate from the desktop app's files.

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
