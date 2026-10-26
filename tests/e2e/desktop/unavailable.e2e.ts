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
