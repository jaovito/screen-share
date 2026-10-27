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

test('viewer switches and remembers all supported languages', async ({ page }, info) => {
  await page.goto('/');
  for (const [locale, heading, status, title] of [
    ['en', 'Your screen. Your friends.', 'API connected · database ready', 'Screen Share — Viewer'],
    [
      'es',
      'Tu pantalla. Tus amigos.',
      'API conectada · base de datos lista',
      'Screen Share — Espectador',
    ],
    [
      'pt-BR',
      'Sua tela. Seus amigos.',
      'API conectada · banco pronto',
      'Screen Share — Espectador',
    ],
  ]) {
    if (!locale || !heading || !status || !title) throw new Error('Invalid locale test case');
    await page.getByRole('combobox').selectOption(locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page.getByRole('status')).toHaveText(status);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('.profile')).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath(`viewer-${locale}.png`), fullPage: true });
    await page.reload();
    await expect(page.getByRole('combobox')).toHaveValue(locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  }
});

test('the experimental receiver requires consent, rejects invalid grants and clears credentials', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.getByRole('combobox').selectOption('en');
  await page.locator('summary').click();
  await expect(page.getByRole('button', { name: 'Connect to proof', exact: true })).toBeDisabled();
  await page.getByLabel('Viewer grant JSON', { exact: true }).fill('{}');
  await page.getByLabel('Independent media key', { exact: true }).fill('a'.repeat(43));
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Connect to proof', exact: true }).click();
  await expect(page.locator('.proof-content [role=status]')).toContainText('Invalid grant');
  await expect(page.getByLabel('Viewer grant JSON', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Independent media key', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('m1-receiver.png'), fullPage: true });
  await page.locator('summary').click();
  await expect(page.getByLabel('Viewer grant JSON', { exact: true })).toHaveCount(0);
});
