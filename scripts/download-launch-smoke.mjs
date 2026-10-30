import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

// Exercise the real portable/AppImage launcher, without depending on it forwarding
// Electron's Node inspector output to Playwright. Debugging is test-only and local.
const executable = resolve(process.env.AINOGO_PACKAGED_EXECUTABLE);
const directory = mkdtempSync(join(process.env.AINOGO_TEST_DATA_PARENT ?? tmpdir(), 'ainogo-download-launch-'));
const env = { ...process.env, AINOGO_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
let child, browser, page;
let logs = '';
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function launch() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'];
  if (process.platform === 'linux' && env.AINOGO_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
  child = spawn(executable, args, { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let launchError;
  child.once('error', error => { launchError = error; });
  child.stdout.on('data', data => { logs = (logs + data).slice(-12_000); });
  child.stderr.on('data', data => { logs = (logs + data).slice(-12_000); });
  const deadline = Date.now() + 90_000;
  while (true) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Launcher exited ${child.exitCode}: ${logs}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) break;
    } catch { /* The wrapper may still be extracting its runtime. */ }
    if (Date.now() > deadline) throw new Error(`Launcher did not expose the study: ${logs}`);
    await delay(250);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pageDeadline = Date.now() + 30_000;
  while (!(page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('file:')))) {
    if (Date.now() > pageDeadline) throw new Error('The downloaded launcher did not create a study window.');
    await delay(100);
  }
  await page.locator('#start-button:not([disabled])').waitFor();
  page.on('pageerror', error => errors.push(error.message));
  const marker = `${sep}resources${sep}app.asar${sep}`;
  const entry = fileURLToPath(page.url());
  assert.ok(entry.includes(marker), 'The wrapper must launch its packaged app.');
  const runtimeFile = join(entry.split(marker)[0], process.platform === 'win32' ? 'Ainogo.exe' : 'ainogo');
  const header = Buffer.alloc(4096);
  const fd = openSync(runtimeFile, 'r');
  try { readSync(fd, header, 0, header.length, 0); } finally { closeSync(fd); }
  if (process.platform === 'win32') {
    assert.equal(header.toString('ascii', 0, 2), 'MZ');
    const pe = header.readUInt32LE(0x3c);
    assert.equal(header.toString('ascii', pe, pe + 4), 'PE\0\0');
    assert.equal(header.readUInt16LE(pe + 4), 0x8664, 'Portable app must contain the x64 runtime.');
  } else {
    assert.equal(header.toString('ascii', 1, 4), 'ELF');
    assert.equal(header[4], 2);
    assert.equal(header.readUInt16LE(18), 62, 'AppImage must contain the x86-64 runtime.');
  }
}
async function close() {
  if (page && !page.isClosed()) await page.close();
  if (browser) await browser.close();
  for (let tries = 0; child?.exitCode === null && tries < 100; tries++) await delay(100);
  assert.notEqual(child?.exitCode, null, 'Launcher did not exit after closing the app.');
  assert.equal(child.exitCode, 0, logs);
  child = browser = page = undefined;
}
const manifest = () => JSON.parse(readFileSync(join(directory, 'sessions', 'exports', 'CURRENT.json'), 'utf8'));
try {
  await launch();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await page.locator('#rating-buttons button:not([disabled])').first().waitFor();
  await page.keyboard.press('2');
  assert.equal(manifest().ratingCount, 1);
  const firstManifest = manifest();
  const first = JSON.parse(readFileSync(join(firstManifest.directory, 'all-experiments.json'), 'utf8')).records[0];
  assert.equal(first.session_status, 'partial');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(async () => {
    try { await fetch('https://example.com'); return false; } catch { return true; }
  }), true);
  await close();
  await launch();
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await page.locator('#rating-buttons button:not([disabled])').first().waitFor();
  await page.keyboard.press('8');
  assert.equal(manifest().ratingCount, 2);
  const current = manifest();
  const rows = JSON.parse(readFileSync(join(current.directory, 'all-experiments.json'), 'utf8')).records;
  assert.ok(rows.every(row => row.session_id === first.session_id));
  assert.equal(rows[0].reaction_time_ms, first.reaction_time_ms);
  assert.equal(rows[1].interrupted, true);
  await close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ launcher: executable, platform: process.platform, arch: process.arch,
    offline: true, savedRatings: 2, partialRecovered: true, cleanExit: true, dataDirectory: directory }));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child?.pid && child.exitCode === null) {
    if (process.platform === 'win32') {
      const cleanup = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      await new Promise(resolve => { cleanup.once('exit', resolve); cleanup.once('error', resolve); });
    } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
  }
}
