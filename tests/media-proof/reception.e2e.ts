import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { MediaProofGrant } from '@screen-share/contracts';
import { issueProofGrants } from '../../tooling/media-proof/grants';

async function grants() {
  const credentials = {
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    serverUrl: process.env.LIVEKIT_PUBLIC_URL,
  };
  const result = await issueProofGrants(
    {
      sessionId: randomUUID(),
      epoch: 1,
      participants: [
        { id: randomUUID(), role: 'publisher' },
        { id: randomUUID(), role: 'viewer' },
        { id: randomUUID(), role: 'viewer' },
      ],
    },
    credentials,
  );
  const publisher = result[0];
  const viewer = result[1];
  const wrongViewer = result[2];
  if (!publisher || !viewer || !wrongViewer)
    throw new Error('Synthetic test grant creation failed.');
  return { publisher, viewer, wrongViewer };
}

async function decodedFrames(page: import('@playwright/test').Page) {
  return page
    .locator('video')
    .evaluate((video) =>
      video instanceof HTMLVideoElement ? video.getVideoPlaybackQuality().totalVideoFrames : 0,
    );
}

test('the actual worker receives encrypted synthetic H264 and a wrong key cannot decode it', async ({
  browser,
}) => {
  const { publisher, viewer, wrongViewer } = await grants();
  const publishing = await browser.newPage();
  const receiving = await browser.newPage();
  const wrong = await browser.newPage();
  try {
    await publishing.goto(`http://127.0.0.1:${process.env.MEDIA_PROOF_PUBLISHER_PORT}`);
    await publishing.waitForFunction(() => Boolean(window.mediaTest));
    const key = await publishing.evaluate((grant) => window.mediaTest.start(grant), publisher);
    const open = async (
      page: import('@playwright/test').Page,
      grant: MediaProofGrant,
      mediaKey: string,
    ) => {
      await page.goto(`http://127.0.0.1:${process.env.MEDIA_PROOF_VIEWER_PORT}/?mode=experiment`);
      await page.getByRole('combobox').selectOption('en');
      await page.locator('summary').click();
      await page.getByLabel('Viewer grant JSON', { exact: true }).fill(JSON.stringify(grant));
      await page.getByLabel('Independent media key', { exact: true }).fill(mediaKey);
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Connect to proof', exact: true }).click();
    };
    await open(receiving, viewer, key);
    await expect.poll(() => decodedFrames(receiving), { timeout: 15000 }).toBeGreaterThan(3);
    await open(wrong, wrongViewer, (key[0] === 'A' ? 'B' : 'A') + key.slice(1));
    const before = await decodedFrames(receiving);
    await wrong.waitForTimeout(2500);
    expect(await decodedFrames(wrong)).toBe(0);
    await expect.poll(() => decodedFrames(receiving)).toBeGreaterThan(before);
    await expect(wrong.locator('.proof-content [role=status]')).not.toContainText('Configuring');
    await expect(wrong.getByLabel('Independent media key', { exact: true })).toHaveValue('');
    await expect(wrong.getByLabel('Viewer grant JSON', { exact: true })).toHaveValue('');
  } finally {
    await publishing.evaluate(() => window.mediaTest?.stop()).catch(() => {});
    await Promise.all([publishing.close(), receiving.close(), wrong.close()]);
  }
});
