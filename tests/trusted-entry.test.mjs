import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntryGuard } from '../desktop/trusted-entry.mjs';

test('Windows long and short app paths authorize only the same physical app and exact study entry', () => {
  const long = 'C:\\Users\\Runner Admin\\Ainogo\\resources\\app.asar';
  const short = 'C:\\Users\\RUNNER~1\\Ainogo\\resources\\app.asar';
  const guard = createEntryGuard(long, 'dist-desktop/ui/index.html', { platform: 'win32', realpath: root => {
    if (root === short || root === long) return long;
    return root;
  } });
  assert.equal(guard('file:///C:/Users/RUNNER~1/Ainogo/resources/app.asar/dist-desktop/ui/index.html'), true);
  assert.equal(guard('file:///C:/Users/Runner%20Admin/Ainogo/resources/app.asar/dist-desktop/ui/index.html'), true);
  for (const url of [
    'file:///C:/OtherApp/resources/app.asar/dist-desktop/ui/index.html',
    'file:///C:/Users/RUNNER~1/Ainogo/resources/app.asar/dist-desktop/ui/other.html',
    'file:///C:/Users/RUNNER~1/Ainogo/resources/app.asar/dist-desktop/ui/index.html?other=1',
    'file:///C:/Users/RUNNER~1/Ainogo/resources/app.asar/dist-desktop/ui/index.html#other',
    'https://example.com/dist-desktop/ui/index.html',
    'file://server/share/dist-desktop/ui/index.html',
    'file:///C:/Users/RUNNER~1/Ainogo/resources/app.asar/dist-desktop%2Fui/index.html',
    'invalid',
  ]) assert.equal(guard(url), false, url);
});

test('POSIX paths require the exact entry in the canonical app root and reject missing roots', () => {
  const guard = createEntryGuard('/apps/Ainogo/app.asar', 'dist-desktop/ui/index.html', { platform: 'linux', realpath: root => {
    if (root === '/missing/app.asar') throw new Error('Missing');
    return root;
  } });
  assert.equal(guard('file:///apps/Ainogo/app.asar/dist-desktop/ui/index.html'), true);
  assert.equal(guard('file:///apps/Other/app.asar/dist-desktop/ui/index.html'), false);
  assert.equal(guard('file:///missing/app.asar/dist-desktop/ui/index.html'), false);
  assert.equal(guard('file:///apps/Ainogo/app.asar/dist-desktop/ui/index.html/other'), false);
});
