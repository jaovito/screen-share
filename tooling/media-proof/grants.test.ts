import { expect, it } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenVerifier } from 'livekit-server-sdk';
import { writeProofGrants } from './grant-files';
import { issueProofGrants } from './grants';

const publisherId = '83c97c34-e315-43ea-8bcf-bcb90d03f9db';
const viewerId = 'fe15d838-70a2-4fda-b38c-40c7a5e98ec2';
const plan = {
  sessionId: publisherId,
  epoch: 1,
  participants: [
    { id: publisherId, role: 'publisher' },
    { id: viewerId, role: 'viewer' },
  ],
};
const credentials = {
  apiKey: 'synthetic-key-123',
  apiSecret: 'synthetic-secret-for-local-tests-1234567890',
  serverUrl: 'ws://127.0.0.1:7880',
};

it('signs least-privilege short-lived role grants for the explicit allowlist only', async () => {
  const start = Math.floor(Date.now() / 1000);
  const grants = await issueProofGrants(plan, credentials);
  const verifier = new TokenVerifier(credentials.apiKey, credentials.apiSecret);
  const signed = await Promise.all(grants.map((grant) => verifier.verify(grant.accessToken, 0)));
  const publisher = signed[0];
  const viewer = signed[1];
  expect(publisher?.sub).toBe(publisherId);
  expect(viewer?.sub).toBe(viewerId);
  expect(publisher?.video).toMatchObject({
    roomJoin: true,
    canPublish: true,
    canPublishSources: ['screen_share'],
    canSubscribe: false,
    canPublishData: false,
    roomAdmin: false,
    roomRecord: false,
    roomCreate: false,
  });
  expect(viewer?.video).toMatchObject({
    roomJoin: true,
    canPublish: false,
    canSubscribe: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  expect(viewer?.video?.canPublishSources).toBeUndefined();
  expect(publisher?.video?.room).toBe(viewer?.video?.room);
  for (const token of signed) {
    expect(token.exp).toBeGreaterThanOrEqual(start + 300);
    expect(token.exp).toBeLessThanOrEqual(start + 301);
  }
  for (const grant of grants) {
    expect(grant.expiresAt).toBeGreaterThanOrEqual(start + 300);
    expect(grant).not.toHaveProperty('mediaKey');
  }
  const next = await issueProofGrants({ ...plan, epoch: 2 }, credentials);
  expect(next[0]?.rtcRoom).not.toBe(grants[0]?.rtcRoom);
  await expect(
    new TokenVerifier(credentials.apiKey, 'incorrect-secret').verify(grants[0]?.accessToken ?? ''),
  ).rejects.toThrow();
});

it('rejects malformed plans and unsafe public signaling before issuing any grant', async () => {
  await expect(issueProofGrants({ ...plan, participants: [] }, credentials)).rejects.toThrow();
  await expect(
    issueProofGrants(plan, { ...credentials, serverUrl: 'ws://192.168.1.1:7880' }),
  ).rejects.toThrow();
  await expect(issueProofGrants(plan, { ...credentials, apiSecret: '' })).rejects.toThrow();
});

it('writes secrets privately, never overwrites existing grants, and rejects duplicate destinations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ss-proof-grants-'));
  const destination = join(root, 'private');
  try {
    const grants = await issueProofGrants(plan, credentials);
    await writeProofGrants(destination, grants);
    expect((await readdir(destination)).length).toBe(2);
    const file = join(destination, `${viewerId}.json`);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(grants[1]);
    if (process.platform !== 'win32') {
      expect((await stat(destination)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
    await expect(writeProofGrants(destination, grants)).rejects.toThrow();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(grants[1]);
    await expect(
      writeProofGrants(join(root, 'duplicates'), [...grants, ...grants]),
    ).rejects.toThrow();
    await expect(writeProofGrants(join(root, 'empty'), [])).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
