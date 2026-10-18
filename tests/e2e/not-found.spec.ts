import { expect, test } from '@playwright/test';

test('an unknown address shows the 404 page with a way home', async ({ page }) => {
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('button', { name: 'Go home' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'New session' })).toBeVisible();
});
