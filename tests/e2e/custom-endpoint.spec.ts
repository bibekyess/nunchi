import { expect, test, type Locator } from '@playwright/test';

// Runs against the app server that has no upstreams (see playwright.config.ts): everything
// must go from the browser straight to the mock, used here as a custom endpoint.
const APP = 'http://localhost:3101';
const MOCK = `http://localhost:${process.env.E2E_MOCK_PORT ?? '8788'}/v1`;

async function pickCustom(dialog: Locator, task: string) {
  await dialog
    .getByRole('radiogroup', { name: task })
    .getByRole('radio', { name: 'Custom', exact: true })
    .click();
}

test('custom endpoint: a session and its summary run without the app server', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  const appCalls: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.origin === APP && url.pathname.startsWith('/api/') && url.pathname !== '/api/health') {
      appCalls.push(url.pathname);
    }
  });

  await page.goto(`${APP}/`);
  await expect(page.getByRole('status').getByText(/Speech not set up/)).toBeVisible();

  await page.getByRole('button', { name: 'Processing' }).click();
  const dialog = page.getByRole('dialog', { name: 'Processing' });
  for (const task of ['Speech to text', 'Translation', 'Summary']) await pickCustom(dialog, task);

  // Nothing filled in yet: saving is blocked, with the reason.
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert').first()).toHaveText('Enter the server URL.');

  const section = (title: string) =>
    dialog.locator('section', { has: page.getByRole('heading', { name: title, exact: true }) });
  const speech = section('Speech to text');
  await speech.getByLabel('Server URL').fill(MOCK);
  await speech.getByLabel('Model').fill('Systran/faster-whisper-large-v3');
  await speech.getByRole('button', { name: 'Test connection' }).click();
  await expect(speech.getByRole('status')).toHaveText('Connected (2 models).');

  // The mock wants its custom auth header on chat requests; CORS lets the browser send it.
  const translation = section('Translation');
  await translation.getByLabel('Server URL').fill(MOCK);
  await translation.getByLabel('Model').fill('mock-qwen');
  await translation.getByText('More options').click();
  await translation.getByLabel('Custom header name').fill('x-mock-auth');
  await translation.getByLabel('Header value').fill('wrong');
  await translation.getByRole('button', { name: 'Test connection' }).click();
  await expect(translation.getByRole('status')).toContainText('refused the API key (401)');
  // The browser logs that deliberate 401; only errors from here on count.
  consoleErrors.length = 0;
  await translation.getByLabel('Header value').fill('mock-secret');
  await translation.getByRole('button', { name: 'Test connection' }).click();
  await expect(translation.getByRole('status')).toHaveText('Connected. mock-qwen answered.');

  // The summary shares the translation endpoint by default.
  await expect(dialog.getByRole('switch', { name: 'Same as translation' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').getByText('Ready')).toBeVisible();

  // The key stays in this browser's settings.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nunchi.engines')!));
  expect(saved.choice).toEqual({ speech: 'endpoint', translate: 'endpoint', summary: 'endpoint' });
  expect(saved.endpoints.translate).toMatchObject({ baseUrl: MOCK, headerValue: 'mock-secret' });

  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByRole('button', { name: 'Start listening' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  const done = page.locator('[data-status="done"]');
  await expect(done.first()).toBeVisible({ timeout: 45_000 });
  await expect(done.first().locator('.source-text')).toHaveText(/[가-힣]/);
  await expect(done.first().locator('.translation-text')).not.toHaveText('');
  await expect(page.locator('.translation-text', { hasText: '<think>' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Passcode required')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Summary' }).click();
  await page.getByRole('button', { name: 'Generate summary' }).click();
  await expect(
    page.getByTestId('summary').getByRole('heading', { name: 'Overview' }),
  ).toBeVisible();

  expect(appCalls).toEqual([]);
  expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
});
