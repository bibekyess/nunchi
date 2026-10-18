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

  // Stop submits the speech in progress; let every line settle before counting what's saved.
  await expect(
    page.locator('[data-status="transcribing"], [data-status="translating"]'),
  ).toHaveCount(0, { timeout: 30_000 });

  // Phase 3: the session is saved on the device and survives a reload.
  const savedSeqs = await done.evaluateAll((els) => els.map((e) => e.getAttribute('data-seq')));
  const firstTranslation = await first.locator('.translation-text').textContent();
  await page.reload();
  await expect(done).toHaveCount(savedSeqs.length, { timeout: 10_000 });
  await expect(done.first().locator('.translation-text')).toHaveText(firstTranslation!);

  // Summary: streamed markdown (GFM task list), saved with the session.
  await page.getByRole('tab', { name: 'Summary' }).click();
  await page.getByRole('button', { name: 'Generate summary' }).click();
  const summary = page.getByTestId('summary');
  await expect(summary.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(summary.getByRole('checkbox')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeEnabled();
  await page.screenshot({ path: 'test-results/summary.png' });
  await page.reload();
  await page.getByRole('tab', { name: 'Summary' }).click();
  await expect(summary.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.getByRole('tab', { name: 'Transcript' }).click();
  await expect(done.first()).toBeVisible();

  // Home lists it with its first translated line; rename and delete work.
  await page.getByRole('link', { name: 'Home' }).click();
  const row = page.getByTestId('recent-session');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(firstTranslation!);
  await row.getByRole('button', { name: /^Edit / }).click();
  await page.getByLabel('Title').fill('Weekly sync');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('Weekly sync');
  await page.screenshot({ path: 'test-results/home.png' });
  await row.getByRole('button', { name: /^Edit / }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
  expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
});

test('the empty-state microphone starts listening too', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Servers ready')).toBeVisible();
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/);

  // Hidden from assistive tech, so only one "Start listening" button is ever announced.
  await expect(page.getByRole('button', { name: 'Start listening' })).toHaveCount(1);
  await page.getByTestId('empty-state-mic').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Stop' }).click();
});
