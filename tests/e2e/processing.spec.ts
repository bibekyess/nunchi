import { expect, test, type Page } from '@playwright/test';

async function openProcessing(page: Page) {
  await page.getByRole('button', { name: 'Processing' }).click();
  const dialog = page.getByRole('dialog', { name: 'Processing' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('processing: every task defaults to the server; others are coming soon', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Servers ready')).toBeVisible();

  const dialog = await openProcessing(page);
  for (const task of ['Speech to text', 'Translation', 'Summary']) {
    const group = dialog.getByRole('radiogroup', { name: task });
    await expect(group.getByRole('radio', { name: 'Server', exact: true })).toBeChecked();
    await expect(group.getByRole('radio', { name: 'Custom (Coming soon)' })).toBeDisabled();
    await expect(group.getByRole('radio', { name: 'This device (Coming soon)' })).toBeDisabled();
  }
  await expect(dialog.getByText('Ready')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // The same dialog is in the session's ⋯ menu.
  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Processing' }).click();
  await expect(page.getByRole('dialog', { name: 'Processing' })).toBeVisible();
});

test('processing: a choice survives a reload', async ({ page }) => {
  await page.goto('/');
  // A choice that isn't built yet (e.g. saved by a newer version): shown, flagged, never
  // quietly replaced by the server.
  await page.evaluate(() =>
    localStorage.setItem(
      'nunchi.engines',
      JSON.stringify({ speech: 'server', translate: 'server', summary: 'device' }),
    ),
  );
  await page.reload();
  await expect(page.getByRole('status').getByText('Summary coming soon')).toBeVisible();

  let dialog = await openProcessing(page);
  const summary = dialog.getByRole('radiogroup', { name: 'Summary' });
  await expect(summary.getByRole('radio', { name: 'This device (Coming soon)' })).toBeChecked();
  await expect(dialog.getByText("This device isn't available yet")).toBeVisible();

  // Pick the server again and save: that choice is what comes back after a reload.
  await summary.getByRole('radio', { name: 'Server', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.reload();
  await expect(page.getByText('Servers ready')).toBeVisible();
  dialog = await openProcessing(page);
  await expect(
    dialog
      .getByRole('radiogroup', { name: 'Summary' })
      .getByRole('radio', { name: 'Server', exact: true }),
  ).toBeChecked();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('nunchi.engines') ?? 'null')),
  ).toEqual({ speech: 'server', translate: 'server', summary: 'server' });
});
