import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { MediaProofGrant } from '@screen-share/contracts';
import { issueProofGrants } from '../../tooling/media-proof/grants';

test('Rust pre-encoded H264 interoperates with the browser worker and rejects a different key', async ({
  browser,
}) => {
  test.setTimeout(45000);
  const directory = await mkdtemp(join(tmpdir(), 'ss-native-media-'));
  const fixture = await browser.newPage();
  const receiver = await browser.newPage();
  const wrong = await browser.newPage();
  let processHandle: ReturnType<typeof spawn> | undefined;
  let exited: Promise<number | null> | undefined;
  try {
    const grants = await issueProofGrants(
      {
        sessionId: randomUUID(),
        epoch: 1,
        participants: [
          { id: randomUUID(), role: 'publisher' },
          { id: randomUUID(), role: 'viewer' },
          { id: randomUUID(), role: 'viewer' },
        ],
      },
      {
        apiKey: process.env.LIVEKIT_API_KEY,
        apiSecret: process.env.LIVEKIT_API_SECRET,
        serverUrl: process.env.LIVEKIT_PUBLIC_URL,
      },
    );
    const [publisher, viewer, wrongViewer] = grants;
    if (!publisher || !viewer || !wrongViewer) throw new Error('Synthetic grant creation failed.');
    await fixture.goto(`http://127.0.0.1:${process.env.MEDIA_PROOF_PUBLISHER_PORT}`);
    await fixture.waitForFunction(() => Boolean(window.mediaTest));
    const key = await fixture.evaluate(() => {
      const data = crypto.getRandomValues(new Uint8Array(32));
      return btoa(String.fromCharCode(...data))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    });
    const downloadReady = fixture.waitForEvent('download');
    await fixture.evaluate(() => window.mediaTest.exportSyntheticPackets());
    const download = await downloadReady;
    const packetsPath = join(directory, 'synthetic-packets.bin');
    await download.saveAs(packetsPath);
    const grantPath = join(directory, 'publisher.json');
    const keyPath = join(directory, 'independent-key');
    await writeFile(grantPath, JSON.stringify(publisher), { flag: 'wx', mode: 0o600 });
    await writeFile(keyPath, key, { flag: 'wx', mode: 0o600 });
    const binary =
      resolve('target/debug/examples/preencoded_probe') +
      (process.platform === 'win32' ? '.exe' : '');
    processHandle = spawn(binary, [grantPath, keyPath, packetsPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', RUST_BACKTRACE: '0' },
    });
    const child = processHandle;
    let failure = 'no sanitized stage';
    child.stderr?.on('data', (data: Buffer) => {
      const stage = data.toString('utf8').match(/Native transport code: ([A-Za-z]+)/)?.[1];
      if (stage) failure = stage;
      for (const known of [
        'Invalid publisher grant',
        'Invalid independent media key',
        'Native runtime unavailable',
      ])
        if (data.toString('utf8').includes(known)) failure = known;
    });
    child.stdin?.on('error', () => {});
    exited = new Promise((resolveExit) => {
      child.once('exit', resolveExit);
      child.once('error', () => resolveExit(-1));
    });
    const ready = new Promise<void>((resolveReady, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error('Native publisher readiness timed out.')),
        25000,
      );
      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error('Native publisher could not start.'));
      });
      child.once('exit', (code, signal) => {
        failure += `; exit ${code}, signal ${signal ?? 'none'}`;
        clearTimeout(timer);
        reject(new Error(`Native publisher exited before readiness (${failure}).`));
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-1024);
        if (output.includes('Native encrypted publication prepared.')) {
          clearTimeout(timer);
          resolveReady();
        }
      });
    });
    await ready;
    const open = async (page: Page, grant: MediaProofGrant, mediaKey: string) => {
      await page.goto(`http://127.0.0.1:${process.env.MEDIA_PROOF_VIEWER_PORT}`);
      await page.getByRole('combobox').selectOption('en');
      await page.locator('summary').click();
      await page.getByLabel('Viewer grant JSON', { exact: true }).fill(JSON.stringify(grant));
      await page.getByLabel('Independent media key', { exact: true }).fill(mediaKey);
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Connect to proof', exact: true }).click();
    };
    const decoded = (page: Page) =>
      page
        .locator('video')
        .evaluate((video) =>
          video instanceof HTMLVideoElement ? video.getVideoPlaybackQuality().totalVideoFrames : 0,
        );
    await open(receiver, viewer, key);
    await expect.poll(() => decoded(receiver), { timeout: 15000 }).toBeGreaterThan(3);
    await open(wrong, wrongViewer, (key[0] === 'A' ? 'B' : 'A') + key.slice(1));
    const before = await decoded(receiver);
    await wrong.waitForTimeout(2500);
    expect(await decoded(wrong)).toBe(0);
    await expect.poll(() => decoded(receiver)).toBeGreaterThan(before);
    await expect(wrong.locator('.proof-content [role=status]')).not.toContainText('Configuring');
    child.stdin?.end('stop');
    expect(await exited).toBe(0);
  } finally {
    if (processHandle?.stdin?.writable && !processHandle.stdin.writableEnded)
      processHandle.stdin.end('stop');
    if (processHandle && processHandle.exitCode === null) {
      const timer = setTimeout(() => processHandle?.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
    await Promise.all([fixture.close(), receiver.close(), wrong.close()]);
    await rm(directory, { recursive: true, force: true });
  }
});
