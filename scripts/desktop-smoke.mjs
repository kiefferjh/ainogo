import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const directory = mkdtempSync(join(tmpdir(), 'ainogo-desktop-smoke-'));
const env = { ...process.env, AINOGO_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.AINOGO_PACKAGED_EXECUTABLE ? resolve(process.env.AINOGO_PACKAGED_EXECUTABLE) : undefined;
const args = executablePath ? [] : [resolve('.')];
if (process.platform === 'linux' && process.env.AINOGO_TEST_NO_SANDBOX === '1') args.unshift('--no-sandbox');
const launch = () => electron.launch({ executablePath, args, env, timeout: 45_000 });
let application;
const errors = [];
try {
  application = await launch();
  let page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const rate = async value => {
    await page.waitForFunction(() => !document.querySelector('#rating-buttons button').disabled);
    await page.keyboard.press(String(value));
  };
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await rate(2);
  const filename = readdirSync(join(directory, 'sessions')).find(name => name.endsWith('.json'));
  const first = JSON.parse(readFileSync(join(directory, 'sessions', filename), 'utf8'));
  assert.equal(first.responses.length, 1);
  await application.close();
  application = await launch(); page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await rate(8);
  for (let index = 2; index <= 8; index++) { await rate(2); await rate(8); }
  const saved = JSON.parse(readFileSync(join(directory, 'sessions', filename), 'utf8'));
  assert.equal(saved.responses.length, 16);
  assert.deepEqual(saved.responses[0], first.responses[0]);
  assert.equal(saved.responses[1].interrupted, true);
  assert.ok(saved.completedAt);
  const output = join(directory, 'export.csv');
  await application.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, output);
  await page.getByRole('button', { name: 'Export session CSV', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('CSV exported'));
  const csv = readFileSync(output, 'utf8');
  assert.equal(csv.trimEnd().split('\r\n').length, 17);
  assert.ok(csv.includes('"reaction_time_ms"'));
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.ok(page.url().startsWith('file:'));
  assert.equal(await page.evaluate(async () => {
    try { await fetch('https://example.com'); return false; } catch { return true; }
  }), true);
  assert.ok(await page.evaluate(() => window.ainogoDesktop.listKeys().ok));
  const illegal = await page.evaluate(() => window.ainogoDesktop.getItem('ainogo.session.v1.../escape'));
  assert.equal(illegal.ok, false);
  console.log(JSON.stringify({ desktop: true, offline: true, recoveredAfterRestart: true,
    savedRatings: 16, csvRows: 16, dataDirectory: directory, pageErrors: errors }));
} finally {
  if (application) await application.close();
}
