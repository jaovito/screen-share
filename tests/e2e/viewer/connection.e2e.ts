import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT}`;

async function signUp(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('combobox').selectOption('en');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(`${randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(`Synthetic-${randomUUID()}`);
  await page
    .locator('.auth-panel form')
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Your rooms', exact: true })).toBeVisible();
}

test('real private rooms require identity, owner approval and new session keys after membership changes', async ({
  page,
  browser,
  request,
}, info) => {
  expect((await request.get(`${api}/readyz`)).status()).toBe(200);
  expect((await request.get(`${api}/v1/video-profiles`)).status()).toBe(200);
  expect((await request.post(`${api}/token`)).status()).toBe(404);
  expect((await request.get(`${api}/v1/rooms`)).status()).toBe(401);
  await signUp(page, 'Synthetic owner');
  const roomName = `Private room ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Room name', { exact: true }).fill(roomName);
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('heading', { name: roomName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const invite = page.locator('.private-callout').getByLabel('Private invitation', { exact: true });
  await expect(invite).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
  const token = await invite.inputValue();
  const viewerContext = await browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.E2E_VIEWER_PORT}`,
  });
  const viewer = await viewerContext.newPage();

  try {
    await signUp(viewer, 'Synthetic viewer');
    await viewer.getByLabel('Private invitation', { exact: true }).fill(token);
    await viewer.getByRole('button', { name: 'Request access', exact: true }).click();
    await expect(viewer.locator('.room-content [role=status]')).toContainText(
      'Waiting for owner approval',
    );
    await expect(viewer.getByLabel('Private invitation', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(viewer.getByText('No stream is running.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Prepare sharing', exact: true }).click();
    await expect(page.getByLabel('Content key', { exact: true })).toHaveValue(
      /^[A-Za-z0-9_-]{43}$/,
    );
    await expect(
      page.getByRole('button', { name: 'Open session to approved viewers' }),
    ).toBeDisabled();
    await page.locator('.session-panel input[type=checkbox]').check();
    await page.getByRole('button', { name: 'Open session to approved viewers' }).click();
    await expect(viewer.getByRole('button', { name: 'Watch encrypted stream' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Watch encrypted stream' })).toBeDisabled();
    await expect(
      page.getByText('Publishing requires the Windows desktop app.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(viewer.getByRole('button', { name: 'Watch encrypted stream' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({
      path: info.outputPath('private-room.png'),
      fullPage: true,
      mask: [page.locator('input[type=password]')],
    });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('.auth-panel')).toBeVisible();
    await expect(page.getByLabel('Content key', { exact: true })).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }
});

test('authorization outages stop the workspace and explicit retry recovers', async ({ page }) => {
  await page.route(`${api}/api/auth/get-session`, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('autorização');
  await page.unroute(`${api}/api/auth/get-session`);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.locator('.auth-panel')).toBeVisible();
});

test('private workspace translates and remembers all supported languages', async ({
  page,
}, info) => {
  await page.goto('/');
  for (const [locale, heading] of [
    ['en', 'A screen. Your people.'],
    ['es', 'Una pantalla. Tu gente.'],
    ['pt-BR', 'Uma tela. A sua turma.'],
  ]) {
    if (!locale || !heading) throw new Error('Invalid locale fixture');
    await page.getByRole('combobox').selectOption(locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath(`workspace-${locale}.png`), fullPage: true });
    await page.reload();
    await expect(page.getByRole('combobox')).toHaveValue(locale);
  }
});
