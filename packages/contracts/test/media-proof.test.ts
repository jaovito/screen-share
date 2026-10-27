import { expect, it } from 'bun:test';
import { mediaProofGrantSchema, mediaProofServerSchema } from '../src';

const publisherId = '83c97c34-e315-43ea-8bcf-bcb90d03f9db';
const viewerId = 'fe15d838-70a2-4fda-b38c-40c7a5e98ec2';
it('accepts only secure or loopback signaling without URL credentials', () => {
  for (const url of [
    'wss://rtc.example.test',
    'ws://127.0.0.1:7880',
    'ws://localhost:7880',
    'ws://[::1]:7880',
  ])
    expect(mediaProofServerSchema.safeParse(url).success).toBe(true);
  for (const url of [
    'ws://192.168.1.5:7880',
    'https://rtc.example.test',
    'wss://user:password@rtc.example.test',
    'wss://rtc.example.test?token=secret',
    'wss://rtc.example.test#secret',
    'ws://localhost.evil.test',
  ])
    expect(mediaProofServerSchema.safeParse(url).success).toBe(false);
});

it('validates strict client grants without treating the envelope as verified JWT authorization', () => {
  const grant = {
    version: 1,
    sessionId: publisherId,
    epoch: 1,
    rtcRoom: `m1-${publisherId}`,
    participantId: viewerId,
    publisherId,
    role: 'viewer',
    serverUrl: 'wss://rtc.example.test',
    accessToken: 'synthetic.payload.signature',
    expiresAt: 1900000000,
  };
  expect(mediaProofGrantSchema.safeParse(grant).success).toBe(true);
  expect(mediaProofGrantSchema.safeParse({ ...grant, role: 'publisher' }).success).toBe(false);
  expect(mediaProofGrantSchema.safeParse({ ...grant, mediaKey: 'never-in-a-grant' }).success).toBe(
    false,
  );
  expect(mediaProofGrantSchema.safeParse({ ...grant, accessToken: 'not-a-jwt' }).success).toBe(
    false,
  );
});
