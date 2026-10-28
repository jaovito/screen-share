import { expect, it } from 'bun:test';
import { controlResponseSchema, nativeSharingStatusSchema, productMediaGrantSchema } from '../src';

it('adaptive diagnostics expose bounded actual targets and reject invented bottlenecks', async () => {
  const fixture = await Bun.file(
    new URL('../fixtures/native-sharing-status.json', import.meta.url),
  ).json();
  const valid = {
    ...fixture,
    adaptationReason: 'network_pressure',
    qualityChanges: 2,
    targetBitrateBps: 1_000_000,
  };
  expect(nativeSharingStatusSchema.parse(valid).qualityChanges).toBe(2);
  for (const patch of [
    { adaptationReason: 'gpu_saturated' },
    { qualityChanges: -1 },
    { qualityChanges: 1.5 },
    { targetBitrateBps: 0 },
    { targetBitrateBps: 50_000_001 },
  ]) {
    expect(nativeSharingStatusSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  }
});

const publisherId = '2be00d58-9715-4319-a747-725ac0735130';
const participantId = 'e9128130-5c5a-43c1-a571-3146240e4ea5';
const grant = {
  version: 1,
  sessionId: publisherId,
  epoch: 1,
  rtcRoom: `ss-${publisherId}`,
  participantId,
  publisherId,
  role: 'viewer',
  serverUrl: 'wss://rtc.example.test',
  accessToken: 'synthetic.token.signature',
  expiresAt: 2000000000,
};
it('validates product room names and public transport envelopes at client boundaries', () => {
  expect(productMediaGrantSchema.safeParse(grant).success).toBe(true);
  for (const rtcRoom of [
    'ss-------------------------------------',
    'ss-invalid',
    `m1-${publisherId}`,
  ])
    expect(productMediaGrantSchema.safeParse({ ...grant, rtcRoom }).success).toBe(false);
  expect(controlResponseSchema.safeParse({ status: 200, body: { user: null } }).success).toBe(true);
  expect(controlResponseSchema.safeParse({ status: 99, body: null }).success).toBe(false);
});
it('keeps unavailable native measurements nullable and rejects invented negative counters', () => {
  const status = {
    state: 'idle',
    profileId: null,
    elapsedMs: 0,
    framesCaptured: 0,
    framesEncoded: 0,
    encodedBytes: 0,
    queueReplacements: 0,
    captureFps: null,
    encodedFps: null,
    targetFps: null,
    audioSupported: false,
    reason: null,
    encryption: 'pending',
  };
  expect(nativeSharingStatusSchema.safeParse(status).success).toBe(true);
  expect(nativeSharingStatusSchema.safeParse({ ...status, framesEncoded: -1 }).success).toBe(false);
  expect(
    nativeSharingStatusSchema.safeParse({ ...status, audioSupported: 'unverified' }).success,
  ).toBe(false);
});

it('validates native metadata compatibility and rejects invalid audio counters', async () => {
  const fixture = await Bun.file(
    new URL('../fixtures/native-sharing-status.json', import.meta.url),
  ).json();
  expect(nativeSharingStatusSchema.parse(fixture).audioSamples).toBe(0);
  expect(nativeSharingStatusSchema.safeParse({ ...fixture, audioSamples: -1 }).success).toBe(false);
});

it('accepts measured processing metadata while rejecting invalid or unbounded diagnostic evidence', async () => {
  const fixture = await Bun.file(
    new URL('../fixtures/native-sharing-status.json', import.meta.url),
  ).json();
  const valid = {
    ...fixture,
    diagnosticsGeneration: 2,
    diagnosticsElapsedMs: 5000,
    conversionSubmissionMs: 0.5,
    encoderOutputLatencyMs: 8,
    availableSendBitrateBps: 2_000_000,
    manualBitrateBps: 4_000_000,
  };
  expect(nativeSharingStatusSchema.parse(valid).encoderOutputLatencyMs).toBe(8);
  for (const patch of [
    { captureRecoveries: 4 },
    { diagnosticsGeneration: -1 },
    { diagnosticsElapsedMs: Infinity },
    { conversionSubmissionMs: NaN },
    { conversionSubmissionMs: -1 },
    { encoderOutputLatencyMs: 60_001 },
    { availableSendBitrateBps: 1_000_000_000_001 },
    { manualBitrateBps: 63_999 },
  ]) {
    expect(nativeSharingStatusSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  }
});

it('accepts the shared native failure fixture and rejects arbitrary text, fields and invalid HRESULTs', async () => {
  const status = await Bun.file(
    new URL('../fixtures/native-sharing-status.json', import.meta.url),
  ).json();
  const failure = await Bun.file(
    new URL('../fixtures/native-sharing-failure.json', import.meta.url),
  ).json();
  expect(nativeSharingStatusSchema.parse({ ...status, failure }).failure).toEqual(failure);
  for (const patch of [
    { stage: 'private input' },
    { code: 'private token' },
    { operation: 'arbitrary driver description' },
    { hresult: 2147483648 },
    { hresult: -2147483649 },
    { hresult: 1.5 },
    { hresult: NaN },
    { accessToken: 'synthetic secret' },
  ])
    expect(
      nativeSharingStatusSchema.safeParse({ ...status, failure: { ...failure, ...patch } }).success,
    ).toBe(false);
  expect(nativeSharingStatusSchema.parse(status).failure).toBeUndefined();
});
