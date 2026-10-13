import { devices, expect, test } from '@playwright/test';

// Desktop Chromium, where tab capture is offered. Chromium's fake capture UI auto-accepts
// getDisplayMedia and hands back a fake audio track.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Desktop Chrome'];
test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

test('tab audio: picked in Audio settings, transcribed like the mic', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  await page.goto('/');
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page).toHaveURL(/\/session\//);

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Audio settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Audio' });
  await dialog.getByRole('radio', { name: /Tab audio/ }).check();
  // Tab-only hides the microphone section.
  await expect(dialog.getByLabel('Input')).toBeHidden();
  await dialog.getByRole('button', { name: 'Save' }).click();
  expect(await page.evaluate(() => localStorage.getItem('nunchi.audioSource'))).toBe('tab');

  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-status="done"]').first()).toBeVisible({ timeout: 45_000 });

  await page.getByRole('button', { name: 'Stop' }).click();
  expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
});

test('tab audio is not offered on phones', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Audio settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Audio' });
  await expect(dialog.getByText('Speech detection')).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await ctx.close();
});
