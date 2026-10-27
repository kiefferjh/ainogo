import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Exercise configuration variants against the real app module without changing
// repository configuration or adding test-only configuration to the product.
async function configuredPage(page, overrides) {
  const code = stripTypeScriptTypes(readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8'));
  await page.route('**/src/config.ts', route => route.fulfill({
    contentType: 'text/javascript',
    body: `${code}\nObject.assign(experimentConfig, ${JSON.stringify(overrides)});`,
  }));
  await page.goto(`http://127.0.0.1:4174${process.env.GITHUB_ACTIONS ? '/ainogo/' : '/'}`);
}

async function begin(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
}

async function rateWithKey(page, key) {
  await expect(page.getByRole('button', { name: key, exact: true })).toBeEnabled();
  await page.keyboard.press(key);
}

test('all eight images complete with mixed input and no runtime errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await begin(page);
  const sources = new Set();
  for (let index = 1; index <= 8; index++) {
    await expect(page.locator('#screen-description')).toContainText(`Image ${index} of 8`);
    await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
    const src = await page.locator('#study-image').getAttribute('src');
    sources.add(src);
    await page.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.locator('#screen-description')).toContainText('arousal');
    await expect(page.locator('#study-image')).toHaveAttribute('src', src);
    await rateWithKey(page, '8');
  }
  await expect(page.locator('#screen-description')).toContainText('complete');
  await expect(page.locator('#rating-panel')).toBeHidden();
  expect(sources.size).toBe(8);
  const final = await page.locator('#status').textContent();
  expect(final.match(/valence 2, arousal 8/g)).toHaveLength(8);
  await page.keyboard.press('9');
  await expect(page.locator('#status')).toHaveText(final);
  expect(errors).toEqual([]);
});

test('double-clicking Start does not skip instructions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'Begin', exact: true })).toBeVisible();
  await expect(page.locator('#rating-panel')).toBeHidden();
});

test('double-clicking a rating records only its first dimension', async ({ page }) => {
  await begin(page);
  await page.getByRole('button', { name: '4', exact: true }).dblclick();
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
});

test('holding a numeric key cannot fill the next rating', async ({ page }) => {
  await begin(page);
  await page.keyboard.down('4');
  await page.keyboard.down('4');
  await page.keyboard.up('4');
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
});

test('two inputs in one browser task cannot answer a question before it is displayed', async ({ page }) => {
  await begin(page);
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '8', bubbles: true }));
  });
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
  await expect(page.getByRole('button', { name: '8', exact: true })).toBeEnabled();
  await page.keyboard.press('8');
  await expect(page.locator('#screen-description')).toContainText('Image 2 of 8');
});

test('modified Enter does not submit a focused rating button', async ({ page }) => {
  await begin(page);
  const button = page.getByRole('button', { name: '4', exact: true });
  await button.focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one valence');
  await page.keyboard.press('Enter');
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
});

test('releasing a mouse press from the previous question cannot submit another rating', async ({ page }) => {
  await begin(page);
  const button = page.getByRole('button', { name: '4', exact: true });
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.keyboard.press('2');
  await expect(button).toBeEnabled();
  await page.mouse.up();
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
  await rateWithKey(page, '8');
  await expect(page.locator('#screen-description')).toContainText('Image 2 of 8');
});

test('retrying an image URL with a fragment starts a fresh network request', async ({ page }) => {
  await page.clock.install();
  await page.route('**/src/images.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({ response,
      body: `${await response.text()}\nimages.forEach(image => { image.src += '#stimulus'; });`,
    });
  });
  let stall = true;
  const pending = [];
  await page.route('**/*.png*', route => {
    if (route.request().resourceType() !== 'image') return route.continue();
    if (stall) pending.push(route);
    else return route.continue();
  });
  await configuredPage(page, {});
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Loading image');
  await page.clock.fastForward(15_000);
  await expect(page.getByRole('button', { name: 'Retry image' })).toBeVisible();
  stall = false;
  await page.getByRole('button', { name: 'Retry image' }).click();
  await expect(page.getByRole('button', { name: '4', exact: true })).toBeEnabled();
  await page.keyboard.press('4');
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
  for (const route of pending) await route.abort();
});

