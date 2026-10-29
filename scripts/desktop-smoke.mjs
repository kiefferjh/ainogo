import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import * as XLSX from 'xlsx';

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
  assert.equal(await page.locator('#download-session').isVisible(), false);
  const filename = readdirSync(join(directory, 'sessions')).find(name => name.endsWith('.json'));
  const first = JSON.parse(readFileSync(join(directory, 'sessions', filename), 'utf8'));
  assert.equal(first.responses.length, 1);
  await application.close();
  const partialManifest = JSON.parse(readFileSync(join(directory, 'sessions', 'exports', 'CURRENT.json'), 'utf8'));
  const partial = JSON.parse(readFileSync(join(partialManifest.directory, 'all-experiments.json'), 'utf8'));
  assert.equal(partial.records.length, 1);
  assert.equal(partial.records[0].session_id, first.sessionId);
  assert.equal(partial.records[0].session_status, 'partial');
  assert.equal(partial.records[0].ratings_recorded, 1);
  assert.equal(partial.records[0].ratings_expected, 16);
  const partialBook = XLSX.read(readFileSync(join(partialManifest.directory, 'all-experiments.xlsx')), { type: 'buffer' });
  assert.deepEqual(XLSX.utils.sheet_to_json(partialBook.Sheets[partialBook.SheetNames[0]], { defval: null }), partial.records);
  assert.equal(readFileSync(join(partialManifest.directory, 'all-experiments.csv'), 'utf8').trimEnd().split('\r\n').length, 2);
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
  assert.equal(await page.locator('#download-session').isVisible(), true);
  assert.match(await page.locator('#session-export-note').textContent(), /only this session/);
  const output = join(directory, 'export.csv');
  await application.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, output);
  await page.getByRole('button', { name: 'Export CSV — this session only', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('CSV exported'));
  const csv = readFileSync(output, 'utf8');
  assert.equal(csv.trimEnd().split('\r\n').length, 17);
  assert.ok(csv.includes('"reaction_time_ms"'));
  await page.getByRole('button', { name: 'Next participant', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  for (let index = 0; index < 8; index++) { await rate(3); await rate(7); }
  const manifest = JSON.parse(readFileSync(join(directory, 'sessions', 'exports', 'CURRENT.json'), 'utf8'));
  const combined = JSON.parse(readFileSync(join(manifest.directory, 'all-experiments.json'), 'utf8'));
  const workbook = XLSX.read(readFileSync(join(manifest.directory, 'all-experiments.xlsx')), { type: 'buffer' });
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null }), combined.records);
  assert.equal(manifest.sessionCount, 2);
  assert.equal(manifest.ratingCount, 32);
  assert.equal(new Set(combined.records.map(row => row.session_id)).size, 2);
  assert.equal(readFileSync(join(manifest.directory, 'all-experiments.csv'), 'utf8').trimEnd().split('\r\n').length, 33);
  await page.getByRole('button', { name: 'Export CSV — this session only', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('CSV exported'));
  const sessionOnlyCsv = readFileSync(output, 'utf8');
  assert.equal(sessionOnlyCsv.trimEnd().split('\r\n').length, 17);
  assert.equal(sessionOnlyCsv.includes(first.sessionId), false);
  const secondId = combined.records.find(row => row.session_id !== first.sessionId).session_id;
  assert.ok(sessionOnlyCsv.includes(secondId));
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
    savedRatings: 32, csvRows: 32, uniqueSessions: 2, partialSavedWithoutExport: true,
    sessionOnlyCsvRows: 16, synchronizedFormats: ['json', 'csv', 'xlsx'], dataDirectory: directory, pageErrors: errors }));
} finally {
  if (application) await application.close();
}
