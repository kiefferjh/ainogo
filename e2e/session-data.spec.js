import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const sessions = page => page.evaluate(() => Object.keys(localStorage)
  .filter(key => key.startsWith('ainogo.session.v1.'))
  .flatMap(key => { try { return [JSON.parse(localStorage.getItem(key))]; } catch { return []; } }));

async function begin(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('button', { name: '2', exact: true })).toBeEnabled();
}

async function rate(page, value) {
  await expect(page.getByRole('button', { name: String(value), exact: true })).toBeEnabled();
  await page.keyboard.press(String(value));
}

async function complete(page, start = 1) {
  for (let index = start; index <= 8; index++) { await rate(page, 2); await rate(page, 8); }
  await expect(page.locator('#screen-description')).toContainText('complete');
}

function csvRows(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (!quoted && char === '\r') { /* CRLF separator */ }
    else cell += char;
  }
  return rows;
}

async function download(page, buttonName = 'Download session CSV') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  expect(file.suggestedFilename()).toMatch(/^ainogo-[a-zA-Z0-9-]+\.csv$/);
  const [headers, ...rows] = csvRows(readFileSync(await file.path(), 'utf8'));
  return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

test('session CSV contains all ratings, separate reaction times, methods, and metadata', async ({ page }) => {
  await page.clock.install();
  await begin(page);
  await page.clock.fastForward(250);
  await rate(page, 2);
  await expect(page.getByRole('button', { name: '8', exact: true })).toBeEnabled();
  await page.clock.fastForward(90);
  await page.getByRole('button', { name: '8', exact: true }).click();
  await complete(page, 2);
  const [saved] = await sessions(page);
  expect(saved.responses).toHaveLength(16);
  expect(saved.responses[0].reactionTimeMs).toBeGreaterThanOrEqual(250);
  expect(saved.responses[1].reactionTimeMs).toBeGreaterThanOrEqual(90);
  expect(saved.responses[0].inputMethod).toBe('keyboard');
  expect(saved.responses[1].inputMethod).toBe('mouse');
  const rows = await download(page);
  expect(rows).toHaveLength(16);
  expect(new Set(rows.map(row => row.session_id))).toEqual(new Set([saved.sessionId]));
  expect(rows[0].rating_dimension).toBe('valence');
  expect(rows[1].rating_dimension).toBe('arousal');
  expect(rows[0].rating_position).toBe('1');
  expect(rows[1].rating_position).toBe('2');
  for (let index = 0; index < rows.length; index++) {
    expect(Number(rows[index].reaction_time_ms)).toBe(saved.responses[index].reactionTimeMs);
    expect(rows[index].session_completed_at).toBeTruthy();
    expect(rows[index].responded_at).toBeTruthy();
  }
});

test('refresh resumes the next unanswered rating with original order and prior data intact', async ({ page }) => {
  await begin(page); await rate(page, 2);
  const [before] = await sessions(page);
  await page.reload();
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
  await rate(page, 8); await complete(page, 2);
  const [after] = await sessions(page);
  expect(after.sessionId).toBe(before.sessionId);
  expect(after.imageIds).toEqual(before.imageIds);
  expect(after.responses[0]).toEqual(before.responses[0]);
  expect(after.responses[1].interrupted).toBe(true);
  expect(after.responses[2].interrupted).toBe(false);
  const rows = await download(page);
  expect(rows).toHaveLength(16);
  expect(rows[1].interrupted).toBe('true');
});

test('new sessions retain earlier sessions for later CSV download', async ({ page }) => {
  await begin(page); await complete(page);
  const [first] = await sessions(page);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await complete(page);
  expect(await sessions(page)).toHaveLength(2);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.locator('#session-select option')).toHaveCount(2);
  if (page.viewportSize().width < 600) await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#session-select').selectOption(first.sessionId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toBeDisabled();
  const rows = await download(page, 'Download saved CSV');
  expect(rows).toHaveLength(16);
  expect(new Set(rows.map(row => row.session_id))).toEqual(new Set([first.sessionId]));
});

test('quota failures preserve downloadable in-memory data and show a persistent warning', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError'); }; });
  await begin(page); await complete(page);
  await expect(page.locator('#storage-status')).toContainText('Browser saving is unavailable');
  expect(await sessions(page)).toHaveLength(0);
  expect(await download(page)).toHaveLength(16);
});

test('damaged local records do not prevent recording or partial CSV export', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('ainogo.session.v1.broken', '{'); });
  await begin(page); await rate(page, 2);
  await expect(page.locator('#storage-status')).toContainText('damaged saved sessions');
  expect(await download(page)).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('ainogo.session.v1.broken'))).toBe('{');
});

test('window interruptions cannot inflate a clean reaction time', async ({ page }) => {
  await page.clock.install(); await begin(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.fastForward(10_000);
  await page.keyboard.press('2');
  expect((await sessions(page))[0].responses).toHaveLength(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: '2', exact: true })).toBeEnabled();
  await page.clock.fastForward(80); await rate(page, 2);
  const [saved] = await sessions(page);
  expect(saved.responses[0].interrupted).toBe(true);
  expect(saved.responses[0].reactionTimeMs).toBeGreaterThanOrEqual(80);
  expect(saved.responses[0].reactionTimeMs).toBeLessThan(5000);
});

test('another tab resuming a session pauses the old tab without overwriting responses', async ({ page, context, baseURL }) => {
  await begin(page); await rate(page, 2);
  const other = await context.newPage();
  await other.goto(baseURL);
  await other.getByRole('button', { name: 'Resume session', exact: true }).click();
  await rate(other, 8);
  await expect(page.locator('#storage-status')).toContainText('another tab');
  await expect(page.getByRole('button', { name: '4', exact: true })).toBeDisabled();
  await page.keyboard.press('4');
  expect((await sessions(page))[0].responses).toHaveLength(2);
  await other.close();
});