test('keyboard focus moves to each new question after responding', async ({ page }) => {
  await begin(page);
  await expect(page.locator('#rating-question')).toBeFocused();
  await page.getByRole('button', { name: '3', exact: true }).click();
  await expect(page.locator('#rating-question')).toBeFocused();
});

test('image failure can be retried without losing recorded ratings', async ({ page }) => {
  await begin(page);
  let fail = true;
  await page.route('**/*.png*', route => fail ? route.abort() : route.continue());
  await page.getByRole('button', { name: '2', exact: true }).click();
  await rateWithKey(page, '8');
  await expect(page.getByRole('button', { name: 'Retry image' })).toBeVisible();
  await page.keyboard.press('5');
  await expect(page.locator('#screen-description')).toContainText('Image 2 of 8: select one valence');
  await expect(page.getByRole('button', { name: '5', exact: true })).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: 'Retry image' }).click();
  for (let index = 2; index <= 8; index++) {
    await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
    await page.keyboard.press('2');
    await rateWithKey(page, '8');
  }
  await expect(page.locator('#screen-description')).toContainText('complete');
  expect((await page.locator('#status').textContent()).match(/valence 2, arousal 8/g)).toHaveLength(8);
});

test('a stalled image offers retry instead of leaving the participant stuck', async ({ page }) => {
  await page.clock.install();
  const pending = [];
  let stall = true;
  await page.route('**/*.png*', route => {
    if (stall) pending.push(route);
    else return route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Loading image');
  await page.clock.fastForward(15_000);
  await expect(page.getByRole('button', { name: 'Retry image' })).toBeVisible();
  stall = false;
  await page.getByRole('button', { name: 'Retry image' }).click();
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await expect(page.locator('#rating-question')).toBeFocused();
  await page.keyboard.press('2');
  await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
  for (const route of pending) await route.abort();
});

test('rating controls fit the viewport without horizontal scrolling', async ({ page }) => {
  await begin(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '9', exact: true })).toBeVisible();
});

test('holding Enter on Start does not bypass instructions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start', exact: true }).focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByRole('button', { name: 'Begin', exact: true })).toBeVisible();
  await expect(page.locator('#rating-panel')).toBeHidden();
});

