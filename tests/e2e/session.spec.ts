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

  // View filter is by language: the mock's Korean speech → English translation.
  const first = done.first();
  const filter = page.getByTestId('view-filter');
  await filter.selectOption('en');
  await expect(first.locator('[data-role="source"]')).toHaveCount(0);
  await expect(first.locator('[data-role="translation"]')).toBeVisible();
  await filter.selectOption('ko');
  await expect(first.locator('[data-role="source"]')).toBeVisible();
  await expect(first.locator('[data-role="translation"]')).toHaveCount(0);
  await filter.selectOption('all');
  await expect(first.locator('[data-role="translation"]')).toBeVisible();

  // Text size steps M → L, and the line gets bigger.
  const size = () =>
    first.locator('[data-role="translation"]').evaluate((e) => getComputedStyle(e).fontSize);
  const before = parseFloat(await size());
  await page.getByRole('button', { name: /^Text size: Medium/ }).click();
  await expect(page.locator('[data-size="l"]')).toBeVisible();
  expect(parseFloat(await size())).toBeGreaterThan(before);

  // Side by side needs a wide screen: the toggle is hidden on the phone viewport.
  const sideBySide = page.getByRole('button', { name: 'Side by side' });
  await expect(sideBySide).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await sideBySide.click();
  await expect(page.locator('[data-layout="columns"]')).toBeVisible();
  const [src, tr] = await Promise.all([
    first.locator('[data-role="source"]').boundingBox(),
    first.locator('[data-role="translation"]').boundingBox(),
  ]);
  expect(Math.abs(src!.y - tr!.y)).toBeLessThan(2); // same row
  expect(tr!.x).toBeGreaterThan(src!.x + src!.width - 1); // Korean left, English right
  await page.screenshot({ path: 'test-results/session-columns.png' });
  await sideBySide.click();
  await page.setViewportSize({ width: 412, height: 839 });

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume listening' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start listening' })).toBeVisible();

  await page.screenshot({ path: 'test-results/session.png', fullPage: false });
  expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
});
