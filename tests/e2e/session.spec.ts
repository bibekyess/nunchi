import { expect, test } from '@playwright/test';

test('live session: speech becomes ordered bilingual blocks', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  await page.goto('/');
  await expect(page.getByText('Servers ready')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });

  // The fixture is ~11 s of speech followed by silence; VAD should cut at least one clip,
  // and the mock answers with canned Korean that is translated to English.
  const done = page.locator('[data-status="done"]');
  await expect(done.first()).toBeVisible({ timeout: 45_000 });
  await expect(done.first().locator('.source-text')).toHaveText(/[가-힣]/);
  await expect(done.first().locator('.translation-text')).not.toHaveText('');
  await expect(page.locator('.translation-text', { hasText: '<think>' })).toHaveCount(0);

  await page.screenshot({ path: 'test-results/session-listening.png' });

  // Blocks are rendered in speech order.
  const seqs = await page
    .locator('[data-seq]')
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-seq'))));
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume listening' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start listening' })).toBeVisible();

  await page.screenshot({ path: 'test-results/session.png', fullPage: false });
  expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
});
