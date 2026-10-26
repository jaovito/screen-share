import { expect, test } from '@playwright/test';

test('desktop browser preview explains missing IPC and disables transmission', async ({
  page,
}, info) => {
  await page.goto(`http://127.0.0.1:${process.env.E2E_DESKTOP_PORT}`);
  await expect(page.getByRole('button', { name: 'Iniciar transmissão' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('prévia web não possui IPC');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('desktop-preview.png'), fullPage: true });
});

test('desktop preview translates its unavailable state and remembers the language', async ({
  page,
}, info) => {
  await page.goto(`http://127.0.0.1:${process.env.E2E_DESKTOP_PORT}`);
  await page.getByRole('combobox').selectOption('en');
  await expect(page.getByRole('button', { name: 'Start streaming' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('the web preview has no IPC');
  await page.getByRole('combobox').selectOption('es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'El comienzo de tu transmisión.',
  );
  await expect(page.getByRole('status')).toContainText('la vista previa web no tiene IPC');
  await expect(page.getByRole('button', { name: 'Iniciar transmisión' })).toBeDisabled();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page).toHaveTitle('Screen Share — Escritorio');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('desktop-es.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('combobox')).toHaveValue('es');
  await expect(page.getByRole('status')).toContainText('la vista previa web no tiene IPC');
});
