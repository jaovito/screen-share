import { expect, test } from '@playwright/test';

test('desktop preview provides real account controls and never exposes native capture in a browser', async ({
  page,
}, info) => {
  await page.goto(`http://127.0.0.1:${process.env.E2E_DESKTOP_PORT}`);
  await page.getByRole('combobox').selectOption('en');
  await expect(page.locator('.auth-panel')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A screen. Your people.');
  await expect(page.getByRole('button', { name: 'Choose window and start' })).toHaveCount(0);
  await page.getByRole('combobox').selectOption('es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Una pantalla. Tu gente.');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('desktop-product-preview.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('combobox')).toHaveValue('es');
});
