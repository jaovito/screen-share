import { expect, test } from '@playwright/test';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT}`;

test('viewer connects to the real API/database, renders eight profiles and keeps media unavailable', async ({
  page,
  request,
}, info) => {
  const ready = await request.get(`${api}/readyz`);

  expect(ready.status()).toBe(200);

  const token = await request.post(`${api}/token`);

  expect(token.status()).toBe(404);

  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('API conectada · banco pronto');
  await expect(page.locator('.profile')).toHaveCount(8);
  await expect(page.getByText('Player ainda não implementado.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('viewer.png'), fullPage: true });
});

test('retry handles unavailable control and incompatible data, then recovers', async ({ page }) => {
  await page.route(`${api}/**`, (route) =>
    route.fulfill({ status: 503, body: '{}', headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('API ou banco indisponível');
  await page.unroute(`${api}/**`);

  await page.route(`${api}/v1/video-profiles`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"profiles":[]}',
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  await page.getByRole('button', { name: 'Verificar novamente' }).click();
  await expect(page.getByRole('status')).toHaveText('Resposta da API incompatível');
  await page.unroute(`${api}/v1/video-profiles`);

  await page.getByRole('button', { name: 'Verificar novamente' }).click();
  await expect(page.getByRole('status')).toHaveText('API conectada · banco pronto');
});