test('keyboard-only participants can Tab to ratings and activate with Enter and Space', async ({ page }) => {
  await configuredPage(page, { enableMouse: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.locator('#rating-question')).toBeFocused();
  await page.getByRole('button', { name: '4', exact: true }).click();
  await expect(page.locator('#screen-description')).toContainText('select one valence');
  // Return to the question after the intentionally ignored mouse click.
  await page.locator('#rating-question').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#screen-description')).toContainText('select one arousal');
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await expect(page.locator('#rating-question')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(page.locator('#screen-description')).toContainText('Image 2 of 8');
});

test('mouse-only participants cannot submit ratings with native keyboard activation', async ({ page }) => {
  await configuredPage(page, { enableKeyboard: false });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  const button = page.getByRole('button', { name: '4', exact: true });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.keyboard.press('4');
  await expect(page.locator('#screen-description')).toContainText('select one valence');
  await button.click();
  await expect(page.locator('#screen-description')).toContainText('select one arousal');
});

test('arousal-first mode completes a real session with correct values', async ({ page }) => {
  await configuredPage(page, { ratingOrder: ['arousal', 'valence'] });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  for (let index = 1; index <= 8; index++) {
    await expect(page.getByRole('button', { name: '8', exact: true })).toBeEnabled();
    await expect(page.locator('#screen-description')).toContainText('select one arousal');
    await page.keyboard.press('8');
    await expect(page.locator('#status')).toContainText('Arousal recorded. Now rate valence.');
    await rateWithKey(page, '2');
  }
  await expect(page.locator('#screen-description')).toContainText('complete');
  expect((await page.locator('#status').textContent()).match(/valence 2, arousal 8/g)).toHaveLength(8);
});

test('invalid configuration visibly disables the study instead of leaving a dead Start button', async ({ page }) => {
  await configuredPage(page, { enableKeyboard: false, enableMouse: false });
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await expect(page.locator('#status')).toContainText('This study cannot start');
  await expect(page.locator('#rating-panel')).toBeHidden();
});

test('a failed script download leaves Start disabled with recovery instructions', async ({ page }) => {
  await page.route('**/assets/*.js', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await expect(page.locator('#status')).toContainText('check your connection and refresh');
});

test('JavaScript-disabled browsers receive an explanation and cannot start', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(baseURL);
    await expect(page.getByText('JavaScript must be enabled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  } finally {
    await context.close();
  }
});

test('slow image delivery blocks responses until the new image is ready', async ({ page }) => {
  await begin(page);
  const pending = [];
  let stall = true;
  await page.route('**/*.png*', route => {
    if (stall) pending.push(route);
    else return route.continue();
  });
  await rateWithKey(page, '2');
  await rateWithKey(page, '8');
  await expect(page.locator('#status')).toContainText('Loading image');
  await expect.poll(() => pending.length).toBe(1);
  await page.keyboard.press('4');
  await page.keyboard.press('6');
  await expect(page.locator('#screen-description')).toContainText('Image 2 of 8: select one valence');
  await expect(page.getByRole('button', { name: '4', exact: true })).toBeDisabled();
  stall = false;
  await pending[0].continue();
  await rateWithKey(page, '4');
  await expect(page.locator('#screen-description')).toContainText('Image 2 of 8: select one arousal');
});

test('rating reminders reset for new questions and cannot overwrite completion', async ({ page }) => {
  await page.clock.install();
  await configuredPage(page, { timeLimitMs: 1000 });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.getByRole('button', { name: '2', exact: true })).toBeEnabled();
  await page.clock.fastForward(1000);
  await expect(page.locator('#status')).toContainText('Time limit reached');
  await rateWithKey(page, '2');
  await expect(page.getByRole('button', { name: '8', exact: true })).toBeEnabled();
  await expect(page.locator('#status')).not.toContainText('Time limit reached');
  await page.clock.fastForward(1000);
  await expect(page.locator('#status')).toContainText('Time limit reached');
  await rateWithKey(page, '8');
  for (let index = 2; index <= 8; index++) {
    await rateWithKey(page, '2');
    await rateWithKey(page, '8');
  }
  const final = await page.locator('#status').textContent();
  await page.clock.fastForward(100_000);
  await expect(page.locator('#screen-description')).toContainText('complete');
  await expect(page.locator('#status')).toHaveText(final);
});

test.describe('touch input', () => {
  test.use({ hasTouch: true });
  test('a full session works using touchscreen taps', async ({ page }) => {
    await page.addInitScript(() => {
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        document.addEventListener(type, event => {
          const button = event.target.closest?.('#rating-buttons button');
          if (button) console.debug('rating-touch-event', JSON.stringify({
            type, detail: event.detail, pointerType: event.pointerType,
            value: button.textContent, disabled: button.disabled,
            prompt: document.querySelector('#screen-description')?.textContent,
          }));
        }, true);
      }
    });
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await begin(page);
    for (let index = 1; index <= 8; index++) {
      // A touch action may return before its synthesized click is processed.
      // Confirm each prompt transition rather than tapping against the old UI.
      await expect(page.locator('#screen-description')).toContainText(`Image ${index} of 8: select one valence`);
      await page.getByRole('button', { name: '2', exact: true }).tap();
      await expect(page.locator('#screen-description')).toContainText(`Image ${index} of 8: select one arousal`);
      await page.getByRole('button', { name: '8', exact: true }).tap();
    }
    await expect(page.locator('#screen-description')).toContainText('complete');
    expect((await page.locator('#status').textContent()).match(/valence 2, arousal 8/g)).toHaveLength(8);
  });

  test('touch click counts do not reject intentional new-prompt responses', async ({ page }) => {
    await begin(page);
    const activate = async (value, detail) => {
      await expect(page.getByRole('button', { name: String(value), exact: true })).toBeEnabled();
      await page.evaluate(({ value, detail }) => {
        const button = document.querySelectorAll('#rating-buttons button')[value - 1];
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
        button.dispatchEvent(new PointerEvent('click', { bubbles: true, pointerType: 'touch', detail }));
      }, { value, detail });
    };
    await activate(2, 2);
    await expect(page.locator('#screen-description')).toContainText('Image 1 of 8: select one arousal');
    await activate(8, 3);
    await expect(page.locator('#screen-description')).toContainText('Image 2 of 8');
  });
});
