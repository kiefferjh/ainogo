# Ainogo desktop preview

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
rating. Use **Open data folder** to find them. Default locations:

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

Use one running instance per data folder. Launching the app again brings the
existing instance forward. Do not manually edit files while the app is running.
Advanced users can set `AINOGO_DATA_DIR` to an absolute directory before launch;
the app then saves in its `sessions` subfolder. Keep that directory available and
back it up. Existing website/browser-only sessions do not automatically appear
in the desktop app; export their CSVs from the browser to retain those results.

## Export and timing

Use **Export session CSV** after the first response or on completion. A native
Save dialog lets you choose where the CSV goes. Saved sessions can also be
exported from the welcome screen. Original JSON records remain in the data folder.

Each full session has 16 rows, including separate reaction times, input methods,
image/rating order, timestamps, and interruption flags. Timing and CSV definitions
remain documented in DATA.md in the source repository. Interrupted or resumed
ratings restart timing and are marked; browser rendering is not laboratory-grade
physical stimulus timing. Final study instructions and participant-ID collection
still need the study-design decisions described in the project notes.

## Build from source

Use Node 22.13+ and run `npm ci`, then `npm run start:desktop` to launch locally.
`npm run package:desktop` builds packages for the current system. The release
workflow builds and tests Windows, Linux, and universal macOS packages natively.
`npm run test:desktop` verifies restart recovery and native CSV export. Linux CI
uses a virtual display and disables the OS sandbox only for its automated test
process; the released app does not add that flag. SHA256SUMS lists release-file
checksums so downloads can be checked after transfer.
