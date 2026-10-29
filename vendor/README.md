# Excel library

`xlsx-0.20.3.tgz` is the unmodified SheetJS Community Edition package from
https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz, pinned through the local
`file:` dependency and lockfile integrity hash. It is used only by the desktop
process, not loaded into the online test. Its Apache-2.0 license is included in
the package. Vendoring follows the official installation instructions at
https://docs.sheetjs.com/docs/getting-started/installation/nodejs/ and avoids
depending on CDN availability during installation.
