import { test, expect } from '@playwright/test';

async function preview(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Take test online — not saved', exact: true }).click();
  await expect(page.locator('#screen-description')).toContainText('unsaved online test');
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('button', { name: '2', exact: true })).toBeEnabled();
}

test('online and desktop choices are clear and fit a narrow screen', async ({ page }) => {
  await page.goto('/');
  if (page.viewportSize().width < 600) await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.getByRole('heading', { name: 'Try the test online' })).toBeVisible();
  await expect(page.locator('#online-test')).toContainText('will not be saved');
  await expect(page.getByRole('button', { name: 'Take test online — not saved', exact: true })).toBeEnabled();
  await expect(page.locator('#desktop-download .download-button')).toHaveCount(3);
  await expect(page.locator('#start-button')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('online test completes without storage writes or response uploads', async ({ page }) => {
  await page.addInitScript(() => {
    window.storageWrites = [];
    Storage.prototype.setItem = function(key) { window.storageWrites.push(key); throw new Error('Unexpected write'); };
  });
  const responseRequests = [];
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) responseRequests.push(request.url());
  });
  await preview(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('button', { name: '2', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
  });
  for (let index = 0; index < 16; index++) {
    await expect(page.getByRole('button', { name: '2', exact: true })).toBeEnabled();
    await page.keyboard.press('2');
  }
  await expect(page.locator('#status')).toContainText('These results were not saved');
  await expect(page.locator('#download-session')).toBeHidden();
  await expect(page.locator('#storage-status')).toContainText('memory only');
  expect(await page.evaluate(() => window.storageWrites)).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(responseRequests).toEqual([]);
  await page.reload();
  await expect(page.locator('#saved-sessions')).toBeHidden();
  await expect(page.locator('#session-info')).toHaveText('');
});

test('preview preserves earlier saved results and discards partial results on refresh', async ({ page }) => {
  await page.goto('/');
  await page.locator('#browser-save-summary').click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('button', { name: '2', exact: true })).toBeEnabled();
  await page.keyboard.press('2');
  await expect(page.locator('#screen-description')).toContainText('arousal');
  // Leave the saved session first; losing focus can persist its interruption flag.
  await page.reload();
  const snapshot = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  await preview(page);
  await page.keyboard.press('9');
  await expect(page.locator('#screen-description')).toContainText('arousal');
  await page.reload();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(snapshot);
  await expect(page.locator('#session-select option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
  await expect(page.locator('#storage-status')).not.toContainText('memory only');
});
