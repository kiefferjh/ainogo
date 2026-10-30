import { realpathSync } from 'node:fs';
import { win32, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

// Canonicalize the real app directory/ASAR file, not files inside the virtual
// ASAR filesystem. Windows loaders can use 8.3 paths for the very same app.
export function createEntryGuard(appRoot, relativeEntry, { platform = process.platform, realpath = realpathSync.native } = {}) {
  const paths = platform === 'win32' ? win32 : posix;
  const expectedRoot = realpath(appRoot);
  const suffix = paths.sep + relativeEntry.split('/').join(paths.sep);
  return value => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'file:' || url.host || url.search || url.hash) return false;
      const filename = fileURLToPath(url, { windows: platform === 'win32' });
      if (!filename.endsWith(suffix)) return false;
      return realpath(filename.slice(0, -suffix.length)) === expectedRoot;
    } catch { return false; }
  };
}
