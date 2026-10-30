# Published desktop reliability pass — 2026-10-30

Release: [desktop-v1.2.2](https://github.com/kiefferjh/ainogo/releases/tag/desktop-v1.2.2).
All eight native checks passed against the published files in
[verification run 41084993077](https://github.com/kiefferjh/ainogo/actions/runs/41084993077).
Each job retains its JSON evidence report as an Actions artifact.
The release build and its pre-publication Windows installer/portable gate passed
in [release run 41084048153](https://github.com/kiefferjh/ainogo/actions/runs/41084048153).

## Issue found and fixed

The initial checks against 1.2.1 found that Windows could launch the study but
reject local saving when the loader used an 8.3 path such as `RUNNER~1` and the
app used the equivalent long path. The raw file-URL comparison incorrectly
classified that legitimate window as untrusted. The UI reported saving failure.

Version 1.2.2 canonicalizes the real app directory/ASAR file and requires the
exact study entry. Storage requests still require the app's own WebContents and
main frame; other files, roots, remote URLs, queries and fragments are rejected.
The actual installed and portable Windows builds now pass in paths containing
spaces. These installer/portable checks also gate future Windows releases.

## Tested downloads

| Native host | Published package | Result |
| --- | --- | --- |
| Windows Server 2025 x64 (10.0.26100) | Windows x64 setup EXE, installed into a temporary folder with spaces | Passed full 32-response/two-participant test |
| Windows Server 2025 x64 (10.0.26100) | Actual portable EXE launcher; extraction and data paths contain spaces | Passed launch, clean exit, two-response partial recovery |
| macOS 15 (Darwin 24.6.0), Intel x64 | Extracted universal ZIP | Passed full test; both binary slices and ad-hoc signature verified |
| macOS 15 (Darwin 24.6.0), Apple Silicon arm64 | Same universal ZIP | Passed full test; both binary slices and ad-hoc signature verified |
| Ubuntu 22.04 x64 | Extracted tar.gz | Passed full test |
| Ubuntu 22.04 x64 | Actual AppImage, FUSE-free extraction-and-run | Passed launcher and partial recovery |
| Ubuntu 24.04 x64 | Extracted tar.gz | Passed full test |
| Ubuntu 24.04 x64 | Actual AppImage, FUSE-free extraction-and-run | Passed launcher and partial recovery |

Full tests verified app version 1.2.2 / Electron 45.1.0 on the host's native
architecture, offline image loading, accepted-response persistence before
completion/export, restart and resume with the original response intact,
two unique session IDs, 32 combined rows in JSON/CSV/Excel, and individual CSV
containing only the current participant's 16 rows. Node access from the renderer
and network fetches remained blocked. Launcher tests checked the actual x64
runtime, offline operation, saving before completion, interruption flags, restart
recovery and clean exit.

Both Linux downloads were additionally tested locally on an x86-64 Linux host
(kernel 6.18.55-2-cachyos-lts) with the normal app sandbox enabled. The archive
passed the full test; the AppImage passed its real launcher and partial recovery
in FUSE-free mode. CI Linux checks use the documented test-only sandbox override.

## Integrity

Every native job checked its exact asset against the published SHA256SUMS:

```text
45b07a91b98ec3d520e8c0b01b323ca17660105d0271ab7fc2f5f21e08cc027d  Ainogo-1.2.2-linux-x64.tar.gz
aad40164c6d5d957ecd8b9e112430ffad6b1307f64e45f4496b2976e17cc587f  Ainogo-1.2.2-linux-x86_64.AppImage
ec1858704234d524de4c6c93473ac2df591b381699ca5a716688e780dc8a7cd9  Ainogo-1.2.2-mac-universal.zip
77d00f13add59ee85c8f648392ab15e2deb61ad73552136a6a335508f2728589  Ainogo-1.2.2-win-x64.exe
c730d3e3a9ea0fe04271db54ed32a876d55f667cac24f9ad8826500dc4510626  Ainogo-1.2.2-windows-x64-setup.exe
```

## Limits

Windows checks used Server 2025, not separate Windows 10/11 client installations.
macOS 15 was tested on both CPUs; macOS 13 is the bundle's declared minimum,
not a tested minimum. AppImage FUSE mounting, other Linux distributions, native
CSV dialog interaction, SmartScreen/Gatekeeper approval and physical display
timing were not verified. The Mac bundle has an ad-hoc signature, not trusted
publisher signing/notarization. Existing OS approval requirements still apply.

See [TESTING.md](../TESTING.md) to repeat this pass against a published release.
