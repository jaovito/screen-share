import { expect, type Page } from '@playwright/test';

const frames = (page: Page) =>
  page
    .locator('.receive-panel video')
    .evaluate((element) =>
      element instanceof HTMLVideoElement ? element.getVideoPlaybackQuality().totalVideoFrames : 0,
    );

async function connect(page: Page, key: string) {
  const panel = page.locator('.receive-panel');
  await panel.locator('input[name="mediaKey"]').fill(key);
  await panel.locator('input[type="checkbox"]').check();
  await panel.locator('button[type="submit"]').click();
  await expect(panel.locator('input[name="mediaKey"]')).toHaveValue('');
}

export async function assertPlayback(page: Page, key: string) {
  await connect(page, key);
  await expect.poll(() => frames(page), { timeout: 20_000 }).toBeGreaterThan(5);
  const video = page.locator('.receive-panel video');
  expect(
    await video.evaluate(
      (element) =>
        element instanceof HTMLVideoElement &&
        element.videoWidth === 320 &&
        element.videoHeight === 180,
    ),
  ).toBe(true);
  const energy = await page.locator('.receive-panel audio').evaluate(async (element) => {
    if (!(element instanceof HTMLAudioElement) || !(element.srcObject instanceof MediaStream))
      throw new Error('Actual received audio stream unavailable');
    const context = new AudioContext();
    try {
      await context.resume();
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(element.srcObject).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peak = 0;
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        analyser.getFloatTimeDomainData(samples);
        for (const value of samples) peak = Math.max(peak, Math.abs(value));
      }
      return peak;
    } finally {
      await context.close();
    }
  });
  expect(energy).toBeGreaterThan(0.005);
  // Verify stopping releases attached media before trying a distinct invalid key.
  await page.locator('.receive-panel button.secondary').click();
  await expect
    .poll(() =>
      video.evaluate(
        (element) => element instanceof HTMLVideoElement && element.srcObject === null,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator('.receive-panel audio')
        .evaluate((element) => element instanceof HTMLAudioElement && element.srcObject === null),
    )
    .toBe(true);
  await video.evaluate((element) => {
    if (element instanceof HTMLVideoElement) element.load();
  });
  await expect.poll(() => frames(page)).toBe(0);
  const wrong = `${key[0] === 'A' ? 'B' : 'A'}${key.slice(1)}`;
  await connect(page, wrong);
  // The reset element must never decode a single frame with the independent wrong key.
  for (let sample = 0; sample < 25; sample++) {
    await page.waitForTimeout(200);
    expect(await frames(page)).toBe(0);
  }
  const disconnect = page.locator('.receive-panel button.secondary');
  if (await disconnect.isEnabled()) await disconnect.click();
  await expect
    .poll(() =>
      video.evaluate(
        (element) => element instanceof HTMLVideoElement && element.srcObject === null,
      ),
    )
    .toBe(true);
}

export async function assertCsp(page: Page, forbiddenUrl: string) {
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('desktop_fixture');
  const result = await page.evaluate(async (url) => {
    let violated = false;
    const listener = (event: SecurityPolicyViolationEvent) => {
      if (event.violatedDirective === 'connect-src' && event.blockedURI.startsWith(url))
        violated = true;
    };
    document.addEventListener('securitypolicyviolation', listener);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      return violated;
    } finally {
      document.removeEventListener('securitypolicyviolation', listener);
    }
  }, forbiddenUrl);
  expect(result).toBe(true);
}
