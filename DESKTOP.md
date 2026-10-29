# Ainogo 1.2.0 desktop preview

Download the package for your operating system from this release. The study,
all eight images, and its runtime are included. No Node installation, server,
internet connection, or cloud account is needed to run the downloaded app.

- **Windows x64:** use the `windows-x64-setup.exe` installer, or run the
  `win-x64.exe` portable executable without an installer.
- **Linux x64:** make the AppImage executable and run it. A `.tar.gz` containing
  the app folder is also provided; extract it and run `ainogo`.
- **macOS:** extract the universal `.zip` and move Ainogo.app to Applications.

These initial downloads are not signed with commercial Windows or Apple
certificates and are not Apple-notarized. The OS may require explicit approval
before first launch. Follow your institution's software policy. Linux requires
a desktop session and support for Chromium's sandbox; AppImage may also require
FUSE. The archive is an alternative when FUSE is unavailable.

## Local data

The app automatically saves each session as a JSON file after every accepted
rating. It also saves a matching collection of **all-experiments.json**,
**all-experiments.csv**, and **all-experiments.xlsx** after each response.
Use **Open data folder** to open the latest collection. Individual session files
remain available for recovery. Default locations:

- Windows: `%APPDATA%\Ainogo\sessions`
- macOS: `~/Library/Application Support/Ainogo/sessions`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/Ainogo/sessions`

The data folder is separate from the program. Replacing the downloaded app does
not replace session files. Windows uninstall does not intentionally remove them.
“Portable” describes the executable: data still goes to the user's data folder,
not beside the executable or onto the USB drive carrying it.

Files are flushed before atomic replacement. A `.json.bak` holds the previous
saved snapshot. If the current file is damaged or missing, the app can recover
that snapshot and shows a warning; the latest update may be missing. Damaged
originals are preserved when writing a recovered session. These copies protect
against interrupted saves, not disk failure. Back up the whole `sessions` folder
to a separate device or location as well as exporting CSVs.

The combined files live in `sessions/exports/<snapshot-id>/`. They contain the
same rows, including session IDs, reaction times, settings and completion state.
The JSON includes the column order and snapshot metadata; Excel uses typed cells
and CSV uses text with spreadsheet formula protection. Sessions with no responses
have a `record_type=session` row; recorded responses use `record_type=rating`.
Filter to rating rows for analysis.

All three files are written and flushed before `sessions/exports/CURRENT.json`
is atomically updated to point at the new complete set. A failed write leaves the
last complete set available, shows a warning, and retains the individual session
records. The next successful save or app restart rebuilds the collection.
The current and previous complete sets are retained; older generated snapshots
are cleaned up. Use **Open data folder** again to see the newest files, and copy
a set elsewhere before analysis. An already-open Excel workbook does not refresh
automatically. Do not edit generated files to correct study data.

Each new participant receives a random session ID. Use **Next participant** after
completion; all earlier sessions remain in the collection. **Resume session**
continues the same participant's interrupted test and keeps its ID. Collection
is shared by runs using the same data folder/OS account. Separate OS accounts need
the same accessible `AINOGO_DATA_DIR` if they are to share a collection.

Use one running instance per data folder. Launching the app again brings the
existing instance forward. Do not manually edit files while the app is running.
Advanced users can set `AINOGO_DATA_DIR` to an absolute directory before launch;
the app then saves in its `sessions` subfolder. Keep that directory available and
back it up. Existing website/browser-only sessions do not automatically appear
in the desktop app; export their CSVs from the browser to retain those results.

## Export and timing

Use **Export session CSV** on completion. It stays hidden during normal trials;
if saving fails or a session conflicts, it appears early for emergency recovery. A native
Save dialog lets you choose where the CSV goes. Saved sessions can also be
exported from the welcome screen. Original JSON records remain in the data folder.

Each full session has 16 rows, including separate reaction times, input methods,
image/rating order, timestamps, and interruption flags. Timing and CSV definitions
remain documented in DATA.md in the source repository. Interrupted or resumed
ratings restart timing and are marked; browser rendering is not laboratory-grade
physical stimulus timing. Final study instructions and participant-ID collection
still need the study-design decisions described in the project notes. Random
session IDs identify test runs, not a person's identity across separate visits.

## Build from source

Use Node 22.13+ and run `npm ci`, then `npm run start:desktop` to launch locally.
`npm run package:desktop` builds packages for the current system. The release
workflow builds and tests Windows, Linux, and universal macOS packages natively.
`npm run test:desktop` verifies restart recovery and native CSV export. Linux CI
uses a virtual display and disables the OS sandbox only for its automated test
process; the released app does not add that flag. SHA256SUMS lists release-file
checksums so downloads can be checked after transfer.
